import { promises as fs } from 'node:fs';
import { shotPath, shotContentType } from '@/web/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A file for a given job id never changes.
const CACHE = 'public, max-age=86400, immutable';

/** "bytes=0-1023", "bytes=500-", "bytes=-500" -> offsets, or null if it cannot be honoured. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  let start: number;
  let end: number;
  if (rawStart === '') {
    if (rawEnd === '') return null;
    const len = Number(rawEnd);
    if (!Number.isFinite(len) || len <= 0) return null;
    start = Math.max(0, size - len);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

async function readSlice(p: string, start: number, end: number): Promise<ArrayBuffer> {
  const handle = await fs.open(p, 'r');
  try {
    const length = end - start + 1;
    const buf = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buf, 0, length, start);
    const out = new ArrayBuffer(bytesRead);
    new Uint8Array(out).set(buf.subarray(0, bytesRead));
    return out;
  } finally {
    await handle.close();
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await ctx.params;
  const p = shotPath(id, file);
  if (!p) return new Response('Not found', { status: 404 });

  let size: number;
  try {
    const stat = await fs.stat(p);
    if (!stat.isFile()) return new Response('Not found', { status: 404 });
    size = stat.size;
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const type = shotContentType(file);
  const rangeHeader = req.headers.get('range');

  // WebKit will not play a video from a server that ignores Range.
  if (rangeHeader) {
    const range = parseRange(rangeHeader, size);
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes' },
      });
    }
    const body = await readSlice(p, range.start, range.end);
    return new Response(body, {
      status: 206,
      headers: {
        'content-type': type,
        'content-length': String(body.byteLength),
        'content-range': `bytes ${range.start}-${range.end}/${size}`,
        'accept-ranges': 'bytes',
        'cache-control': CACHE,
      },
    });
  }

  let body: ArrayBuffer;
  try {
    body = await readSlice(p, 0, Math.max(0, size - 1));
  } catch {
    return new Response('Not found', { status: 404 });
  }

  return new Response(body, {
    headers: {
      'content-type': type,
      'content-length': String(body.byteLength),
      'accept-ranges': 'bytes',
      'cache-control': CACHE,
    },
  });
}

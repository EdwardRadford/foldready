import { promises as fs } from 'node:fs';
import { shotPath } from '@/web/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await ctx.params;
  const p = shotPath(id, file);
  if (!p) return new Response('Not found', { status: 404 });

  let body: ArrayBuffer;
  try {
    const buf = await fs.readFile(p);
    body = new ArrayBuffer(buf.byteLength);
    new Uint8Array(body).set(buf);
  } catch {
    return new Response('Not found', { status: 404 });
  }

  return new Response(body, {
    headers: {
      'content-type': 'image/png',
      'content-length': String(body.byteLength),
      // A screenshot for a given job id never changes.
      'cache-control': 'public, max-age=86400, immutable',
    },
  });
}

import { getShot } from '@/web/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A file for a given job id never changes.
const CACHE = 'public, max-age=86400, immutable';

export async function GET(req: Request, ctx: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await ctx.params;
  // WebKit will not play a video from a server that ignores Range, so the store hands back the
  // slice the browser asked for, whether that comes off disk (localhost) or out of R2 (Workers).
  const shot = await getShot(id, file, req.headers.get('range'));

  if (shot.kind === 'not-found') return new Response('Not found', { status: 404 });

  if (shot.kind === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { 'content-range': `bytes */${shot.size}`, 'accept-ranges': 'bytes' },
    });
  }

  if (shot.kind === 'partial') {
    const length = shot.range.end - shot.range.start + 1;
    return new Response(shot.body, {
      status: 206,
      headers: {
        'content-type': shot.type,
        'content-length': String(length),
        'content-range': `bytes ${shot.range.start}-${shot.range.end}/${shot.size}`,
        'accept-ranges': 'bytes',
        'cache-control': CACHE,
      },
    });
  }

  return new Response(shot.body, {
    headers: {
      'content-type': shot.type,
      'content-length': String(shot.size),
      'accept-ranges': 'bytes',
      'cache-control': CACHE,
    },
  });
}

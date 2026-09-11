import { createJob, RateLimitError } from '@/web/jobs';
import { UrlError } from '@/engine/url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'local';
}

export async function POST(req: Request) {
  let url = '';
  let fresh = false;
  try {
    const body = (await req.json()) as { url?: unknown; fresh?: unknown };
    url = typeof body.url === 'string' ? body.url : '';
    fresh = body.fresh === true;
  } catch {
    return Response.json({ error: 'Send a web address to check.' }, { status: 400 });
  }

  try {
    const job = await createJob(url, clientIp(req), fresh);
    return Response.json({ id: job.id });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof UrlError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    return Response.json(
      { error: 'Something went wrong starting that check. Try again in a minute.' },
      { status: 500 },
    );
  }
}

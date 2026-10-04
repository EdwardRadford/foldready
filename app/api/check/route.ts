import { createJob, RateLimitError, statsContext } from '@/web/jobs';
import { domainOf, recordEvent } from '@/web/stats';
import { UrlError } from '@/engine/url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf;
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'local';
}

/** Count a check that never started (bad address, rate limit). Best effort. */
async function countRefused(url: string, country: string | undefined): Promise<void> {
  const stats = await statsContext().catch(() => undefined);
  if (!stats) return;
  const domain = domainOf(/^https?:\/\//i.test(url) ? url : `https://${url.trim()}`);
  stats.ctx.waitUntil(recordEvent(stats.db, { kind: 'check_refused', domain, country }));
}

// Two callers. The page's script posts JSON and gets JSON back. A plain form post (the button
// pressed before the page's script has loaded) gets a redirect: to the results page, or back to
// the home page with the error in the address so the form can show it.
export async function POST(req: Request) {
  const isForm = (req.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded');
  const country = req.headers.get('cf-ipcountry') ?? undefined;

  let url = '';
  let fresh = false;
  try {
    if (isForm) {
      const value = (await req.formData()).get('url');
      url = typeof value === 'string' ? value : '';
    } else {
      const body = (await req.json()) as { url?: unknown; fresh?: unknown };
      url = typeof body.url === 'string' ? body.url : '';
      fresh = body.fresh === true;
    }
  } catch {
    return Response.json({ error: 'Send a web address to check.' }, { status: 400 });
  }

  // The form path sends a short code, not the message, so the home page only ever shows its own
  // fixed wording (FORM_ERRORS in app/page.tsx), never text taken from the address bar.
  const reply = (status: number, payload: { id?: string; error?: string }): Response => {
    if (!isForm) return Response.json(payload, { status });
    const target = new URL(payload.id ? `/r/${payload.id}` : '/', req.url);
    if (!payload.id) {
      const code = status === 429 ? 'busy' : status === 400 ? (url.trim() === '' ? 'empty' : 'address') : 'failed';
      target.searchParams.set('error', code);
      if (url) target.searchParams.set('url', url.slice(0, 300));
    }
    return Response.redirect(target.toString(), 303);
  };

  if (url.trim() === '') return reply(400, { error: 'Type a web address first.' });

  try {
    const job = await createJob(url, clientIp(req), fresh, country);
    return reply(200, { id: job.id });
  } catch (err) {
    if (err instanceof RateLimitError) {
      await countRefused(url, country);
      return reply(429, { error: err.message });
    }
    if (err instanceof UrlError) {
      await countRefused(url, country);
      return reply(400, { error: err.message });
    }
    return reply(500, { error: 'Something went wrong starting that check. Try again in a minute.' });
  }
}

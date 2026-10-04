import { statsContext } from '@/web/jobs';
import { isAdmin } from '@/web/admin-auth';
import { cleanPath, dailyHash, isBot, recordEvent, referrerHost } from '@/web/stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OWN_HOSTS = ['foldready.co.uk', 'foldready.edward-radford.workers.dev', 'localhost'];

// The page-view beacon (app/_components/PageBeacon.tsx). Always answers 204 and never sets a
// cookie: a failed or skipped count is invisible to the visitor.
export async function POST(req: Request) {
  const done = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

  const ua = req.headers.get('user-agent');
  if (isBot(ua) || isAdmin(req)) return done(); // crawlers, and Ed's own browser once signed in

  let body: { path?: unknown; referrer?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return done();
  }
  const path = cleanPath(body.path);
  if (!path) return done();

  const stats = await statsContext().catch(() => undefined);
  if (!stats) return done();

  const ip = req.headers.get('cf-connecting-ip') ?? '';
  stats.ctx.waitUntil(
    (async () => {
      const visitor = await dailyHash(stats.db, 'visit', ip, ua ?? '');
      await recordEvent(stats.db, {
        kind: 'visit',
        path,
        referrer: referrerHost(body.referrer, OWN_HOSTS),
        country: req.headers.get('cf-ipcountry') ?? undefined,
        visitor,
      });
    })().catch(() => {}),
  );
  return done();
}

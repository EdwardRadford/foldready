import { getJob } from '@/web/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) {
    return Response.json({ error: 'No check with that link.' }, { status: 404 });
  }
  return Response.json(job, {
    headers: { 'cache-control': 'no-store' },
  });
}

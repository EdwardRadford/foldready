import { NextResponse } from 'next/server';
import { isAdmin, adminToken } from '@/web/admin-auth';
import { deleteJob } from '@/web/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!adminToken()) {
    return new Response('Admin is not configured.', { status: 503 });
  }
  if (!isAdmin(req)) {
    return new Response('Not signed in.', { status: 401 });
  }
  const { id } = await ctx.params;
  await deleteJob(id);
  return NextResponse.redirect(new URL('/admin', req.url), { status: 303 });
}

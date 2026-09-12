import { NextResponse } from 'next/server';
import {
  ADMIN_COOKIE,
  ADMIN_COOKIE_MAX_AGE,
  adminToken,
  cookieValueFor,
  timingSafeStringsEqual,
} from '@/web/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const token = adminToken();
  if (!token) {
    return new Response('Admin is not configured.', { status: 503 });
  }

  let submitted = '';
  try {
    const form = await req.formData();
    submitted = String(form.get('token') ?? '');
  } catch {
    submitted = '';
  }

  const url = new URL(req.url);
  if (!submitted || !timingSafeStringsEqual(submitted, token)) {
    return NextResponse.redirect(new URL('/admin/login?error=1', url), { status: 303 });
  }

  const res = NextResponse.redirect(new URL('/admin', url), { status: 303 });
  res.cookies.set(ADMIN_COOKIE, cookieValueFor(token), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });
  return res;
}

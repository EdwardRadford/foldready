import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Guards the whole admin area: if ADMIN_TOKEN is unset, nothing under /admin or /api/admin
// works at all, and everything that does work is tagged noindex.
export function middleware(_req: NextRequest) {
  if (!process.env.ADMIN_TOKEN) {
    return new NextResponse('Admin is not configured.', { status: 503 });
  }
  const res = NextResponse.next();
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};

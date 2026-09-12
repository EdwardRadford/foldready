// Minimal admin auth. One shared token (ADMIN_TOKEN), one cookie holding an HMAC of it —
// nothing to store, nothing to rotate per session.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const ADMIN_COOKIE = 'fr_admin';
export const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds

/** The configured admin token, or undefined when the admin area is switched off. */
export function adminToken(): string | undefined {
  const t = process.env.ADMIN_TOKEN;
  return t && t.length > 0 ? t : undefined;
}

function sha256(input: string): Buffer {
  return createHash('sha256').update(input, 'utf8').digest();
}

/** Constant-time string comparison (hashes both sides first so length never leaks either). */
export function timingSafeStringsEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

/** The value the cookie should hold for a given token: HMAC-SHA256, keyed by the token itself. */
export function cookieValueFor(token: string): string {
  return createHmac('sha256', token).update(token).digest('hex');
}

function cookieFromHeader(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return part.slice(i + 1).trim();
      }
    }
  }
  return undefined;
}

/** For route handlers: does this request carry a cookie signed with the current token? */
export function isAdmin(req: Request): boolean {
  const token = adminToken();
  if (!token) return false;
  const value = cookieFromHeader(req.headers.get('cookie'), ADMIN_COOKIE);
  if (!value) return false;
  return timingSafeStringsEqual(value, cookieValueFor(token));
}

/** For server components: redirects to the login page unless signed in. */
export async function requireAdmin(): Promise<void> {
  const token = adminToken();
  if (!token) redirect('/admin/login');
  const jar = await cookies();
  const value = jar.get(ADMIN_COOKIE)?.value;
  if (!value || !timingSafeStringsEqual(value, cookieValueFor(token))) {
    redirect('/admin/login');
  }
}

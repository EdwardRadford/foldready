import { promises as dns } from 'node:dns';

export class UrlError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
  }
}

/** Normalise user input to an absolute http(s) URL. Throws UrlError on junk. */
export function normaliseUrl(input: string): URL {
  let s = (input ?? '').trim();
  if (!s) throw new UrlError('Enter a web address to check.', 'empty');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new UrlError('That does not look like a web address.', 'invalid');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new UrlError('Only http and https addresses can be checked.', 'scheme');
  }
  if (u.username || u.password) throw new UrlError('Addresses with a username or password are not supported.', 'credentials');
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') {
    throw new UrlError('That does not look like a public web address.', 'hostname');
  }
  u.hash = '';
  return u;
}

/**
 * Which kind of IP literal this string is, by shape alone. Deliberately not `node:net`: this file
 * runs in Node (the engine) and on workerd (the Worker), and node's net helpers are not dependable
 * in the second, which silently turned public addresses into "private" refusals.
 */
function ipVersion(s: string): 4 | 6 | 0 {
  if (s.includes(':')) return /^[0-9a-f:.]+$/i.test(s) ? 6 : 0;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return 0;
  return m.slice(1).every((n) => Number(n) <= 255) ? 4 : 0;
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateV6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return true;
  if (s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) return true; // link-local
  if (s.startsWith('fc') || s.startsWith('fd')) return true; // unique local
  if (s.startsWith('::ffff:')) return isPrivateV4(s.slice(7));
  return false;
}

/**
 * True when this address points somewhere internal. A string that is not an IP at all returns
 * false: callers pass resolver answers, which are always addresses, and treating an unrecognised
 * string as private refused real sites rather than protecting anything.
 */
export function isPrivateAddress(ip: string): boolean {
  const v = ipVersion(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return false;
}

/**
 * Everything the SSRF guard can decide without a resolver: the scheme, the shape of the host and
 * any IP typed straight into the box. Safe in any runtime.
 */
export function assertPublicHostSyntactic(u: URL): void {
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new UrlError('Local and internal addresses cannot be checked.', 'private');
  }
  if (ipVersion(host) !== 0 && isPrivateAddress(host)) {
    throw new UrlError('Private network addresses cannot be checked.', 'private');
  }
}

/**
 * The full guard: the checks above, then a real DNS lookup. Node only — on workerd the lookup is
 * not dependable, so the Worker runs the syntactic half plus DNS-over-HTTPS and leaves the
 * authoritative check to the engine, which calls this before it opens a browser.
 */
export async function assertPublicHost(u: URL, allowLocal = false): Promise<void> {
  if (allowLocal) return;
  assertPublicHostSyntactic(u);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (ipVersion(host) !== 0) return; // an IP literal, already judged above

  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new UrlError('That address could not be found. Check the spelling and try again.', 'dns');
  }
  if (addrs.length === 0) throw new UrlError('That address could not be found.', 'dns');
  if (addrs.some((a) => isPrivateAddress(a.address))) {
    throw new UrlError('That address points at a private network and cannot be checked.', 'private');
  }
}

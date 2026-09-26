// Tests for the URL guard in src/engine/url.ts.
//
// This module is the only thing standing between a public check endpoint and the
// machine's own network, and it is the one engine file that runs in both runtimes:
// Node in the Cloud Run engine, workerd in the Worker. These tests are table-driven
// and run offline — every case is either pure string work or an IP literal, so
// nothing here performs a DNS lookup.
//
// The same table covers src/url.ts in the standalone foldready-engine repo. Keep the
// two in step: the one behavioural difference is noted against the last case below.

import { describe, it, expect } from 'vitest';
import {
  normaliseUrl,
  isPrivateAddress,
  assertPublicHostSyntactic,
  assertPublicHost,
  UrlError,
} from '../src/engine/url';

/** Assert that fn throws a UrlError carrying the given code. */
function expectUrlError(fn: () => unknown, code: string, label: string) {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, label).toBeInstanceOf(UrlError);
  expect((thrown as UrlError).code, label).toBe(code);
}

// --------------------------------------------------------------------------
// normaliseUrl
// --------------------------------------------------------------------------

describe('normaliseUrl', () => {
  it('assumes https for input with no scheme', () => {
    const cases: [string, string][] = [
      ['example.com', 'https://example.com/'],
      ['  example.com  ', 'https://example.com/'],
      ['example.com/pricing', 'https://example.com/pricing'],
      ['example.com:8443/a?b=1', 'https://example.com:8443/a?b=1'],
      ['sub.example.co.uk', 'https://sub.example.co.uk/'],
    ];
    for (const [input, expected] of cases) {
      expect(normaliseUrl(input).href, input).toBe(expected);
    }
  });

  it('keeps an explicit http or https scheme', () => {
    for (const input of ['http://example.com/', 'https://example.com/']) {
      expect(normaliseUrl(input).href).toBe(input);
    }
  });

  it('rejects credentials embedded in the URL', () => {
    // A URL carrying credentials is either a copy-paste accident or an attempt to
    // make the renderer authenticate as somebody. Neither is a page to check.
    const cases = [
      'https://user:pass@example.com',
      'https://user@example.com',
      'https://:pass@example.com',
      'http://admin:hunter2@example.com/dashboard',
    ];
    for (const input of cases) {
      expectUrlError(() => normaliseUrl(input), 'credentials', input);
    }
  });

  it('rejects every scheme but http and https', () => {
    for (const input of ['ftp://example.com', 'file:///etc/passwd', 'ws://example.com', 'gopher://example.com']) {
      expectUrlError(() => normaliseUrl(input), 'scheme', input);
    }
  });

  it('rejects junk, with a code naming the reason', () => {
    // javascript: and data: have no "://" so they are never treated as schemes; they
    // fail as unparseable instead, which is the same refusal by a shorter route.
    const cases: [string, string][] = [
      ['', 'empty'],
      ['   ', 'empty'],
      ['javascript:alert(1)', 'invalid'],
      ['data:text/html,<script>1</script>', 'invalid'],
      ['http://ex ample', 'invalid'],
      ['https://intranet', 'hostname'],
      ['https://wiki', 'hostname'],
    ];
    for (const [input, code] of cases) {
      expectUrlError(() => normaliseUrl(input), code, JSON.stringify(input));
    }
  });

  it('drops the fragment and keeps path, query and port', () => {
    const u = normaliseUrl('example.com:8443/a/b?q=1&r=2#anchor');
    expect(u.hash).toBe('');
    expect(u.pathname).toBe('/a/b');
    expect(u.search).toBe('?q=1&r=2');
    expect(u.port).toBe('8443');
  });

  it('accepts localhost, leaving it for the host guard to refuse', () => {
    // Two layers on purpose: parsing says "this is a URL", the host guard says "you
    // may not fetch it". --allow-local turns off only the second one.
    expect(normaliseUrl('localhost').href).toBe('https://localhost/');
    expectUrlError(() => assertPublicHostSyntactic(normaliseUrl('localhost')), 'private', 'localhost');
  });
});

// --------------------------------------------------------------------------
// isPrivateAddress
// --------------------------------------------------------------------------

describe('isPrivateAddress', () => {
  it('blocks the reserved IPv4 ranges', () => {
    const cases: [string, string][] = [
      ['0.0.0.0', 'this host, 0.0.0.0/8'],
      ['10.0.0.1', 'private 10/8'],
      ['127.0.0.1', 'loopback 127/8'],
      ['100.64.0.1', 'carrier-grade NAT 100.64/10, low end'],
      ['100.127.255.255', 'carrier-grade NAT 100.64/10, high end'],
      ['169.254.169.254', 'link-local 169.254/16, the cloud metadata address'],
      ['172.16.0.1', 'private 172.16/12, low end'],
      ['172.31.255.255', 'private 172.16/12, high end'],
      ['192.0.0.1', 'IETF protocol assignments 192.0.0/24'],
      ['192.168.1.1', 'private 192.168/16'],
      ['198.18.0.1', 'benchmarking 198.18/15, low end'],
      ['198.19.255.255', 'benchmarking 198.18/15, high end'],
      ['224.0.0.1', 'multicast 224/4'],
      ['239.255.255.255', 'multicast 224/4, high end'],
      ['255.255.255.255', 'broadcast'],
    ];
    for (const [ip, why] of cases) {
      expect(isPrivateAddress(ip), `${ip} (${why}) should be blocked`).toBe(true);
    }
  });

  it('allows public IPv4, including addresses just outside each reserved range', () => {
    const cases: [string, string][] = [
      ['8.8.8.8', 'public resolver'],
      ['93.184.216.34', 'ordinary public host'],
      ['100.63.255.255', 'just below carrier-grade NAT'],
      ['100.128.0.1', 'just above carrier-grade NAT'],
      ['169.253.255.255', 'just below link-local'],
      ['172.15.255.255', 'just below private 172.16/12'],
      ['172.32.0.1', 'just above private 172.16/12'],
      ['198.17.255.255', 'just below benchmarking'],
      ['198.20.0.1', 'just above benchmarking'],
      ['223.255.255.255', 'just below multicast'],
    ];
    for (const [ip, why] of cases) {
      expect(isPrivateAddress(ip), `${ip} (${why}) should be allowed`).toBe(false);
    }
  });

  it('blocks the reserved IPv6 ranges', () => {
    const cases: [string, string][] = [
      ['::', 'unspecified'],
      ['::1', 'loopback'],
      ['fe80::1', 'link-local fe80::/10, low end'],
      ['febf:ffff::1', 'link-local fe80::/10, high end'],
      ['fec0::1', 'site-local fec0::/10, deprecated'],
      ['feff:ffff::1', 'site-local fec0::/10, high end'],
      ['fc00::1', 'unique local fc00::/7, low end'],
      ['fdff:ffff::1', 'unique local fc00::/7, high end'],
      ['ff02::1', 'multicast, all nodes on the link'],
      ['ff05::1:3', 'multicast, site-local'],
      ['FE80::1', 'uppercase is the same address'],
    ];
    for (const [ip, why] of cases) {
      expect(isPrivateAddress(ip), `${ip} (${why}) should be blocked`).toBe(true);
    }
  });

  it('allows public IPv6', () => {
    const cases: [string, string][] = [
      ['2001:4860:4860::8888', 'public resolver'],
      ['2606:4700:4700::1111', 'public resolver'],
      ['2a00:1450:4009:81f::200e', 'ordinary public host'],
    ];
    for (const [ip, why] of cases) {
      expect(isPrivateAddress(ip), `${ip} (${why}) should be allowed`).toBe(false);
    }
  });

  it('judges IPv4-mapped IPv6 on the address it embeds', () => {
    // ::ffff:127.0.0.1 reaches loopback. Blocking 127.0.0.1 and not its mapped form
    // would be a guard with a hole in it.
    const cases: [string, boolean][] = [
      ['::ffff:127.0.0.1', true],
      ['::ffff:10.0.0.1', true],
      ['::ffff:169.254.169.254', true],
      ['::ffff:192.168.0.1', true],
      ['::ffff:8.8.8.8', false],
      ['::ffff:0808:0808', true], // same address in hex; not parsed, so it fails closed
    ];
    for (const [ip, expected] of cases) {
      expect(isPrivateAddress(ip), ip).toBe(expected);
    }
  });

  it('returns false for a string that is not an IP at all, and is never asked about one', () => {
    // This is the one place this file differs on purpose from the standalone engine's
    // copy, which fails closed here. Every caller passes either a resolver answer or a
    // host that ipVersion() has already confirmed is an IP literal, so an arbitrary
    // string never reaches this function in practice — and when an earlier version did
    // treat unrecognised strings as private, it refused real sites instead of
    // protecting anything. The gate is asserted immediately below.
    for (const input of ['', 'not-an-ip', 'example.com', '10.0.0', '1.2.3.4.5', '999.1.1.1', '::gg']) {
      expect(isPrivateAddress(input), JSON.stringify(input)).toBe(false);
    }
  });
});

// --------------------------------------------------------------------------
// assertPublicHostSyntactic — the half that runs on workerd, with no resolver
// --------------------------------------------------------------------------

describe('assertPublicHostSyntactic', () => {
  it('refuses local and internal hostname suffixes without a lookup', () => {
    const cases = [
      'http://localhost/',
      'http://localhost:3000/',
      'http://app.localhost/',
      'http://printer.local/',
      'http://metadata.internal/',
      'http://db.svc.internal/',
    ];
    for (const input of cases) {
      expectUrlError(() => assertPublicHostSyntactic(new URL(input)), 'private', input);
    }
  });

  it('refuses private IP literals, v4 and bracketed v6', () => {
    const cases = [
      'http://127.0.0.1/',
      'http://127.0.0.1:8080/admin',
      'http://10.1.2.3/',
      'http://169.254.169.254/latest/meta-data/',
      'http://192.168.0.1/',
      'http://100.64.0.1/',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://[fec0::1]/',
      'http://[ff02::1]/',
    ];
    for (const input of cases) {
      expectUrlError(() => assertPublicHostSyntactic(new URL(input)), 'private', input);
    }
  });

  it('passes public IP literals and ordinary hostnames through', () => {
    // An ordinary hostname is the gate referred to above: isPrivateAddress is only
    // consulted for it after a resolver has turned it into addresses.
    const cases = [
      'http://8.8.8.8/',
      'https://93.184.216.34/',
      'http://[2001:4860:4860::8888]/',
      'https://example.com/',
      'https://www.gov.uk/',
    ];
    for (const input of cases) {
      expect(() => assertPublicHostSyntactic(new URL(input)), input).not.toThrow();
    }
  });
});

// --------------------------------------------------------------------------
// assertPublicHost — the full guard. Only the no-lookup paths are exercised.
// --------------------------------------------------------------------------

describe('assertPublicHost', () => {
  it('refuses private hosts and IP literals before it reaches a resolver', async () => {
    const cases = ['http://localhost:3000/', 'http://127.0.0.1/', 'http://[::1]/', 'http://[ff02::1]/'];
    for (const input of cases) {
      await expect(assertPublicHost(new URL(input)), input).rejects.toThrow(UrlError);
    }
  });

  it('passes public IP literals straight through, still without a lookup', async () => {
    for (const input of ['http://8.8.8.8/', 'https://93.184.216.34/', 'http://[2001:4860:4860::8888]/']) {
      await expect(assertPublicHost(new URL(input)), input).resolves.toBeUndefined();
    }
  });

  it('allowLocal turns the guard off entirely, which is what --allow-local is for', async () => {
    for (const input of ['http://localhost:3000/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/']) {
      await expect(assertPublicHost(new URL(input), true), input).resolves.toBeUndefined();
    }
  });

  it('UrlError carries a machine-readable code alongside the message', () => {
    const e = new UrlError('nope', 'private');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('private');
    expect(e.message).toBe('nope');
  });
});

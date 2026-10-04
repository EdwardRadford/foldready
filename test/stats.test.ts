// The pure helpers behind the stats: what counts as a bot, how paths and referrers are folded.
import { describe, expect, it } from 'vitest';
import { cleanPath, domainOf, isBot, referrerHost } from '../src/web/stats';

describe('isBot', () => {
  it.each([
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', true],
    ['LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)', true],
    ['facebookexternalhit/1.1', true],
    ['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', true],
    ['curl/8.4.0', true],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0', true],
    ['', true],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      false,
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
      false,
    ],
  ])('%s -> %s', (ua, bot) => {
    expect(isBot(ua)).toBe(bot);
  });
});

describe('cleanPath', () => {
  it.each([
    ['/', '/'],
    ['/?utm=x', '/'],
    ['/r/abc123defg', '/r/:id'],
    ['/r/sample', '/r/sample'],
    ['/fix/abc123defg', '/fix/:id'],
    ['/admin/stats', undefined],
    ['/api/hit', undefined],
    ['https://evil.example/', undefined],
    [42, undefined],
  ])('%s -> %s', (input, out) => {
    expect(cleanPath(input)).toBe(out);
  });
});

describe('referrerHost', () => {
  const own = ['foldready.co.uk'];
  it.each([
    ['https://www.linkedin.com/feed/', 'www.linkedin.com'],
    ['https://foldready.co.uk/r/sample', undefined],
    ['https://www.foldready.co.uk/', undefined],
    ['', undefined],
    ['javascript:alert(1)', undefined],
    ['not a url', undefined],
  ])('%s -> %s', (input, out) => {
    expect(referrerHost(input, own)).toBe(out);
  });
});

describe('domainOf', () => {
  it('takes the hostname of a checked address', () => {
    expect(domainOf('https://www.bbc.co.uk/news')).toBe('www.bbc.co.uk');
    expect(domainOf('nope')).toBeUndefined();
  });
});

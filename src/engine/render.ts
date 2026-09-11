import { webkit, chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright';
import type { ViewportSpec } from './types';
import { FOLDED, UNFOLDED, SPLIT, USER_AGENT } from './device';
import { PROBE_SOURCE, type DomMetrics } from './probe';

export class RenderError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
  }
}

export interface Capture {
  viewport: ViewportSpec;
  metrics: DomMetrics;
  png: Buffer;          // full page (capped)
  fullHeight: number;   // CSS px captured
}

export interface RenderOutput {
  engine: 'webkit' | 'chromium';
  finalUrl: string;
  status: number;
  html: string;
  cssTexts: string[];
  folded: Capture;
  unfolded: Capture;
  split: Capture;
  foldTransition: Capture;   // folded load, then resized to unfolded without reload
}

export interface RenderOptions {
  onProgress?: (msg: string) => void;
  navTimeoutMs?: number;
  maxPageHeight?: number;   // CSS px cap for full-page shots
  scale?: number;           // deviceScaleFactor
  engine?: 'webkit' | 'chromium';
}

const STILL_CSS = `*, *::before, *::after { animation-play-state: paused !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }`;

let browserPromise: Promise<Browser> | null = null;
let browserEngine: 'webkit' | 'chromium' = 'webkit';

async function getBrowser(engine: 'webkit' | 'chromium'): Promise<Browser> {
  if (browserPromise && browserEngine === engine) {
    const b = await browserPromise;
    if (b.isConnected()) return b;
  }
  browserEngine = engine;
  browserPromise = (engine === 'webkit' ? webkit : chromium).launch({ headless: true });
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    await b?.close().catch(() => {});
  }
}

async function newContext(browser: Browser, vp: ViewportSpec, scale: number): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: scale,
    isMobile: true,
    hasTouch: true,
    userAgent: USER_AGENT,
    locale: 'en-GB',
    reducedMotion: 'reduce',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
}

function describeGotoError(e: unknown): RenderError {
  const msg = String((e as Error)?.message ?? e);
  if (/Timeout/i.test(msg)) return new RenderError('The page took too long to load, so we could not check it.', 'timeout');
  if (/ENOTFOUND|getaddrinfo|Could not connect|net::ERR_NAME_NOT_RESOLVED|cannot find server/i.test(msg)) {
    return new RenderError('That address could not be found. Check the spelling and try again.', 'dns');
  }
  if (/ECONNREFUSED|Connection refused|net::ERR_CONNECTION_REFUSED/i.test(msg)) return new RenderError('The site refused the connection.', 'refused');
  if (/SSL|certificate|net::ERR_CERT/i.test(msg)) return new RenderError('The site has a certificate problem, so we could not load it.', 'tls');
  return new RenderError('The page could not be loaded.', 'load');
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  await page.addStyleTag({ content: STILL_CSS }).catch(() => {});
  await page.waitForTimeout(400);
}

/** Scroll through the page to trigger lazy content, then return to the top. */
async function warmLazyContent(page: Page, maxHeight: number): Promise<void> {
  await page
    .evaluate(async (cap) => {
      const step = Math.max(300, window.innerHeight);
      const total = Math.min(document.documentElement.scrollHeight, cap);
      for (let y = 0; y < total; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 200));
    }, maxHeight)
    .catch(() => {});
}

async function probe(page: Page): Promise<DomMetrics> {
  return (await page.evaluate(PROBE_SOURCE)) as DomMetrics;
}

async function shoot(page: Page, vp: ViewportSpec, maxHeight: number): Promise<{ png: Buffer; fullHeight: number }> {
  const scrollHeight = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)).catch(() => vp.height);
  const fullHeight = Math.max(vp.height, Math.min(scrollHeight, maxHeight));
  const png = await page.screenshot({
    fullPage: true,
    clip: { x: 0, y: 0, width: vp.width, height: fullHeight },
    animations: 'disabled',
    caret: 'hide',
    timeout: 20000,
  });
  return { png, fullHeight };
}

async function capture(page: Page, vp: ViewportSpec, maxHeight: number): Promise<Capture> {
  await warmLazyContent(page, maxHeight);
  const metrics = await probe(page);
  const { png, fullHeight } = await shoot(page, vp, maxHeight);
  return { viewport: vp, metrics, png, fullHeight };
}

interface Loaded { page: Page; response: Response | null }

async function load(page: Page, url: string, timeout: number): Promise<Loaded> {
  let response: Response | null;
  try {
    // DOM first, then give the full load a bounded chance. Heavy sites never reach "load" quickly.
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  } catch (e) {
    throw describeGotoError(e);
  }
  await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
  await settle(page);
  return { page, response };
}

export async function renderAll(url: string, opts: RenderOptions = {}): Promise<RenderOutput> {
  const engine = opts.engine ?? 'webkit';
  const navTimeoutMs = opts.navTimeoutMs ?? 25000;
  const maxPageHeight = opts.maxPageHeight ?? 5000;
  const scale = opts.scale ?? 2;
  const progress = opts.onProgress ?? (() => {});

  const browser = await getBrowser(engine);
  const cssTexts: string[] = [];
  const seenCss = new Set<string>();

  // --- Folded context: primary load, collects HTML + CSS, then the fold simulation.
  progress('Loading the page at the folded size');
  const ctxFolded = await newContext(browser, FOLDED, scale);
  const foldedPage = await ctxFolded.newPage();
  foldedPage.on('response', async (r) => {
    try {
      const ct = r.headers()['content-type'] ?? '';
      const u = r.url();
      if ((ct.includes('text/css') || /\.css(\?|$)/i.test(u)) && !seenCss.has(u) && r.ok()) {
        seenCss.add(u);
        const t = await r.text();
        if (t.length < 3_000_000) cssTexts.push(t);
      }
    } catch {
      /* body may be gone; ignore */
    }
  });

  let html = '';
  let finalUrl = url;
  let status = 0;
  let folded: Capture;
  let foldTransition: Capture;
  try {
    const { response } = await load(foldedPage, url, navTimeoutMs);
    status = response?.status() ?? 0;
    finalUrl = foldedPage.url();
    const ct = response?.headers()['content-type'] ?? '';
    if (response && ct && !/html|xml/i.test(ct)) {
      throw new RenderError('That address is not a web page, so there is nothing to render.', 'not-html');
    }
    if (status === 401 || status === 403) throw new RenderError('The page is behind a login or a block, so we could not check it.', 'blocked');
    if (status >= 400) throw new RenderError(`The page returned an error (${status}).`, 'http');
    html = await foldedPage.content();
    const inlineCss = await foldedPage.evaluate(() => Array.from(document.querySelectorAll('style')).map((s) => s.textContent ?? '')).catch(() => [] as string[]);
    cssTexts.push(...inlineCss);

    folded = await capture(foldedPage, FOLDED, maxPageHeight);

    progress('Unfolding without a reload');
    await foldedPage.setViewportSize({ width: UNFOLDED.width, height: UNFOLDED.height });
    await foldedPage.waitForTimeout(900);
    await foldedPage.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await foldedPage.waitForTimeout(300);
    const metrics = await probe(foldedPage);
    const shot = await shoot(foldedPage, UNFOLDED, maxPageHeight);
    foldTransition = { viewport: UNFOLDED, metrics, png: shot.png, fullHeight: shot.fullHeight };
  } finally {
    await ctxFolded.close().catch(() => {});
  }

  // --- Fresh loads at unfolded and split, in parallel.
  const fresh = async (vp: ViewportSpec, label: string): Promise<Capture> => {
    progress(`Rendering the ${label} view`);
    const ctx = await newContext(browser, vp, scale);
    try {
      const page = await ctx.newPage();
      await load(page, url, navTimeoutMs);
      return await capture(page, vp, maxPageHeight);
    } finally {
      await ctx.close().catch(() => {});
    }
  };
  const [unfolded, split] = await Promise.all([fresh(UNFOLDED, 'unfolded'), fresh(SPLIT, 'split')]);

  return { engine, finalUrl, status, html, cssTexts, folded, unfolded, split, foldTransition };
}

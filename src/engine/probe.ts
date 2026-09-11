// The in-page probe. Runs inside the rendered page via page.evaluate. Must stay self-contained:
// no imports, no closures over Node scope. Returns plain JSON.

export interface Box { key: string; x: number; y: number; w: number; h: number }
export interface DomMetrics {
  innerWidth: number;
  innerHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  viewportMeta: string | null;
  overflowing: { sel: string; width: number; right: number; explicit: boolean }[];
  smallTapTargets: { sel: string; w: number; h: number }[];
  smallTapTotal: number;
  tapTotal: number;
  textChars: number;
  smallTextChars: number;
  vhHeroes: { sel: string; height: number }[];
  headerHeight: number;
  fixedCoverage: number;      // fraction of viewport height covered by fixed/sticky bars
  navPresent: boolean;
  navVisible: boolean;
  menuToggle: boolean;        // a visible burger/menu button in the first screen
  bigTables: { sel: string; width: number }[];
  boxes: Box[];
  title: string;
}

// Kept as a plain string so bundlers never transform it; it runs verbatim inside WebKit.
export const PROBE_SOURCE = String.raw`(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const doc = document.documentElement, body = document.body;
  const sel = (el) => {
    const parts = [];
    let cur = el, depth = 0;
    while (cur && cur.nodeType === 1 && depth < 3 && cur !== body) {
      let s = cur.tagName.toLowerCase();
      if (cur.id) { s += '#' + cur.id; parts.unshift(s); break; }
      const cls = (typeof cur.className === 'string' ? cur.className : '').trim().split(/\s+/).filter(Boolean)[0];
      if (cls) s += '.' + cls;
      parts.unshift(s);
      cur = cur.parentElement; depth++;
    }
    return parts.join(' > ').slice(0, 80);
  };
  const visible = (el, r) => {
    if (!(r.width > 0 && r.height > 0)) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };
  // An element wider than the screen is fine if a parent clips or scrolls it (carousels, code blocks).
  const clippedByAncestor = (el) => {
    let p = el.parentElement;
    while (p && p !== body) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'hidden' || ox === 'auto' || ox === 'scroll' || ox === 'clip') {
        if (p.getBoundingClientRect().right <= vw + 2) return true;
      }
      p = p.parentElement;
    }
    return false;
  };
  const all = Array.from(body ? body.querySelectorAll('*') : []).slice(0, 5000);

  const overflowing = [];
  const smallTaps = []; let tapTotal = 0; let menuToggle = false;
  let textChars = 0, smallTextChars = 0;
  const vhHeroes = [];
  const bigTables = [];
  const fixedRects = [];
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'link' || tag === 'meta') continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    const cs = getComputedStyle(el);
    if (r.right > vw + 2 && r.width > 40 && overflowing.length < 12 && !clippedByAncestor(el)) {
      const explicit = /px$/.test(el.style.width || '') || el.hasAttribute('width') || (/px$/.test(cs.minWidth) && parseFloat(cs.minWidth) > vw);
      overflowing.push({ sel: sel(el), width: Math.round(r.width), right: Math.round(r.right), explicit });
    }
    const role = el.getAttribute('role');
    if ((tag === 'a' && el.hasAttribute('href')) || tag === 'button' || (tag === 'input' && el.type !== 'hidden') || tag === 'select' || tag === 'textarea' || role === 'button' || role === 'link') {
      const inlineText = cs.display === 'inline' && tag === 'a' && el.parentElement && /^(p|li|td|span|em|strong|small|dd|figcaption|blockquote)$/i.test(el.parentElement.tagName);
      if (r.top < vh * 3 && r.bottom > 0 && !inlineText) {
        tapTotal++;
        const small = (r.width < 44 && r.height < 44) || r.height < 28 || r.width < 28;
        if (small && smallTaps.length < 200) smallTaps.push({ sel: sel(el), w: Math.round(r.width), h: Math.round(r.height) });
      }
      const hint = ((el.getAttribute('aria-label') || '') + ' ' + (typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '')).toLowerCase();
      if (!menuToggle && r.top < vh && r.width >= 20 && r.height >= 20 && (/menu|burger|hamburger|nav-toggle|navbar-toggle|toggle/.test(hint) || el.hasAttribute('aria-expanded'))) menuToggle = true;
    }
    let chars = 0;
    for (const n of el.childNodes) if (n.nodeType === 3) chars += (n.textContent || '').trim().length;
    if (chars > 0) {
      textChars += chars;
      if (parseFloat(cs.fontSize) < 16) smallTextChars += chars;
    }
    if (r.top < vh && Math.abs(r.height - vh) <= 2 && r.width >= vw * 0.9 && (tag === 'section' || tag === 'div' || tag === 'header' || tag === 'main') && vhHeroes.length < 5) {
      vhHeroes.push({ sel: sel(el), height: Math.round(r.height) });
    }
    if (tag === 'table' && r.width > 500 && (el.hasAttribute('width') || /px$/.test(el.style.width || '')) && bigTables.length < 5) {
      bigTables.push({ sel: sel(el), width: Math.round(r.width) });
    }
    // Bars only: full-screen fixed layers are backgrounds or overlays, not headers.
    if ((cs.position === 'fixed' || cs.position === 'sticky') && r.width >= vw * 0.8 && r.height <= vh * 0.6 && r.top < vh && fixedRects.length < 10) {
      fixedRects.push([Math.max(0, r.top), Math.min(vh, r.bottom)]);
    }
  }
  fixedRects.sort((a, b) => a[0] - b[0]);
  let covered = 0, curTop = -1, curBot = -1;
  for (const [t, b] of fixedRects) {
    if (t > curBot) { if (curBot > curTop) covered += curBot - curTop; curTop = t; curBot = b; }
    else curBot = Math.max(curBot, b);
  }
  if (curBot > curTop) covered += curBot - curTop;

  const header = document.querySelector('header, [role=banner], .header, #header, .site-header');
  const headerRect = header ? header.getBoundingClientRect() : null;
  const nav = document.querySelector('nav, [role=navigation], .nav, .menu, #menu');
  const navRect = nav ? nav.getBoundingClientRect() : null;

  const boxes = [];
  const walk = (el, depth, prefix) => {
    let i = 0;
    for (const child of el.children) {
      if (boxes.length >= 400) return;
      const tag = child.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'noscript') continue;
      const r = child.getBoundingClientRect();
      const key = prefix + '/' + tag + (child.id ? '#' + child.id : '') + '[' + i + ']';
      i++;
      if (r.width === 0 && r.height === 0) continue;
      boxes.push({ key, x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) });
      if (depth < 2) walk(child, depth + 1, key);
    }
  };
  if (body) walk(body, 0, '');

  const meta = document.querySelector('meta[name="viewport" i]');
  return {
    innerWidth: vw, innerHeight: vh,
    scrollWidth: Math.max(doc.scrollWidth, body ? body.scrollWidth : 0),
    scrollHeight: Math.max(doc.scrollHeight, body ? body.scrollHeight : 0),
    viewportMeta: meta ? meta.getAttribute('content') : null,
    overflowing,
    smallTapTargets: smallTaps.slice(0, 12),
    smallTapTotal: smallTaps.length,
    tapTotal,
    textChars, smallTextChars,
    vhHeroes,
    headerHeight: headerRect ? Math.round(headerRect.height) : 0,
    fixedCoverage: vh ? covered / vh : 0,
    navPresent: !!nav,
    navVisible: !!(navRect && navRect.width > 0 && navRect.height > 0 && navRect.top < vh),
    menuToggle,
    bigTables,
    boxes,
    title: document.title || ''
  };
})()`;

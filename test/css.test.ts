import { describe, it, expect } from 'vitest';
import { extractMediaQueries, analyseCss, analyseViewportMeta, detectPlatform } from '../src/engine/css';
import { classify } from '../src/engine/classify';
import type { Finding } from '../src/engine/types';
import type { DomMetrics } from '../src/engine/probe';

describe('extractMediaQueries', () => {
  it('reads min and max width in px, em and range syntax', () => {
    const css = `
      @media (max-width: 480px) { a { color: red } }
      @media screen and (min-width:30em){b{}}
      @media (width >= 700px) { c {} }
      @media print { d {} }
    `;
    const q = extractMediaQueries(css);
    expect(q).toHaveLength(4);
    expect(q[0].maxWidth).toBe(480);
    expect(q[1].minWidth).toBe(480);
    expect(q[2].minWidth).toBe(700);
    expect(q[3].minWidth).toBeUndefined();
  });
});

describe('analyseCss', () => {
  it('flags breakpoints in the folded trap band once each', () => {
    const info = analyseCss(['@media (max-width: 450px){a{}} @media (max-width: 450px){b{}} @media (min-width: 768px){c{}}']);
    expect(info.trapQueries).toHaveLength(1);
    expect(info.widthQueries).toHaveLength(3);
  });
  it('keeps only landscape rules that would fire at the unfolded size', () => {
    const info = analyseCss([
      '@media (orientation: landscape){a{}}',
      '@media (orientation: landscape) and (min-width: 1024px){b{}}',
      '@media (max-width: 767px) and (orientation: landscape){c{}}',
      '@media screen and (orientation:landscape) and (max-height: 500px){d{}}',
    ]);
    expect(info.landscapeQueries.map((q) => q.raw)).toEqual([
      '(orientation: landscape)',
      'screen and (orientation:landscape) and (max-height: 500px)',
    ]);
  });
  it('counts 100vh and dvh separately', () => {
    const info = analyseCss(['.hero{min-height:100vh} .m{height: 100dvh} .x{height:calc(100vh - 80px)}']);
    expect(info.vh.count).toBe(2);
    expect(info.vh.dvhOrSvh).toBe(1);
  });
  it('spots fixed-width page containers', () => {
    const info = analyseCss(['#wrapper{width:960px;margin:0 auto} .btn{width:120px}']);
    expect(info.fixedWidthRules).toHaveLength(1);
  });
});

describe('analyseViewportMeta', () => {
  it('handles missing, device-width, fixed and zoom-blocking tags', () => {
    expect(analyseViewportMeta(null).present).toBe(false);
    expect(analyseViewportMeta('width=device-width, initial-scale=1').deviceWidth).toBe(true);
    expect(analyseViewportMeta('width=1024').fixedWidth).toBe(1024);
    expect(analyseViewportMeta('width=device-width, user-scalable=no').blocksZoom).toBe(true);
    expect(analyseViewportMeta('width=device-width, maximum-scale=1').blocksZoom).toBe(true);
    expect(analyseViewportMeta('width=device-width, maximum-scale=10').blocksZoom).toBe(false);
  });
});

describe('detectPlatform', () => {
  it('recognises the big builders', () => {
    expect(detectPlatform('<link href="/wp-content/themes/x.css">')).toBe('wordpress');
    expect(detectPlatform('<script src="https://static1.squarespace.com/x.js">')).toBe('squarespace');
    expect(detectPlatform('<img src="https://static.wixstatic.com/a.png">')).toBe('wix');
    expect(detectPlatform('<html data-wf-page="1">')).toBe('webflow');
    expect(detectPlatform('<script src="https://cdn.shopify.com/s/x.js">')).toBe('shopify');
    expect(detectPlatform('<html><body>' + 'x'.repeat(300) + '</body></html>')).toBe('custom');
  });
});

const baseMetrics: DomMetrics = {
  innerWidth: 466, innerHeight: 678, scrollWidth: 466, scrollHeight: 2000, viewportMeta: 'width=device-width',
  overflowing: [], smallTapTargets: [], smallTapTotal: 0, tapTotal: 10, textChars: 1000, smallTextChars: 100,
  vhHeroes: [], headerHeight: 60, fixedCoverage: 0.1, navPresent: true, navVisible: true, menuToggle: false,
  bigTables: [], images: [], textBlocks: [], overlay: null, boxes: [], title: 't',
  a11y: { hasLang: true, hasTitle: true, hasDescription: true, h1Count: 1, imgTotal: 0, imgNoAlt: 0, inputTotal: 0, inputNoLabel: 0, linkTotal: 5, linkNoText: 0 },
};
const f = (status: Finding['status'], id: string = status): Finding => ({ id, status, title: id, detail: id });
const responsiveCss = analyseCss(['@media (max-width: 767px){a{}}']);
const vm = analyseViewportMeta('width=device-width');

describe('classify', () => {
  it('passes with no fails, whatever the warn count', () => {
    expect(classify({ findings: [f('warn', 'a'), f('warn', 'b'), f('warn', 'c')], css: responsiveCss, viewportMeta: vm, folded: baseMetrics }).outcome).toBe('passes');
  });
  it('is patchable when responsive but failing', () => {
    expect(classify({ findings: [f('fail', 'overflow-folded')], css: responsiveCss, viewportMeta: vm, folded: baseMetrics }).outcome).toBe('patchable');
  });
  it('needs more without a viewport tag or media queries', () => {
    const noVm = analyseViewportMeta(null);
    expect(classify({ findings: [f('fail')], css: responsiveCss, viewportMeta: noVm, folded: baseMetrics }).outcome).toBe('needs-more');
    expect(classify({ findings: [f('fail')], css: analyseCss(['a{}']), viewportMeta: vm, folded: baseMetrics }).outcome).toBe('needs-more');
  });
  it('needs more with a fixed-width page container or layout table', () => {
    const fixed = { ...baseMetrics, overflowing: [{ sel: 'div#wrapper', width: 960, right: 960, explicit: true }] };
    expect(classify({ findings: [f('fail')], css: responsiveCss, viewportMeta: vm, folded: fixed }).outcome).toBe('needs-more');
    const table = { ...baseMetrics, bigTables: [{ sel: 'table', width: 940 }] };
    expect(classify({ findings: [f('fail')], css: responsiveCss, viewportMeta: vm, folded: table }).outcome).toBe('needs-more');
  });
});

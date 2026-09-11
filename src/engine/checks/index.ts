// Every check returns pass | warn | fail (or info) with one plain-English sentence.
import type { Finding, ViewportId } from '../types';
import type { RenderOutput, Capture } from '../render';
import type { CssInfo } from '../css';
import { analyseViewportMeta } from '../css';
import type { Comparison } from '../compare';
import { FOLDED, UNFOLDED, SPLIT } from '../device';

export interface CheckInput {
  render: RenderOutput;
  css: CssInfo;
  fold: Comparison;
}

const label: Record<ViewportId, string> = { folded: 'folded screen', unfolded: 'unfolded screen', split: 'Split View' };

function overflowCheck(cap: Capture, id: ViewportId): Finding {
  const m = cap.metrics;
  const extra = m.scrollWidth - m.innerWidth;
  if (extra <= 1) {
    return { id: `overflow-${id}`, status: 'pass', viewport: id, title: `Fits the ${label[id]}`, detail: `Nothing spills past the right edge at ${cap.viewport.width}px wide.` };
  }
  const evidence = m.overflowing.map((o) => `${o.sel} is ${o.width}px wide${o.explicit ? ' (fixed width)' : ''}`);
  return {
    id: `overflow-${id}`,
    status: 'fail',
    viewport: id,
    title: `Horizontal scrollbar on the ${label[id]}`,
    detail: `The page is ${extra}px wider than the ${label[id]} (${cap.viewport.width}px), so it scrolls sideways.`,
    evidence,
  };
}

export function runChecks({ render, css, fold }: CheckInput): Finding[] {
  const f: Finding[] = [];
  const folded = render.folded.metrics;

  // 1. viewport meta
  const vm = analyseViewportMeta(folded.viewportMeta);
  if (!vm.present) {
    f.push({ id: 'viewport-meta', status: 'fail', title: 'No viewport meta tag', detail: 'Without it, Safari renders the page at desktop width and shrinks it to fit, so nothing adapts to the Duo.' });
  } else if (vm.fixedWidth && !vm.deviceWidth) {
    f.push({ id: 'viewport-meta', status: 'fail', title: `Viewport locked to ${vm.fixedWidth}px`, detail: 'The viewport tag sets a fixed width, so the page is scaled rather than laid out for the screen.', evidence: [vm.content ?? ''] });
  } else if (vm.blocksZoom) {
    f.push({ id: 'viewport-meta', status: 'warn', title: 'Pinch zoom is disabled', detail: 'The viewport tag blocks zooming. Not a Duo problem, but worth removing.', evidence: [vm.content ?? ''] });
  } else {
    f.push({ id: 'viewport-meta', status: 'pass', title: 'Viewport tag is set correctly', detail: 'The page tells Safari to use the real screen width.' });
  }

  // 2. overflow at each width
  f.push(overflowCheck(render.folded, 'folded'));
  f.push(overflowCheck(render.unfolded, 'unfolded'));
  f.push(overflowCheck(render.split, 'split'));

  // 3. fixed pixel widths wider than the folded screen
  const fixedWide = folded.overflowing.filter((o) => o.explicit);
  const foldedOverflows = folded.scrollWidth > folded.innerWidth + 1;
  if (fixedWide.length > 0 || css.fixedWidthRules.length > 0) {
    f.push({
      id: 'fixed-width',
      status: fixedWide.length > 0 && foldedOverflows ? 'fail' : 'warn',
      viewport: 'folded',
      title: 'Elements with a fixed pixel width',
      detail: fixedWide.length > 0
        ? `${fixedWide.length} element${fixedWide.length === 1 ? ' is' : 's are'} set to a pixel width wider than the folded screen.`
        : 'The stylesheet sets a fixed pixel width on a page container; it may not adapt at every Duo size.',
      evidence: [...fixedWide.map((o) => `${o.sel}: ${o.width}px`), ...css.fixedWidthRules],
    });
  } else {
    f.push({ id: 'fixed-width', status: 'pass', title: 'No fixed-width elements', detail: 'Widths are fluid, which is what the three Duo sizes need.' });
  }

  // 4. 100vh usage
  const heroes = folded.vhHeroes;
  if (heroes.length > 0) {
    f.push({
      id: 'vh-units',
      status: 'warn',
      viewport: 'folded',
      title: 'A full-height section is pinned to the screen height',
      detail: 'On the folded screen the height is short, and it changes again on unfolding. A section sized to 100vh can cut content off or jump when the phone opens.',
      evidence: [...heroes.map((h) => `${h.sel} is ${h.height}px tall`), ...css.vh.samples],
    });
  } else if (css.vh.count > 0) {
    f.push({ id: 'vh-units', status: 'pass', title: 'No sections pinned to the screen height', detail: 'The stylesheet mentions 100vh, but nothing in the first screen is sized to it, so folding will not cut content off.', evidence: css.vh.samples });
  } else if (css.vh.dvhOrSvh > 0) {
    f.push({ id: 'vh-units', status: 'pass', title: 'Height units are fold-safe', detail: 'The page uses dvh or svh units, which track the real screen height.' });
  } else {
    f.push({ id: 'vh-units', status: 'pass', title: 'No 100vh sections', detail: 'Nothing is pinned to the screen height, so folding will not cut content off.' });
  }

  // 5. breakpoints in the folded trap band
  if (css.trapQueries.length > 0) {
    const tabletSide = css.trapQueries.filter((q) => (q.maxWidth !== undefined && q.maxWidth < FOLDED.width) || (q.minWidth !== undefined && q.minWidth <= FOLDED.width));
    if (tabletSide.length > 0) {
      f.push({
        id: 'breakpoint-band',
        status: 'warn',
        viewport: 'folded',
        title: 'Folded screen gets the wider layout',
        detail: `The layout switches at a width just under ${FOLDED.width}px, so the folded screen lands on the wider-layout side. It may get a cramped tablet layout on a phone-sized screen.`,
        evidence: tabletSide.map((q) => `@media ${q.raw}`).slice(0, 8),
      });
    } else {
      f.push({
        id: 'breakpoint-band',
        status: 'pass',
        viewport: 'folded',
        title: 'Folded screen stays in the phone layout',
        detail: `A breakpoint sits just above ${FOLDED.width}px, but the folded screen falls on the phone side of it. Worth re-checking once real device sizes are confirmed.`,
        evidence: css.trapQueries.map((q) => `@media ${q.raw}`).slice(0, 8),
      });
    }
  } else if (css.widthQueries.length > 0) {
    f.push({ id: 'breakpoint-band', status: 'pass', title: 'No breakpoints near the folded width', detail: `None of the ${css.widthQueries.length} width breakpoints land between 440px and 500px.` });
  }

  // 6. tap targets (folded)
  if (folded.tapTotal > 0) {
    const ratio = folded.smallTapTotal / folded.tapTotal;
    if (folded.smallTapTotal >= 3 && ratio > 0.25) {
      f.push({
        id: 'tap-targets',
        status: 'warn',
        viewport: 'folded',
        title: 'Some tap targets are small',
        detail: `${folded.smallTapTotal} of ${folded.tapTotal} links and buttons near the top are under 44px, which is fiddly on a phone.`,
        evidence: folded.smallTapTargets.map((t) => `${t.sel}: ${t.w}×${t.h}px`),
      });
    } else {
      f.push({ id: 'tap-targets', status: 'pass', title: 'Tap targets are big enough', detail: 'Links and buttons are comfortably tappable on the folded screen.' });
    }
  }

  // 7. text size (folded)
  if (folded.textChars > 200) {
    const pct = Math.round((folded.smallTextChars / folded.textChars) * 100);
    if (pct > 50) {
      f.push({ id: 'text-size', status: 'warn', viewport: 'folded', title: 'Most text is under 16px', detail: `About ${pct}% of the text on the folded screen is smaller than 16px.` });
    } else {
      f.push({ id: 'text-size', status: 'pass', title: 'Text is readable', detail: `Most text on the folded screen is 16px or larger.` });
    }
  }

  // 8. fold transition: the Duo-specific check
  const ft = render.foldTransition.metrics;
  if (fold.differs) {
    const why = fold.overflowOnlyAfterResize
      ? `After unfolding, the page is ${ft.scrollWidth - ft.innerWidth}px too wide, but a fresh load at the same size fits.`
      : `${fold.layoutShiftCount} of ${fold.comparedBoxes} layout blocks sit in a different place than they do after a fresh load (${fold.pixelDiffPct}% of the top screen differs).`;
    f.push({
      id: 'fold-transition',
      status: 'fail',
      viewport: 'unfolded',
      title: 'Layout does not update when the phone unfolds',
      detail: `${why} Scripts that measured the screen once at load time are not re-measuring.`,
      evidence: [`pixel difference ${fold.pixelDiffPct}%`, `layout blocks moved ${fold.layoutShiftCount}/${fold.comparedBoxes}`],
    });
  } else {
    f.push({ id: 'fold-transition', status: 'pass', viewport: 'unfolded', title: 'Layout updates when the phone unfolds', detail: 'Unfolding mid-session gives the same page as a fresh load at the unfolded size.' });
  }

  // 9. landscape sanity (unfolded)
  const u = render.unfolded.metrics;
  const headerPct = Math.round((u.headerHeight / UNFOLDED.height) * 100);
  const fixedPct = Math.round(u.fixedCoverage * 100);
  if (headerPct > 40 || fixedPct > 45) {
    f.push({
      id: 'landscape-header',
      status: 'warn',
      viewport: 'unfolded',
      title: 'Header takes a lot of the unfolded screen',
      detail: headerPct > 40
        ? `The header is ${u.headerHeight}px tall, about ${headerPct}% of the ${UNFOLDED.height}px unfolded screen, leaving little room for content.`
        : `Fixed bars cover about ${fixedPct}% of the unfolded screen height.`,
    });
  } else {
    f.push({ id: 'landscape-header', status: 'pass', viewport: 'unfolded', title: 'Unfolded screen has room for content', detail: `The header and any fixed bars leave most of the ${UNFOLDED.height}px height free.` });
  }
  if (u.navPresent && !u.navVisible && !u.menuToggle) {
    f.push({ id: 'landscape-nav', status: 'warn', viewport: 'unfolded', title: 'Navigation is off screen when unfolded', detail: 'The navigation element exists but is not visible in the first screen at the unfolded size.' });
  }

  // 10. Split View note
  if (render.split.metrics.scrollWidth <= SPLIT.width + 1 && render.folded.metrics.scrollWidth <= FOLDED.width + 1) {
    f.push({ id: 'split-view', status: 'pass', viewport: 'split', title: 'Works in Split View', detail: `The page fits the ${SPLIT.width}px half-screen used when two apps share the inner display.` });
  }

  const order = { fail: 0, warn: 1, info: 2, pass: 3 } as const;
  return f.sort((a, b) => order[a.status] - order[b.status]);
}

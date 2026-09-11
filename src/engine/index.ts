import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Result, Shot } from './types';
import { VIEWPORTS, EMULATION_NOTE, UNFOLDED } from './device';
import { normaliseUrl, assertPublicHost, UrlError } from './url';
import { renderAll, RenderError, type RenderOutput } from './render';
import { analyseCss, analyseViewportMeta, detectPlatform } from './css';
import { compareFold } from './compare';
import { runChecks } from './checks';
import { classify } from './classify';

export { UrlError, RenderError };
export { closeBrowser } from './render';
export type { Result, Job, Finding, Shot, Outcome } from './types';

export interface RunOptions {
  id: string;
  outDir: string;
  onProgress?: (msg: string) => void;
  allowLocal?: boolean;         // skip the SSRF guard (tests only)
  engine?: 'webkit' | 'chromium';
  scale?: number;
}

export const SHOT_FILES = ['folded.png', 'unfolded.png', 'split.png', 'fold-transition.png'] as const;

async function writeShots(render: RenderOutput, outDir: string): Promise<Shot[]> {
  await fs.mkdir(outDir, { recursive: true });
  const entries: { kind: Shot['kind']; cap: RenderOutput['folded']; file: string }[] = [
    { kind: 'folded', cap: render.folded, file: 'folded.png' },
    { kind: 'unfolded', cap: render.unfolded, file: 'unfolded.png' },
    { kind: 'split', cap: render.split, file: 'split.png' },
    { kind: 'fold-transition', cap: render.foldTransition, file: 'fold-transition.png' },
  ];
  const shots: Shot[] = [];
  for (const e of entries) {
    await fs.writeFile(path.join(outDir, e.file), e.cap.png);
    shots.push({ kind: e.kind, file: e.file, width: e.cap.viewport.width, height: e.cap.viewport.height, fullHeight: e.cap.fullHeight });
  }
  return shots;
}

/**
 * Check one URL at the three Duo viewports plus the fold simulation.
 * Throws UrlError for bad input. Render failures come back as a Result with `error` set
 * (outcome needs-more, no findings) so the caller can still show something honest.
 */
export async function runCheck(input: string, opts: RunOptions): Promise<Result> {
  const started = Date.now();
  const progress = opts.onProgress ?? (() => {});
  const url = normaliseUrl(input);
  progress('Checking the address');
  await assertPublicHost(url, opts.allowLocal);

  const base: Omit<Result, 'outcome' | 'score' | 'summary' | 'findings' | 'shots' | 'foldTransition' | 'platform' | 'engine' | 'finalUrl' | 'durationMs'> = {
    id: opts.id,
    url: url.toString(),
    checkedAt: new Date().toISOString(),
    viewports: VIEWPORTS,
    emulationNote: EMULATION_NOTE,
  };

  let render: RenderOutput;
  try {
    render = await renderAll(url.toString(), { onProgress: progress, engine: opts.engine, scale: opts.scale });
  } catch (e) {
    const msg = e instanceof RenderError ? e.message : 'The page could not be rendered.';
    return {
      ...base,
      finalUrl: url.toString(),
      durationMs: Date.now() - started,
      engine: opts.engine ?? 'webkit',
      platform: 'unknown',
      outcome: 'needs-more',
      score: 0,
      summary: msg,
      findings: [],
      shots: [],
      foldTransition: { differs: false, pixelDiffPct: 0, layoutShiftCount: 0, note: 'Not tested because the page did not load.' },
      error: msg,
    };
  }

  progress('Comparing the fold');
  const css = analyseCss(render.cssTexts);
  const scale = opts.scale ?? 2;
  const fold = compareFold(
    { metrics: render.foldTransition.metrics, png: render.foldTransition.png },
    { metrics: render.unfolded.metrics, png: render.unfolded.png },
    UNFOLDED.height * scale,
  );
  const findings = runChecks({ render, css, fold });
  const viewportMeta = analyseViewportMeta(render.folded.metrics.viewportMeta);
  const cls = classify({ findings, css, viewportMeta, folded: render.folded.metrics });

  progress('Saving screenshots');
  const shots = await writeShots(render, opts.outDir);

  return {
    ...base,
    finalUrl: render.finalUrl,
    durationMs: Date.now() - started,
    engine: render.engine,
    platform: detectPlatform(render.html),
    outcome: cls.outcome,
    score: cls.score,
    summary: cls.summary,
    findings,
    shots,
    foldTransition: {
      differs: fold.differs,
      pixelDiffPct: fold.pixelDiffPct,
      layoutShiftCount: fold.layoutShiftCount,
      note: fold.differs
        ? 'After unfolding without a reload, the page does not match a fresh load at the unfolded size.'
        : 'After unfolding without a reload, the page matches a fresh load at the unfolded size.',
    },
  };
}

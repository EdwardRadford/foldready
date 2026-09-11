'use client';

import { useState } from 'react';
import type { Finding, FoldTransition, Shot, Video, ViewportSpec } from '@/engine/types';
import { cssVars, shotUrl } from './css';

const BEZEL = 16; // device px of frame around the screen, drawn in CSS

/** What the frame is showing. The stage is where the phone is; `fresh` swaps in a clean load. */
type Stage = 'first-load' | 'unfolded' | 'folded-back';
type View = 'folded' | 'after-unfold' | 'unfolded-fresh' | 'after-fold-back';

const FILE_FOR: Record<View, string> = {
  folded: 'folded.png',
  'after-unfold': 'fold-transition.png',
  'unfolded-fresh': 'unfolded.png',
  'after-fold-back': 'fold-back.png',
};

export default function FoldViewer({
  jobId,
  shots,
  videos,
  findings,
  foldTransition,
  viewports,
}: {
  jobId: string;
  shots: Shot[];
  videos?: Video[];
  findings?: Finding[];
  foldTransition: FoldTransition;
  viewports: ViewportSpec[];
}) {
  const [stage, setStage] = useState<Stage>('first-load');
  const [fresh, setFresh] = useState(false);
  const [missing, setMissing] = useState<Record<string, boolean>>({});

  const folded = viewports.find((v) => v.id === 'folded') ?? { width: 466, height: 678, label: 'Folded' };
  const unfolded = viewports.find((v) => v.id === 'unfolded') ?? { width: 890, height: 626, label: 'Unfolded' };

  const have = (file: string) => shots.some((s) => s.file === file);
  const haveFoldBack = have('fold-back.png');

  const open = stage === 'unfolded';
  const screen = open ? unfolded : folded;
  const view: View =
    stage === 'unfolded'
      ? fresh
        ? 'unfolded-fresh'
        : 'after-unfold'
      : stage === 'folded-back' && !fresh
        ? 'after-fold-back'
        : 'folded';
  const stillFile = FILE_FOR[view];

  // The clip only plays where it is the honest thing to show: a clean load at either size.
  // The page after a fold, either way, stays a still: that is the evidence.
  const evidence = view === 'after-unfold' || view === 'after-fold-back';
  const clip = videos?.find((v) => v.kind === (view === 'unfolded-fresh' ? 'unfolded' : 'folded'));
  const playing = !evidence && clip && !missing[clip.file] ? clip : undefined;

  const foldBackFail = findings?.find((f) => f.id === 'fold-back' && f.status === 'fail');

  // The placeholder sits at the bottom of the stack, so a clip that never loads shows it
  // through rather than leaving an empty white screen.
  const stillMissing = missing[stillFile] === true || !have(stillFile);

  // One scale for both states, so only the right edge moves when the phone opens.
  const scaleW = unfolded.width + BEZEL * 2;
  const scaleH = Math.max(folded.height, unfolded.height) + BEZEL * 2;

  const caption =
    view === 'after-unfold'
      ? `The inner screen, ${unfolded.width} × ${unfolded.height}, after the page was resized without a reload. That is what the phone does when it opens.`
      : view === 'unfolded-fresh'
        ? `A fresh load at ${unfolded.width} × ${unfolded.height}, for comparison.`
        : view === 'after-fold-back'
          ? 'The outer screen again, after closing the phone without a reload.'
          : stage === 'folded-back'
            ? `A fresh load at ${folded.width} × ${folded.height}, for comparison.`
            : `The outer screen, ${folded.width} × ${folded.height}. The top of the page, as someone first sees it.`;

  return (
    <div className="fold-row">
      <div className="fold-stage">
        <div className="fold-box" style={cssVars({ '--scale-w': scaleW, '--scale-h': scaleH })}>
          <div
            className="phone"
            style={cssVars({ '--w': screen.width + BEZEL * 2, '--h': screen.height + BEZEL * 2 })}
          >
            <div className="phone-screen">
              {stillMissing ? (
                <div className="shot-missing">
                  {screen.label} render, {screen.width} × {screen.height}
                </div>
              ) : null}
              {(Object.keys(FILE_FOR) as View[]).map((key) => {
                const file = FILE_FOR[key];
                if (missing[file] || !have(file)) return null;
                return (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={file}
                    src={shotUrl(jobId, file)}
                    alt={
                      key === 'folded' || key === 'after-fold-back'
                        ? 'The page on the folded screen'
                        : 'The page on the unfolded screen'
                    }
                    className={view === key ? 'on' : ''}
                    onError={() => setMissing((m) => ({ ...m, [file]: true }))}
                    ref={(el) => {
                      // An image that failed before hydration never fires onError.
                      if (el && el.complete && el.naturalWidth === 0) {
                        setMissing((m) => (m[file] ? m : { ...m, [file]: true }));
                      }
                    }}
                  />
                );
              })}
              {playing ? (
                <video
                  key={playing.file}
                  className="phone-video"
                  src={shotUrl(jobId, playing.file)}
                  poster={have(stillFile) ? shotUrl(jobId, stillFile) : undefined}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  aria-label="The page moving on the Duo screen"
                  onError={() => setMissing((m) => ({ ...m, [playing.file]: true }))}
                />
              ) : null}
              <div className={open ? 'phone-hinge on' : 'phone-hinge'} aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>

      <div className="fold-side">
        <p className="fold-lead">
          The page as it opens on the folded screen. Unfold it to see what the phone does when
          someone opens it mid-page, without the page reloading.
        </p>
        <div className="fold-controls btn-row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setFresh(false);
              // Folding back is only a separate state when there is a shot of it.
              setStage(open ? (haveFoldBack ? 'folded-back' : 'first-load') : 'unfolded');
            }}
          >
            {open ? 'Fold it back' : 'Unfold'}
          </button>
          {stage !== 'first-load' ? (
            <button type="button" className="btn btn-quiet" onClick={() => setFresh((f) => !f)}>
              {fresh
                ? open
                  ? 'Back to the unfolded view'
                  : 'Back to the folded view'
                : 'Compare with a fresh load'}
            </button>
          ) : null}
        </div>

        <p className="fold-state">{caption}</p>
        <p className="fold-state">{foldTransition.note}</p>

        {foldBackFail ? <div className="callout">{foldBackFail.title}</div> : null}

        {foldTransition.differs ? (
          <div className="callout">
            The page did not re-lay itself out after unfolding. The fresh load at{' '}
            {unfolded.width} × {unfolded.height} and the page after the fold differ by{' '}
            {foldTransition.pixelDiffPct.toFixed(1)}% of the screen
            {foldTransition.layoutShiftCount > 0
              ? `, across ${foldTransition.layoutShiftCount} element${foldTransition.layoutShiftCount === 1 ? '' : 's'}`
              : ''}
            . Someone who opens the phone mid-page keeps the folded layout until they reload.
          </div>
        ) : null}
      </div>
    </div>
  );
}

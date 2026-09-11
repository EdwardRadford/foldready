'use client';

import { useState } from 'react';
import type { FoldTransition, Shot, ViewportSpec } from '@/engine/types';
import { cssVars, shotUrl } from './css';

const BEZEL = 16; // device px of frame around the screen, drawn in CSS

type View = 'folded' | 'after-unfold' | 'fresh';

const FILE_FOR: Record<View, string> = {
  folded: 'folded.png',
  'after-unfold': 'fold-transition.png',
  fresh: 'unfolded.png',
};

export default function FoldViewer({
  jobId,
  shots,
  foldTransition,
  viewports,
}: {
  jobId: string;
  shots: Shot[];
  foldTransition: FoldTransition;
  viewports: ViewportSpec[];
}) {
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [missing, setMissing] = useState<Record<string, boolean>>({});

  const folded = viewports.find((v) => v.id === 'folded') ?? { width: 466, height: 678, label: 'Folded' };
  const unfolded = viewports.find((v) => v.id === 'unfolded') ?? { width: 890, height: 626, label: 'Unfolded' };

  const screen = open ? unfolded : folded;
  const view: View = open ? (fresh ? 'fresh' : 'after-unfold') : 'folded';
  const have = (file: string) => shots.some((s) => s.file === file);
  const activeFile = FILE_FOR[view];
  const activeMissing = missing[activeFile] === true || !have(activeFile);

  const caption =
    view === 'folded'
      ? `The outer screen, ${folded.width} × ${folded.height}. The top of the page, as someone first sees it.`
      : view === 'after-unfold'
        ? `The inner screen, ${unfolded.width} × ${unfolded.height}, after the page was resized without a reload. That is what the phone does when it opens.`
        : `A fresh load at ${unfolded.width} × ${unfolded.height}, for comparison.`;

  return (
    <div className="fold-row">
      <div className="fold-stage">
        <div
          className="phone"
          style={cssVars({ '--nat-w': screen.width + BEZEL * 2, '--nat-h': screen.height + BEZEL * 2 })}
        >
          <div className="phone-screen">
            {(Object.keys(FILE_FOR) as View[]).map((key) => {
              const file = FILE_FOR[key];
              if (missing[file] || !have(file)) return null;
              return (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={file}
                  src={shotUrl(jobId, file)}
                  alt={key === 'folded' ? 'The page on the folded screen' : 'The page on the unfolded screen'}
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
            {activeMissing ? (
              <div className="shot-missing">
                {screen.label} render, {screen.width} × {screen.height}
              </div>
            ) : null}
            <div className={open ? 'phone-crease on' : 'phone-crease'} aria-hidden="true" />
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
            setOpen((o) => {
              if (o) setFresh(false);
              return !o;
            });
          }}
        >
          {open ? 'Fold it back' : 'Unfold'}
        </button>
        {open ? (
          <button type="button" className="btn btn-quiet" onClick={() => setFresh((f) => !f)}>
            {fresh ? 'Back to the unfolded view' : 'Compare with a fresh load'}
          </button>
        ) : null}
      </div>

      <p className="fold-state">{caption}</p>
      <p className="fold-state">{foldTransition.note}</p>

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

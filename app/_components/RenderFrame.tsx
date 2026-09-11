'use client';

import { useState } from 'react';
import type { Shot, ViewportSpec } from '@/engine/types';
import { cssVars, shotUrl } from './css';

/**
 * A browser-ish frame at the viewport's aspect, holding the full-page screenshot.
 * Hover scrolls the page inside the frame; on touch the frame scrolls normally.
 */
export default function RenderFrame({
  jobId,
  viewport,
  shot,
}: {
  jobId: string;
  viewport: ViewportSpec;
  shot?: Shot;
}) {
  const [failed, setFailed] = useState(false);

  const fullHeight = Math.max(shot?.fullHeight ?? viewport.height, viewport.height);
  // The image is 100% of the frame width, so its rendered height is fullHeight/width of that.
  // Shifting by this percentage of its own height brings the last screenful into view.
  const shiftPct = fullHeight > viewport.height ? -(1 - viewport.height / fullHeight) * 100 : 0;
  const seconds = Math.min(14, Math.max(1.5, fullHeight / 700));
  const show = shot && !failed;

  return (
    <div className="render">
      <div className="render-head">
        <h3>{viewport.label}</h3>
        <p className="dims">
          {viewport.width} × {viewport.height}
        </p>
        <p className="desc">{viewport.description}</p>
      </div>
      <div className="browser">
        <div className="browser-bar" aria-hidden="true">
          <span />
          <span />
          <span />
          <b />
        </div>
        <div
          className="scroller"
          style={cssVars({
            '--vw': viewport.width,
            '--vh': viewport.height,
            '--shift': `${shiftPct.toFixed(3)}%`,
            '--dur': `${seconds.toFixed(1)}s`,
          })}
        >
          {show ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={shotUrl(jobId, shot.file)}
              alt={`The full page at ${viewport.width} by ${viewport.height}`}
              onError={() => setFailed(true)}
              ref={(el) => {
                // An image that failed before hydration never fires onError.
                if (el && el.complete && el.naturalWidth === 0) setFailed(true);
              }}
            />
          ) : (
            <div className="flat">{viewport.label} render</div>
          )}
        </div>
      </div>
    </div>
  );
}

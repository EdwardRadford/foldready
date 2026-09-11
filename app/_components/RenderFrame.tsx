'use client';

import { useState } from 'react';
import type { Shot } from '@/engine/types';
import { cssVars, shotUrl } from './css';

/**
 * A browser-ish frame at one screen's aspect, holding the full-page screenshot.
 * Hover scrolls the page inside the frame; on touch the frame scrolls normally.
 */
export default function RenderFrame({
  jobId,
  label,
  width,
  height,
  description,
  shot,
}: {
  jobId: string;
  label: string;
  width: number;
  height: number;
  description?: string;
  shot?: Shot;
}) {
  const [failed, setFailed] = useState(false);

  const fullHeight = Math.max(shot?.fullHeight ?? height, height);
  // The image is 100% of the frame width, so its rendered height is fullHeight/width of that.
  // Shifting by this percentage of its own height brings the last screenful into view.
  const shiftPct = fullHeight > height ? -(1 - height / fullHeight) * 100 : 0;
  const seconds = Math.min(14, Math.max(1.5, fullHeight / 700));
  const show = shot && !failed;

  return (
    <div className="render">
      <div className="render-head">
        <h3>{label}</h3>
        <p className="dims">
          {width} × {height}
        </p>
        {description ? <p className="desc">{description}</p> : null}
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
            '--vw': width,
            '--vh': height,
            '--shift': `${shiftPct.toFixed(3)}%`,
            '--dur': `${seconds.toFixed(1)}s`,
          })}
        >
          {show ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={shotUrl(jobId, shot.file)}
              alt={`The full page at ${width} by ${height}`}
              onError={() => setFailed(true)}
              ref={(el) => {
                // An image that failed before hydration never fires onError.
                if (el && el.complete && el.naturalWidth === 0) setFailed(true);
              }}
            />
          ) : (
            <div className="flat">{label} render</div>
          )}
        </div>
      </div>
    </div>
  );
}

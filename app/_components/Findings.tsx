'use client';

import { useState } from 'react';
import type { Finding, Status, ViewportSpec } from '@/engine/types';

const RANK: Record<Status, number> = { fail: 0, warn: 1, pass: 2, info: 3 };
const WORD: Record<Status, string> = { fail: 'Fail', warn: 'Warning', pass: 'Pass', info: 'Note' };
const SHOWN = 6;

export default function Findings({
  findings,
  viewports,
}: {
  findings: Finding[];
  viewports: ViewportSpec[];
}) {
  const [all, setAll] = useState(false);
  const ordered = [...findings].sort((a, b) => RANK[a.status] - RANK[b.status]);
  const visible = all ? ordered : ordered.slice(0, SHOWN);
  const hidden = ordered.length - visible.length;

  const label = (id?: string) => viewports.find((v) => v.id === id)?.label;

  return (
    <>
      <div className="findings">
        {visible.map((f) => (
          <div className="finding" key={f.id}>
            <div className="finding-head">
              <span className={`dot dot-${f.status}`} aria-hidden="true" />
              <span className={`finding-mark mark-${f.status}`}>{WORD[f.status]}</span>
              {f.viewport ? <span className="finding-where">{label(f.viewport)}</span> : null}
            </div>
            <h3>{f.title}</h3>
            <p>{f.detail}</p>
            {f.evidence && f.evidence.length > 0 ? (
              <details>
                <summary>Evidence</summary>
                <ul>
                  {f.evidence.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ))}
      </div>
      {hidden > 0 ? (
        <button type="button" className="link-btn" onClick={() => setAll(true)}>
          See all {ordered.length}
        </button>
      ) : null}
      {all && ordered.length > SHOWN ? (
        <button type="button" className="link-btn" onClick={() => setAll(false)}>
          Show fewer
        </button>
      ) : null}
    </>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Job } from '@/engine/types';
import ResultView from '../../_components/ResultView';

const POLL_MS = 1500;

export default function Poller({ initial }: { initial: Job }) {
  const [job, setJob] = useState<Job>(initial);

  useEffect(() => {
    if (job.state === 'done' || job.state === 'error') return;
    let stopped = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${initial.id}`, { cache: 'no-store' });
        if (!res.ok) return;
        const next = (await res.json()) as Job;
        if (!stopped) setJob(next);
      } catch {
        // keep polling; a dropped request is not a failed check
      }
    };

    const timer = window.setInterval(tick, POLL_MS);
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [initial.id, job.state]);

  if (job.state === 'error' || (job.state === 'done' && !job.result)) {
    return (
      <div className="wrap">
        <div className="status-page">
          <h1>That check did not finish.</h1>
          <p>{job.error ?? 'Something went wrong while loading that site.'}</p>
          <div className="btn-row">
            <Link className="btn" href="/">
              Try another address
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (job.state !== 'done' || !job.result) {
    const shown = job.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return (
      <div className="wrap">
        <div className="status-page">
          <h1>Checking {shown}</h1>
          <p>{job.progress || 'Waiting for a browser'}</p>
          <div className="bar" aria-hidden="true">
            <i />
          </div>
          <p className="note" style={{ marginTop: 24 }}>
            This takes about forty seconds. The link in your address bar keeps working, so you can
            come back to it.
          </p>
        </div>
      </div>
    );
  }

  return <ResultView result={job.result} />;
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Re-runs the same address, skipping the cached result. */
export default function CheckAgain({ url, quiet }: { url: string; quiet?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function again() {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, fresh: true }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setError(data.error ?? 'That check could not be started. Try again in a minute.');
        setBusy(false);
        return;
      }
      router.push(`/r/${data.id}`);
    } catch {
      setError('That check could not be started. Check your connection and try again.');
      setBusy(false);
    }
  }

  if (quiet) {
    return (
      <>
        <button type="button" className="link-btn" onClick={again} disabled={busy}>
          {busy ? 'Starting' : 'Check again'}
        </button>
        {error ? <span className="err">{error}</span> : null}
      </>
    );
  }

  return (
    <div>
      <button type="button" className="btn btn-quiet" onClick={again} disabled={busy}>
        {busy ? 'Starting' : 'Check again'}
      </button>
      {error ? <p className="err">{error}</p> : null}
    </div>
  );
}

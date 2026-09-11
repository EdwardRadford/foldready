'use client';

import { useState } from 'react';

export default function NotifyForm({ jobId, url }: { jobId: string; url: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === 'busy') return;
    setError('');
    setState('busy');
    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, url, jobId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'That did not save. Try again in a minute.');
        setState('idle');
        return;
      }
      setState('done');
    } catch {
      setError('That did not save. Check your connection and try again.');
      setState('idle');
    }
  }

  if (state === 'done') {
    return <p className="note">Noted. You will hear from me once the checks run on a real Duo.</p>;
  }

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="notify-email" className="note">
        Tell me when you can test on real hardware
      </label>
      <div className="field" style={{ marginTop: 8 }}>
        <input
          id="notify-email"
          type="email"
          autoComplete="email"
          placeholder="you@yourbusiness.co.uk"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={state === 'busy'}
        />
        <button type="submit" className="btn btn-quiet" disabled={state === 'busy' || email.trim() === ''}>
          {state === 'busy' ? 'Saving' : 'Let me know'}
        </button>
      </div>
      {error ? <p className="err">{error}</p> : null}
    </form>
  );
}

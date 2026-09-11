'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CheckForm() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setError(data.error ?? 'That check could not be started. Try again in a minute.');
        setBusy(false);
        return;
      }
      router.push(`/r/${data.id}`);
    } catch {
      setError('The check could not be started. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="url" className="sr-only" style={{ position: 'absolute', left: '-9999px' }}>
          Web address
        </label>
        <input
          id="url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="yourbusiness.co.uk"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
        />
        <button className="btn" type="submit" disabled={busy || url.trim() === ''}>
          {busy ? 'Starting' : 'Check my site'}
        </button>
      </div>
      {error ? <p className="err">{error}</p> : null}
    </form>
  );
}

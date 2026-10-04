'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// The form works before its script has loaded: it is a real form posting to /api/check, which
// redirects to the results page. Once the script is running, submit is taken over with fetch.
// Without this, an address typed and sent in the first moments after the page arrived went
// nowhere: the button was still disabled from the server render, and hydration then emptied the
// box (found 4 Oct 2026, three times out of three).
export default function CheckForm({ initialUrl = '', initialError = '' }: { initialUrl?: string; initialError?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  // Keep anything typed before hydration rather than resetting the box to the server's value.
  useEffect(() => {
    const typed = input.current?.value ?? '';
    if (typed !== '') setUrl(typed);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (url.trim() === '') {
      setError('Type a web address first.');
      input.current?.focus();
      return;
    }
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
    <form action="/api/check" method="post" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="url" className="sr-only" style={{ position: 'absolute', left: '-9999px' }}>
          Web address
        </label>
        <input
          ref={input}
          id="url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="yourbusiness.co.uk"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          readOnly={busy}
        />
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Starting' : 'Check my site'}
        </button>
      </div>
      {error ? <p className="err">{error}</p> : null}
    </form>
  );
}

'use client';

import { useState } from 'react';

export default function CopyLink() {
  const [done, setDone] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    } catch {
      setDone(false);
    }
  }

  return (
    <button type="button" className="link-btn" onClick={copy}>
      {done ? 'Link copied' : 'Copy link'}
    </button>
  );
}

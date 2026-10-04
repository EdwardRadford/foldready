'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

// Counts a page view once the page has loaded in a real browser: the path, and on the first page
// of a visit the site the visitor came from. Nothing is stored on the device. See src/web/stats.ts.
export default function PageBeacon() {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    if (!pathname || pathname.startsWith('/admin')) return;
    const payload = JSON.stringify({ path: pathname, referrer: first.current ? document.referrer : '' });
    first.current = false;
    try {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon?.('/api/hit', blob)) return;
    } catch {
      // fall through to fetch
    }
    void fetch('/api/hit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);

  return null;
}

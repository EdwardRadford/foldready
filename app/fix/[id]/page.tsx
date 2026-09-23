import Link from 'next/link';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { getJob } from '@/web/jobs';
import Offer from '../../_components/Offer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Get it Fold Ready',
  robots: { index: false, follow: false },
};

export default async function FixPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  const shown = job ? job.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';

  // Build the results link from the host this page was served on, so it is right on whatever
  // address Fold Ready is running at. Never hard-code a domain.
  const h = await headers();
  const host = h.get('host') ?? '';
  const origin = host ? `${host.startsWith('localhost') ? 'http' : 'https'}://${host}` : '';

  const subject = `Fold Ready fix: ${shown || id}`;
  const body = `Hello,\n\nMy site ${shown || ''} did not come out well on the iPhone Duo check:\n${origin}/r/${id}\n\nCan you fix it?\n`;

  return (
    <div className="wrap">
      <div className="result-head">
        {shown ? <p className="url">{shown}</p> : null}
        <h1>Get it Fold Ready</h1>
      </div>

      <Offer hideHeading />

      <section className="calm">
        <p>
          Send me the results link and I will tell you what it needs, what it would cost and how
          long it takes. No obligation either way.
        </p>
        <div className="btn-row">
          <a
            className="btn"
            href={`mailto:contact@edwardradford.co.uk?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
          >
            Email me about this site
          </a>
          <Link className="btn btn-quiet" href={`/r/${id}`}>
            Back to the results
          </Link>
        </div>
      </section>
    </div>
  );
}

import Link from 'next/link';
import type { Metadata } from 'next';
import { getJob } from '@/web/jobs';
import Offer from '../../_components/Offer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Get it Fold Ready — £149',
  robots: { index: false, follow: false },
};

export default async function FixPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  const shown = job ? job.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';

  const subject = `Fold Ready fix: ${shown || id}`;

  return (
    <div className="wrap">
      <div className="result-head">
        {shown ? <p className="url">{shown}</p> : null}
        <h1>Get it Fold Ready</h1>
      </div>

      <Offer hideHeading />

      <section className="calm">
        <p>Checkout is coming; email contact@edwardradford.co.uk to go first.</p>
        <div className="btn-row">
          <a className="btn" href={`mailto:contact@edwardradford.co.uk?subject=${encodeURIComponent(subject)}`}>
            Email me to go first
          </a>
          <Link className="btn btn-quiet" href={`/r/${id}`}>
            Back to the results
          </Link>
        </div>
      </section>
    </div>
  );
}

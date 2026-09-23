import Link from 'next/link';

/**
 * What a fix covers. No price and no payment: Ed's decision on 23 Sep 2026 is that Fold Ready
 * ships as "get in touch and I will fix it", so every path here ends in an email, not a checkout.
 */
export default function Offer({ jobId, hideHeading }: { jobId?: string; hideHeading?: boolean }) {
  return (
    <section className="offer">
      {hideHeading ? null : <h2>Want it fixed?</h2>}
      <p className="price">I fix these for a living. Send me the link and I will sort it.</p>
      <ul>
        <li>Breakpoints corrected so the folded width gets the layout it should have.</li>
        <li>Heroes and panels built on 100vh resized so nothing is cut off on the short screens.</li>
        <li>A resize shim so sliders, maps and menus re-measure when the phone is opened.</li>
        <li>Whatever is spilling sideways tracked down, so the page stops scrolling horizontally.</li>
      </ul>
      <p className="excludes">
        It is not a redesign, it cannot rescue a site that was never responsive, and it does not
        cover bugs in your theme or plugins.
      </p>
      {jobId ? (
        <div className="btn-row">
          <Link className="btn" href={`/fix/${jobId}`}>
            Get in touch about a fix
          </Link>
        </div>
      ) : null}
    </section>
  );
}

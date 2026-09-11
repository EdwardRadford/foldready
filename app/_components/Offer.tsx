import Link from 'next/link';

/** The one offer. Price and guarantee are locked copy: do not reword. */
export default function Offer({ jobId, hideHeading }: { jobId?: string; hideHeading?: boolean }) {
  return (
    <section className="offer">
      {hideHeading ? null : <h2>Get it Fold Ready</h2>}
      <p className="price">£149, one-off. No subscription, no call, no quote.</p>
      <p className="guarantee">See it fixed at both Duo screen sizes or your money back.</p>
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
            Fix it for £149
          </Link>
        </div>
      ) : null}
    </section>
  );
}

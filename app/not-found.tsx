import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="wrap">
      <div className="status-page">
        <h1>Nothing here.</h1>
        <p>That link does not point at a check. Start a new one and you will get a fresh link.</p>
        <div className="btn-row">
          <Link className="btn" href="/">
            Check a site
          </Link>
        </div>
      </div>
    </div>
  );
}

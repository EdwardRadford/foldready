import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fold Ready — see your site on the iPhone Duo',
  description:
    'Paste a web address and see how it renders at the iPhone Duo screen sizes: folded, unfolded and split view, plus what happens when someone opens the phone mid-page.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <header className="site-head">
          <div className="wrap">
            <Link href="/" className="wordmark">
              Fold Ready
            </Link>
            <span className="tag">iPhone Duo, checked before your customers do</span>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-foot">
          <div className="wrap">
            <p>
              Fold Ready is not affiliated with Apple. Checks are emulated at the iPhone Duo screen
              sizes in a WebKit browser.
            </p>
            <p>
              Questions: <a href="mailto:contact@edwardradford.co.uk">contact@edwardradford.co.uk</a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

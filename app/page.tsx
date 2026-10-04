import CheckForm from './_components/CheckForm';
import { VIEWPORTS } from '@/engine/device';

// A form posted before the page's script loaded comes back here with ?error=<code> (and the
// address) when the check could not start. Codes only, so the page never echoes arbitrary text.
const FORM_ERRORS: Record<string, string> = {
  empty: 'Type a web address first.',
  address: 'That address cannot be checked. Check the spelling and try again.',
  busy: 'That is a lot of checks from this connection. Try again in a few minutes.',
  failed: 'Something went wrong starting that check. Try again in a minute.',
};

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string; url?: string }> }) {
  const { error, url } = await searchParams;
  return (
    <div className="wrap">
      <section className="hero">
        <h1>See your site on the iPhone Duo.</h1>
        <p className="sub">
          Paste a web address. You get it rendered at the Duo screen sizes, and the moment someone
          opens the phone with your page on screen.
        </p>
        <CheckForm
          initialUrl={typeof url === 'string' ? url.slice(0, 300) : ''}
          initialError={typeof error === 'string' ? (FORM_ERRORS[error] ?? '') : ''}
        />
      </section>

      <section className="quiet-note">
        <h2>What gets checked</h2>
        <ul>
          {VIEWPORTS.map((v) => (
            <li key={v.id}>
              <strong>{v.label}</strong>, {v.width} × {v.height}. {v.description}
            </li>
          ))}
          <li>
            <strong>The fold itself</strong>: the page is resized from folded to unfolded without a
            reload, the way the phone does it, and compared with a fresh load at the same size.
          </li>
        </ul>
        <p>
          Free, with no cookies and no sign-up. What is kept is the screenshots behind your results
          link and anonymous counts of visits and checks. The Duo ships
          on 23 October 2026; until then every check is emulated at its screen sizes in a WebKit
          browser rather than run on real hardware.
        </p>
      </section>
    </div>
  );
}

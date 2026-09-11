import CheckForm from './_components/CheckForm';
import { VIEWPORTS } from '@/engine/device';

export default function Home() {
  return (
    <div className="wrap">
      <section className="hero">
        <h1>See your site on the iPhone Duo.</h1>
        <p className="sub">
          Paste a web address. You get it rendered at the Duo screen sizes, and the moment someone
          opens the phone with your page on screen.
        </p>
        <CheckForm />
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
          Free, and nothing is stored beyond the screenshots behind your results link. The Duo ships
          on 23 October 2026; until then every check is emulated at its screen sizes in a WebKit
          browser rather than run on real hardware.
        </p>
      </section>
    </div>
  );
}

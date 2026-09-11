'use client';

import Link from 'next/link';
import type { Outcome, Result, Status } from '@/engine/types';
import FoldViewer from './FoldViewer';
import RenderFrame from './RenderFrame';
import Findings from './Findings';
import CopyLink from './CopyLink';
import Offer from './Offer';

const OUTCOME_WORD: Record<Outcome, string> = {
  passes: 'Ready for the Duo',
  patchable: 'Fixable with a patch',
  'needs-more': 'Needs more than a patch',
};

const OUTCOME_DOT: Record<Outcome, Status> = {
  passes: 'pass',
  patchable: 'warn',
  'needs-more': 'fail',
};

export default function ResultView({ result }: { result: Result }) {
  const { id, url, outcome, viewports, shots } = result;
  const shown = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const others = shots.filter((s) => s.kind === 'other');
  const duoFindings = result.findings.filter((f) => (f.scope ?? 'duo') === 'duo');
  const generalFindings = result.findings.filter((f) => f.scope === 'general');
  const hasPartTwo = others.length > 0 || generalFindings.length > 0;

  return (
    <div className="wrap">
      <div className="result-head">
        <p className="url">{shown}</p>
        <h1>{result.summary}</h1>
        <div className="outcome-line">
          <span className={`dot dot-${OUTCOME_DOT[outcome]}`} aria-hidden="true" />
          <span>{OUTCOME_WORD[outcome]}</span>
          <span className="sep" aria-hidden="true" />
          <CopyLink />
        </div>
      </div>

      <section className="block">
        <h2>Opening the phone</h2>
        <FoldViewer
          jobId={id}
          shots={shots}
          videos={result.videos}
          foldTransition={result.foldTransition}
          viewports={viewports}
        />
      </section>

      <section className="block">
        <h2>The three screen sizes</h2>
        <p>Hover a frame to scroll the whole page inside it. On a touch screen, scroll the frame.</p>
        <div className="renders">
          {viewports.map((v) => (
            <RenderFrame
              key={v.id}
              jobId={id}
              label={v.label}
              width={v.width}
              height={v.height}
              description={v.description}
              shot={shots.find((s) => s.kind === v.id)}
            />
          ))}
        </div>
        <p className="hover-hint">{result.emulationNote}</p>
      </section>

      <section className="block">
        <h2>What the check found</h2>
        <Findings findings={duoFindings} viewports={viewports} />
      </section>

      {hasPartTwo ? (
        <section className="block part-two">
          <h2>Other screens and general insights</h2>
          <p>
            Beyond the Duo: the same page on the screens your visitors use today, and the things
            any checker would tell you.
          </p>
          {others.length > 0 ? (
            <div className="renders">
              {others.map((s) => (
                <RenderFrame
                  key={s.file}
                  jobId={id}
                  label={s.label ?? 'Other screen'}
                  width={s.width}
                  height={s.height}
                  description={s.description}
                  shot={s}
                />
              ))}
            </div>
          ) : null}
          {generalFindings.length > 0 ? (
            <>
              <h3 className="list-head">General</h3>
              <Findings findings={generalFindings} viewports={viewports} />
            </>
          ) : null}
        </section>
      ) : null}

      {outcome === 'passes' ? (
        <section className="calm">
          <h2>Your site handles the Duo.</h2>
          <p>
            There is always room for improvement, though. If you would like a second pair of eyes
            on the site as a whole, get in touch.
          </p>
          <div className="btn-row">
            <a
              className="btn"
              href={`mailto:eddie@yowzer.co.uk?subject=${encodeURIComponent(`Fold Ready: ${url}`)}`}
            >
              Email Ed
            </a>
            <a href="https://www.edwardradford.co.uk" target="_blank" rel="noopener noreferrer">
              See Ed&rsquo;s work
            </a>
          </div>
        </section>
      ) : null}

      {outcome === 'patchable' ? <Offer jobId={id} /> : null}

      {outcome === 'needs-more' ? (
        <section className="calm">
          <h2>This needs more than a patch.</h2>
          <p>
            What is going wrong here sits in the structure of the site rather than in a few rules of
            CSS, so a flat-price patch would not fix it honestly. Send me the address and I will
            tell you what it would actually take, whether or not that turns into work for me.
          </p>
          <div className="btn-row">
            <a
              className="btn"
              href={`mailto:eddie@yowzer.co.uk?subject=${encodeURIComponent(`Fold Ready: ${shown}`)}`}
            >
              Email me about this site
            </a>
          </div>
        </section>
      ) : null}

      <section className="block">
        <p className="note">
          <Link href="/">Check another site</Link>
        </p>
      </section>
    </div>
  );
}

// Contract between the engine and the web UI. Keep additive.
export type ViewportId = 'folded' | 'unfolded' | 'split';
export type ShotKind = ViewportId | 'fold-transition';
export type Status = 'pass' | 'warn' | 'fail' | 'info';
export type Outcome = 'passes' | 'patchable' | 'needs-more';
export type Platform = 'wordpress' | 'squarespace' | 'wix' | 'webflow' | 'shopify' | 'custom' | 'unknown';

export interface ViewportSpec {
  id: ViewportId;
  label: string;        // "Folded", "Unfolded", "Split View"
  width: number;        // CSS px
  height: number;       // CSS px
  description: string;  // one plain sentence
}

export interface Finding {
  id: string;           // stable machine id, e.g. "overflow-folded"
  status: Status;
  title: string;        // short, plain English
  detail: string;       // one or two sentences, specific, calm
  viewport?: ViewportId;
  evidence?: string[];  // selectors, values, media queries — shown behind "details"
}

export interface Shot {
  kind: ShotKind;
  file: string;         // filename only, e.g. "folded.png"; served by the web app
  width: number;        // viewport width
  height: number;       // viewport height
  fullHeight: number;   // full-page height captured
}

export interface FoldTransition {
  differs: boolean;
  pixelDiffPct: number;     // 0-100, post-resize vs fresh load at unfolded size
  layoutShiftCount: number; // elements whose box differs between the two
  note: string;             // one plain sentence
}

export interface Result {
  id: string;
  url: string;
  finalUrl: string;
  checkedAt: string;        // ISO
  durationMs: number;
  engine: 'webkit' | 'chromium';
  platform: Platform;
  outcome: Outcome;
  score: number;            // 0-100, secondary to the screenshots
  summary: string;          // one sentence for the top of the results page
  findings: Finding[];      // ordered: fails, warns, passes
  shots: Shot[];
  foldTransition: FoldTransition;
  viewports: ViewportSpec[];
  emulationNote: string;
  error?: string;           // set when the page could not be fetched/rendered
}

export interface Job {
  id: string;
  url: string;
  state: 'queued' | 'running' | 'done' | 'error';
  progress: string;         // human readable, e.g. "Rendering folded view"
  createdAt: string;
  result?: Result;
  error?: string;
}

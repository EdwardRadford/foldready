// iPhone Duo viewport estimates. Physical px ÷ 3. Correct these on 23 Oct 2026 against a real
// device (or sooner from the Xcode 27.1 Duo simulator: read window.innerWidth/innerHeight in Safari).
import type { ViewportSpec } from './types';

export const DEVICE_NAME = 'iPhone Duo';
export const SCALE_FACTOR = 3;

export const VIEWPORTS: ViewportSpec[] = [
  {
    id: 'folded',
    label: 'Folded',
    width: 466,
    height: 678,
    description: 'The outer screen, held upright. Wider than any earlier iPhone, but short.',
  },
  {
    id: 'unfolded',
    label: 'Unfolded',
    width: 890,
    height: 626,
    description: 'The inner screen opened flat. Tablet width, phone height.',
  },
  {
    id: 'split',
    label: 'Split View',
    width: 440,
    height: 626,
    description: 'Half of the inner screen, with two apps side by side.',
  },
];

export const FOLDED = VIEWPORTS[0];
export const UNFOLDED = VIEWPORTS[1];
export const SPLIT = VIEWPORTS[2];

// Breakpoints that land in this band flip the layout right around the folded width.
export const FOLDED_TRAP_BAND: [number, number] = [440, 500];

// Safari-like mobile UA. Emulation, not a real device; keep the results page honest about that.
export const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';

export const EMULATION_NOTE =
  `Emulated at the ${DEVICE_NAME}'s screen sizes in a WebKit browser. Real hardware ships 23 October 2026; we will re-run every check on a real device then.`;

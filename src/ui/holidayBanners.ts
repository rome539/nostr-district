/**
 * holidayBanners.ts — Login-screen seasonal banners.
 *
 * Every entry is a date-gated holiday with its own emoji, i18n key prefix,
 * theme palette, and optional external link. `getActiveHoliday()` returns
 * whichever holiday's date window contains today's local date (first match
 * wins if windows overlap), or `null` if none.
 *
 * The login screen renders ONE banner top-left during that window — no
 * per-holiday code in LoginScreen.ts. Adding a new holiday is just:
 *   1. Drop ~6 i18n keys under a new prefix
 *   2. Add one entry to HOLIDAYS below
 * The login UI picks it up automatically.
 *
 * Halving is special: in addition to the static date table, we hit
 * mempool.space's block-height API on first call to compute the actual
 * blocks/days remaining. If the live answer says we're inside the
 * pre-halving window (≤14 days), the banner fires even if today's calendar
 * date doesn't match any static window. If the API is unreachable the
 * static date table still gates the banner — progressive enhancement, not a
 * hard dependency.
 */

const HALVING_INTERVAL     = 210_000;     // blocks between halvings (NIP-…wait no, just Bitcoin)
const HALVING_LIVE_WINDOW  = 14;          // days before halving to start showing banner
const HALVING_CACHE_TTL    = 10 * 60_000; // 10 min — block height changes ~144 times/day
const MEMPOOL_HEIGHT_URL   = 'https://mempool.space/api/blocks/tip/height';
const HALVING_EVENT        = 'nd-halving-live-update';
/**
 * How long the post-halving "gold celebration" theme sticks around after the
 * block is mined. Long enough for the news cycle, short enough that we don't
 * leave the banner up for weeks.
 */
const HALVING_CELEBRATION_MS = 7 * 24 * 60 * 60_000; // 7 days

export interface HolidayTheme {
  /** Banner background fill (CSS color expression). */
  bg:          string;
  /** Banner outline / pill border. */
  border:      string;
  /** Glow color around the emoji icon. */
  emojiGlow:   string;
  /** Bright accent color for the title text. */
  titleColor:  string;
  /** Primary text color in the trigger button. */
  textColor:   string;
  /** Subdued color for the trigger subtitle row. */
  subColor:    string;
  /** Expanded info-panel background. */
  panelBg:     string;
  /** Expanded info-panel border. */
  panelBorder: string;
  /** Link color in the info panel. */
  linkColor:   string;
  /** Color used in <strong> tags inside the info paragraphs. */
  strongColor: string;
  /** Italic "extra" line color. */
  extraColor:  string;
}

/** Year-specific date window — used for holidays whose date drifts (e.g. Halving). */
export interface SpecificWindow {
  year:       number;
  monthStart: number;
  dayStart:   number;
  monthEnd:   number;
  dayEnd:     number;
}

export interface Holiday {
  id:              string;
  emoji:           string;
  /**
   * Inclusive annual window (1-based month), no year wraparound. Ignored if
   * `specificDates` is set.
   */
  monthDayStart?:  [number, number];
  monthDayEnd?:    [number, number];
  /**
   * Year-specific windows. If present, takes priority over the annual range
   * and only triggers when the current year matches one of the entries.
   * Used for Halving and other non-annual events.
   */
  specificDates?:  SpecificWindow[];
  /** i18n key prefix; expects `{prefix}.title`, `.sub`, `.aria_label`, `.p1`, `.p2`, `.extra`, `.link`. */
  i18nPrefix:      string;
  /** Year of the original event for the auto "{n} years" subtitle counter. null = no counter. */
  anniversaryYear: number | null;
  /** Optional URL for the "read more" link in the dropdown panel. */
  externalLink?:   string;
  theme:           HolidayTheme;
}

const PIZZA_DAY_THEME: HolidayTheme = {
  bg:          'color-mix(in srgb, black 55%, #f0a030)',
  border:      'color-mix(in srgb, #f0b040 60%, transparent)',
  emojiGlow:   'color-mix(in srgb, #f0a030 55%, transparent)',
  titleColor:  '#ffe098',
  textColor:   '#ffd07a',
  subColor:    '#f4cb88',
  panelBg:     'color-mix(in srgb, black 75%, #f0a030)',
  panelBorder: 'color-mix(in srgb, #f0b040 50%, transparent)',
  linkColor:   '#ffd07a',
  strongColor: '#ffe098',
  extraColor:  '#ffc870',
};

const WHITEPAPER_THEME: HolidayTheme = {
  // White / silver — evokes the printed-paper aesthetic
  bg:          'color-mix(in srgb, black 55%, #d8d8d8)',
  border:      'color-mix(in srgb, #f0f0f0 60%, transparent)',
  emojiGlow:   'color-mix(in srgb, #ffffff 50%, transparent)',
  titleColor:  '#ffffff',
  textColor:   '#e8e8e8',
  subColor:    '#bcbcbc',
  panelBg:     'color-mix(in srgb, black 75%, #d8d8d8)',
  panelBorder: 'color-mix(in srgb, #f0f0f0 50%, transparent)',
  linkColor:   '#e8e8e8',
  strongColor: '#ffffff',
  extraColor:  '#d0d0d0',
};

const GENESIS_THEME: HolidayTheme = {
  bg:          'color-mix(in srgb, black 55%, #3aa860)',
  border:      'color-mix(in srgb, #58c878 60%, transparent)',
  emojiGlow:   'color-mix(in srgb, #3aa860 55%, transparent)',
  titleColor:  '#c8f0d0',
  textColor:   '#a0e0b4',
  subColor:    '#80c898',
  panelBg:     'color-mix(in srgb, black 75%, #3aa860)',
  panelBorder: 'color-mix(in srgb, #58c878 50%, transparent)',
  linkColor:   '#a0e0b4',
  strongColor: '#c8f0d0',
  extraColor:  '#88d8a0',
};

const HALVING_THEME: HolidayTheme = {
  // Gold leaf — the block reward made tangible. Used AFTER the halving block
  // is mined (celebration phase). Yellower than the Pizza Day amber so the
  // two warm holidays read as distinct.
  bg:          'color-mix(in srgb, black 48%, #f0b820)',
  border:      'color-mix(in srgb, #ffd84a 75%, transparent)',
  emojiGlow:   'color-mix(in srgb, #ffc820 65%, transparent)',
  titleColor:  '#ffd84a',
  textColor:   '#ffd060',
  subColor:    '#e0b840',
  panelBg:     'color-mix(in srgb, black 70%, #f0b820)',
  panelBorder: 'color-mix(in srgb, #ffd84a 60%, transparent)',
  linkColor:   '#ffd060',
  strongColor: '#ffd84a',
  extraColor:  '#f0c040',
};

const HALVING_COUNTDOWN_THEME: HolidayTheme = {
  // Royal purple — anticipation phase BEFORE the block is mined. Flips to
  // gold the moment the chain confirms the halving.
  bg:          'color-mix(in srgb, black 50%, #7030c0)',
  border:      'color-mix(in srgb, #a060ff 75%, transparent)',
  emojiGlow:   'color-mix(in srgb, #8040e0 65%, transparent)',
  titleColor:  '#d8b8ff',
  textColor:   '#c8a8f0',
  subColor:    '#a880d0',
  panelBg:     'color-mix(in srgb, black 70%, #7030c0)',
  panelBorder: 'color-mix(in srgb, #a060ff 60%, transparent)',
  linkColor:   '#c8a8f0',
  strongColor: '#d8b8ff',
  extraColor:  '#b890e0',
};

const JULY4_THEME: HolidayTheme = {
  bg:          'color-mix(in srgb, black 52%, #cc2233)',
  border:      'color-mix(in srgb, #ff4455 65%, transparent)',
  emojiGlow:   'color-mix(in srgb, #ff3344 60%, transparent)',
  titleColor:  '#ffffff',
  textColor:   '#ffcccc',
  subColor:    '#aabbff',
  panelBg:     'color-mix(in srgb, black 72%, #cc2233)',
  panelBorder: 'color-mix(in srgb, #ff4455 55%, transparent)',
  linkColor:   '#aabbff',
  strongColor: '#ffffff',
  extraColor:  '#ff8888',
};

const FINNEY_THEME: HolidayTheme = {
  // Soft silver/blue — a respectful tribute palette
  bg:          'color-mix(in srgb, black 55%, #7080a0)',
  border:      'color-mix(in srgb, #a0b8d8 60%, transparent)',
  emojiGlow:   'color-mix(in srgb, #a0b8d8 55%, transparent)',
  titleColor:  '#e8eef8',
  textColor:   '#c8d4e8',
  subColor:    '#a8b4c8',
  panelBg:     'color-mix(in srgb, black 75%, #7080a0)',
  panelBorder: 'color-mix(in srgb, #a0b8d8 50%, transparent)',
  linkColor:   '#c8d4e8',
  strongColor: '#e8eef8',
  extraColor:  '#b0c0d8',
};

const HOLIDAYS: Holiday[] = [
  {
    id:              'pizza_day',
    emoji:           '🍕',
    monthDayStart:   [5, 18],
    monthDayEnd:     [5, 25],
    i18nPrefix:      'login.pizza_day',
    anniversaryYear: 2010,
    externalLink:    'https://bitcointalk.org/index.php?topic=137.0',
    theme:           PIZZA_DAY_THEME,
  },
  {
    // Bitcoin Whitepaper Day — Satoshi published the 9-page paper to the
    // cryptography mailing list on October 31, 2008.
    id:              'whitepaper',
    emoji:           '📄',
    monthDayStart:   [10, 28],
    monthDayEnd:     [11, 4],
    i18nPrefix:      'login.whitepaper',
    anniversaryYear: 2008,
    externalLink:    'https://bitcoin.org/bitcoin.pdf',
    theme:           WHITEPAPER_THEME,
  },
  {
    // Bitcoin Genesis Block — block 0 was mined on January 3, 2009. Window
    // starts Jan 1 to avoid year-boundary wraparound (the helpers below
    // assume a single calendar year).
    id:              'genesis',
    emoji:           '⛓️',
    monthDayStart:   [1, 1],
    monthDayEnd:     [1, 6],
    i18nPrefix:      'login.genesis',
    anniversaryYear: 2009,
    externalLink:    'https://mempool.space/block/000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
    theme:           GENESIS_THEME,
  },
  {
    // Running Bitcoin Day (Hal Finney) — Jan 12, 2009: Satoshi sent Hal the
    // first Bitcoin transaction (10 BTC), and his "Running bitcoin" tweet
    // (Jan 11) is iconic in the cypherpunk lineage. Wide window starts Jan 10
    // so it doesn't overlap with Genesis (Jan 1-6).
    id:              'finney',
    emoji:           '🖖',
    monthDayStart:   [1, 10],
    monthDayEnd:     [1, 14],
    i18nPrefix:      'login.finney',
    anniversaryYear: 2009,
    externalLink:    'https://twitter.com/halfin/status/1110302988',
    theme:           FINNEY_THEME,
  },
  {
    id:              'july4',
    emoji:           '🎆',
    monthDayStart:   [7, 3],
    monthDayEnd:     [7, 6],
    i18nPrefix:      'login.july4',
    anniversaryYear: 1776,
    externalLink:    'https://en.wikipedia.org/wiki/Independence_Day_(United_States)',
    theme:           JULY4_THEME,
  },
  {
    // Bitcoin Halving — every 210,000 blocks (~4 years). Date drifts based
    // on block production, so we list windows per known/expected halving.
    // Pre-populated through 2036 (5th-7th halvings).
    id:              'halving',
    emoji:           '⏳',
    specificDates: [
      { year: 2024, monthStart: 4, dayStart: 15, monthEnd: 4, dayEnd: 25 },
      { year: 2028, monthStart: 4, dayStart: 15, monthEnd: 4, dayEnd: 30 },
      { year: 2032, monthStart: 3, dayStart: 25, monthEnd: 4, dayEnd: 10 },
      { year: 2036, monthStart: 3, dayStart: 10, monthEnd: 3, dayEnd: 25 },
    ],
    i18nPrefix:      'login.halving',
    anniversaryYear: 2012,
    externalLink:    'https://mempool.space/about',
    theme:           HALVING_THEME,
  },
];

/**
 * Returns the active holiday for today (or `now` if provided), or `null` if
 * we're not currently inside any holiday's window.
 */
export interface HalvingLiveInfo {
  /** Current block height fetched from mempool.space. */
  height:      number;
  /** Height of the upcoming halving block. */
  nextHeight:  number;
  /** Blocks remaining until the halving. */
  blocksLeft:  number;
  /** Estimated days until halving (blocks / 144). */
  daysLeft:    number;
  /** Unix ms when the cache was populated. */
  fetchedAt:   number;
}

let _halvingLive: HalvingLiveInfo | null = null;
let _halvingInFlight = false;
/**
 * Timestamp of when we observed the halving block transition. Set when
 * `blocksLeft` flips from a small number (countdown) back to ~210k (the
 * counter just reset because the halving block was mined). Used to keep the
 * banner in "celebration" gold for {@link HALVING_CELEBRATION_MS} after the
 * event, even though the live data no longer shows an active countdown.
 */
let _halvingJustMinedAt: number | null = null;

/**
 * Kick off an async fetch of the current block height from mempool.space.
 * Idempotent: returns immediately if a fetch is in flight or the cache is
 * still fresh. Updates `_halvingLive` and dispatches `nd-halving-live-update`
 * so the UI can re-render.
 */
function refreshHalvingLive(): void {
  if (_halvingInFlight) return;
  if (_halvingLive && Date.now() - _halvingLive.fetchedAt < HALVING_CACHE_TTL) return;
  if (typeof fetch !== 'function') return; // SSR / non-browser
  _halvingInFlight = true;
  fetch(MEMPOOL_HEIGHT_URL)
    .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(text => {
      const height = Number(text.trim());
      if (!Number.isFinite(height) || height <= 0) return;
      const nextHeight = Math.ceil((height + 1) / HALVING_INTERVAL) * HALVING_INTERVAL;
      const blocksLeft = nextHeight - height;
      const daysLeft   = blocksLeft / 144; // 144 = ~blocks per day at 10-min target
      // Detect the halving transition: blocksLeft was small (we were in the
      // countdown window) and just jumped back near 210k (the counter reset
      // because the halving block was mined).
      const prev = _halvingLive;
      if (prev && prev.blocksLeft <= 1000 && blocksLeft >= HALVING_INTERVAL - 1000) {
        _halvingJustMinedAt = Date.now();
      }
      _halvingLive = { height, nextHeight, blocksLeft, daysLeft, fetchedAt: Date.now() };
      try { window.dispatchEvent(new Event(HALVING_EVENT)); } catch { /* ignore */ }
    })
    .catch(() => { /* silently fall back to static date table */ })
    .finally(() => { _halvingInFlight = false; });
}

/** Current phase of the halving lifecycle for theming/copy decisions. */
export type HalvingPhase = 'countdown' | 'celebration' | null;

/**
 * Resolve the halving phase from live and static signals:
 *   - countdown:   live data shows blocksLeft within the 14-day window
 *   - celebration: halving block was just mined (transition observed), OR
 *                  we're inside a static halving date window but the live
 *                  counter has already reset past the countdown threshold
 *   - null:        not in any halving-relevant state
 */
export function getHalvingPhase(now: Date = new Date()): HalvingPhase {
  const countdownBlocks = HALVING_LIVE_WINDOW * 144;
  if (_halvingLive && _halvingLive.blocksLeft > 0 && _halvingLive.blocksLeft <= countdownBlocks) {
    return 'countdown';
  }
  if (_halvingJustMinedAt && Date.now() - _halvingJustMinedAt < HALVING_CELEBRATION_MS) {
    return 'celebration';
  }
  // Inside a static halving window AND the live counter is no longer in
  // countdown range → the halving must have been mined (or we cold-started
  // post-mine). Show celebration gold.
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const halving = findHoliday('halving');
  if (halving?.specificDates) {
    for (const w of halving.specificDates) {
      if (w.year !== y) continue;
      if (afterOrEqual(m, d, w.monthStart, w.dayStart) && beforeOrEqual(m, d, w.monthEnd, w.dayEnd)) {
        return 'celebration';
      }
    }
  }
  return null;
}

/**
 * Returns the theme to use for a holiday right now. Halving swaps between
 * purple (countdown) and gold (celebration); every other holiday returns its
 * static theme.
 */
export function getActiveHolidayTheme(holiday: Holiday): HolidayTheme {
  if (holiday.id !== 'halving') return holiday.theme;
  const phase = getHalvingPhase();
  return phase === 'countdown' ? HALVING_COUNTDOWN_THEME : HALVING_THEME;
}

/** Latest cached halving-live info, or null until the first fetch resolves. */
export function getHalvingLiveInfo(): HalvingLiveInfo | null {
  return _halvingLive;
}

/** Subscribe to live-halving updates. Returns an unsubscribe function. */
export function onHalvingLiveUpdate(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(HALVING_EVENT, handler);
  return () => window.removeEventListener(HALVING_EVENT, handler);
}

/** Look up a holiday by id (used to fire halving banner from live data). */
export function findHoliday(id: string): Holiday | null {
  return HOLIDAYS.find(h => h.id === id) ?? null;
}

export function getActiveHoliday(now: Date = new Date()): Holiday | null {
  // Trigger an async fetch of block-height data the first time anyone asks
  // for the active holiday. If it's already cached and fresh, this is a no-op.
  refreshHalvingLive();

  // Live halving check — fires the banner if the chain says we're within
  // ~14 days, regardless of whether the calendar matches a static window.
  if (_halvingLive && _halvingLive.daysLeft >= 0 && _halvingLive.daysLeft <= HALVING_LIVE_WINDOW) {
    const halving = findHoliday('halving');
    if (halving) return halving;
  }

  const y = now.getFullYear();
  const m = now.getMonth() + 1; // getMonth is 0-based
  const d = now.getDate();
  for (const h of HOLIDAYS) {
    // Year-specific windows take priority (used for Halving etc).
    if (h.specificDates) {
      for (const w of h.specificDates) {
        if (w.year !== y) continue;
        if (afterOrEqual(m, d, w.monthStart, w.dayStart) && beforeOrEqual(m, d, w.monthEnd, w.dayEnd)) return h;
      }
      continue;
    }
    if (h.monthDayStart && h.monthDayEnd) {
      const [sm, sd] = h.monthDayStart;
      const [em, ed] = h.monthDayEnd;
      if (afterOrEqual(m, d, sm, sd) && beforeOrEqual(m, d, em, ed)) return h;
    }
  }
  return null;
}

/**
 * Years since the holiday's anniversary year. Returns 0 if the holiday has
 * no anniversary year configured.
 */
export function holidayYears(holiday: Holiday, now: Date = new Date()): number {
  if (holiday.anniversaryYear == null) return 0;
  return now.getFullYear() - holiday.anniversaryYear;
}

function afterOrEqual(m: number, d: number, sm: number, sd: number): boolean {
  if (m > sm) return true;
  if (m < sm) return false;
  return d >= sd;
}

function beforeOrEqual(m: number, d: number, em: number, ed: number): boolean {
  if (m < em) return true;
  if (m > em) return false;
  return d <= ed;
}

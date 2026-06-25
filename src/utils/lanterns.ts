import Phaser from 'phaser';
import { isHolidayWindowNow } from '../ui/holidayBanners';

/** Mid-Autumn cosmetic window — honours the ?holiday override (dev/testing, cosmetic
 *  only) plus the real lunar calendar. Mirrors isJuly4thPeriod / isHalloweenPeriod.
 *  The lunar dates live in holidayBanners (specificDates), so we defer to it. */
export function isMidAutumnPeriod(): boolean {
  if (new URLSearchParams(window.location.search).get('holiday') === 'mid_autumn') return true;
  return isHolidayWindowNow('mid_autumn');
}

interface Lantern {
  x: number; baseX: number; y: number; vy: number;
  phase: number; phaseSpeed: number; amp: number;
  size: number; flickerPhase: number; warm: boolean;
}

export interface LanternsConfig {
  yTop?:     number; // height lanterns rise to before recycling (default: -24)
  yBottom?:  number; // baseline they rise FROM (default: H) — lanterns float upward
  count?:    number; // simultaneous lanterns (default: 7)
  speedMin?: number; // rise speed, px per 16ms (default: 0.12)
  speedMax?: number; // (default: 0.30)
  sizeMin?:  number; // (default: 2)
  sizeMax?:  number; // (default: 4)
}

export class LanternEngine {
  readonly lanterns: Lantern[] = [];

  constructor(
    private W: number, private yTop: number, private yBottom: number,
    private speedMin: number, private speedMax: number,
    private sizeMin: number, private sizeMax: number, count: number,
  ) {
    for (let i = 0; i < count; i++) this.spawn(true);
  }

  private spawn(initial = false): void {
    const baseX = 16 + Math.random() * (this.W - 32);
    this.lanterns.push({
      x: baseX,
      baseX,
      // initial: spread across the whole rise band; recycle: re-enter at the baseline and
      // rise. We never spawn BELOW yBottom (callers set it above the floor) so lanterns
      // don't render under the ground.
      y: initial ? this.yTop + Math.random() * (this.yBottom - this.yTop) : this.yBottom,
      vy: -(this.speedMin + Math.random() * (this.speedMax - this.speedMin)),
      phase:      Math.random() * Math.PI * 2,
      phaseSpeed: 0.0008 + Math.random() * 0.0012, // slow sway
      amp:        4 + Math.random() * 10,
      size:       this.sizeMin + Math.random() * (this.sizeMax - this.sizeMin),
      flickerPhase: Math.random() * Math.PI * 2,
      warm:       Math.random() > 0.6, // a few warmer red-orange ones for variety
    });
  }

  tick(time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs, 64) / 16;
    for (let i = this.lanterns.length - 1; i >= 0; i--) {
      const l = this.lanterns[i];
      l.y += l.vy * dt;                                    // drift upward
      l.x = l.baseX + Math.sin(time * l.phaseSpeed + l.phase) * l.amp; // gentle sway
      if (l.y < this.yTop - 30) { this.lanterns.splice(i, 1); this.spawn(); }
    }
  }
}

export function newLanternEngine(W: number, H: number, cfg: LanternsConfig = {}): LanternEngine {
  return new LanternEngine(
    W,
    cfg.yTop     ?? -24,
    cfg.yBottom  ?? H,
    cfg.speedMin ?? 0.12,
    cfg.speedMax ?? 0.30,
    cfg.sizeMin  ?? 2,
    cfg.sizeMax  ?? 4,
    cfg.count    ?? 7,
  );
}

// ── Colors ──
const C_GLOW  = 0xffb24d; // warm halo
const C_RED   = 0xd0322e; // lantern red
const C_ORANGE = 0xe85a2a; // warmer variant
const C_GOLD  = 0xf2c659;  // caps + core + tassel

// fillRect, not arcs: same perf reasoning as the fireworks/bats renderers.
function drawLanternShape(
  rect: (x: number, y: number, w: number, h: number, color: number, alpha: number) => void,
  l: Lantern, time: number,
): void {
  const s = l.size;
  const flick = 0.78 + Math.sin(time * 0.006 + l.flickerPhase) * 0.12 + (Math.random() < 0.04 ? 0.1 : 0);
  const body = l.warm ? C_ORANGE : C_RED;
  const cx = l.x, cy = l.y;
  const bw = s * 2; // widest body row
  const bh = s * 0.7;

  // soft glow halo (translucent, behind)
  rect(cx - s * 2.2, cy - s * 2.2, s * 4.4, s * 4.4, C_GLOW, 0.10 * flick);
  rect(cx - s * 1.5, cy - s * 1.6, s * 3.0, s * 3.2, C_GLOW, 0.14 * flick);

  // body — rounded paper lantern: narrow top/bottom rows, wide middle
  rect(cx - bw * 0.35, cy - s * 1.5, bw * 0.7, bh, body, 0.95); // top (narrow)
  rect(cx - bw * 0.5,  cy - s * 0.8, bw,       bh, body, 0.95); // upper-mid (wide)
  rect(cx - bw * 0.5,  cy - s * 0.1, bw,       bh, body, 0.95); // lower-mid (wide)
  rect(cx - bw * 0.35, cy + s * 0.6, bw * 0.7, bh, body, 0.95); // bottom (narrow)

  // gold caps (top + bottom)
  rect(cx - s * 0.5, cy - s * 1.85, s, s * 0.4, C_GOLD, 0.95);
  rect(cx - s * 0.5, cy + s * 1.3,  s, s * 0.4, C_GOLD, 0.95);

  // glowing core (the candle inside), flickers
  rect(cx - s * 0.4, cy - s * 0.45, s * 0.8, s * 0.9, C_GOLD, Math.min(1, 0.3 + 0.55 * flick));

  // tassel hanging below
  rect(cx - s * 0.12, cy + s * 1.75, s * 0.24, s * 0.9, C_GOLD, 0.8);
}

export function drawLanternsPhaser(
  g: Phaser.GameObjects.Graphics, engine: LanternEngine, time: number,
  accept?: (x: number, y: number) => boolean,
): void {
  for (const l of engine.lanterns) {
    if (accept && !accept(l.x, l.y)) continue;
    drawLanternShape(
      (x, y, w, h, color, alpha) => { g.fillStyle(color, alpha); g.fillRect(x, y, w, h); },
      l, time,
    );
  }
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Bake ONE static lantern — the exact same sprite the world engine draws — onto a canvas.
 *  Used as the Lantern AURA particle texture so the aura matches the floating world lanterns
 *  (red body, gold caps, glowing core, tassel, soft glow), instead of a tinted dot. */
export function makeLanternTextureCanvas(size = 5): HTMLCanvasElement {
  const w = Math.ceil(size * 5), h = Math.ceil(size * 6);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const l: Lantern = {
    x: w / 2, y: h / 2 - size * 0.3, baseX: w / 2, vy: 0,
    phase: 0, phaseSpeed: 0, amp: 0, size, flickerPhase: 0, warm: false,
  };
  drawLanternShape((x, y, ww, hh, color, alpha) => {
    ctx.globalAlpha = alpha; ctx.fillStyle = hex(color); ctx.fillRect(x, y, ww, hh);
  }, l, 0);
  ctx.globalAlpha = 1;
  return c;
}

/** Canvas renderer — used by the login screen. */
export function drawLanternsCanvas(ctx: CanvasRenderingContext2D, engine: LanternEngine, time: number): void {
  for (const l of engine.lanterns) {
    drawLanternShape((x, y, w, h, color, alpha) => {
      ctx.globalAlpha = alpha; ctx.fillStyle = hex(color); ctx.fillRect(x, y, w, h);
    }, l, time);
  }
  ctx.globalAlpha = 1;
}

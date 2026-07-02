import Phaser from 'phaser';

export function isJuly4thPeriod(): boolean {
  if (new URLSearchParams(window.location.search).get('holiday') === 'july4') return true;
  const d = new Date();
  return d.getMonth() === 6 && d.getDate() >= 3 && d.getDate() <= 6;
}

// Wider window than the fireworks display (July 3–6): the full Independence drop
// week (July 1–7), so a login any day that week earns the 🎆 Liberty name color.
// NOTE: gates the 🎆 Liberty grant, which is PERMANENT + relay-backed — so unlike
// isJuly4thPeriod (cosmetic fireworks only), the ?holiday=july4 override is DEV-only.
// Otherwise anyone guessing the param in prod could mint the color year-round.
export function isJuly4thWindow(): boolean {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('holiday') === 'july4') return true;
  const d = new Date();
  return d.getMonth() === 6 && d.getDate() >= 1 && d.getDate() <= 7;
}

const COLORS_CSS = [
  '#ff2222', '#ff5555', '#ff8888',
  '#ffffff', '#ffeeee',
  '#2255ff', '#5588ff', '#88aaff',
];
const COLORS_NUM = COLORS_CSS.map(c => parseInt(c.replace('#', ''), 16));

// White-hot variants — newborn sparks flash these for their first ~fifth of life,
// like the incandescent core of a real burst, then cool to the palette color.
const brighten = (n: number): number => {
  const f = (v: number) => Math.round(v + (255 - v) * 0.6);
  return (f((n >> 16) & 0xff) << 16) | (f((n >> 8) & 0xff) << 8) | f(n & 0xff);
};
const COLORS_NUM_BRIGHT = COLORS_NUM.map(brighten);
const COLORS_CSS_BRIGHT = COLORS_NUM_BRIGHT.map(n => `#${n.toString(16).padStart(6, '0')}`);

// Hue groups into the palette above — used to build multi-color bursts that are
// guaranteed to mix distinct colors (a red AND a blue, sometimes white) rather than
// three near-identical reds. Keeps multi bursts unmistakably patriotic.
const RED_CI = [0, 1, 2];
const WHITE_CI = [3, 4];
const BLUE_CI = [5, 6, 7];
const pick = <T,>(a: T[]): T => a[(Math.random() * a.length) | 0];

interface FWRocket {
  x: number; y: number; vy: number; targetY: number;
  ci: number;
  multi: number[] | null; // when set, each particle draws a color from this palette
  trail: Array<{ x: number; y: number }>;
}

interface FWParticle {
  x: number; y: number; vx: number; vy: number;
  ci: number; alpha: number; life: number; maxLife: number;
  px: number; py: number; // previous tick's position — renderers smear a ghost here
  tw: number;             // per-spark twinkle phase for the burn-out glitter
}

// Brief expanding glow at a burst point (the detonation "pop" of light).
interface FWFlash { x: number; y: number; ci: number; life: number; maxLife: number; }

// Burst silhouettes. Each explosion picks one at random from the engine's list.
//   burst — classic filled radial pop (default)
//   ring  — clean expanding circle outline
//   heart — heart-shaped outline
//   star  — 5-pointed spiky star
//   palm  — fronds that shoot up and droop (willow)
export type FWShape = 'burst' | 'ring' | 'heart' | 'star' | 'palm' | 'bitcoin' | 'ostrich';

// Shared mix for every scene: mostly classic bursts with the occasional special
// shape (each special ~6-7%). Repeats weight the random pick toward 'burst'.
export const FW_SHAPE_MIX: FWShape[] = [
  'burst', 'burst', 'burst', 'burst', 'burst',
  'burst', 'burst', 'burst', 'burst',
  'ring', 'star', 'heart', 'palm', 'bitcoin', 'ostrich',
];

// ── Picture-firework bitmaps ─────────────────────────────────────────────────
// '#' = one particle. Converted to normalised, centred, y-up offset vectors;
// each explosion of this shape fires one particle per '#' so the spray briefly
// renders the figure. Coarse on purpose — they read at firework scale.
function gridToPoints(rows: string[]): Array<[number, number]> {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const half = Math.max(w, h) / 2;
  const pts: Array<[number, number]> = [];
  rows.forEach((row, ry) => {
    for (let i = 0; i < row.length; i++) {
      if (row[i] === '#') pts.push([(i - cx) / half, (cy - ry) / half]);
    }
  });
  return pts;
}

// Bitcoin ₿ — left spine, bowls bulging right, two vertical strokes top & bottom.
const BITCOIN_PTS = gridToPoints([
  '.#.#.',
  '.#.#.',
  '####.',
  '.#..#',
  '.#..#',
  '.###.',
  '.#..#',
  '.#..#',
  '####.',
  '.#.#.',
  '.#.#.',
]);

// Ostrich — traced from public/assets/Holiday/ostrichsprite.png (alpha pixels).
const OSTRICH_PTS = gridToPoints([
  '..#......',
  '.###.....',
  '####.....',
  '..#..#.#.',
  '..#.###..',
  '.#######.',
  '.########',
  '..######.',
  '...###...',
  '...#.#...',
  '...#.#...',
  '..####...',
]);

export interface FireworksConfig {
  launchY?:       number;  // Y rockets launch from (default: H)
  explodeYMin?:   number;  // min Y for explosion (default: H*0.08)
  explodeYMax?:   number;  // max Y for explosion (default: H*0.43)
  xMin?:          number;  // min launch X (default: 60)
  xMax?:          number;  // max launch X (default: W-120)
  intervalMin?:   number;  // ms min between launches (default: 900)
  intervalMax?:   number;  // ms max between launches (default: 1400)
  particleRadius?: number; // draw radius for particles (default: 1.5)
  explosionCount?: number; // particles per burst (default: 28-42)
  explosionSpeed?: number; // burst spread speed (default: 2.2-4.2)
  initialDelay?:  number;  // ms before first launch (default: 0)
  shapes?:        FWShape[]; // burst silhouettes to pick from (default: ['burst'])
}

export class FireworksEngine {
  readonly rockets: FWRocket[] = [];
  readonly particles: FWParticle[] = [];
  readonly flashes: FWFlash[] = [];
  now = 0;                       // last tick's time — renderers use it for the glitter strobe
  // Optional audio hooks — the engine stays render/sound-agnostic; each surface
  // wires these to SoundEngine at its own volume (hub loud, room windows muffled,
  // aura silent). Before the first user gesture the AudioContext is suspended and
  // any triggered sound is simply swallowed, so pre-gesture wiring is safe.
  onLaunch: ((x: number, y: number) => void) | null = null;
  onExplode: ((x: number, y: number) => void) | null = null;
  private nextLaunch = Infinity; // set on first tick once we know current time
  private volleyLeft = 0;        // rockets still owed in the current quick-fire volley
  private started = false;
  private cfg: Required<FireworksConfig>;

  constructor(private W: number, private H: number, cfg: FireworksConfig = {}) {
    this.cfg = {
      launchY:        cfg.launchY        ?? H,
      explodeYMin:    cfg.explodeYMin    ?? H * 0.08,
      explodeYMax:    cfg.explodeYMax    ?? H * 0.43,
      xMin:           cfg.xMin           ?? 60,
      xMax:           cfg.xMax           ?? W - 120,
      intervalMin:    cfg.intervalMin    ?? 900,
      intervalMax:    cfg.intervalMax    ?? 1400,
      particleRadius: cfg.particleRadius ?? 1.5,
      explosionCount: cfg.explosionCount ?? 30,
      explosionSpeed: cfg.explosionSpeed ?? 3.2,
      initialDelay:   cfg.initialDelay   ?? 0,
      shapes:         cfg.shapes         ?? ['burst'],
    };
  }

  tick(time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs, 64) / 16;
    this.now = time;

    if (!this.started) {
      this.started = true;
      this.nextLaunch = time + this.cfg.initialDelay;
    }

    if (time > this.nextLaunch) {
      this.launchRocket();
      // Occasional volley: 1-2 quick follow-up shells so bursts sometimes overlap in
      // the air — evenly spaced lone pops read as mechanical, real shows fire clusters.
      if (this.volleyLeft > 0) {
        this.volleyLeft--;
        this.nextLaunch = time + 130 + Math.random() * 170;
      } else if (Math.random() < 0.16) {
        this.volleyLeft = Math.random() < 0.35 ? 2 : 1;
        this.nextLaunch = time + 130 + Math.random() * 170;
      } else {
        this.nextLaunch = time + this.cfg.intervalMin + Math.random() * this.cfg.intervalMax;
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= deltaMs;
      if (f.life <= 0) this.flashes.splice(i, 1);
    }

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.trail.push({ x: r.x, y: r.y });
      if (r.trail.length > 7) r.trail.shift();
      r.y += r.vy * dt;
      if (r.y <= r.targetY) { this.explode(r); this.rockets.splice(i, 1); }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.px = p.x;
      p.py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.055 * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.life -= deltaMs;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  private launchRocket(): void {
    const ci = Math.floor(Math.random() * COLORS_CSS.length);
    // ~40% of bursts are multi-color: a red + a blue, plus white about half the time.
    let multi: number[] | null = null;
    if (Math.random() < 0.4) {
      multi = [pick(RED_CI), pick(BLUE_CI)];
      if (Math.random() < 0.5) multi.push(pick(WHITE_CI));
    }
    const { launchY, explodeYMin, explodeYMax, xMin, xMax } = this.cfg;
    const x = xMin + Math.random() * (xMax - xMin);
    this.rockets.push({
      x,
      y: launchY,
      vy: -(3.8 + Math.random() * 2.8),
      targetY: explodeYMin + Math.random() * (explodeYMax - explodeYMin),
      ci, multi, trail: [],
    });
    this.onLaunch?.(x, launchY);
  }

  private explode(r: FWRocket): void {
    const baseLife = 900 + Math.random() * 500;
    const speed = this.cfg.explosionSpeed * (0.7 + Math.random() * 0.6);
    const shape = this.cfg.shapes[Math.floor(Math.random() * this.cfg.shapes.length)];

    // Detonation flash — a ~200ms glow pop at the burst point.
    this.flashes.push({ x: r.x, y: r.y, ci: r.multi ? pick(r.multi) : r.ci, life: 200, maxLife: 200 });
    this.onExplode?.(r.x, r.y);

    // Picture shapes: one particle per bitmap point, scaled out from the centre.
    if (shape === 'bitcoin' || shape === 'ostrich') {
      const pts = shape === 'bitcoin' ? BITCOIN_PTS : OSTRICH_PTS;
      const f = speed * 1.0; // scale of the figure (smaller = tighter picture)
      for (const [px, py] of pts) {
        this.particles.push({
          x: r.x, y: r.y, px: r.x, py: r.y, vx: px * f, vy: -py * f,
          ci: r.ci, alpha: 1, life: baseLife, maxLife: baseLife, tw: Math.random() * 10,
        });
      }
      return;
    }

    // Single-color burst → every particle is r.ci; multi-color → each draws from the
    // rocket's small red/blue(/white) palette for a confetti mix.
    const pci = () => (r.multi ? pick(r.multi) : r.ci);

    const count = Math.round(this.cfg.explosionCount * (0.8 + Math.random() * 0.4));
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      let vx: number, vy: number, life = baseLife;

      switch (shape) {
        case 'ring': {
          // Near-constant speed → a clean expanding circle outline.
          const s = speed * (1.0 + Math.random() * 0.12);
          vx = Math.cos(angle) * s; vy = Math.sin(angle) * s;
          break;
        }
        case 'heart': {
          // Parametric heart; speed varies with the curve's radius so the spray
          // traces a heart. Canvas Y is down, so flip vy to sit it upright.
          const a = angle + Math.random() * 0.06;
          const hx = 16 * Math.pow(Math.sin(a), 3);
          const hy = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
          const f = speed / 15;
          vx = hx * f; vy = -hy * f;
          break;
        }
        case 'star': {
          // 5 spikes — speed peaks at five evenly spaced angles.
          const spike = Math.pow(Math.abs(Math.cos(2.5 * angle)), 6);
          const s = speed * (0.35 + spike) * (0.9 + Math.random() * 0.2);
          vx = Math.cos(angle) * s; vy = Math.sin(angle) * s;
          break;
        }
        case 'palm': {
          // Fronds shoot up and droop: upward bias + longer life so gravity arcs them.
          const s = speed * (0.45 + Math.random() * 0.5);
          vx = Math.cos(angle) * s;
          vy = Math.sin(angle) * s - speed * 0.5;
          life = baseLife * 1.7;
          break;
        }
        default: { // 'burst' — classic filled radial pop
          const a = angle + Math.random() * 0.3;
          const s = speed * (0.5 + Math.random() * 0.9);
          vx = Math.cos(a) * s; vy = Math.sin(a) * s;
        }
      }

      this.particles.push({ x: r.x, y: r.y, px: r.x, py: r.y, vx, vy, ci: pci(), alpha: 1, life, maxLife: life, tw: Math.random() * 10 });
    }
  }

  get radius(): number { return this.cfg.particleRadius; }
  colorCss(ci: number): string { return COLORS_CSS[ci]; }
  colorNum(ci: number): number { return COLORS_NUM[ci]; }
  colorCssBright(ci: number): string { return COLORS_CSS_BRIGHT[ci]; }
  colorNumBright(ci: number): number { return COLORS_NUM_BRIGHT[ci]; }
}

// ── Canvas (DOM) renderer — used by LoginScreen / Room city windows ──────────

export function drawFireworksCanvas(ctx: CanvasRenderingContext2D, fw: FireworksEngine): void {
  const r = fw.radius;
  const d = r * 2;
  const now = fw.now;
  ctx.save();
  // Additive: overlapping sparks bloom instead of occluding (drawn over dark sky).
  ctx.globalCompositeOperation = 'lighter';

  // Detonation flash — expanding, fading glow under the sparks.
  for (const f of fw.flashes) {
    const t = 1 - f.life / f.maxLife;
    const fade = (1 - t) * (1 - t);
    const rad = (3 + r * 9) * (0.3 + 0.7 * t);
    ctx.globalAlpha = 0.35 * fade;
    ctx.fillStyle = fw.colorCss(f.ci);
    ctx.beginPath(); ctx.arc(f.x, f.y, rad, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.85 * fade;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(f.x, f.y, rad * 0.45, 0, Math.PI * 2); ctx.fill();
  }

  for (const rocket of fw.rockets) {
    for (let i = 0; i < rocket.trail.length; i++) {
      ctx.globalAlpha = (i / rocket.trail.length) * 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(rocket.trail[i].x - 1, rocket.trail[i].y - 1, 2, 2);
    }
    // Warm ember glow around the climbing shell, white-hot core on top.
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#ffc878';
    ctx.fillRect(rocket.x - d, rocket.y - d, d * 2, d * 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(rocket.x, rocket.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const p of fw.particles) {
    const lf = p.alpha; // life fraction, 1 at birth → 0 at death
    let a = lf * 0.9;
    // Burn-out glitter: dying sparks strobe instead of fading flat.
    if (lf < 0.45) a *= 0.3 + 0.7 * Math.abs(Math.sin(now * 0.02 + p.tw));
    // Sparks shrink as they cool; newborn ones flash white-hot.
    const ds = Math.max(1, d * (0.55 + 0.45 * lf));
    const col = lf > 0.82 ? fw.colorCssBright(p.ci) : fw.colorCss(p.ci);
    // One-tick motion smear while the spark is still fast (young).
    if (lf > 0.5) {
      ctx.globalAlpha = a * 0.3;
      ctx.fillStyle = col;
      ctx.fillRect(p.px - ds / 2, p.py - ds / 2, ds, ds);
    }
    ctx.globalAlpha = a;
    ctx.fillStyle = col;
    ctx.fillRect(p.x - ds / 2, p.y - ds / 2, ds, ds);
  }
  ctx.restore();
}

// ── Phaser Graphics renderer — used by HubScene / Lounge / Room windows ──────

// `accept` (optional) clips drawing to points it approves — used to confine
// fireworks to a window/sky region so falling sparks don't spill onto a floor.
export function drawFireworksPhaser(
  g: Phaser.GameObjects.Graphics,
  fw: FireworksEngine,
  accept?: (x: number, y: number) => boolean,
): void {
  // fillRect, not fillCircle: Phaser tessellates every circle into ~32 triangles, so a
  // few hundred particles is thousands of tris/frame. At these radii (≤1.5px) a square
  // is visually identical and ~16× cheaper to build + upload. The only circles below
  // are the detonation flashes — at most a couple alive at once.
  const r = fw.radius;
  const d = r * 2;
  const now = fw.now;

  // Detonation flash — expanding, fading glow under the sparks.
  for (const f of fw.flashes) {
    if (accept && !accept(f.x, f.y)) continue;
    const t = 1 - f.life / f.maxLife; // 0 → 1 over the flash
    const fade = (1 - t) * (1 - t);
    const rad = (3 + r * 9) * (0.3 + 0.7 * t);
    g.fillStyle(fw.colorNum(f.ci), 0.35 * fade);
    g.fillCircle(f.x, f.y, rad);
    g.fillStyle(0xffffff, 0.85 * fade);
    g.fillCircle(f.x, f.y, rad * 0.45);
  }

  for (const rocket of fw.rockets) {
    for (let i = 0; i < rocket.trail.length; i++) {
      const pt = rocket.trail[i];
      if (accept && !accept(pt.x, pt.y)) continue;
      g.fillStyle(0xffffff, (i / rocket.trail.length) * 0.5);
      g.fillRect(pt.x - 1, pt.y - 1, 2, 2);
    }
    if (!accept || accept(rocket.x, rocket.y)) {
      // Warm ember glow around the climbing shell, white-hot core on top.
      g.fillStyle(0xffc878, 0.3);
      g.fillRect(rocket.x - d, rocket.y - d, d * 2, d * 2);
      g.fillStyle(0xffffff, 1);
      g.fillRect(rocket.x - r, rocket.y - r, d, d);
    }
  }

  for (const p of fw.particles) {
    if (accept && !accept(p.x, p.y)) continue;
    const lf = p.alpha; // life fraction, 1 at birth → 0 at death
    let a = lf * 0.9;
    // Burn-out glitter: dying sparks strobe instead of fading flat.
    if (lf < 0.45) a *= 0.3 + 0.7 * Math.abs(Math.sin(now * 0.02 + p.tw));
    // Sparks shrink as they cool; newborn ones flash white-hot.
    const ds = Math.max(1, d * (0.55 + 0.45 * lf));
    const col = lf > 0.82 ? fw.colorNumBright(p.ci) : fw.colorNum(p.ci);
    // One-tick motion smear while the spark is still fast (young).
    if (lf > 0.5) {
      g.fillStyle(col, a * 0.3);
      g.fillRect(p.px - ds / 2, p.py - ds / 2, ds, ds);
    }
    g.fillStyle(col, a);
    g.fillRect(p.x - ds / 2, p.y - ds / 2, ds, ds);
  }
}

import Phaser from 'phaser';

export function isJuly4thPeriod(): boolean {
  if (new URLSearchParams(window.location.search).get('holiday') === 'july4') return true;
  const d = new Date();
  return d.getMonth() === 6 && d.getDate() >= 3 && d.getDate() <= 6;
}

const COLORS_CSS = [
  '#ff2222', '#ff5555', '#ff8888',
  '#ffffff', '#ffeeee',
  '#2255ff', '#5588ff', '#88aaff',
];
const COLORS_NUM = COLORS_CSS.map(c => parseInt(c.replace('#', ''), 16));

interface FWRocket {
  x: number; y: number; vy: number; targetY: number;
  ci: number;
  trail: Array<{ x: number; y: number }>;
}

interface FWParticle {
  x: number; y: number; vx: number; vy: number;
  ci: number; alpha: number; life: number; maxLife: number;
}

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
}

export class FireworksEngine {
  readonly rockets: FWRocket[] = [];
  readonly particles: FWParticle[] = [];
  private nextLaunch = Infinity; // set on first tick once we know current time
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
    };
  }

  tick(time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs, 64) / 16;

    if (!this.started) {
      this.started = true;
      this.nextLaunch = time + this.cfg.initialDelay;
    }

    if (time > this.nextLaunch) {
      this.launchRocket();
      this.nextLaunch = time + this.cfg.intervalMin + Math.random() * this.cfg.intervalMax;
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
    const { launchY, explodeYMin, explodeYMax, xMin, xMax } = this.cfg;
    this.rockets.push({
      x: xMin + Math.random() * (xMax - xMin),
      y: launchY,
      vy: -(3.8 + Math.random() * 2.8),
      targetY: explodeYMin + Math.random() * (explodeYMax - explodeYMin),
      ci, trail: [],
    });
  }

  private explode(r: FWRocket): void {
    const count = Math.round(this.cfg.explosionCount * (0.8 + Math.random() * 0.4));
    const life = 900 + Math.random() * 500;
    const speed = this.cfg.explosionSpeed * (0.7 + Math.random() * 0.6);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const s = speed * (0.5 + Math.random() * 0.9);
      this.particles.push({
        x: r.x, y: r.y,
        vx: Math.cos(angle) * s, vy: Math.sin(angle) * s,
        ci: r.ci, alpha: 1, life, maxLife: life,
      });
    }
  }

  get radius(): number { return this.cfg.particleRadius; }
  colorCss(ci: number): string { return COLORS_CSS[ci]; }
  colorNum(ci: number): number { return COLORS_NUM[ci]; }
}

// ── Canvas (DOM) renderer — used by LoginScreen ──────────────────────────────

export function drawFireworksCanvas(ctx: CanvasRenderingContext2D, fw: FireworksEngine): void {
  const r = fw.radius;
  ctx.save();
  for (const rocket of fw.rockets) {
    for (let i = 0; i < rocket.trail.length; i++) {
      ctx.globalAlpha = (i / rocket.trail.length) * 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(rocket.trail[i].x - 1, rocket.trail[i].y - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(rocket.x, rocket.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const p of fw.particles) {
    ctx.globalAlpha = p.alpha * 0.9;
    ctx.fillStyle = fw.colorCss(p.ci);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── Phaser Graphics renderer — used by HubScene / Lounge ─────────────────────

export function drawFireworksPhaser(g: Phaser.GameObjects.Graphics, fw: FireworksEngine): void {
  const r = fw.radius;
  for (const rocket of fw.rockets) {
    for (let i = 0; i < rocket.trail.length; i++) {
      g.fillStyle(0xffffff, (i / rocket.trail.length) * 0.5);
      g.fillRect(rocket.trail[i].x - 1, rocket.trail[i].y - 1, 2, 2);
    }
    g.fillStyle(0xffffff, 1);
    g.fillCircle(rocket.x, rocket.y, r);
  }
  for (const p of fw.particles) {
    g.fillStyle(fw.colorNum(p.ci), p.alpha * 0.85);
    g.fillCircle(p.x, p.y, r);
  }
}

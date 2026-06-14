import Phaser from 'phaser';

// Valentine's world decorations — floating hearts (air) + glowing heart
// lanterns (ground). Mirrors the Halloween FX (bats + pumpkins). Window: Feb 8–14.

export function isValentinePeriod(): boolean {
  if (new URLSearchParams(window.location.search).get('holiday') === 'valentine') return true;
  const d = new Date(); return d.getMonth() === 1 && d.getDate() >= 8 && d.getDate() <= 14;
}

// ── Heart shape ────────────────────────────────────────────────────────────────
// Pixel heart on a 7×6 grid, drawn as filled row-runs. `u` is the pixel unit.
function drawHeart(
  fill: (x: number, y: number, w: number, h: number) => void,
  cx: number, cy: number, u: number,
): void {
  const left = cx - 3.5 * u, top = cy - 3 * u;
  fill(left + 1 * u, top,         2 * u, u); // top-left lobe
  fill(left + 4 * u, top,         2 * u, u); // top-right lobe
  fill(left,         top + 1 * u, 7 * u, u);
  fill(left,         top + 2 * u, 7 * u, u);
  fill(left + 1 * u, top + 3 * u, 5 * u, u);
  fill(left + 2 * u, top + 4 * u, 3 * u, u);
  fill(left + 3 * u, top + 5 * u, 1 * u, u); // point
}

// ── Floating hearts ─────────────────────────────────────────────────────────────

interface FloatHeart {
  x: number; y: number; vy: number;
  phase: number; phaseSpeed: number; amp: number;
  size: number; color: number; alpha: number;
}

const HEART_COLORS = [0xff5d8f, 0xff90b3, 0xe23d6a, 0xffb3c8];

export interface HeartsConfig {
  yMin?: number;  // top of drift range (default 20)
  yMax?: number;  // bottom / spawn line (default H)
  count?: number; // simultaneous hearts (default 7)
  speedMin?: number;
  speedMax?: number;
}

export class HeartsEngine {
  readonly hearts: FloatHeart[] = [];

  constructor(private W: number, private yMin: number, private yMax: number,
              private speedMin: number, private speedMax: number, count: number) {
    for (let i = 0; i < count; i++) this.spawn(true);
  }

  private spawn(initial = false): void {
    this.hearts.push({
      x: Math.random() * this.W,
      y: initial ? this.yMin + Math.random() * (this.yMax - this.yMin) : this.yMax + 8,
      vy: -(this.speedMin + Math.random() * (this.speedMax - this.speedMin)),
      phase:      Math.random() * Math.PI * 2,
      phaseSpeed: 0.0012 + Math.random() * 0.0018,
      amp:        4 + Math.random() * 8,
      size:       1 + (Math.random() > 0.5 ? 1 : 0),
      color:      HEART_COLORS[Math.floor(Math.random() * HEART_COLORS.length)],
      alpha:      0.55 + Math.random() * 0.35,
    });
  }

  tick(time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs, 64) / 16;
    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const h = this.hearts[i];
      h.y += h.vy * dt;
      h.x += Math.sin(time * h.phaseSpeed + h.phase) * 0.4 * dt;
      if (h.y < this.yMin - 12) { this.hearts.splice(i, 1); this.spawn(); }
    }
  }
}

export function newHeartsEngine(W: number, H: number, cfg: HeartsConfig = {}): HeartsEngine {
  return new HeartsEngine(
    W,
    cfg.yMin     ?? 20,
    cfg.yMax     ?? H,
    cfg.speedMin ?? 0.18,
    cfg.speedMax ?? 0.5,
    cfg.count    ?? 7,
  );
}

export function drawHeartsPhaser(
  g: Phaser.GameObjects.Graphics, engine: HeartsEngine, accept?: (x: number, y: number) => boolean,
): void {
  for (const h of engine.hearts) {
    if (accept && !accept(h.x, h.y)) continue;
    g.fillStyle(h.color, h.alpha);
    drawHeart((x, y, w, ht) => g.fillRect(x, y, w, ht), h.x, h.y, h.size);
  }
}

export function drawHeartsCanvas(ctx: CanvasRenderingContext2D, engine: HeartsEngine): void {
  for (const h of engine.hearts) {
    ctx.globalAlpha = h.alpha;
    ctx.fillStyle = `#${h.color.toString(16).padStart(6, '0')}`;
    drawHeart((x, y, w, ht) => ctx.fillRect(x, y, w, ht), h.x, h.y, h.size);
  }
  ctx.globalAlpha = 1;
}

// ── Ground heart lantern (analog to a pumpkin) ──────────────────────────────────
// `bottom` is ground level; the lantern's post sits on it, heart glows above.
export function drawHeartLanternPhaser(
  g: Phaser.GameObjects.Graphics, cx: number, bottom: number, s: number, glowAmt = 0,
): void {
  const heartCy = bottom - s * 4;
  if (glowAmt > 0) {
    g.fillStyle(0xff5d8f, glowAmt * 0.22);
    g.fillCircle(cx, heartCy, s * 5);
    g.fillStyle(0xffb3c8, glowAmt * 0.12);
    g.fillCircle(cx, heartCy, s * 7);
  }
  // post
  g.fillStyle(0x2a1420, 1);
  g.fillRect(cx - s * 0.4, heartCy + s * 2, s * 0.8, s * 2);
  g.fillRect(cx - s * 1.2, bottom - s * 0.5, s * 2.4, s * 0.5); // base
  // heart (bright core + lighter rim)
  g.fillStyle(0xe23d6a, 1);
  drawHeart((x, y, w, h) => g.fillRect(x, y, w, h), cx, heartCy, s);
  g.fillStyle(0xff90b3, 0.9);
  drawHeart((x, y, w, h) => g.fillRect(x, y, w, Math.max(1, h * 0.5)), cx, heartCy - s * 0.2, s * 0.6);
}

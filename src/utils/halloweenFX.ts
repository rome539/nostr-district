import Phaser from 'phaser';

// ── Pumpkin drawing ───────────────────────────────────────────────────────────

// cy is the BOTTOM of the pumpkin body so it sits flush on the ground
function pumpkinRects(cx: number, bottom: number, s: number): Array<[number, number, number, number, number, number, number]> {
  const cy = bottom - s * 0.7; // centre of body
  return [
    // body lobes
    [255, 100,   0, cx - s * 1.4, cy - s * 0.7, s * 2.8, s * 1.4],
    // ridge lines (darker)
    [180,  55,   0, cx - 1,        cy - s * 0.7,        2, s * 1.4],
    [180,  55,   0, cx - s * 0.6,  cy - s * 0.5,        1, s * 1.0],
    [180,  55,   0, cx + s * 0.6,  cy - s * 0.5,        1, s * 1.0],
    // stem
    [ 40,  90,  20, cx - 2,        cy - s * 0.7 - s * 0.6, 4, s * 0.6],
    // carved eyes (dark)
    [  10,  5,   0, cx - s * 0.8,  cy - s * 0.2, s * 0.5, s * 0.38],
    [  10,  5,   0, cx + s * 0.3,  cy - s * 0.2, s * 0.5, s * 0.38],
    // carved mouth teeth gaps
    [  10,  5,   0, cx - s * 0.9,  cy + s * 0.22, s * 1.8, s * 0.22],
    [  10,  5,   0, cx - s * 0.4,  cy + s * 0.10, s * 0.28, s * 0.36],
    [  10,  5,   0, cx + s * 0.12, cy + s * 0.10, s * 0.28, s * 0.36],
  ];
}

export function drawPumpkinPhaser(
  g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number, glowAmt = 0,
): void {
  if (glowAmt > 0) {
    g.fillStyle(0xff8800, glowAmt * 0.25);
    g.fillCircle(cx, cy, s * 2.5);
    g.fillStyle(0xffaa00, glowAmt * 0.12);
    g.fillCircle(cx, cy, s * 3.5);
  }
  for (const [r, gr, b, x, y, w, h] of pumpkinRects(cx, cy, s)) {
    g.fillStyle(Phaser.Display.Color.GetColor(r, gr, b), 1);
    g.fillRect(x, y, w, h);
  }
}

export function drawPumpkinCanvas(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, glowAmt = 0,
): void {
  if (glowAmt > 0) {
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 3.5);
    grd.addColorStop(0, `rgba(255,160,0,${glowAmt * 0.35})`);
    grd.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx, cy, s * 3.5, 0, Math.PI * 2); ctx.fill();
  }
  for (const [r, gr, b, x, y, w, h] of pumpkinRects(cx, cy, s)) {
    ctx.fillStyle = `rgb(${r},${gr},${b})`;
    ctx.fillRect(x, y, w, h);
  }
}


// ── Glowing Eyes ─────────────────────────────────────────────────────────────

interface EyePair { x: number; y: number; phase: number; blinkT: number; visible: boolean; nextBlink: number; }

export class GlowingEyesEngine {
  readonly eyes: EyePair[] = [];

  constructor(positions: Array<[number, number]>) {
    for (const [x, y] of positions) {
      this.eyes.push({ x, y, phase: Math.random() * Math.PI * 2, blinkT: 0, visible: true, nextBlink: 2000 + Math.random() * 4000 });
    }
  }

  tick(deltaMs: number): void {
    for (const e of this.eyes) {
      e.blinkT += deltaMs;
      if (e.visible && e.blinkT > e.nextBlink) {
        e.visible = false; e.blinkT = 0; e.nextBlink = 100 + Math.random() * 200;
      } else if (!e.visible && e.blinkT > e.nextBlink) {
        e.visible = true; e.blinkT = 0; e.nextBlink = 2000 + Math.random() * 5000;
      }
    }
  }
}

export function drawEyesPhaser(g: Phaser.GameObjects.Graphics, engine: GlowingEyesEngine, time: number): void {
  for (const e of engine.eyes) {
    if (!e.visible) continue;
    const pulse = 0.6 + Math.sin(time * 0.003 + e.phase) * 0.3;
    g.fillStyle(0xffee00, pulse * 0.12);
    g.fillCircle(e.x - 3, e.y, 3); g.fillCircle(e.x + 3, e.y, 3);
    g.fillStyle(0xffee22, pulse);
    g.fillRect(e.x - 4, e.y - 1, 2, 2);
    g.fillRect(e.x + 2, e.y - 1, 2, 2);
  }
}

export function drawEyesCanvas(ctx: CanvasRenderingContext2D, engine: GlowingEyesEngine, time: number): void {
  for (const e of engine.eyes) {
    if (!e.visible) continue;
    const pulse = 0.6 + Math.sin(time * 0.003 + e.phase) * 0.3;
    ctx.fillStyle = `rgba(255,238,0,${pulse * 0.2})`;
    ctx.beginPath(); ctx.arc(e.x - 4, e.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(e.x + 4, e.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255,238,34,${pulse})`;
    ctx.fillRect(e.x - 5, e.y - 1, 3, 2);
    ctx.fillRect(e.x + 2, e.y - 1, 3, 2);
  }
}

// ── Ground Fog ───────────────────────────────────────────────────────────────

interface FogWisp { x: number; y: number; vx: number; w: number; alpha: number; phase: number; }

export class GroundFogEngine {
  readonly wisps: FogWisp[] = [];
  constructor(private W: number, private groundY: number, count = 12) {
    for (let i = 0; i < count; i++) this.spawnWisp(true);
  }
  private spawnWisp(initial = false): void {
    this.wisps.push({
      x: initial ? Math.random() * this.W : (Math.random() > 0.5 ? -60 : this.W + 60),
      y: this.groundY - 8 - Math.random() * 28,
      vx: (Math.random() > 0.5 ? 1 : -1) * (0.08 + Math.random() * 0.12),
      w: 40 + Math.random() * 80,
      alpha: 0.04 + Math.random() * 0.07,
      phase: Math.random() * Math.PI * 2,
    });
  }
  tick(deltaMs: number): void {
    const dt = Math.min(deltaMs, 64) / 16;
    for (let i = this.wisps.length - 1; i >= 0; i--) {
      const f = this.wisps[i];
      f.x += f.vx * dt;
      if (f.x < -100 || f.x > this.W + 100) { this.wisps.splice(i, 1); this.spawnWisp(); }
    }
  }
}

export function drawFogPhaser(g: Phaser.GameObjects.Graphics, engine: GroundFogEngine, time: number): void {
  for (const f of engine.wisps) {
    const a = f.alpha * (0.7 + Math.sin(time * 0.0015 + f.phase) * 0.3);
    g.fillStyle(0xc8d8e8, a);
    g.fillEllipse(f.x, f.y, f.w, 14);
  }
}

export function drawFogCanvas(ctx: CanvasRenderingContext2D, engine: GroundFogEngine, time: number): void {
  for (const f of engine.wisps) {
    const a = f.alpha * (0.7 + Math.sin(time * 0.0015 + f.phase) * 0.3);
    ctx.fillStyle = `rgba(200,216,232,${a})`;
    ctx.beginPath();
    ctx.ellipse(f.x, f.y, f.w / 2, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

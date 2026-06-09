import Phaser from 'phaser';

export function isHalloweenPeriod(): boolean {
  const d = new Date(); return d.getMonth() === 9 && d.getDate() >= 29 && d.getDate() <= 31;
}

interface Bat {
  x: number; y: number; vx: number;
  baseY: number; phase: number; phaseSpeed: number; amp: number;
  size: number; wingPhase: number;
}

export interface BatsConfig {
  yMin?: number;   // min spawn Y (default: 30)
  yMax?: number;   // max spawn Y (default: 180)
  count?: number;  // simultaneous bats (default: 5)
  speedMin?: number;
  speedMax?: number;
}

export class BatEngine {
  readonly bats: Bat[] = [];

  constructor(private W: number, private yMin: number, private yMax: number,
              private speedMin: number, private speedMax: number, count: number) {
    for (let i = 0; i < count; i++) this.spawnBat(true);
  }

  private spawnBat(initial = false): void {
    const fromLeft = Math.random() > 0.5;
    const baseY = this.yMin + Math.random() * (this.yMax - this.yMin);
    this.bats.push({
      x: initial ? Math.random() * this.W : (fromLeft ? -12 : this.W + 12),
      y: baseY,
      vx: (fromLeft ? 1 : -1) * (this.speedMin + Math.random() * (this.speedMax - this.speedMin)),
      baseY,
      phase:      Math.random() * Math.PI * 2,
      phaseSpeed: 0.0015 + Math.random() * 0.002,
      amp:        6 + Math.random() * 10,
      size:       1 + (Math.random() > 0.5 ? 1 : 0),
      wingPhase:  Math.random() * Math.PI * 2,
    });
  }

  tick(time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs, 64) / 16;
    for (let i = this.bats.length - 1; i >= 0; i--) {
      const b = this.bats[i];
      b.x += b.vx * dt;
      b.y = b.baseY + Math.sin(time * b.phaseSpeed + b.phase) * b.amp;
      if (b.x < -20 || b.x > this.W + 20) {
        this.bats.splice(i, 1);
        this.spawnBat();
      }
    }
  }
}

export function newBatEngine(W: number, cfg: BatsConfig = {}): BatEngine {
  return new BatEngine(
    W,
    cfg.yMin     ?? 30,
    cfg.yMax     ?? 180,
    cfg.speedMin ?? 0.4,
    cfg.speedMax ?? 0.9,
    cfg.count    ?? 5,
  );
}

function drawBat(
  fill: (x: number, y: number, w: number, h: number) => void,
  b: Bat, time: number,
): void {
  const wingUp = Math.sin(time * 0.009 + b.wingPhase) > 0;
  const s = b.size;
  // body
  fill(b.x - s,      b.y - s,      s * 2, s * 2);
  // wings
  if (wingUp) {
    fill(b.x - s * 4, b.y - s * 2, s * 3, s);
    fill(b.x + s,     b.y - s * 2, s * 3, s);
  } else {
    fill(b.x - s * 4, b.y,         s * 3, s);
    fill(b.x + s,     b.y,         s * 3, s);
  }
}

export function drawBatsPhaser(g: Phaser.GameObjects.Graphics, engine: BatEngine, time: number): void {
  for (const b of engine.bats) {
    // dark silhouette with subtle glow so they read against the night sky
    g.fillStyle(0x1a0a2e, 0.7);
    drawBat((x, y, w, h) => g.fillRect(x - 1, y - 1, w + 2, h + 2), b, time);
    g.fillStyle(0x3d1f5c, 0.95);
    drawBat((x, y, w, h) => g.fillRect(x, y, w, h), b, time);
  }
}

export function drawBatsCanvas(ctx: CanvasRenderingContext2D, engine: BatEngine, time: number): void {
  for (const b of engine.bats) {
    ctx.fillStyle = 'rgba(29,10,46,0.7)';
    drawBat((x, y, w, h) => ctx.fillRect(x - 1, y - 1, w + 2, h + 2), b, time);
    ctx.fillStyle = 'rgba(61,31,92,0.95)';
    drawBat((x, y, w, h) => ctx.fillRect(x, y, w, h), b, time);
  }
}

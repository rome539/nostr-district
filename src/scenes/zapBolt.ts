// The zap lightning strike: a jagged amber bolt that arcs from the zapper to
// the zap recipient. Drawn ENTIRELY client-side by the two parties — the
// sender fires it when their payment settles, the recipient when the zap
// arrives — so nothing extra is broadcast and bystanders never see it
// (matching the privacy model of the zap itself). If the other party isn't
// in the current scene, no bolt is drawn.
import Phaser from 'phaser';

type Point = { x: number; y: number };
/** Endpoint getters re-read the sprite position each frame so the bolt
 *  tracks players who are walking; returning null drops the bolt. */
type Anchor = () => Point | null;

const TRAVEL_MS = 350;   // head races from sender to recipient
const LINGER_MS = 280;   // full bolt flickers, then fades out

interface Bolt {
  from: Anchor;
  to: Anchor;
  age: number;
  /** Joint count, rolled per bolt (7–10) so no two strikes zigzag alike. */
  segs: number;
  /** Per-joint offsets perpendicular to travel, fixed at spawn (the arc's
   *  shape); a small per-frame jitter on top gives the electric flicker. */
  offs: { dx: number; dy: number }[];
  discharged: boolean;
}

interface Spark {
  x: number; y: number; vx: number; vy: number;
  life: number; age: number;
}

export class ZapBoltFX {
  private g: Phaser.GameObjects.Graphics;
  private bolts: Bolt[] = [];
  private sparks: Spark[] = [];

  constructor(scene: Phaser.Scene, depth = 20) {
    this.g = scene.add.graphics().setDepth(depth).setBlendMode(Phaser.BlendModes.ADD);
  }

  strike(from: Anchor, to: Anchor): void {
    // Every strike rolls its own shape: joint count, bow direction (up or
    // down), bow depth, and per-joint scatter in BOTH axes — back-to-back
    // zaps between two standing players still trace clearly different paths.
    const segs = 7 + Math.floor(Math.random() * 4);
    const lift = (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 48);
    const offs = [{ dx: 0, dy: 0 }];
    for (let i = 1; i < segs; i++) {
      offs.push({
        dx: (Math.random() - 0.5) * 20,
        dy: Math.sin(Math.PI * (i / segs)) * lift + (Math.random() - 0.5) * 32,
      });
    }
    offs.push({ dx: 0, dy: 0 });
    this.bolts.push({ from, to, age: 0, segs, offs, discharged: false });
  }

  update(deltaMs: number): void {
    this.g.clear();
    if (this.bolts.length === 0 && this.sparks.length === 0) return;
    const dt = Math.min(deltaMs, 50) / 1000;

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.age += deltaMs;
      const a = b.from(), z = b.to();
      if (!a || !z || b.age >= TRAVEL_MS + LINGER_MS) { this.bolts.splice(i, 1); continue; }

      if (!b.discharged && b.age >= TRAVEL_MS) {
        b.discharged = true;
        this.burst(z.x, z.y);
      }

      const frac  = Math.min(1, b.age / TRAVEL_MS);
      const alpha = b.age <= TRAVEL_MS ? 1 : 1 - (b.age - TRAVEL_MS) / LINGER_MS;
      const joints = Math.max(1, Math.floor(b.segs * frac));
      const pt = (j: number): Point => {
        const f = j / b.segs;
        return {
          x: a.x + (z.x - a.x) * f + b.offs[j].dx,
          y: a.y + (z.y - a.y) * f + b.offs[j].dy + (Math.random() - 0.5) * 4,
        };
      };
      // glow pass + core pass (ADD blend turns the overlap into the hot center)
      for (const [width, col, aa] of [[5, 0xf0b040, 0.35 * alpha], [2, 0xffe060, alpha]] as const) {
        this.g.lineStyle(width, col, aa);
        this.g.beginPath();
        const p0 = pt(0);
        this.g.moveTo(p0.x, p0.y);
        for (let j = 1; j <= joints && j <= b.segs; j++) { const p = pt(j); this.g.lineTo(p.x, p.y); }
        this.g.strokePath();
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      if (s.age >= s.life) { this.sparks.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 140 * dt;
      this.g.fillStyle(0xffe060, 1 - s.age / s.life);
      this.g.fillRect(s.x - 1, s.y - 1, 2, 2);
    }
  }

  private burst(x: number, y: number): void {
    for (let i = 0; i < 16; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp  = 40 + Math.random() * 90;
      this.sparks.push({
        x, y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 30,
        life: 0.3 + Math.random() * 0.3,
        age: 0,
      });
    }
  }

  destroy(): void {
    this.g.destroy();
    this.bolts.length = 0;
    this.sparks.length = 0;
  }
}

/** HeartsEmote — small hearts float upward from the player. */
import Phaser from 'phaser';
import { BaseEmote } from './EmoteSet';

interface Heart {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; r: number; color: number;
}

const HEART_COLORS = [0xff4477, 0xff77aa, 0xff2255, 0xff99bb];

export class HeartsEmote implements BaseEmote {
  private hearts: Heart[] = [];
  private timer = 0;
  private spawnTimer = 0;
  private idx = 0;
  private _active = false;
  readonly stopsOnMove = false;
  private readonly duration = 8000;

  get active(): boolean { return this._active; }
  start(): void { this._active = true; this.timer = 0; this.spawnTimer = 0; this.hearts = []; this.idx = 0; }
  stop(): void  { this._active = false; this.timer = 0; this.hearts = []; }

  private drawHeart(g: Phaser.GameObjects.Graphics, hx: number, hy: number, r: number, color: number, alpha: number): void {
    g.fillStyle(color, alpha);
    // Two circles for the top bumps
    g.fillCircle(hx - r * 0.7, hy, r);
    g.fillCircle(hx + r * 0.7, hy, r);
    // Triangle for the bottom point
    g.fillTriangle(
      hx - r * 1.5, hy,
      hx + r * 1.5, hy,
      hx,            hy + r * 1.8,
    );
  }

  update(g: Phaser.GameObjects.Graphics, delta: number, px: number, py: number, _fr: boolean, scale: 'hub' | 'cabin' | 'room'): boolean {
    if (!this._active) return false;
    this.timer += delta;
    if (this.timer > this.duration) { this.stop(); return false; }
    this.spawnTimer += delta;

    const isRoom  = scale === 'room';
    const isCabin = scale === 'cabin';
    if (this.spawnTimer >= 420) {
      this.spawnTimer = 0;
      this.hearts.push({
        x: px + (Math.random() - 0.5) * (isRoom ? 28 : isCabin ? 22 : 16),
        y: py - (isRoom ? 152 : isCabin ? 88 : 44),
        vx: (Math.random() - 0.5) * (isRoom ? 0.35 : isCabin ? 0.28 : 0.22),
        vy: -(isRoom ? 0.5 : isCabin ? 0.42 : 0.32) - Math.random() * 0.2,
        life: 0,
        maxLife: 1800 + Math.random() * 700,
        r: isRoom ? 3 + Math.random() * 2 : isCabin ? 2.5 + Math.random() * 1.5 : 2 + Math.random(),
        color: HEART_COLORS[this.idx % HEART_COLORS.length],
      });
      this.idx++;
    }

    const dt = delta / 16;
    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const h = this.hearts[i];
      h.x += (h.vx + Math.sin(h.life * 0.005) * 0.06) * dt;
      h.y += h.vy * dt;
      h.life += delta;
      const prog = h.life / h.maxLife;
      if (prog >= 1) { this.hearts.splice(i, 1); continue; }
      const alpha = prog < 0.12 ? (prog / 0.12) * 0.9 : (1 - prog) * 0.9;
      this.drawHeart(g, h.x, h.y, h.r, h.color, alpha);
    }
    return true;
  }
}

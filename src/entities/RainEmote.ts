/** RainEmote — a tiny personal storm cloud with falling raindrops. */
import Phaser from 'phaser';
import { BaseEmote } from './EmoteSet';

interface Drop {
  x: number; y: number; vy: number; len: number;
  life: number; maxLife: number;
}

export class RainEmote implements BaseEmote {
  private drops: Drop[] = [];
  private timer = 0;
  private spawnTimer = 0;
  private _active = false;
  readonly stopsOnMove = false;
  private readonly duration = 10000;

  get active(): boolean { return this._active; }
  start(): void { this._active = true; this.timer = 0; this.spawnTimer = 0; this.drops = []; }
  stop(): void  { this._active = false; this.timer = 0; this.drops = []; }

  private drawCloud(g: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: 'hub' | 'cabin' | 'room', alpha: number): void {
    const isRoom  = scale === 'room';
    const isCabin = scale === 'cabin';
    const bumps = isRoom
      ? [{ ox: 0, oy: 0, r: 10 }, { ox: -13, oy: 4, r: 7 }, { ox: 13, oy: 4, r: 7 }, { ox: -7, oy: -3, r: 7 }, { ox: 7, oy: -3, r: 7 }]
      : isCabin
        ? [{ ox: 0, oy: 0, r: 8 }, { ox: -11, oy: 3, r: 6 }, { ox: 11, oy: 3, r: 6 }, { ox: -6, oy: -2, r: 5.5 }, { ox: 6, oy: -2, r: 5.5 }]
        : [{ ox: 0, oy: 0, r: 6 }, { ox: -8, oy: 3, r: 4.5 }, { ox: 8, oy: 3, r: 4.5 }, { ox: -4, oy: -2, r: 4 }, { ox: 4, oy: -2, r: 4 }];
    g.fillStyle(0x99aacc, alpha);
    for (const { ox, oy, r } of bumps) g.fillCircle(cx + ox, cy + oy, r);
    // Dark underside
    g.fillStyle(0x6677aa, alpha * 0.5);
    const uW = isRoom ? 32 : isCabin ? 26 : 20;
    const uH = isRoom ? 5 : isCabin ? 4 : 3;
    const uOY = isRoom ? 6 : isCabin ? 5 : 4;
    g.fillRect(cx - uW / 2, cy + uOY, uW, uH);
  }

  update(g: Phaser.GameObjects.Graphics, delta: number, px: number, py: number, _fr: boolean, scale: 'hub' | 'cabin' | 'room'): boolean {
    if (!this._active) return false;
    this.timer += delta;
    if (this.timer > this.duration) { this.stop(); return false; }
    this.spawnTimer += delta;

    const isRoom  = scale === 'room';
    const isCabin = scale === 'cabin';
    const fade    = this.timer > this.duration - 1500 ? (this.duration - this.timer) / 1500 : 1;
    const cloudX  = px;
    const cloudY  = py - (isRoom ? 172 : isCabin ? 104 : 52);
    const cloudBottom = cloudY + (isRoom ? 10 : isCabin ? 8 : 6);
    const cloudHalfW  = isRoom ? 16 : isCabin ? 13 : 10;

    // Spawn drops
    if (this.spawnTimer >= 80) {
      this.spawnTimer = 0;
      this.drops.push({
        x: cloudX + (Math.random() - 0.5) * cloudHalfW * 1.6,
        y: cloudBottom,
        vy: isRoom ? 1.4 : isCabin ? 1.1 : 0.9,
        len: isRoom ? 5 + Math.random() * 4 : isCabin ? 4 + Math.random() * 3 : 3 + Math.random() * 2,
        life: 0,
        maxLife: 700 + Math.random() * 300,
      });
    }

    // Draw cloud
    this.drawCloud(g, cloudX, cloudY, scale, fade * 0.85);

    // Draw drops
    const dt = delta / 16;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.y += d.vy * dt;
      d.life += delta;
      const prog = d.life / d.maxLife;
      if (prog >= 1) { this.drops.splice(i, 1); continue; }
      const alpha = (1 - prog) * fade * 0.75;
      g.fillStyle(0x88bbff, alpha);
      g.fillRect(d.x, d.y, Math.max(1, isRoom ? 1.5 : isCabin ? 1.5 : 1), d.len);
    }
    if (this.drops.length > 50) this.drops = this.drops.slice(-40);
    return true;
  }
}

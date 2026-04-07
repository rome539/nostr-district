/** ConfettiEmote — colorful rectangles rain down around the player. */
import Phaser from 'phaser';
import { BaseEmote } from './EmoteSet';

interface Piece {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; w: number; h: number; color: number;
}

const COLORS = [0xff4488, 0x44aaff, 0xffcc44, 0x44ff88, 0xaa44ff, 0xff8844, 0xffffff];

export class ConfettiEmote implements BaseEmote {
  private pieces: Piece[] = [];
  private timer = 0;
  private spawnTimer = 0;
  private _active = false;
  readonly stopsOnMove = false;
  private readonly duration = 5000;

  get active(): boolean { return this._active; }
  start(): void { this._active = true; this.timer = 0; this.spawnTimer = 0; this.pieces = []; }
  stop(): void  { this._active = false; this.timer = 0; this.pieces = []; }

  update(g: Phaser.GameObjects.Graphics, delta: number, px: number, py: number, _fr: boolean, scale: 'hub' | 'cabin' | 'room'): boolean {
    if (!this._active) return false;
    this.timer += delta;
    if (this.timer > this.duration) { this.stop(); return false; }
    this.spawnTimer += delta;

    const isRoom  = scale === 'room';
    const isCabin = scale === 'cabin';
    const spawnRate = this.timer < 2000 ? 60 : 150; // burst then trickle
    while (this.spawnTimer >= spawnRate) {
      this.spawnTimer -= spawnRate;
      const count = this.timer < 2000 ? 3 : 1;
      for (let i = 0; i < count; i++) {
        this.pieces.push({
          x: px + (Math.random() - 0.5) * (isRoom ? 80 : isCabin ? 65 : 50),
          y: py - (isRoom ? 160 : isCabin ? 92 : 48),
          vx: (Math.random() - 0.5) * (isRoom ? 1.2 : isCabin ? 1.0 : 0.8),
          vy: (isRoom ? 0.4 : isCabin ? 0.32 : 0.25) + Math.random() * (isRoom ? 1.2 : isCabin ? 1.0 : 0.7),
          life: 0,
          maxLife: 1400 + Math.random() * 800,
          w: isRoom ? 4 + Math.random() * 4 : isCabin ? 3 + Math.random() * 3.5 : 2 + Math.random() * 3,
          h: isRoom ? 2 + Math.random() * 3 : isCabin ? 1.5 + Math.random() * 2.5 : 1 + Math.random() * 2,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
        });
      }
    }

    const dt = delta / 16;
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.x += (p.vx + Math.sin(p.life * 0.007 + p.x * 0.05) * 0.15) * dt;
      p.y += p.vy * dt;
      p.vy += 0.015 * dt; // gravity
      p.life += delta;
      const prog = p.life / p.maxLife;
      if (prog >= 1) { this.pieces.splice(i, 1); continue; }
      const alpha = prog > 0.7 ? (1 - prog) / 0.3 * 0.9 : 0.9;
      g.fillStyle(p.color, alpha);
      g.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
    }
    if (this.pieces.length > 80) this.pieces = this.pieces.slice(-60);
    return true;
  }
}

/** CoffeeEmote — a coffee cup with rising steam wisps. */
import Phaser from 'phaser';
import { BaseEmote } from './EmoteSet';

interface SteamParticle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; col: number;
}

export class CoffeeEmote implements BaseEmote {
  private particles: SteamParticle[] = [];
  private timer = 0;
  private _active = false;
  readonly stopsOnMove = true;
  private readonly duration = 15000;

  get active(): boolean { return this._active; }
  start(): void { this._active = true; this.timer = 0; this.particles = []; }
  stop(): void  { this._active = false; this.timer = 0; this.particles = []; }

  update(g: Phaser.GameObjects.Graphics, delta: number, px: number, py: number, facingRight: boolean, scale: 'hub' | 'cabin' | 'room'): boolean {
    if (!this._active) return false;
    this.timer += delta;
    if (this.timer > this.duration) { this.stop(); return false; }

    const isRoom  = scale === 'room';
    const isCabin = scale === 'cabin';
    const offX  = isRoom ? 22 : isCabin ? 20 : 11;
    const offY  = isRoom ? -78 : isCabin ? -38 : -19;  // waist: hub 48%, cabin 48%, room 52%
    const cupW  = isRoom ? 10 : isCabin ? 10 : 6;
    const cupH  = isRoom ? 14 : isCabin ? 13 : 8;
    const rimW  = isRoom ? 13 : isCabin ? 13 : 8;
    const rimH  = isRoom ? 3  : isCabin ? 3  : 2;

    const cx = facingRight ? px + offX - cupW : px - offX;
    const cy = py + offY;

    // Cup body
    g.fillStyle(0x4a2c0a, 0.9);
    g.fillRect(cx, cy, cupW, cupH);
    // Rim
    g.fillStyle(0x8b5e3c, 0.95);
    g.fillRect(cx - 1, cy, rimW, rimH);
    // Handle stub
    g.fillStyle(0x4a2c0a, 0.8);
    g.fillRect(facingRight ? cx + cupW : cx - 2, cy + 2, 2, isRoom ? 6 : 3);

    // Spawn steam
    if (Math.random() > 0.55) {
      const col = Math.random() > 0.5 ? 0 : 1;
      this.particles.push({
        x: cx + cupW * (col === 0 ? 0.3 : 0.7),
        y: cy - 2,
        vx: (col === 0 ? -0.15 : 0.15) + (Math.random() - 0.5) * 0.1,
        vy: -(isRoom ? 0.38 : isCabin ? 0.32 : 0.24) - Math.random() * 0.18,
        life: 0,
        maxLife: (isRoom ? 1100 : isCabin ? 1000 : 850) + Math.random() * 600,
        size: isRoom ? 2 + Math.random() * 1.5 : isCabin ? 1.8 + Math.random() * 1.2 : 1.2 + Math.random() * 0.8,
        col,
      });
    }

    const dt = delta / 16;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += (p.vx + Math.sin(p.life * 0.006 + p.col * Math.PI) * 0.07) * dt;
      p.y += p.vy * dt;
      p.life += delta;
      const prog = p.life / p.maxLife;
      if (prog >= 1) { this.particles.splice(i, 1); continue; }
      const alpha = prog < 0.15 ? (prog / 0.15) * 0.5 : (1 - prog) * 0.5;
      const sz = p.size + prog * (isRoom ? 3 : isCabin ? 2.5 : 1.5);
      g.fillStyle(0xe8e8e8, alpha);
      g.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    if (this.particles.length > 20) this.particles = this.particles.slice(-15);
    return true;
  }
}

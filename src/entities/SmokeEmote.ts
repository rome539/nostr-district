/**
 * SmokeEmote.ts — Cigarette smoke particle system
 * Used by both the local player and other players
 */

import Phaser from 'phaser';

interface SmokeParticle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
}

export class SmokeEmote {
  private particles: SmokeParticle[] = [];
  private timer = 0;
  private _active = false;
  private duration: number;

  constructor(duration = 12000) {
    this.duration = duration;
  }

  get active(): boolean { return this._active; }

  start(): void {
    this._active = true;
    this.timer = 0;
    this.particles = [];
  }

  stop(): void {
    this._active = false;
    this.timer = 0;
    this.particles = [];
  }

  /** Draw smoke for a player at the given position. Returns false if smoke ended. */
  update(graphics: Phaser.GameObjects.Graphics, delta: number, px: number, py: number, facingRight: boolean, scale: 'hub' | 'room'): boolean {
    if (!this._active) return false;

    this.timer += delta;
    if (this.timer > this.duration) { this.stop(); return false; }

    // Scale-dependent offsets
    const isRoom = scale === 'room';
    const cigOffX = isRoom ? 18 : 5;
    const cigOffY = isRoom ? -110 : -32;
    const cigW = isRoom ? 8 : 4;
    const cigH = isRoom ? 3 : 1.5;
    const tipW = isRoom ? 3 : 1.5;

    const cigX = facingRight ? px + cigOffX - cigW : px - cigOffX;
    const cigY = py + cigOffY;

    // Cigarette body
    graphics.fillStyle(0xf5e8d0, 0.7);
    graphics.fillRect(cigX, cigY, cigW, cigH);

    // Orange tip
    const tipFlicker = 0.5 + Math.sin(this.timer * 0.008) * 0.3;
    graphics.fillStyle(0xf0b040, tipFlicker);
    graphics.fillRect(facingRight ? cigX + cigW : cigX - tipW, cigY, tipW, cigH);

    // Tip glow
    graphics.fillStyle(0xf0b040, tipFlicker * 0.15);
    const glowSize = isRoom ? 7 : 4;
    graphics.fillRect(
      facingRight ? cigX + cigW - 2 : cigX - tipW - 1,
      cigY - 2, glowSize, glowSize
    );

    // Spawn particles
    if (Math.random() > 0.6) {
      const tipX = facingRight ? cigX + cigW + 2 : cigX - 2;
      const pSize = isRoom ? (2 + Math.random() * 2) : (1 + Math.random());
      this.particles.push({
        x: tipX + (Math.random() - 0.5) * (isRoom ? 4 : 2),
        y: cigY - 2,
        vx: (Math.random() - 0.5) * (isRoom ? 0.5 : 0.3),
        vy: -(isRoom ? 0.5 : 0.3) - Math.random() * (isRoom ? 0.6 : 0.4),
        life: 0,
        maxLife: (isRoom ? 1000 : 800) + Math.random() * (isRoom ? 800 : 600),
        size: pSize,
      });
    }

    // Update and draw particles
    const dt = delta / 16;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx += (Math.random() - 0.5) * 0.02;
      p.life += delta;
      const progress = p.life / p.maxLife;
      if (progress >= 1) { this.particles.splice(i, 1); continue; }
      const alpha = progress < 0.2 ? progress / 0.2 : (1 - progress) / 0.8;
      const size = p.size + progress * (isRoom ? 4 : 2);
      graphics.fillStyle(0xcccccc, alpha * (isRoom ? 0.3 : 0.25));
      graphics.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }

    if (this.particles.length > 30) this.particles = this.particles.slice(-20);
    return true;
  }
}
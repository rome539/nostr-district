/** SparkleEmote — four glowing star points orbit the player in an ellipse. */
import Phaser from 'phaser';
import { BaseEmote } from './EmoteSet';

export class SparkleEmote implements BaseEmote {
  private timer = 0;
  private _active = false;
  readonly stopsOnMove = false;
  private readonly duration = 8000;

  get active(): boolean { return this._active; }
  start(): void { this._active = true; this.timer = 0; }
  stop(): void  { this._active = false; this.timer = 0; }

  private drawStar(g: Phaser.GameObjects.Graphics, sx: number, sy: number, sz: number, alpha: number): void {
    // 4-pointed star as two crossing rects
    g.fillRect(sx - sz, sy - Math.max(1, sz * 0.3), sz * 2, Math.max(1, sz * 0.6 | 0));
    g.fillRect(sx - Math.max(1, sz * 0.3), sy - sz, Math.max(1, sz * 0.6 | 0), sz * 2);
    // Inner glow dot
    g.fillStyle(0xffffff, alpha * 0.7);
    g.fillCircle(sx, sy, sz * 0.5);
  }

  update(g: Phaser.GameObjects.Graphics, delta: number, px: number, py: number, _fr: boolean, scale: 'hub' | 'cabin' | 'room'): boolean {
    if (!this._active) return false;
    this.timer += delta;
    if (this.timer > this.duration) { this.stop(); return false; }

    const isRoom  = scale === 'room';
    const isCabin = scale === 'cabin';
    const fade    = this.timer > this.duration - 1500 ? (this.duration - this.timer) / 1500 : 1;
    const orbitRX = isRoom ? 30 : isCabin ? 24 : 16;
    const orbitRY = isRoom ? 18 : isCabin ? 14 : 10;
    const centerY = py - (isRoom ? 90 : isCabin ? 44 : 22);
    const starSz  = isRoom ? 3.5 : isCabin ? 3 : 2.2;
    const speed   = 0.0018;

    for (let i = 0; i < 4; i++) {
      const angle = (this.timer * speed + i * Math.PI / 2) % (Math.PI * 2);
      const sx = px + Math.cos(angle) * orbitRX;
      const sy = centerY + Math.sin(angle) * orbitRY;
      const twinkle = 0.5 + Math.sin(this.timer * 0.005 + i * 1.3) * 0.35;
      const alpha   = twinkle * fade * 0.9;

      g.fillStyle(0xffff88, alpha);
      this.drawStar(g, sx, sy, starSz, alpha);

      // Trail dot
      const ta = angle - 0.35;
      g.fillStyle(0xffdd44, alpha * 0.35);
      g.fillCircle(
        px + Math.cos(ta) * orbitRX,
        centerY + Math.sin(ta) * orbitRY,
        starSz * 0.5,
      );
    }
    return true;
  }
}

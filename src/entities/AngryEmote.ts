/** AngryEmote — red puff clouds pulse on both sides of the player's head. */
import Phaser from 'phaser';
import { BaseEmote } from './EmoteSet';

export class AngryEmote implements BaseEmote {
  private timer = 0;
  private _active = false;
  readonly stopsOnMove = false;
  private readonly duration = 8000;

  get active(): boolean { return this._active; }
  start(): void { this._active = true; this.timer = 0; }
  stop(): void  { this._active = false; this.timer = 0; }

  private drawPuff(g: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: 'hub' | 'cabin' | 'room', alpha: number): void {
    const isRoom  = scale === 'room';
    const isCabin = scale === 'cabin';
    const puffs = isRoom
      ? [{ ox: 0, oy: 0, r: 5 }, { ox: -6, oy: 3, r: 4 }, { ox: 6, oy: 3, r: 4 }, { ox: 0, oy: 6, r: 3.5 }]
      : isCabin
      ? [{ ox: 0, oy: 0, r: 4 }, { ox: -5, oy: 2, r: 3 }, { ox: 5, oy: 2, r: 3 }, { ox: 0, oy: 5, r: 2.5 }]
      : [{ ox: 0, oy: 0, r: 3 }, { ox: -4, oy: 2, r: 2.5 }, { ox: 4, oy: 2, r: 2.5 }, { ox: 0, oy: 4, r: 2 }];
    for (const { ox, oy, r } of puffs) g.fillCircle(cx + ox, cy + oy, r);
  }

  update(g: Phaser.GameObjects.Graphics, delta: number, px: number, py: number, _fr: boolean, scale: 'hub' | 'cabin' | 'room'): boolean {
    if (!this._active) return false;
    this.timer += delta;
    if (this.timer > this.duration) { this.stop(); return false; }

    const isRoom  = scale === 'room';
    const isCabin = scale === 'cabin';
    // Fade out the last 2s
    const fade = this.timer > this.duration - 2000 ? (this.duration - this.timer) / 2000 : 1;
    // Rapid pulse
    const pulse = 0.55 + Math.sin(this.timer * 0.014) * 0.35;
    const alpha = pulse * fade * 0.8;

    const spreadX = isRoom ? 30 : isCabin ? 24 : 16;
    const headY   = py - (isRoom ? 132 : isCabin ? 68 : 34);

    g.fillStyle(0xff3311, alpha);
    this.drawPuff(g, px - spreadX, headY, scale, alpha);
    this.drawPuff(g, px + spreadX, headY, scale, alpha);

    // Small steam lines
    g.fillStyle(0xff6633, alpha * 0.6);
    const lineLen = isRoom ? 8 : isCabin ? 6 : 5;
    const lineH   = isRoom ? 2 : isCabin ? 1.5 : 1;
    g.fillRect(px - spreadX - lineLen, headY - (isRoom ? 4 : isCabin ? 3 : 2), lineLen, lineH);
    g.fillRect(px + spreadX,           headY - (isRoom ? 4 : isCabin ? 3 : 2), lineLen, lineH);

    return true;
  }
}

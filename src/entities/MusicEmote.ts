/** MusicEmote — floating musical notes drift upward from the player. */
import Phaser from 'phaser';
import { BaseEmote } from './EmoteSet';

interface Note {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; sz: number; colorIdx: number;
}

const COLORS = [0xcc88ff, 0x88ccff, 0xffcc88, 0xff88cc, 0x88ffcc];

export class MusicEmote implements BaseEmote {
  private notes: Note[] = [];
  private timer = 0;
  private spawnTimer = 0;
  private idx = 0;
  private _active = false;
  readonly stopsOnMove = false;
  private readonly duration = 10000;

  get active(): boolean { return this._active; }
  start(): void { this._active = true; this.timer = 0; this.spawnTimer = 0; this.notes = []; this.idx = 0; }
  stop(): void  { this._active = false; this.timer = 0; this.notes = []; }

  private drawNote(g: Phaser.GameObjects.Graphics, nx: number, ny: number, color: number, alpha: number, sz: number): void {
    g.fillStyle(color, alpha);
    g.fillCircle(nx, ny, sz);                                // note head
    g.fillRect(nx + sz - 1, ny - sz * 4, Math.max(1, sz * 0.7 | 0), sz * 4);  // stem
    g.fillRect(nx + sz - 1, ny - sz * 4, sz * 2, Math.max(1, sz * 0.6 | 0));  // flag
  }

  update(g: Phaser.GameObjects.Graphics, delta: number, px: number, py: number, _fr: boolean, scale: 'hub' | 'cabin' | 'room'): boolean {
    if (!this._active) return false;
    this.timer += delta;
    if (this.timer > this.duration) { this.stop(); return false; }
    this.spawnTimer += delta;

    const isRoom  = scale === 'room';
    const isCabin = scale === 'cabin';
    if (this.spawnTimer >= 520) {
      this.spawnTimer = 0;
      const side = this.idx % 2 === 0 ? -1 : 1;
      this.notes.push({
        x: px + side * (isRoom ? 14 : isCabin ? 12 : 8) + (Math.random() - 0.5) * (isRoom ? 8 : isCabin ? 7 : 5),
        y: py - (isRoom ? 155 : isCabin ? 88 : 44),
        vx: side * (isRoom ? 0.18 : isCabin ? 0.15 : 0.11) + (Math.random() - 0.5) * 0.08,
        vy: -(isRoom ? 0.55 : isCabin ? 0.45 : 0.35) - Math.random() * 0.25,
        life: 0,
        maxLife: 1900 + Math.random() * 700,
        sz: isRoom ? 3 : isCabin ? 2.5 : 2,
        colorIdx: this.idx % COLORS.length,
      });
      this.idx++;
    }

    const dt = delta / 16;
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i];
      n.x += (n.vx + Math.sin(n.life * 0.004) * 0.05) * dt;
      n.y += n.vy * dt;
      n.life += delta;
      const prog = n.life / n.maxLife;
      if (prog >= 1) { this.notes.splice(i, 1); continue; }
      const alpha = prog < 0.15 ? (prog / 0.15) * 0.9 : (1 - prog) * 0.9;
      this.drawNote(g, n.x, n.y, COLORS[n.colorIdx], alpha, n.sz);
    }
    return true;
  }
}

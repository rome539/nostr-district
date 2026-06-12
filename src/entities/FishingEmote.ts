import Phaser from 'phaser';
import { BaseEmote } from './EmoteSet';
import { ROD_SKINS } from '../stores/marketStore';

export class FishingEmote implements BaseEmote {
  private bobPhase = 0;
  private _active = false;
  readonly stopsOnMove = false;

  rodSkin = '';

  get active(): boolean { return this._active; }

  start(): void {
    this._active = true;
    this.bobPhase = 0;
  }

  stop(): void {
    this._active = false;
    this.bobPhase = 0;
  }

  update(g: Phaser.GameObjects.Graphics, delta: number, px: number, py: number, _facingRight: boolean, scale: 'hub' | 'cabin' | 'room'): boolean {
    if (!this._active) return false;
    if (scale !== 'hub') return true;

    this.bobPhase += delta * 0.002;

    const skin = ROD_SKINS[this.rodSkin] ?? ROD_SKINS[''];
    const isLegendary = this.rodSkin === 'legendary';
    const isLeviathan = this.rodSkin === 'leviathan';
    const isCryptid   = this.rodSkin === 'cryptid';
    const hue = (Date.now() / 20) % 360;

    const gripColor   = isLegendary ? Phaser.Display.Color.HSLToColor(hue / 360, 0.9, 0.55).color : skin.grip;
    const tipColor    = isLegendary ? Phaser.Display.Color.HSLToColor(((hue + 40) % 360) / 360, 0.9, 0.65).color : skin.tip;
    const lineColor   = isLegendary ? Phaser.Display.Color.HSLToColor(((hue + 80) % 360) / 360, 0.7, 0.75).color : skin.line;
    const bobberColor = isLegendary ? Phaser.Display.Color.HSLToColor(((hue + 120) % 360) / 360, 0.9, 0.6).color : skin.bobber;

    // All offsets match WoodsScene — always cast left toward the lake
    const gripX   = px - 4;
    const gripY   = py - 18;
    const rodMidX = gripX - 8;
    const rodMidY = gripY - 20;
    const rodTipX = px - 20;
    const rodTipY = py - 52;
    const bobberX = px - 70;
    const bobberY = py + 10 + Math.sin(this.bobPhase) * 1.5;

    // Rod — thick grip tapering to thin tip
    g.lineStyle(3, gripColor, 1);
    g.beginPath(); g.moveTo(gripX, gripY); g.lineTo(rodMidX, rodMidY); g.strokePath();
    g.lineStyle(2, tipColor, 1);
    g.beginPath(); g.moveTo(rodMidX, rodMidY); g.lineTo(rodTipX, rodTipY); g.strokePath();

    if (isLeviathan) {
      // Sea-monster spine: bone spikes along the rod + kelp wraps on the grip.
      const sx = rodMidX, sy = rodMidY;                           // tip-segment start
      const dx = rodTipX - sx, dy = rodTipY - sy;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;                        // normal (spike direction)
      g.fillStyle(0xe8e0d0, 1);                                   // bone
      for (const t of [0.25, 0.45, 0.65, 0.85]) {
        const bx = sx + dx * t, by = sy + dy * t;
        const sp = 5 - t * 2;                                     // spikes shrink toward the tip
        g.fillTriangle(
          bx - (dx / len) * 1.6, by - (dy / len) * 1.6,
          bx + (dx / len) * 1.6, by + (dy / len) * 1.6,
          bx + nx * sp, by + ny * sp,
        );
      }
      g.lineStyle(2, 0x1e4034, 1);                                // kelp wraps on grip
      for (const t of [0.35, 0.7]) {
        const kx = gripX + (-8) * t, ky = gripY + (-20) * t;
        g.beginPath(); g.moveTo(kx - 2.5, ky - 1); g.lineTo(kx + 2.5, ky + 1); g.strokePath();
      }
    }

    // Fishing line
    g.lineStyle(1, lineColor, 0.7);
    g.beginPath(); g.moveTo(rodTipX, rodTipY); g.lineTo(bobberX, bobberY); g.strokePath();

    // Bobber
    if (isLeviathan) {
      // Leviathan bobber: a slit-pupil eye watching the water, glow pulsing with the bob.
      const glow = 0.22 + Math.sin(this.bobPhase * 1.4) * 0.08;
      g.fillStyle(0x40e8ff, glow);
      g.fillCircle(bobberX, bobberY, 6);
      g.fillStyle(0xd8efe2, 0.95);                                // eyeball
      g.fillCircle(bobberX, bobberY, 3.4);
      g.fillStyle(0x0a2018, 1);                                   // vertical slit pupil
      g.fillRect(bobberX - 0.7, bobberY - 2.4, 1.5, 4.8);
    } else if (isCryptid) {
      // Cryptid lure: a bioluminescent anglerfish esca pulsing on a drooping stalk,
      // with two feeler tendrils.
      const pulse  = Math.sin(this.bobPhase * 1.6) * 0.5 + 0.5;
      const escaCol = 0x5fff7a;
      g.lineStyle(1.2, 0x244a38, 1);                              // stalk drooping up to the line
      g.beginPath(); g.moveTo(bobberX, bobberY - 7); g.lineTo(bobberX, bobberY); g.strokePath();
      g.lineStyle(0.6, escaCol, 0.5 + pulse * 0.3);               // feeler tendrils
      for (const dir of [-1, 1]) {
        g.beginPath(); g.moveTo(bobberX, bobberY); g.lineTo(bobberX + dir * (3 + pulse), bobberY + 4 + pulse * 2); g.strokePath();
      }
      g.fillStyle(escaCol, 0.18 + pulse * 0.22);                  // glowing esca — outer halo + bright core
      g.fillCircle(bobberX, bobberY, 6 + pulse * 2);
      g.fillStyle(escaCol, 0.85);
      g.fillCircle(bobberX, bobberY, 2.6);
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(bobberX, bobberY, 1.1);
    } else {
      g.fillStyle(bobberColor, 0.9);
      g.fillRect(bobberX - 2, bobberY - 4, 5, 4);
      g.fillStyle(0xf0f0f0, 0.85);
      g.fillRect(bobberX - 2, bobberY, 5, 4);
    }

    // Water rings
    const ringAlpha = 0.08 + Math.sin(this.bobPhase * 0.7) * 0.04;
    g.lineStyle(0.5, 0x5dcaa5, ringAlpha);
    g.strokeCircle(bobberX, bobberY + 2, 6);
    g.strokeCircle(bobberX, bobberY + 2, 11);

    return true;
  }
}

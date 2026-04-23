import Phaser from 'phaser';
import { BaseEmote } from './EmoteSet';

export class FishingEmote implements BaseEmote {
  private bobPhase = 0;
  private _active = false;
  readonly stopsOnMove = false;

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

    // All offsets match WoodsScene — always cast left toward the lake
    const gripX  = px - 4;
    const gripY  = py - 18;
    const rodMidX = gripX - 8;
    const rodMidY = gripY - 20;
    const rodTipX = px - 20;
    const rodTipY = py - 52;
    const bobberX = px - 70;
    const bobberY = py + 10 + Math.sin(this.bobPhase) * 1.5;

    // Rod — thick grip tapering to thin tip
    g.lineStyle(3, 0x3a2810, 1);
    g.beginPath(); g.moveTo(gripX, gripY); g.lineTo(rodMidX, rodMidY); g.strokePath();
    g.lineStyle(2, 0x4a3418, 1);
    g.beginPath(); g.moveTo(rodMidX, rodMidY); g.lineTo(rodTipX, rodTipY); g.strokePath();

    // Fishing line
    g.lineStyle(1, 0xc8b89a, 0.7);
    g.beginPath(); g.moveTo(rodTipX, rodTipY); g.lineTo(bobberX, bobberY); g.strokePath();

    // Bobber
    g.fillStyle(0xe05028, 0.9);
    g.fillRect(bobberX - 2, bobberY - 4, 5, 4);
    g.fillStyle(0xf0f0f0, 0.85);
    g.fillRect(bobberX - 2, bobberY, 5, 4);

    // Water rings
    const ringAlpha = 0.08 + Math.sin(this.bobPhase * 0.7) * 0.04;
    g.lineStyle(0.5, 0x5dcaa5, ringAlpha);
    g.strokeCircle(bobberX, bobberY + 2, 6);
    g.strokeCircle(bobberX, bobberY + 2, 11);

    return true;
  }
}

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, hexToRgb } from '../../config/game.config';
import type { BlinkingLED, CandleFlame, FireplaceFlame, VoidStar } from '../../rooms/roomHelpers';
import type { LightingMood } from '../../stores/roomStore';

export function updateBlinkingLEDs(
  graphics: Phaser.GameObjects.Graphics,
  leds: BlinkingLED[],
  time: number,
): void {
  if (leds.length === 0) return;
  graphics.setDepth(Math.max(...leds.map(l => l.y)) + 44);
  graphics.clear();
  leds.forEach(led => {
    const on = Math.sin(time * 0.003 + led.phase) > -0.2 + Math.random() * 0.1;
    if (on) {
      const rgb = hexToRgb(led.color);
      const c = Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b);
      graphics.fillStyle(c, 0.5 + Math.random() * 0.3);
      graphics.fillRect(led.x, led.y, 4, 4);
      graphics.fillStyle(c, 0.08);
      graphics.fillRect(led.x - 2, led.y - 2, 8, 8);
    }
  });
}

export function updateCandleFlames(
  graphics: Phaser.GameObjects.Graphics,
  flames: CandleFlame[],
  time: number,
): void {
  graphics.clear();
  if (flames.length === 0) return;
  graphics.setDepth(Math.max(...flames.map(f => f.y)) + 44);
  flames.forEach(f => {
    const flicker = Math.sin(time * 0.009 + f.phase) * 0.4 + Math.sin(time * 0.017 + f.phase * 2.1) * 0.2;
    const sway    = Math.sin(time * 0.006 + f.phase * 1.7) * 1.2;
    const h       = 6 + flicker * 3;
    const cx      = f.x + sway;
    const baseY   = f.y;
    graphics.fillStyle(0xff8800, 0.82 + flicker * 0.1);
    graphics.fillEllipse(cx, baseY - h * 0.55, 5, h);
    graphics.fillStyle(0xffee88, 0.9);
    graphics.fillEllipse(cx, baseY - h * 0.65, 2.5, h * 0.6);
    graphics.fillStyle(0xff6600, 0.04 + Math.abs(flicker) * 0.02);
    graphics.fillCircle(cx, baseY - h * 0.4, 10);
  });
}

export function updateFireplaceFlames(
  graphics: Phaser.GameObjects.Graphics,
  flames: FireplaceFlame[],
  time: number,
): void {
  graphics.clear();
  if (flames.length === 0) return;
  graphics.setDepth(6);

  for (const f of flames) {
    const { x, y, w } = f;
    const t = time;

    // Glow at base
    const gp = 0.07 + Math.sin(t * 0.003) * 0.015;
    graphics.fillStyle(0xf08030, gp * 1.2);
    graphics.fillCircle(x, y - 10, w * 0.55);
    graphics.fillStyle(0xe85030, gp * 0.7);
    graphics.fillCircle(x, y - 10, w * 0.30);

    // Flame rects
    const fc = [0xf0a040, 0xe87030, 0xe85030, 0xfac060, 0xff6020];
    const flameCount = 6;
    for (let i = 0; i < flameCount; i++) {
      const ox = Math.sin(t * 0.005 + i * 1.3) * w * 0.14;
      const fh = 26 + Math.sin(t * 0.008 + i * 0.9) * 8 + Math.sin(t * 0.013 + i * 1.7) * 5;
      const fw = 2.5 + Math.abs(Math.sin(t * 0.004 + i * 2.1));
      const bx = x - w * 0.38 + i * (w * 0.15) + ox;
      const a  = 0.45 + Math.sin(t * 0.006 + i * 1.4) * 0.18;
      graphics.fillStyle(fc[i % fc.length], a);
      graphics.fillRect(bx - fw / 2, y - fh - 10, fw, fh);
      graphics.fillStyle(0xffd060, a * 0.5);
      graphics.fillRect(bx - 1, y - fh * 0.55 - 10, 2, fh * 0.4);
    }

    // Hot coal bed
    graphics.fillStyle(0xf0a040, 0.30 + Math.sin(t * 0.004) * 0.08);
    graphics.fillRect(x - w * 0.34, y - 12, w * 0.68, 4);

    // Embers
    for (let i = 0; i < 6; i++) {
      const prog  = ((t * 0.016 + i * 19) % 80) / 80;
      const sx    = x + Math.sin(t * 0.005 + i * 1.6) * w * 0.28;
      const sy    = y - 10 - prog * 45;
      const alpha = Math.max(0, (1 - prog) * 0.65);
      if (sy < y - 4) {
        graphics.fillStyle(prog < 0.5 ? 0xffd060 : 0xf0a040, alpha);
        graphics.fillRect(sx, sy, 1.5, 1.5);
      }
    }
  }
}

export function updateVoidStars(
  graphics: Phaser.GameObjects.Graphics,
  stars: VoidStar[],
  time: number,
): void {
  if (stars.length === 0) { graphics.clear(); return; }
  graphics.clear();
  graphics.setDepth(2); // just above the room background
  stars.forEach(star => {
    const t = time * 0.001;
    // Each star has its own twinkle speed and phase
    const flicker = Math.sin(t * (1.5 + (star.phase % 1.0)) + star.phase);
    const alpha = 0.3 + flicker * 0.35 + (Math.sin(t * 3.1 + star.phase * 2) * 0.1);
    if (alpha <= 0) return;
    const hex = parseInt(star.color.replace('#', ''), 16);
    const col = Phaser.Display.Color.GetColor((hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff);
    graphics.fillStyle(col, Math.min(1, Math.max(0, alpha)));
    graphics.fillRect(star.x, star.y, star.size, star.size);
    // Cross flare on bigger stars when bright
    if (star.size === 2 && alpha > 0.5) {
      graphics.fillStyle(col, alpha * 0.25);
      graphics.fillRect(star.x - 2, star.y,          1, 1);
      graphics.fillRect(star.x + 3, star.y,          1, 1);
      graphics.fillRect(star.x,     star.y - 2,      1, 1);
      graphics.fillRect(star.x,     star.y + 3,      1, 1);
    }
  });
}

export function updateAmbient(
  graphics: Phaser.GameObjects.Graphics,
  neonColor: string,
  time: number,
): void {
  graphics.clear();
  const rgb = hexToRgb(neonColor);
  const c = Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b);
  graphics.fillStyle(c, 0.015 + Math.sin(time * 0.001) * 0.008);
  graphics.fillRect(0, 0, GAME_WIDTH, 6);
}

export function updateLightingOverlay(
  graphics: Phaser.GameObjects.Graphics,
  lighting: LightingMood,
  time: number,
): void {
  graphics.clear();
  const W = GAME_WIDTH, H = GAME_HEIGHT;
  const FY = 300; // floor line
  const LX = 206; // ceiling lamp x
  const LY = FY - 168; // ceiling lamp y (top of light)

}

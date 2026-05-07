import Phaser from 'phaser';
import { GAME_WIDTH, P, hexToRgb, hexToNum } from '../../config/game.config';

export function updateLoungeRoom(
  graphics: Phaser.GameObjects.Graphics,
  time: number,
  _delta: number,
): void {
  graphics.clear();
  const FY = 300;
  const W = GAME_WIDTH;

  for (let row = 0; row < 2; row++) {
    const ry = 197 + row * 10;
    for (let lx = 8; lx < W - 8; lx += 16) {
      const cs = [P.pink, P.amber, P.teal, P.purp, P.lcream, P.red];
      const ci = Math.floor((lx + row * 7) / 16) % cs.length;
      const rgb = hexToRgb(cs[ci]);
      const c = Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b);
      const tw = 0.3 + Math.sin(time * 0.004 + lx * 0.15 + row * 2.5) * 0.4;
      graphics.fillStyle(c, tw);
      graphics.fillRect(lx, ry, 2, 2);
      graphics.fillStyle(c, tw * 0.03);
      graphics.fillCircle(lx + 1, ry + 1, 3);
    }
  }

  const fx = 715, fy = FY - 50;
  [P.amber, P.red, P.amber, '#fad480', P.amber, P.red, '#ffe060', P.amber].forEach((cl, i) => {
    const rgb = hexToRgb(cl);
    const c = Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b);
    const fl = Math.sin(time * 0.008 + i * 1.3) * 0.25;
    const h = 5 + Math.random() * 10 + Math.sin(time * 0.006 + i * 0.9) * 4;
    graphics.fillStyle(c, 0.3 + fl);
    graphics.fillRect(fx + 8 + i * 3.5, fy - h, 3, h);
  });

  graphics.fillStyle(hexToNum(P.amber), 0.06 + Math.sin(time * 0.005) * 0.03);
  graphics.fillCircle(fx + 20, fy - 8, 40);
}

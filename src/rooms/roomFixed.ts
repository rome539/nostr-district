import { P } from '../config/game.config';
import { drawDoor } from './roomDoor';
import { makeR, type BlinkingLED } from './roomHelpers';

export function drawLounge(x: CanvasRenderingContext2D, W: number, H: number, nc: string): void {
  const r = makeR(x);
  const FY = 300;
  ['#010008', '#020010', '#030014', '#05001c', '#070024', '#09002c', '#0b0032'].forEach((c, i) => r(0, i * 42, W, 42, c));
  for (let i = 0; i < 140; i++) { x.fillStyle = ['#fad480', '#e87aab', '#7b68ee', '#5dcaa5', '#fff', '#fff', '#fff'][Math.floor(Math.random() * 7)]; x.globalAlpha = 0.12 + Math.random() * 0.55; const sz = Math.random() > 0.9 ? 2 : 1; x.fillRect(Math.random() * W, Math.random() * 180, sz, sz); }
  for (let i = 0; i < 5; i++) { const sx = Math.random() * W; const sy = 10 + Math.random() * 120; x.fillStyle = '#fff'; x.globalAlpha = 0.3; x.fillRect(sx, sy, 2, 2); x.globalAlpha = 0.08; x.fillRect(sx - 2, sy, 6, 1); x.fillRect(sx, sy - 2, 1, 6); }
  x.globalAlpha = 1;
  x.fillStyle = '#f5e8d0'; x.globalAlpha = 0.06; x.beginPath(); x.arc(620, 50, 28, 0, Math.PI * 2); x.fill(); x.globalAlpha = 0.12; x.beginPath(); x.arc(620, 50, 18, 0, Math.PI * 2); x.fill(); x.globalAlpha = 0.35; x.beginPath(); x.arc(620, 50, 12, 0, Math.PI * 2); x.fill(); x.globalAlpha = 0.6; x.beginPath(); x.arc(620, 50, 8, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
  for (let i = 0; i < W; i += 16 + Math.random() * 22) { const bw = 10 + Math.random() * 38; const bh = 25 + Math.random() * 150; r(i, 220 - bh, bw, bh, '#0a0818'); for (let wy = 220 - bh + 3; wy < 218; wy += 4 + Math.random() * 3) { for (let wx = i + 2; wx < i + bw - 2; wx += 3 + Math.random() * 3) { if (Math.random() > 0.4) { x.fillStyle = [P.pink, P.purp, P.amber, P.teal, P.lcream][Math.floor(Math.random() * 5)]; x.globalAlpha = 0.04 + Math.random() * 0.1; x.fillRect(wx, wy, 2, 2); x.globalAlpha = 1; } } } }
  x.globalAlpha = 0.035; r(0, 175, W, 45, P.pink); x.globalAlpha = 0.02; r(0, 155, W, 65, P.amber); x.globalAlpha = 1;
  r(0, 196, W, 3, '#3a2878'); r(0, 206, W, 3, '#3a2878'); r(0, 218, W, 12, '#1a1040');
  for (let rx = 20; rx < W; rx += 30) r(rx, 196, 3, 24, '#2a1858');
  x.strokeStyle = '#2a1858'; x.lineWidth = 1; x.globalAlpha = 0.4; x.beginPath(); x.moveTo(0, 198); x.lineTo(W, 198); x.stroke(); x.beginPath(); x.moveTo(0, 208); x.lineTo(W, 208); x.stroke(); x.globalAlpha = 1;
  for (let lx = 8; lx < W - 8; lx += 16) { const bc = [P.pink, P.amber, P.teal, P.purp, P.lcream, P.red][Math.floor(lx / 16) % 6]; x.fillStyle = bc; x.globalAlpha = 0.15; x.fillRect(lx - 1, 197, 3, 3); x.globalAlpha = 1; }
  for (let lx = 14; lx < W - 8; lx += 16) { const bc = [P.amber, P.teal, P.pink, P.lcream, P.purp, P.red][Math.floor(lx / 16) % 6]; x.fillStyle = bc; x.globalAlpha = 0.15; x.fillRect(lx - 1, 207, 3, 3); x.globalAlpha = 1; }
  r(0, FY - 70, W, H - FY + 70, '#1a0a3e');
  for (let fy = FY - 65; fy < H; fy += 14) { for (let fx = 0; fx < W; fx += 22) { x.globalAlpha = 0.1; r(fx, fy, 20, 12, '#221448'); x.globalAlpha = 0.04; r(fx, fy, 20, 1, '#3a2878'); x.globalAlpha = 1; } }
  r(30, FY - 50, 14, 55, '#2a1858'); r(176, FY - 50, 14, 55, '#2a1858'); r(40, FY - 55, 140, 28, '#2a1858'); r(45, FY - 52, 130, 22, '#342068'); r(40, FY - 28, 140, 34, '#2a1858'); r(45, FY - 24, 130, 26, '#342068'); r(50, FY - 22, 38, 20, '#4a2878'); r(92, FY - 22, 38, 20, '#3a2068'); r(134, FY - 22, 38, 20, '#4a2878');
  x.fillStyle = P.pink; x.globalAlpha = 0.2; x.fillRect(55, FY - 48, 14, 10); x.globalAlpha = 1;
  r(540, FY - 45, 14, 50, '#2a1858'); r(670, FY - 45, 14, 50, '#2a1858'); r(550, FY - 48, 124, 24, '#2a1858'); r(555, FY - 45, 114, 18, '#342068'); r(550, FY - 25, 124, 30, '#2a1858'); r(555, FY - 21, 114, 22, '#342068');
  r(250, FY - 12, 200, 10, '#2a1858'); r(255, FY - 9, 190, 4, '#3a2878'); r(260, FY - 2, 6, 18, '#221448'); r(434, FY - 2, 6, 18, '#221448');
  x.globalAlpha = 0.5; r(290, FY - 20, 8, 10, P.teal); x.globalAlpha = 1; r(292, FY - 18, 4, 6, '#1a1040');
  x.globalAlpha = 0.4; r(330, FY - 18, 6, 8, P.amber); x.globalAlpha = 1;
  x.globalAlpha = 0.35; r(370, FY - 22, 10, 12, P.pink); x.globalAlpha = 1;
  r(410, FY - 20, 6, 10, '#f5e8d0'); x.fillStyle = P.amber; x.globalAlpha = 0.5; x.fillRect(412, FY - 24, 2, 4); x.globalAlpha = 0.035; x.beginPath(); x.arc(413, FY - 22, 14, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
  r(710, FY - 55, 50, 55, '#1a1040'); r(715, FY - 50, 40, 45, '#221448'); r(705, FY - 58, 60, 5, '#2a1858');
  x.fillStyle = P.amber; x.globalAlpha = 0.04; x.beginPath(); x.arc(735, FY - 35, 35, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
  r(6, FY - 48, 22, 30, '#1a1040'); r(8, FY - 46, 18, 26, '#0e0828'); x.fillStyle = '#2a1858'; x.beginPath(); x.arc(17, FY - 38, 7, 0, Math.PI * 2); x.fill(); x.fillStyle = '#342068'; x.beginPath(); x.arc(17, FY - 38, 4, 0, Math.PI * 2); x.fill(); x.fillStyle = '#2a1858'; x.beginPath(); x.arc(17, FY - 26, 3, 0, Math.PI * 2); x.fill();
  r(W - 28, FY - 48, 22, 30, '#1a1040'); r(W - 26, FY - 46, 18, 26, '#0e0828'); x.fillStyle = '#2a1858'; x.beginPath(); x.arc(W - 17, FY - 38, 7, 0, Math.PI * 2); x.fill(); x.fillStyle = '#342068'; x.beginPath(); x.arc(W - 17, FY - 38, 4, 0, Math.PI * 2); x.fill(); x.fillStyle = '#2a1858'; x.beginPath(); x.arc(W - 17, FY - 26, 3, 0, Math.PI * 2); x.fill();
  r(680, FY - 78, 80, 10, '#2a1858'); r(690, FY - 92, 60, 16, '#1a1040'); r(695, FY - 88, 50, 8, '#0a0818'); x.fillStyle = '#0a0818'; x.beginPath(); x.arc(720, FY - 84, 10, 0, Math.PI * 2); x.fill(); x.fillStyle = P.purp; x.globalAlpha = 0.3; x.beginPath(); x.arc(720, FY - 84, 4, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
  r(680, FY - 66, 24, 48, '#1a1040'); r(684, FY - 62, 16, 40, '#0e0828'); x.fillStyle = '#2a1858'; x.beginPath(); x.arc(692, FY - 42, 6, 0, Math.PI * 2); x.fill(); x.fillStyle = '#2a1858'; x.beginPath(); x.arc(692, FY - 54, 3, 0, Math.PI * 2); x.fill();
  r(310, FY - 68, 160, 26, '#0a0818'); r(312, FY - 66, 156, 22, '#0e0828'); x.strokeStyle = nc; x.globalAlpha = 0.35; x.strokeRect(310, FY - 68, 160, 26); x.globalAlpha = 1;
  x.fillStyle = nc; x.font = 'bold 11px monospace'; x.textAlign = 'center'; x.fillText('ROOFTOP LOUNGE', 390, FY - 52);
  x.fillStyle = nc; x.globalAlpha = 0.03; x.fillRect(300, FY - 42, 180, 15); x.globalAlpha = 1;
  drawDoor(x, W, FY + 50, nc, H);
}

export function drawRelay(
  x: CanvasRenderingContext2D,
  W: number,
  H: number,
  nc: string,
  blinkingLEDs: BlinkingLED[],
): void {
  const r = makeR(x);
  const FY = 300;
  r(0, 0, W, H, '#0a0818'); r(0, FY, W, H - FY, '#0e0828'); r(0, FY, W, 2, nc);
  for (let fy = FY + 4; fy < H; fy += 16) { for (let fx = 0; fx < W; fx += 32) { x.globalAlpha = 0.06; r(fx, fy, 30, 14, '#1a1040'); x.globalAlpha = 1; } }
  for (let rack = 0; rack < 3; rack++) {
    const rx = 40 + rack * 120;
    r(rx, 30, 100, 265, '#080616'); r(rx + 2, 32, 96, 261, '#0c0a1e');
    x.strokeStyle = nc; x.globalAlpha = 0.15; x.strokeRect(rx, 30, 100, 265); x.globalAlpha = 1;
    for (let sy = 40; sy < 285; sy += 18) {
      r(rx + 8, sy, 84, 12, '#060412');
      for (let lx = rx + 12; lx < rx + 88; lx += 8) {
        const lc = [P.teal, P.pink, P.amber, P.purp, P.red][Math.floor(Math.random() * 5)];
        blinkingLEDs.push({ x: lx, y: sy + 3, depth: FY, color: lc, phase: Math.random() * Math.PI * 2 });
      }
    }
  }
  r(450, 30, 310, 265, '#080616'); r(452, 32, 306, 261, '#0c0a1e');
  x.strokeStyle = nc; x.globalAlpha = 0.15; x.strokeRect(450, 30, 310, 265); x.globalAlpha = 1;
  r(460, 40, 290, 24, '#0a0818');
  x.fillStyle = nc; x.font = 'bold 11px monospace'; x.textAlign = 'center'; x.fillText('RELAY STATUS: CONNECTED', 605, 57);
  const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band', 'wss://eden.nostr.land', 'wss://nostr.wine', 'wss://relay.mostr.pub'];
  relays.forEach((rl, i) => {
    const ry = 78 + i * 26;
    r(460, ry, 290, 20, i % 2 === 0 ? '#0a0818' : '#0c0a20');
    x.fillStyle = P.teal; x.globalAlpha = 0.6; x.fillRect(468, ry + 6, 8, 8); x.globalAlpha = 1;
    x.fillStyle = P.lcream; x.globalAlpha = 0.5; x.font = '9px monospace'; x.textAlign = 'left'; x.fillText(rl, 484, ry + 14); x.globalAlpha = 1;
    x.fillStyle = P.teal; x.textAlign = 'right'; x.globalAlpha = 0.4; x.fillText(`${Math.floor(Math.random() * 50 + 10)}ms`, 740, ry + 14); x.globalAlpha = 1;
  });
  r(460, 268, 140, 20, '#0a0818'); x.fillStyle = P.amber; x.font = 'bold 8px monospace'; x.textAlign = 'center'; x.fillText('847 CONNECTED', 530, 282);
  r(610, 268, 140, 20, '#0a0818'); x.fillStyle = P.pink; x.fillText('1.2M EVENTS/HR', 680, 282);
  drawDoor(x, W, FY + 50, nc, H);
}

export function drawFeed(x: CanvasRenderingContext2D, W: number, H: number, nc: string): void {
  const r = makeR(x);
  const FY = 300;
  r(0, 0, W, H, '#0c0820'); r(0, FY, W, H - FY, '#120a2c'); r(0, FY, W, 2, nc);
  r(28, 46, W - 56, 246, '#040208'); r(30, 48, W - 60, 242, '#060412'); r(34, 52, W - 68, 234, '#080616');
  x.strokeStyle = nc; x.globalAlpha = 0.25; x.strokeRect(30, 48, W - 60, 242); x.globalAlpha = 1;
  x.strokeStyle = nc; x.globalAlpha = 0.08; x.strokeRect(34, 52, W - 68, 234); x.globalAlpha = 1;
  r(40, 54, W - 80, 22, '#0a0818');
  x.fillStyle = nc; x.font = 'bold 11px monospace'; x.textAlign = 'center'; x.fillText('24/7 STREAM NOTES', W / 2, 70);
  r(40, 78, W - 80, 1, nc); x.globalAlpha = 0.2; r(40, 78, W - 80, 1, nc); x.globalAlpha = 1;
  x.fillStyle = P.red; x.globalAlpha = 0.5; x.beginPath(); x.arc(60, 64, 3, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
  x.fillStyle = P.red; x.font = 'bold 7px monospace'; x.textAlign = 'left'; x.globalAlpha = 0.6; x.fillText('LIVE', 66, 67); x.globalAlpha = 1;
  x.fillStyle = P.teal; x.globalAlpha = 0.4; x.font = 'bold 7px monospace'; x.textAlign = 'right'; x.fillText('GLOBAL NOSTR', W - 56, 67); x.globalAlpha = 1;
  for (let i = 0; i < 9; i++) { const ey = 84 + i * 22; r(44, ey, W - 88, 18, i % 2 === 0 ? '#0a0818' : '#0c0a20'); }
  x.fillStyle = nc; x.globalAlpha = 0.025; r(20, FY, W - 40, 35, nc); x.globalAlpha = 1;
  drawDoor(x, W, FY + 50, nc, H);
}

export function drawMarket(x: CanvasRenderingContext2D, W: number, H: number, nc: string): void {
  const r = makeR(x);
  const FY = 300;
  r(0, 0, W, H, '#120828'); r(0, FY, W, H - FY, '#1a0c38'); r(0, FY, W, 2, nc);
  for (let fy = FY + 4; fy < H; fy += 14) { for (let fx = 0; fx < W; fx += 14) { const dark = ((fx / 14 + fy / 14) % 2) < 1; x.globalAlpha = dark ? 0.08 : 0.03; r(fx, fy, 14, 14, '#3a2878'); x.globalAlpha = 1; } }
  const labels = ['AVATARS', 'FURNITURE', 'EFFECTS', 'THEMES'];
  for (let shelf = 0; shelf < 4; shelf++) {
    const sx = 30 + shelf * 190;
    r(sx, 30, 170, 260, '#0a0818'); r(sx + 2, 32, 166, 256, '#0e0828');
    x.strokeStyle = nc; x.globalAlpha = 0.12; x.strokeRect(sx, 30, 170, 260); x.globalAlpha = 1;
    x.fillStyle = nc; x.font = 'bold 8px monospace'; x.textAlign = 'center'; x.globalAlpha = 0.55; x.fillText(labels[shelf], sx + 85, 46); x.globalAlpha = 1;
    for (let row = 0; row < 4; row++) {
      const ry = 55 + row * 56;
      r(sx + 6, ry + 42, 158, 3, '#3a2878');
      for (let item = 0; item < 5; item++) {
        const ix = sx + 12 + item * 32;
        const c = [P.pink, P.teal, P.amber, P.purp, P.red, P.sign2][Math.floor(Math.random() * 6)];
        x.fillStyle = c; x.globalAlpha = 0.18 + Math.random() * 0.22;
        const iw = 14 + Math.random() * 8; const ih = 16 + Math.random() * 20;
        x.fillRect(ix, ry + 42 - ih, iw, ih); x.globalAlpha = 1;
      }
      x.fillStyle = P.amber; x.globalAlpha = 0.4; x.font = 'bold 6px monospace'; x.textAlign = 'right'; x.fillText(`⚡ ${Math.floor(Math.random() * 500 + 21)}`, sx + 162, ry + 52); x.globalAlpha = 1;
    }
  }
  r(W / 2 - 110, FY - 20, 220, 18, '#0a0818');
  x.strokeStyle = nc; x.globalAlpha = 0.2; x.strokeRect(W / 2 - 110, FY - 20, 220, 18); x.globalAlpha = 1;
  x.fillStyle = nc; x.font = 'bold 9px monospace'; x.textAlign = 'center'; x.fillText('⚡ ZAP TO UNLOCK ITEMS', W / 2, FY - 8);
  drawDoor(x, W, FY + 50, nc, H);
}

export function drawDefault(x: CanvasRenderingContext2D, W: number, H: number, nc: string): void {
  const r = makeR(x);
  const FY = 300;
  r(0, 0, W, H, '#120828'); r(0, FY, W, H - FY, '#1a0a3e'); r(0, FY, W, 2, nc);
  r(0, 0, W, 3, nc); x.globalAlpha = 0.15; r(0, 0, W, 3, nc); x.globalAlpha = 1;
  drawDoor(x, W, FY + 50, nc, H);
}

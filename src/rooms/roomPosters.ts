import { P } from '../config/game.config';
import type { PosterId } from '../stores/roomStore';

export function drawPoster(
  x: CanvasRenderingContext2D,
  poster: PosterId,
  px: number,
  py: number,
  pw: number,
  ph: number,
  light: { primary: string; glow: string },
): void {
  if (poster === 'none') return;

  // Drop shadow
  x.fillStyle = '#000'; x.globalAlpha = 0.35;
  x.fillRect(px + 3, py + 3, pw, ph); x.globalAlpha = 1;
  // Outer frame — warm dark wood
  x.fillStyle = '#3a220e'; x.fillRect(px, py, pw, ph);
  // Bevel highlight (top/left lighter)
  x.fillStyle = '#5a3818'; x.globalAlpha = 0.8;
  x.fillRect(px, py, pw, 4);       // top edge
  x.fillRect(px, py, 4, ph);       // left edge
  x.globalAlpha = 1;
  // Bevel shadow (bottom/right darker)
  x.fillStyle = '#1e0e04'; x.globalAlpha = 0.8;
  x.fillRect(px, py + ph - 4, pw, 4);   // bottom edge
  x.fillRect(px + pw - 4, py, 4, ph);   // right edge
  x.globalAlpha = 1;
  // Inner mat — dark art background
  x.fillStyle = '#06040f'; x.fillRect(px + 6, py + 6, pw - 12, ph - 12);
  // Subtle inner glow from lighting
  x.fillStyle = light.glow; x.globalAlpha = 0.04;
  x.fillRect(px + 6, py + 6, pw - 12, ph - 12); x.globalAlpha = 1;

  x.textAlign = 'center';
  switch (poster) {
    case 'bitcoin':
      // Circuit board lines
      x.strokeStyle = P.amber; x.lineWidth = 0.5;
      for (let bly = py + 10; bly < py + ph - 10; bly += 7) {
        x.globalAlpha = 0.08;
        x.beginPath(); x.moveTo(px + 8, bly); x.lineTo(px + pw - 8, bly); x.stroke();
      }
      x.globalAlpha = 1;
      // ₿ symbol
      x.fillStyle = P.amber; x.globalAlpha = 0.88;
      x.font = `bold ${Math.floor(Math.min(pw, ph) * 0.42)}px monospace`;
      x.fillText('₿', px + pw / 2, py + ph * 0.58);
      x.globalAlpha = 1;
      // "BITCOIN" label
      x.fillStyle = P.amber; x.font = 'bold 7px monospace';
      x.globalAlpha = 0.8; x.fillText('BITCOIN', px + pw / 2, py + ph * 0.84); x.globalAlpha = 1;
      // Inner glow border
      x.strokeStyle = P.amber; x.globalAlpha = 0.25; x.lineWidth = 1;
      x.strokeRect(px + 9, py + 9, pw - 18, ph - 18); x.globalAlpha = 1;
      break;

    case 'nostr':
      // Title
      x.fillStyle = P.purp; x.globalAlpha = 0.9;
      x.font = 'bold 9px monospace';
      x.fillText('NOSTR', px + pw / 2, py + 20); x.globalAlpha = 1;
      // Spokes from center hub
      x.strokeStyle = P.purp; x.lineWidth = 0.5;
      x.globalAlpha = 0.22;
      x.beginPath(); x.moveTo(px+pw*0.5, py+ph*0.5); x.lineTo(px+pw*0.15, py+ph*0.33); x.stroke();
      x.beginPath(); x.moveTo(px+pw*0.5, py+ph*0.5); x.lineTo(px+pw*0.85, py+ph*0.33); x.stroke();
      x.beginPath(); x.moveTo(px+pw*0.5, py+ph*0.5); x.lineTo(px+pw*0.1, py+ph*0.62); x.stroke();
      x.beginPath(); x.moveTo(px+pw*0.5, py+ph*0.5); x.lineTo(px+pw*0.9, py+ph*0.62); x.stroke();
      x.beginPath(); x.moveTo(px+pw*0.5, py+ph*0.5); x.lineTo(px+pw*0.35, py+ph*0.76); x.stroke();
      x.beginPath(); x.moveTo(px+pw*0.5, py+ph*0.5); x.lineTo(px+pw*0.65, py+ph*0.76); x.stroke();
      // Center hub
      x.fillStyle = P.pink; x.globalAlpha = 0.9;
      x.beginPath(); x.arc(px+pw*0.5, py+ph*0.5, 5, 0, Math.PI*2); x.fill();
      x.fillStyle = '#fff'; x.globalAlpha = 0.7;
      x.beginPath(); x.arc(px+pw*0.5, py+ph*0.5, 2, 0, Math.PI*2); x.fill();
      // Outer nodes
      x.fillStyle = P.purp; x.globalAlpha = 0.7;
      x.beginPath(); x.arc(px+pw*0.15, py+ph*0.33, 3, 0, Math.PI*2); x.fill();
      x.beginPath(); x.arc(px+pw*0.85, py+ph*0.33, 3, 0, Math.PI*2); x.fill();
      x.beginPath(); x.arc(px+pw*0.1,  py+ph*0.62, 3, 0, Math.PI*2); x.fill();
      x.beginPath(); x.arc(px+pw*0.9,  py+ph*0.62, 3, 0, Math.PI*2); x.fill();
      x.beginPath(); x.arc(px+pw*0.35, py+ph*0.76, 3, 0, Math.PI*2); x.fill();
      x.beginPath(); x.arc(px+pw*0.65, py+ph*0.76, 3, 0, Math.PI*2); x.fill();
      x.globalAlpha = 1;
      x.fillStyle = P.purp; x.font = '6px monospace';
      x.globalAlpha = 0.5; x.fillText('decentralized', px + pw/2, py + ph - 9); x.globalAlpha = 1;
      break;

    case 'pixel_art':
      // Night city skyline
      x.fillStyle = '#080420'; x.fillRect(px+6, py+6, pw-12, ph-12);
      // Stars (deterministic)
      x.fillStyle = '#fff';
      for (let s = 0; s < 16; s++) {
        x.globalAlpha = 0.15 + (s % 4) * 0.08;
        x.fillRect(px + 8 + (s * 14) % (pw - 16), py + 7 + (s * 11) % Math.floor(ph * 0.4), 1, 1);
      }
      x.globalAlpha = 1;
      // Crescent moon
      x.fillStyle = '#e8d060'; x.globalAlpha = 0.6;
      x.beginPath(); x.arc(px+pw*0.82, py+ph*0.18, 6, 0, Math.PI*2); x.fill();
      x.fillStyle = '#080420'; x.globalAlpha = 0.96;
      x.beginPath(); x.arc(px+pw*0.85, py+ph*0.16, 5, 0, Math.PI*2); x.fill();
      x.globalAlpha = 1;
      // Building silhouettes
      x.fillStyle = '#030112';
      x.fillRect(px+6,      py+ph*0.55, 14, ph-6-ph*0.55);
      x.fillRect(px+8,      py+ph*0.44, 10, ph*0.12);
      x.fillRect(px+18,     py+ph*0.62, 12, ph-6-ph*0.62);
      x.fillRect(px+28,     py+ph*0.48, 18, ph-6-ph*0.48);
      x.fillRect(px+32,     py+ph*0.37, 8,  ph*0.12);
      x.fillRect(px+pw-24,  py+ph*0.52, 18, ph-6-ph*0.52);
      x.fillRect(px+pw-22,  py+ph*0.42, 12, ph*0.12);
      // Windows
      x.fillStyle = P.amber; x.globalAlpha = 0.38;
      x.fillRect(px+10, py+ph*0.5,  2, 2); x.fillRect(px+14, py+ph*0.5,  2, 2);
      x.fillRect(px+10, py+ph*0.57, 2, 2); x.fillRect(px+30, py+ph*0.52, 2, 2);
      x.fillRect(px+36, py+ph*0.52, 2, 2); x.fillRect(px+30, py+ph*0.59, 2, 2);
      x.fillRect(px+pw-20, py+ph*0.56, 2, 2); x.fillRect(px+pw-14, py+ph*0.56, 2, 2);
      x.fillStyle = P.teal; x.globalAlpha = 0.28;
      x.fillRect(px+32, py+ph*0.65, 2, 2); x.fillRect(px+38, py+ph*0.65, 2, 2);
      x.globalAlpha = 1;
      break;

    case 'landscape':
      // Pixel mountain scene
      x.fillStyle = '#0a0020'; x.fillRect(px + 6, py + 6, pw - 12, ph - 12);
      // Mountains
      x.fillStyle = '#1a1040'; x.globalAlpha = 0.6;
      x.beginPath(); x.moveTo(px + 5, py + ph * 0.7);
      x.lineTo(px + pw * 0.3, py + ph * 0.25); x.lineTo(px + pw * 0.5, py + ph * 0.5);
      x.lineTo(px + pw * 0.7, py + ph * 0.2); x.lineTo(px + pw - 5, py + ph * 0.6);
      x.lineTo(px + pw - 5, py + ph * 0.7); x.fill();
      x.globalAlpha = 1;
      // Moon
      x.fillStyle = '#fad480'; x.globalAlpha = 0.5;
      x.beginPath(); x.arc(px + pw * 0.8, py + ph * 0.2, 6, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
      // Stars
      for (let s = 0; s < 8; s++) {
        x.fillStyle = '#fff'; x.globalAlpha = 0.3 + Math.random() * 0.3;
        x.fillRect(px + 8 + Math.random() * (pw - 16), py + 6 + Math.random() * (ph * 0.4), 1, 1);
      }
      x.globalAlpha = 1;
      break;

    case 'cat':
      // Ears (triangles)
      x.fillStyle = P.pink; x.globalAlpha = 0.75;
      x.beginPath(); x.moveTo(px+pw*0.25, py+ph*0.22); x.lineTo(px+pw*0.18, py+ph*0.06); x.lineTo(px+pw*0.38, py+ph*0.18); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(px+pw*0.75, py+ph*0.22); x.lineTo(px+pw*0.82, py+ph*0.06); x.lineTo(px+pw*0.62, py+ph*0.18); x.closePath(); x.fill();
      // Inner ear
      x.fillStyle = '#ff9dc0'; x.globalAlpha = 0.4;
      x.beginPath(); x.moveTo(px+pw*0.27, py+ph*0.2); x.lineTo(px+pw*0.21, py+ph*0.1); x.lineTo(px+pw*0.36, py+ph*0.17); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(px+pw*0.73, py+ph*0.2); x.lineTo(px+pw*0.79, py+ph*0.1); x.lineTo(px+pw*0.64, py+ph*0.17); x.closePath(); x.fill();
      // Head
      x.fillStyle = P.pink; x.globalAlpha = 0.65;
      x.beginPath(); x.arc(px+pw/2, py+ph*0.44, pw*0.29, 0, Math.PI*2); x.fill();
      // Eyes
      x.fillStyle = '#0e0828'; x.globalAlpha = 1;
      x.beginPath(); x.ellipse(px+pw*0.37, py+ph*0.40, 4, 5, -0.2, 0, Math.PI*2); x.fill();
      x.beginPath(); x.ellipse(px+pw*0.63, py+ph*0.40, 4, 5,  0.2, 0, Math.PI*2); x.fill();
      x.fillStyle = '#fff'; x.globalAlpha = 0.85;
      x.fillRect(px+pw*0.35, py+ph*0.36, 2, 2); x.fillRect(px+pw*0.61, py+ph*0.36, 2, 2);
      // Nose
      x.fillStyle = '#ff7090'; x.globalAlpha = 0.85;
      x.beginPath(); x.moveTo(px+pw*0.5, py+ph*0.5); x.lineTo(px+pw*0.44, py+ph*0.54); x.lineTo(px+pw*0.56, py+ph*0.54); x.closePath(); x.fill();
      // Whiskers
      x.strokeStyle = '#fff'; x.globalAlpha = 0.28; x.lineWidth = 0.5;
      x.beginPath(); x.moveTo(px+pw*0.18, py+ph*0.50); x.lineTo(px+pw*0.43, py+ph*0.52); x.stroke();
      x.beginPath(); x.moveTo(px+pw*0.82, py+ph*0.50); x.lineTo(px+pw*0.57, py+ph*0.52); x.stroke();
      x.beginPath(); x.moveTo(px+pw*0.16, py+ph*0.55); x.lineTo(px+pw*0.43, py+ph*0.55); x.stroke();
      x.beginPath(); x.moveTo(px+pw*0.84, py+ph*0.55); x.lineTo(px+pw*0.57, py+ph*0.55); x.stroke();
      x.globalAlpha = 1;
      x.fillStyle = P.pink; x.font = 'bold 8px monospace';
      x.fillText('MEOW', px + pw / 2, py + ph * 0.87);
      break;

    case 'skull':
      // Cranium
      x.fillStyle = '#d0c8b8'; x.globalAlpha = 0.85;
      x.beginPath(); x.arc(px+pw/2, py+ph*0.33, pw*0.28, 0, Math.PI*2); x.fill();
      x.fillRect(px+pw/2-pw*0.22, py+ph*0.4, pw*0.44, ph*0.22);
      // Eye sockets
      x.fillStyle = '#040110'; x.globalAlpha = 1;
      x.beginPath(); x.ellipse(px+pw*0.35, py+ph*0.30, 6, 7, -0.1, 0, Math.PI*2); x.fill();
      x.beginPath(); x.ellipse(px+pw*0.65, py+ph*0.30, 6, 7,  0.1, 0, Math.PI*2); x.fill();
      // Nose cavity
      x.beginPath(); x.moveTo(px+pw/2, py+ph*0.43); x.lineTo(px+pw/2-3, py+ph*0.5); x.lineTo(px+pw/2+3, py+ph*0.5); x.closePath(); x.fill();
      // Teeth
      x.fillStyle = '#d0c8b8'; x.globalAlpha = 0.75;
      for (let t = 0; t < 5; t++) {
        x.fillRect(px+pw*0.28 + t*(pw*0.44/5), py+ph*0.58, pw*0.44/5-2, ph*0.1);
      }
      // Crack
      x.strokeStyle = '#040110'; x.globalAlpha = 0.35; x.lineWidth = 0.5;
      x.beginPath(); x.moveTo(px+pw*0.52, py+ph*0.09); x.lineTo(px+pw*0.5, py+ph*0.2); x.lineTo(px+pw*0.53, py+ph*0.28); x.stroke();
      x.globalAlpha = 1;
      break;

    case 'moon':
      // Deep space
      x.fillStyle = '#010008'; x.fillRect(px+6, py+6, pw-12, ph-12);
      // Stars (deterministic)
      x.fillStyle = '#fff';
      for (let s = 0; s < 22; s++) {
        x.globalAlpha = 0.12 + (s % 4) * 0.08;
        x.fillRect(px + 8 + (s * 13) % (pw-16), py + 8 + (s * 17) % (ph-16), (s % 6 === 0) ? 1.5 : 1, (s % 6 === 0) ? 1.5 : 1);
      }
      x.globalAlpha = 1;
      // Full circle (gold)
      x.fillStyle = '#f0d050'; x.globalAlpha = 0.92;
      x.beginPath(); x.arc(px+pw/2, py+ph*0.42, Math.min(pw,ph)*0.24, 0, Math.PI*2); x.fill();
      // Crescent shadow (overlapping circle)
      x.fillStyle = '#010008'; x.globalAlpha = 0.96;
      x.beginPath(); x.arc(px+pw/2+Math.min(pw,ph)*0.12, py+ph*0.38, Math.min(pw,ph)*0.2, 0, Math.PI*2); x.fill();
      // Craters
      x.fillStyle = '#b8a030'; x.globalAlpha = 0.32;
      x.beginPath(); x.arc(px+pw*0.36, py+ph*0.48, 3, 0, Math.PI*2); x.fill();
      x.beginPath(); x.arc(px+pw*0.3,  py+ph*0.36, 2, 0, Math.PI*2); x.fill();
      x.beginPath(); x.arc(px+pw*0.4,  py+ph*0.38, 1.5, 0, Math.PI*2); x.fill();
      x.globalAlpha = 1;
      break;

    case 'code':
      x.fillStyle = '#060412'; x.fillRect(px + 6, py + 6, pw - 12, ph - 12);
      // Line number gutter
      x.fillStyle = '#1a1040'; x.globalAlpha = 0.5;
      for (let ln = 0; ln < 9; ln++) x.fillRect(px+8, py+12+ln*8, 5, 5);
      x.globalAlpha = 1;
      x.font = '6px monospace'; x.textAlign = 'left';
      x.fillStyle = P.purp;  x.globalAlpha = 0.75; x.fillText('const',      px+16, py+16);
      x.fillStyle = P.lcream; x.globalAlpha = 0.65; x.fillText('nostr =',    px+38, py+16);
      x.fillStyle = P.teal;  x.globalAlpha = 0.75; x.fillText('require',     px+16, py+24);
      x.fillStyle = P.amber; x.globalAlpha = 0.65; x.fillText('("nostr")',   px+42, py+24);
      x.fillStyle = P.purp;  x.globalAlpha = 0.75; x.fillText('async',       px+16, py+32);
      x.fillStyle = P.pink;  x.globalAlpha = 0.75; x.fillText('function',    px+38, py+32);
      x.fillStyle = P.teal;  x.globalAlpha = 0.65; x.fillText('sign(e) {',   px+16, py+40);
      x.fillStyle = P.amber; x.globalAlpha = 0.6;  x.fillText('return relay',px+20, py+48);
      x.fillStyle = P.pink;  x.globalAlpha = 0.55; x.fillText('.publish(e)', px+20, py+56);
      x.fillStyle = P.lcream; x.globalAlpha = 0.65; x.fillText('}',          px+16, py+64);
      x.textAlign = 'center'; x.globalAlpha = 1;
      break;

    case 'synthwave': {
      // Dark sky
      x.fillStyle = '#060212'; x.fillRect(px + 6, py + 6, pw - 12, ph - 12);
      // Sky gradient — deep purple to magenta at horizon
      const swGrad = x.createLinearGradient(px + 6, py + 6, px + 6, py + ph * 0.62);
      swGrad.addColorStop(0, '#0d0025');
      swGrad.addColorStop(0.6, '#2a0040');
      swGrad.addColorStop(1, '#4a0050');
      x.fillStyle = swGrad; x.globalAlpha = 1;
      x.fillRect(px + 6, py + 6, pw - 12, Math.floor((ph - 12) * 0.58));
      x.globalAlpha = 1;
      // Sun — solid circle
      x.fillStyle = '#ff4488'; x.globalAlpha = 1;
      x.beginPath(); x.arc(px + pw / 2, py + ph * 0.4, pw * 0.2, 0, Math.PI * 2); x.fill();
      // Sun horizontal scan lines (gives retro banded look)
      const sunCY = py + ph * 0.4; const sunR = pw * 0.2;
      x.fillStyle = '#060212'; x.globalAlpha = 1;
      for (let sl = 1; sl < 6; sl++) {
        const ly = sunCY + sunR * 0.1 + sl * (sunR * 0.8 / 6);
        const hw = Math.sqrt(Math.max(0, sunR * sunR - (ly - sunCY) * (ly - sunCY)));
        x.fillRect(px + pw / 2 - hw, ly, hw * 2, sunR * 0.09);
      }
      // Horizon line
      const horizY = py + ph * 0.58;
      x.fillStyle = '#ff44aa'; x.globalAlpha = 0.8;
      x.fillRect(px + 6, horizY, pw - 12, 1);
      // Grid floor — proper perspective
      x.strokeStyle = '#cc22cc'; x.lineWidth = 0.5; x.globalAlpha = 0.6;
      // Horizontal lines (perspective)
      for (let gl = 0; gl < 5; gl++) {
        const t = gl / 4;
        const gy = horizY + 2 + t * t * (py + ph - 8 - horizY);
        x.beginPath(); x.moveTo(px + 6, gy); x.lineTo(px + pw - 6, gy); x.stroke();
      }
      // Vertical lines converging to vanishing point
      const vp = px + pw / 2;
      for (let gc = -4; gc <= 4; gc++) {
        const bx2 = vp + gc * ((pw - 12) / 8);
        x.beginPath(); x.moveTo(vp, horizY); x.lineTo(bx2, py + ph - 8); x.stroke();
      }
      x.globalAlpha = 1;
      // Stars
      x.fillStyle = '#fff';
      for (let s = 0; s < 14; s++) {
        x.globalAlpha = 0.15 + (s % 4) * 0.1;
        x.fillRect(px + 8 + (s * 13) % (pw - 16), py + 8 + (s * 9) % Math.floor(ph * 0.28), (s % 5 === 0) ? 1.5 : 1, (s % 5 === 0) ? 1.5 : 1);
      }
      x.globalAlpha = 1;
      break;
    }

    case 'matrix': {
      // Dark green rain of code
      x.fillStyle = '#000a02'; x.fillRect(px + 6, py + 6, pw - 12, ph - 12);
      // Clip to inner frame so characters can't overflow
      x.save();
      x.beginPath(); x.rect(px + 6, py + 6, pw - 12, ph - 12); x.clip();
      x.font = '5px monospace'; x.textAlign = 'left';
      const matChars = '01アイウエオカキクケコ'.split('');
      const cols = Math.floor((pw - 12) / 8);
      const rows = Math.floor((ph - 12) / 7);
      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
          const alpha = 0.1 + (row / rows) * 0.65;
          x.fillStyle = col % 3 === 0 ? '#00ff41' : '#00cc33';
          x.globalAlpha = alpha;
          const ch = matChars[(col * 3 + row * 2) % matChars.length];
          x.fillText(ch, px + 8 + col * 8, py + 12 + row * 7);
          x.globalAlpha = 1;
        }
      }
      // Bright leading char per column
      x.fillStyle = '#ccffcc'; x.globalAlpha = 0.95;
      for (let col = 0; col < cols; col++) {
        x.fillText(matChars[col % matChars.length], px + 8 + col * 8, py + 12);
      }
      x.globalAlpha = 1;
      x.restore();
      x.textAlign = 'center';
      break;
    }

    case 'space': {
      // Deep nebula
      x.fillStyle = '#010008'; x.fillRect(px + 6, py + 6, pw - 12, ph - 12);
      // Nebula clouds
      const nebColors = ['#3a0050', '#001a50', '#002a30', '#200040'];
      nebColors.forEach((nc2, i) => {
        x.fillStyle = nc2; x.globalAlpha = 0.3;
        x.beginPath();
        x.ellipse(
          px + 6 + (i * 18) % (pw - 12),
          py + 6 + (i * 14) % (ph - 12),
          20 + i * 6, 12 + i * 4, i * 0.5, 0, Math.PI * 2,
        );
        x.fill(); x.globalAlpha = 1;
      });
      // Stars
      x.fillStyle = '#fff';
      for (let s = 0; s < 30; s++) {
        x.globalAlpha = 0.1 + (s % 5) * 0.1;
        const sz = s % 8 === 0 ? 1.5 : 1;
        x.fillRect(px + 8 + (s * 17) % (pw - 16), py + 8 + (s * 11) % (ph - 16), sz, sz);
      }
      x.globalAlpha = 1;
      // Bright star
      x.fillStyle = '#fff'; x.globalAlpha = 0.9;
      x.beginPath(); x.arc(px + pw * 0.7, py + ph * 0.25, 2, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 0.15;
      x.beginPath(); x.arc(px + pw * 0.7, py + ph * 0.25, 6, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
      break;
    }
  }
}

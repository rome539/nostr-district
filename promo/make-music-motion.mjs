// Motion-promo bed — builds with the acts. 100 BPM, Am–F–C–G. 35s WAV.
//  0-7    minimal: sub pulse + airy pad          (typewriter)
//  7-13   kick + bass eighths enter              (skyline rises)
//  13-21.5 arp melody + hats                     (signs light up)
//  21.5-27.5 full: octave arps, brighter         (fireworks)
//  27.5-35 outro pad, fade                       (end card)
import fs from 'node:fs';

const SR = 44100, DUR = 35, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const CHORDS = [
  [57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62],
];
const BPM = 100, beat = 60 / BPM, bar = beat * 4, eighth = beat / 2;
const sq = (ph) => (ph % 1 < 0.5 ? 1 : -1);
const tri = (ph) => 2 * Math.abs(2 * (ph % 1) - 1) - 1;
let seedv = 555;
const rnd = () => { seedv = (seedv * 1103515245 + 12345) & 0x7fffffff; return seedv / 0x7fffffff; };
const ramp = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));

for (let i = 0; i < N; i++) {
  const t = i / SR;
  const chord = CHORDS[Math.floor(t / bar) % CHORDS.length];
  let l = 0, r = 0;

  // Pad — always on, swells through the piece
  let pad = 0;
  for (const nn of chord) {
    pad += Math.sin(2 * Math.PI * NOTE(nn) * t) + Math.sin(2 * Math.PI * NOTE(nn) * 1.004 * t);
  }
  pad *= 0.016 * (0.5 + 0.5 * ramp(t, 0, 10));
  l += pad; r += pad;

  // Sub pulse (acts 1-2): every 2 beats early, every beat once the kick lands
  const kickEvery = t < 7 ? beat * 2 : beat;
  const kt = t % kickEvery;
  const kAmp = (t < 27.5 ? 1 : ramp(t, 35, 27.5)) * (t < 7 ? 0.14 : 0.2);
  const kick = Math.sin(2 * Math.PI * (40 + 80 * Math.exp(-kt * 22)) * kt) * Math.exp(-kt * 8) * kAmp;
  l += kick; r += kick;

  // Bass eighths (from 7s)
  if (t >= 7 && t < 29) {
    const st = Math.floor(t / eighth);
    const bt2 = t - st * eighth;
    const bn = chord[0] - 12 + (st % 4 === 3 ? 12 : 0);
    const b = sq(NOTE(bn) * t) * Math.exp(-bt2 * 9) * 0.07 * ramp(t, 7, 8.5);
    l += b; r += b;
  }

  // Arp melody (from 13s), brighter octave layer in the finale
  if (t >= 13 && t < 28.5) {
    const st = Math.floor(t / eighth);
    const seq = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 12,
                 chord[0] + 24, chord[2] + 12, chord[1] + 24, chord[2] + 24];
    const an = seq[st % 8];
    const at = t - st * eighth;
    const g = ramp(t, 13, 14) * (t > 21.5 ? 0.10 : 0.075);
    const a1 = tri(NOTE(an) * t) * Math.exp(-at * 6) * g;
    const side = st % 2 ? 0.35 : 0.85;
    l += a1 * side; r += a1 * (1.2 - side);
    if (t > 21.5) {
      const a2 = sq(NOTE(an + 12) * t) * Math.exp(-at * 7) * 0.035 * ramp(t, 21.5, 22.5);
      l += a2 * (1.2 - side); r += a2 * side;
    }
  }

  // Hats (13-27.5) — offbeat ticks
  if (t >= 13 && t < 27.5) {
    const ht = (t % beat) - beat / 2;
    if (ht > 0 && ht < 0.025) {
      const h = (rnd() * 2 - 1) * Math.exp(-ht * 190) * 0.04;
      l += h; r += h;
    }
  }

  const fade = Math.min(1, t / 1.2) * Math.min(1, (DUR - t) / 2.5);
  L[i] = l * fade; R[i] = r * fade;
}

const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.max(-32767, Math.min(32767, (L[i] * 32767) | 0)), i * 4);
  data.writeInt16LE(Math.max(-32767, Math.min(32767, (R[i] * 32767) | 0)), i * 4 + 2);
}
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8);
hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20);
hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 4, 28);
hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34);
hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
fs.writeFileSync(new URL('./motion-music.wav', import.meta.url), Buffer.concat([hdr, data]));
console.log('motion music written');

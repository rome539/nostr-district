// "Pirate broadcast" bed — 140 BPM, aggressive, timed to the acts. 32s WAV.
//  0-2.2   static rumble
//  2.2-6   boom slams at 2.4/3.6/4.8 over a half-time kick
//  6-9     bass eighths + riser 7.5→9
//  9       THE DROP — four-on-floor, driving square bass, 16th arps
//  16-21   add lead + 16th hats
//  21-24.5 groove + ostrich honks (pitch-bent squares) at 21.3/22.4/23.5
//  24.5-27 gain-chopped stutter, degrading
//  27-32   near silence: soft pad, CRT "bwoop" at 31.2
import fs from 'node:fs';

const SR = 44100, DUR = 32, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const CHORDS = [[57, 60, 64], [55, 59, 62], [53, 57, 60], [52, 55, 59]]; // Am G F E
const BPM = 140, beat = 60 / BPM, bar = beat * 4, sixt = beat / 4, eighth = beat / 2;
const sq = (ph) => (ph % 1 < 0.5 ? 1 : -1);
let seedv = 777;
const rnd = () => { seedv = (seedv * 1103515245 + 12345) & 0x7fffffff; return seedv / 0x7fffffff; };
const ramp = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));

const SLAMS = [2.4, 3.6, 4.8, 12.0, 12.7];
const HONKS = [21.3, 22.4, 23.5];

for (let i = 0; i < N; i++) {
  const t = i / SR;
  const chord = CHORDS[Math.floor(((t - 9) / bar % 4 + 4) % 4)] ?? CHORDS[0];
  let l = 0, r = 0;

  // static rumble intro
  if (t < 2.4) {
    const s = (rnd() * 2 - 1) * 0.05 * (1 - t / 2.6);
    const rum = Math.sin(2 * Math.PI * 38 * t) * 0.08;
    l += s + rum; r += (rnd() * 2 - 1) * 0.05 * (1 - t / 2.6) + rum;
  }

  // slams — big boom + noise crack
  for (const s0 of SLAMS) {
    const st = t - s0;
    if (st > 0 && st < 0.5) {
      const boom = Math.sin(2 * Math.PI * (30 + 90 * Math.exp(-st * 18)) * st) * Math.exp(-st * 6) * 0.34;
      const crack = (rnd() * 2 - 1) * Math.exp(-st * 40) * 0.16;
      l += boom + crack; r += boom + crack;
    }
  }

  // half-time kick 2.2-9, four-on-floor after the drop
  if (t >= 2.2 && t < 27) {
    const every = t < 9 ? beat * 2 : beat;
    const kt = t % every;
    const kick = Math.sin(2 * Math.PI * (42 + 85 * Math.exp(-kt * 24)) * kt) * Math.exp(-kt * 9) * 0.24;
    l += kick; r += kick;
  }

  // duck everything rhythmic under the kick after the drop (pump)
  const pump = t >= 9 && t < 27 ? 1 - 0.55 * Math.exp(-(t % beat) * 10) : 1;

  // bass — eighths from 6, square, driving
  if (t >= 6 && t < 27) {
    const st = Math.floor(t / eighth);
    const bt2 = t - st * eighth;
    const bn = chord[0] - 24 + (st % 8 === 6 ? 12 : 0);
    const b = sq(NOTE(bn) * t) * Math.exp(-bt2 * 5) * 0.09 * ramp(t, 6, 6.6) * pump;
    l += b; r += b;
  }

  // riser 7.5-9: noise swell + rising sine
  if (t >= 7.5 && t < 9) {
    const p = (t - 7.5) / 1.5;
    const rise = Math.sin(2 * Math.PI * (300 + 1400 * p * p) * t) * 0.045 * p;
    const nz = (rnd() * 2 - 1) * 0.09 * p;
    l += rise + nz; r += rise + nz * 0.7;
  }

  // 16th arps after the drop
  if (t >= 9 && t < 26.5) {
    const st = Math.floor(t / sixt);
    const seq = [0, 1, 2, 1, 0, 2, 1, 2];
    const an = chord[seq[st % 8]] + 12;
    const at = t - st * sixt;
    const g = 0.06 * ramp(t, 9, 9.4) * pump * (t > 24.5 ? (Math.floor(t * 8) % 2 ? 0.15 : 1) : 1); // stutter in collapse
    const a1 = sq(NOTE(an) * t) * Math.exp(-at * 10) * g;
    const side = st % 2 ? 0.3 : 0.9;
    l += a1 * side; r += a1 * (1.2 - side);
  }

  // lead octave 16-24.5
  if (t >= 16 && t < 24.5) {
    const st = Math.floor(t / eighth);
    const seq2 = [2, 1, 0, 1];
    const ln = chord[seq2[st % 4]] + 24;
    const at = t - st * eighth;
    const lead = sq(NOTE(ln) * t + 0.5) * Math.exp(-at * 6) * 0.045 * ramp(t, 16, 16.6) * pump;
    l += lead * 0.7; r += lead;
  }

  // hats — 16ths from 16
  if (t >= 16 && t < 26 && pump > 0.6) {
    const ht = t % sixt;
    if (ht < 0.02) {
      const h = (rnd() * 2 - 1) * Math.exp(-ht * 240) * 0.035;
      l += h; r += h;
    }
  }

  // ostrich honks — pitch-bent squares, silly on purpose
  for (const h0 of HONKS) {
    const ht = t - h0;
    if (ht > 0 && ht < 0.32) {
      const f = 340 - 160 * ht * 3;
      const honk = sq(f * t) * Math.exp(-ht * 8) * 0.07;
      l += honk; r += honk * 0.8;
    }
  }

  // quiet outro pad from 27
  if (t >= 27) {
    let pad = 0;
    for (const nn of [57, 60, 64]) pad += Math.sin(2 * Math.PI * NOTE(nn) * t);
    pad *= 0.02 * ramp(t, 27, 28) * (t > 30 ? ramp(t, 31.6, 30) : 1);
    l += pad; r += pad;
    // CRT bwoop
    const bt3 = t - 31.2;
    if (bt3 > 0 && bt3 < 0.4) {
      const bw = Math.sin(2 * Math.PI * (900 * Math.exp(-bt3 * 9) + 40) * bt3) * Math.exp(-bt3 * 7) * 0.12;
      l += bw; r += bw;
    }
  }

  const fade = Math.min(1, t / 0.4) * Math.min(1, (DUR - t) / 0.4);
  L[i] = Math.tanh(l * 1.15) * fade;
  R[i] = Math.tanh(r * 1.15) * fade;
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
fs.writeFileSync(new URL('./crazy-music.wav', import.meta.url), Buffer.concat([hdr, data]));
console.log('crazy music written');

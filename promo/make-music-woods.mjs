// Woods promo bed — slower & softer than the city cut. 76 BPM, Em → C → G → D,
// triangle-wave plucks over a sine bass, faint wind, sparse hats. 45s WAV.
import fs from 'node:fs';

const SR = 44100;
const DUR = 45;
const N = SR * DUR;
const L = new Float32Array(N);
const R = new Float32Array(N);

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const CHORDS = [
  [52, 55, 59], // E G B
  [48, 52, 55], // C E G
  [43, 47, 50], // G B D
  [50, 54, 57], // D F# A
];
const BPM = 76;
const beat = 60 / BPM;
const bar = beat * 4;
const quarter = beat;

const tri = (ph) => 2 * Math.abs(2 * (ph % 1) - 1) - 1;
let seedv = 987;
const rnd = () => { seedv = (seedv * 1103515245 + 12345) & 0x7fffffff; return seedv / 0x7fffffff; };
let wind = 0;

for (let i = 0; i < N; i++) {
  const t = i / SR;
  const chord = CHORDS[Math.floor(t / bar) % CHORDS.length];
  let l = 0, r = 0;

  // Bass — root an octave down, gentle
  const bt = t % bar;
  const bass = Math.sin(2 * Math.PI * NOTE(chord[0] - 12) * t) * (Math.exp(-bt * 0.6) * 0.16 + 0.05);
  l += bass; r += bass;

  // Plucks — quarter notes, triangle, long soft decay, slight l/r drift
  const stepIdx = Math.floor(t / quarter);
  const arpNotes = [chord[0] + 12, chord[2] + 12, chord[1] + 12, chord[2] + 24];
  const an = arpNotes[stepIdx % 4];
  const at = t - stepIdx * quarter;
  const pluck = tri(NOTE(an) * t) * Math.exp(-at * 3.5) * 0.09;
  const drift = 0.5 + 0.3 * Math.sin(stepIdx * 1.7);
  l += pluck * drift; r += pluck * (1 - drift + 0.5);

  // Pad — soft detuned chord swell
  let pad = 0;
  for (const nn of chord) {
    pad += Math.sin(2 * Math.PI * NOTE(nn) * t) + Math.sin(2 * Math.PI * NOTE(nn) * 1.004 * t);
  }
  pad *= 0.014 * (0.55 + 0.45 * Math.sin(2 * Math.PI * t / (bar * 2)));
  l += pad; r += pad;

  // Wind — lowpassed noise, slow breathing amplitude
  wind = wind * 0.995 + (rnd() * 2 - 1) * 0.005;
  const breathe = 0.5 + 0.5 * Math.sin(2 * Math.PI * t / 9 + 1);
  l += wind * 2.2 * (0.010 + 0.014 * breathe);
  r += wind * 2.2 * (0.010 + 0.014 * (1 - breathe));

  // Hats — every other beat, very soft
  const ht = t % (beat * 2);
  const off = ht - beat;
  if (off > 0 && off < 0.025) {
    const h = (rnd() * 2 - 1) * Math.exp(-off * 200) * 0.03;
    l += h; r += h;
  }

  const fade = Math.min(1, t / 2) * Math.min(1, (DUR - t) / 3);
  L[i] = l * fade;
  R[i] = r * fade;
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
fs.writeFileSync(new URL('./woods-music.wav', import.meta.url), Buffer.concat([hdr, data]));
console.log('woods music written:', DUR, 's');

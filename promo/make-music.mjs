// Synthesize a mellow synthwave/chiptune bed for the ND promo — 46s WAV.
// Am → F → C → G, soft square arps over a sine bass, gentle noise hats.
import fs from 'node:fs';

const SR = 44100;
const DUR = 46;
const N = SR * DUR;
const L = new Float32Array(N);
const R = new Float32Array(N);

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // midi → Hz
// chords as midi roots: Am(57), F(53), C(48→60), G(55)
const CHORDS = [
  [57, 60, 64], // A C E
  [53, 57, 60], // F A C
  [60, 64, 67], // C E G
  [55, 59, 62], // G B D
];
const BPM = 96;
const beat = 60 / BPM;         // 0.625s
const bar = beat * 4;          // one chord per bar
const eighth = beat / 2;

const sq = (ph) => (ph % 1 < 0.5 ? 1 : -1) * 0.6 + (ph % 1 < 0.25 ? 0.4 : -0.4) * 0.3; // squarish
let seedv = 1234;
const rnd = () => { seedv = (seedv * 1103515245 + 12345) & 0x7fffffff; return seedv / 0x7fffffff; };

for (let i = 0; i < N; i++) {
  const t = i / SR;
  const barIdx = Math.floor(t / bar);
  const chord = CHORDS[barIdx % CHORDS.length];

  let l = 0, r = 0;

  // Bass — root, one octave down, soft sine with slight decay per bar
  const bt = t % bar;
  const bf = NOTE(chord[0] - 12);
  const benv = Math.exp(-bt * 0.9) * 0.22 + 0.06;
  const bass = Math.sin(2 * Math.PI * bf * t) * benv;
  l += bass; r += bass;

  // Arp — 8th notes cycling chord tones (+octave), square, short plucks
  const stepIdx = Math.floor(t / eighth);
  const arpNotes = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 24];
  const an = arpNotes[stepIdx % 4];
  const at = t - stepIdx * eighth;
  const aenv = Math.exp(-at * 7) * 0.11;
  const arp = sq(NOTE(an) * t) * aenv;
  // ping-pong the arp l/r by step
  if (stepIdx % 2 === 0) { l += arp * 0.85; r += arp * 0.35; }
  else { l += arp * 0.35; r += arp * 0.85; }

  // Pad — chord tones as soft detuned sines, slow swell
  let pad = 0;
  for (const nn of chord) {
    pad += Math.sin(2 * Math.PI * NOTE(nn) * t);
    pad += Math.sin(2 * Math.PI * (NOTE(nn) * 1.003) * t);
  }
  const swell = 0.5 + 0.5 * Math.sin(2 * Math.PI * t / (bar * 2));
  pad *= 0.018 * (0.6 + 0.4 * swell);
  l += pad; r += pad;

  // Hats — quiet noise ticks on offbeats
  const ht = t % beat;
  const off = ht - beat / 2;
  if (off > 0 && off < 0.03) {
    const h = (rnd() * 2 - 1) * Math.exp(-off * 160) * 0.05;
    l += h; r += h;
  }

  // master fade in / out
  const fade = Math.min(1, t / 1.5) * Math.min(1, (DUR - t) / 2.5);
  L[i] = l * fade;
  R[i] = r * fade;
}

// 16-bit stereo WAV
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
fs.writeFileSync(new URL('./promo-music.wav', import.meta.url), Buffer.concat([hdr, data]));
console.log('music written:', DUR, 's');

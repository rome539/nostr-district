// "MAKE YOURSELF" bed — bright dressing-room groove. 112 BPM, C major/mixo. 30s.
// Cha-ticks land on every outfit swap (3.4+n*0.5), plinks on the count lines,
// a big hit on the 718M slam (13.2), pops with each lineup citizen (16.4+i*0.4),
// rising arps through the color sweep, warm resolve.
import fs from 'node:fs';

const SR = 44100, DUR = 30, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const BPM = 112, beat = 60/BPM, eighth = beat/2, sixt = beat/4;
const sq = (ph) => (ph % 1 < 0.5 ? 1 : -1);
const tri = (ph) => 2*Math.abs(2*(ph%1)-1)-1;
let seedv = 12;
const rnd = () => { seedv = (seedv*1103515245+12345)&0x7fffffff; return seedv/0x7fffffff; };
const ramp = (t,a,b) => Math.max(0, Math.min(1, (t-a)/(b-a)));

const CHORDS = [[60,64,67],[57,60,64],[53,57,60],[55,59,62]]; // C Am F G
const bar = beat*4;

const SWAPS = Array.from({length:14},(_,n)=>3.4+n*0.5);
const POPS  = Array.from({length:7},(_,i)=>16.4+i*0.4);
const PLINKS = [11.0, 12.0];
const SLAM = 13.2;
const SWEEPN = Array.from({length:9},(_,i)=>22.7+i*0.42);

for (let i = 0; i < N; i++) {
  const t = i / SR;
  const chord = CHORDS[Math.floor(t/bar) % 4];
  let l = 0, r = 0;

  const on = t >= 3.0;
  const counts = t >= 10.5 && t < 16;
  const outro = t >= 26.5;
  const pump = on && !outro ? 1 - 0.4*Math.exp(-(t % beat)*9) : 1;

  // kick — four on the floor (halved during the counts card)
  if (on && t < 28.5) {
    const every = counts || outro ? beat*2 : beat;
    const kt = t % every;
    const kick = Math.sin(2*Math.PI*(46+80*Math.exp(-kt*24))*kt) * Math.exp(-kt*10) * 0.18;
    l += kick; r += kick;
  }
  // bass — bouncy octaves on eighths
  if (on && t < 28 && !outro) {
    const stp = Math.floor(t/eighth);
    const bn = chord[0] - 24 + (stp % 2 ? 12 : 0);
    const at = t - stp*eighth;
    const b = sq(NOTE(bn)*t) * Math.exp(-at*7) * 0.065 * ramp(t,3,3.5) * pump * (counts ? 0.6 : 1);
    l += b; r += b;
  }
  // comp — triangle chord on the and-of-2
  if (on && t < 26.5 && !counts) {
    const st = (t + eighth) % (beat*2);
    if (st < 0.4) {
      let stab = 0;
      for (const nn of chord) stab += tri(NOTE(nn)*t);
      stab *= Math.exp(-st*10) * 0.026 * pump;
      l += stab*0.7; r += stab;
    }
  }
  // hats — offbeats
  if (on && t < 26.5 && !counts) {
    const ht = (t % beat) - beat/2;
    if (ht > 0 && ht < 0.018) { const h = (rnd()*2-1)*Math.exp(-ht*240)*0.03; l += h; r += h; }
  }

  // cha-ticks on outfit swaps — short bright noise + wood tick
  for (const s0 of SWAPS) {
    const st = t - s0;
    if (st > 0 && st < 0.12) {
      const cha = (rnd()*2-1)*Math.exp(-st*70)*0.10 + Math.sin(2*Math.PI*900*st)*Math.exp(-st*50)*0.05;
      l += cha*0.8; r += cha;
    }
  }
  // plinks on the count lines — two-note rise
  for (const p0 of PLINKS) {
    [0, 0.12].forEach((off, k) => {
      const pt = t - p0 - off;
      if (pt > 0 && pt < 0.3) {
        const pl = Math.sin(2*Math.PI*NOTE(76+k*5)*t) * Math.exp(-pt*12) * 0.09;
        l += pl*0.7; r += pl;
      }
    });
  }
  // the 718M slam — big low hit + shimmer
  {
    const st = t - SLAM;
    if (st > 0 && st < 0.6) {
      const boom = Math.sin(2*Math.PI*(38+90*Math.exp(-st*16))*st) * Math.exp(-st*6) * 0.26;
      l += boom; r += boom;
    }
    if (st > 0 && st < 0.8) {
      const step = Math.floor(st/0.07);
      const nn = [72,76,79,84,88][Math.min(4,step)];
      const sh = tri(NOTE(nn)*t) * Math.exp(-(st%0.07)*24) * 0.05 * (1-st/0.8);
      l += sh; r += sh*1.2;
    }
  }
  // lineup pops — pentatonic plucks, one per citizen
  POPS.forEach((p0, k) => {
    const pt = t - p0;
    if (pt > 0 && pt < 0.3) {
      const nn = [60,62,64,67,69,72,74][k];
      const pop = tri(NOTE(nn)*t) * Math.exp(-pt*11) * 0.08;
      l += pop*(k%2?0.4:0.9); r += pop*(k%2?0.9:0.4);
    }
  });
  // color sweep — rising arp per swap
  SWEEPN.forEach((s0, k) => {
    const st = t - s0;
    if (st > 0 && st < 0.3) {
      const nn = 64 + (k%8)*2;
      const ar = sq(NOTE(nn)*t) * Math.exp(-st*13) * 0.05;
      l += ar*0.7; r += ar;
    }
  });

  // outro pad
  if (outro) {
    let pad = 0;
    for (const nn of [60,64,67,72]) pad += Math.sin(2*Math.PI*NOTE(nn)*t) + Math.sin(2*Math.PI*NOTE(nn)*1.003*t);
    pad *= 0.015 * ramp(t,26.5,27.5);
    l += pad; r += pad;
  }

  const fade = Math.min(1, t/0.6) * Math.min(1, (DUR-t)/1.8);
  L[i] = Math.tanh(l*1.1) * fade;
  R[i] = Math.tanh(r*1.1) * fade;
}

const data = Buffer.alloc(N*4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.max(-32767, Math.min(32767, (L[i]*32767)|0)), i*4);
  data.writeInt16LE(Math.max(-32767, Math.min(32767, (R[i]*32767)|0)), i*4+2);
}
const hdr = Buffer.alloc(44);
hdr.write('RIFF',0); hdr.writeUInt32LE(36+data.length,4); hdr.write('WAVE',8);
hdr.write('fmt ',12); hdr.writeUInt32LE(16,16); hdr.writeUInt16LE(1,20);
hdr.writeUInt16LE(2,22); hdr.writeUInt32LE(SR,24); hdr.writeUInt32LE(SR*4,28);
hdr.writeUInt16LE(4,32); hdr.writeUInt16LE(16,34);
hdr.write('data',36); hdr.writeUInt32LE(data.length,40);
fs.writeFileSync(new URL('./makeself-music.wav', import.meta.url), Buffer.concat([hdr, data]));
console.log('makeself music written');

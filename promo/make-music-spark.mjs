// Breez Spark wallet bed v2 — electric 118 BPM, E minor. 35s WAV.
// Zap stings synced to the bolt discharges (spawn + 0.35s travel), coin blips
// on the shop/bazaar card pops, calmer pulse under the wallet-truth cards,
// charge-up swell into the logo.
import fs from 'node:fs';

const SR = 44100, DUR = 35, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const BPM = 118, beat = 60/BPM, bar = beat*4, eighth = beat/2, sixt = beat/4;
const sq = (ph) => (ph % 1 < 0.5 ? 1 : -1);
const tri = (ph) => 2*Math.abs(2*(ph%1)-1)-1;
let seedv = 57;
const rnd = () => { seedv = (seedv*1103515245+12345)&0x7fffffff; return seedv/0x7fffffff; };
const ramp = (t,a,b) => Math.max(0, Math.min(1, (t-a)/(b-a)));

const CHORDS = [[52,55,59],[48,52,55],[57,60,64],[55,59,62]]; // Em C Am G
const ZAPS = [3.6, 4.5, 5.4, 6.2, 7.1, 8.0, 8.8].map(x => x + 0.35); // discharge moments
const COINS = [10.7, 11.5];      // shop / bazaar card pops
const LOGO_AT = 29.5;

for (let i = 0; i < N; i++) {
  const t = i / SR;
  const chord = CHORDS[Math.floor(t/bar) % 4];
  let l = 0, r = 0;

  const on = t >= 3.0;
  const truths = t >= 15.5 && t < 26;
  const logo = t >= LOGO_AT;
  const pump = on && !logo ? 1 - 0.42*Math.exp(-(t % beat)*9) : 1;

  // kick
  if (on && t < 33) {
    const every = truths ? beat*2 : logo ? beat*2 : beat;
    const kt = t % every;
    const kick = Math.sin(2*Math.PI*(45+82*Math.exp(-kt*24))*kt) * Math.exp(-kt*10) * (logo ? 0.1 : 0.18);
    l += kick; r += kick;
  }
  // electric bass — driving 16ths through street+spend acts, eighths under truths
  if (on && t < 29 && !logo) {
    const grid = t < 15.5 ? sixt : eighth;
    const stp = Math.floor(t/grid);
    const bn = chord[0] - 24 + (stp % 8 === 6 ? 12 : 0);
    const at = t - stp*grid;
    const b = sq(NOTE(bn)*t) * Math.exp(-at*9) * (t < 15.5 ? 0.07 : 0.05) * ramp(t,3,3.5) * pump;
    l += b; r += b;
  }
  // arps — sparkly triangle line
  if (on && t < 29.2) {
    const stp = Math.floor(t/eighth);
    const an = chord[(stp*2) % 3] + 24;
    const at = t - stp*eighth;
    const g = (truths ? 0.035 : 0.055) * pump;
    const a1 = tri(NOTE(an)*t) * Math.exp(-at*7) * g;
    const side = stp % 2 ? 0.35 : 0.85;
    l += a1*side; r += a1*(1.2-side);
  }
  // hats
  if (on && t < 29 && !truths) {
    const ht = (t % beat) - beat/2;
    if (ht > 0 && ht < 0.018) { const h = (rnd()*2-1)*Math.exp(-ht*240)*0.032; l += h; r += h; }
  }

  // zap stings — the game's own zapSound recipe, scaled down (noise crack + rising tones)
  for (const z0 of ZAPS) {
    const zt = t - z0;
    if (zt > 0 && zt < 0.3) {
      const crack = (rnd()*2-1)*Math.exp(-zt*45)*0.10;
      const risef = 220*Math.pow(6, Math.min(1, zt*4));
      const risetone = Math.sin(2*Math.PI*risef*t)*Math.exp(-zt*10)*0.05;
      l += crack+risetone; r += crack*0.8+risetone;
    }
  }
  // coin blips — two-note register ding for the shop/bazaar cards
  COINS.forEach((c0, k) => {
    [0, 0.09].forEach((off, j) => {
      const pt = t - c0 - off;
      if (pt > 0 && pt < 0.25) {
        const pl = Math.sin(2*Math.PI*NOTE(76+k*3+j*5)*t) * Math.exp(-pt*14) * 0.06;
        l += pl*(j?0.9:0.6); r += pl*(j?0.6:0.9);
      }
    });
  });

  // charge-up riser into the logo (28.2 → 29.5), then warm blue pad
  {
    const rt = t - 28.2;
    if (rt > 0 && rt < 1.3) {
      const p = rt/1.3;
      const swell = Math.sin(2*Math.PI*(200+900*p*p)*t) * 0.04*p + (rnd()*2-1)*0.05*p*p;
      l += swell; r += swell*0.8;
    }
  }
  if (logo) {
    // landing boom + major pad (E major lift for the brand card)
    const bt = t - LOGO_AT;
    if (bt > 0 && bt < 0.5) {
      const boom = Math.sin(2*Math.PI*(36+80*Math.exp(-bt*15))*bt)*Math.exp(-bt*6)*0.22;
      l += boom; r += boom;
    }
    let pad = 0;
    for (const nn of [52,56,59,64]) pad += Math.sin(2*Math.PI*NOTE(nn)*t) + Math.sin(2*Math.PI*NOTE(nn)*1.003*t);
    pad *= 0.017 * ramp(t,29.6,30.6);
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
fs.writeFileSync(new URL('./spark-music.wav', import.meta.url), Buffer.concat([hdr, data]));
console.log('spark music written');

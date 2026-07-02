// "THE BAZAAR" bed — night-market groove. 105 BPM, A dorian. 30s WAV.
// Coin blips rise with the rarity ladder (3.6/4.95/6.3/7.65 — legendary gets a
// golden triad), full groove for the card river, sparser under "how they find
// you", a zap sting at the trade crossing (23.7), warm resolve for the card.
import fs from 'node:fs';

const SR = 44100, DUR = 30, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const BPM = 105, beat = 60/BPM, bar = beat*4, eighth = beat/2, sixt = beat/4;
const sq = (ph) => (ph % 1 < 0.5 ? 1 : -1);
const tri = (ph) => 2*Math.abs(2*(ph%1)-1)-1;
let seedv = 33;
const rnd = () => { seedv = (seedv*1103515245+12345)&0x7fffffff; return seedv/0x7fffffff; };
const ramp = (t,a,b) => Math.max(0, Math.min(1, (t-a)/(b-a)));

// A dorian: A B C D E F# G — chords Am7 / D7 vamp (classic market slink)
const CHORDS = [[57,60,64,67],[50,54,57,60]];
// coin blips: junk low → legendary golden triad
const BLIPS = [
  { at: 3.60, notes: [57] },
  { at: 4.95, notes: [64] },
  { at: 6.30, notes: [69] },
  { at: 7.65, notes: [76, 81, 88] }, // legendary: rising triad
];
const ZAP_AT = 23.7;

// bass riff (16th grid, A dorian slink) — degrees over root 45 (A1... use 45=A2)
const RIFF = [0, null, 0, 12, null, 0, 10, null, 7, null, 5, 7, 10, null, 12, null];

for (let i = 0; i < N; i++) {
  const t = i / SR;
  const chord = CHORDS[Math.floor(t/(bar*2)) % 2];
  let l = 0, r = 0;

  const on = t >= 3.0;
  const river = t >= 9.5 && t < 16.5;
  const ways = t >= 16.5 && t < 22.5;
  const trade = t >= 22.5 && t < 26.2;
  const outro = t >= 26.2;
  const busy = river || trade ? 1 : ways ? 0.55 : outro ? 0.3 : 0.8;
  const pump = on && !outro ? 1 - 0.45*Math.exp(-(t % beat)*9) : 1;

  // kick — every beat once on; half-time in outro
  if (on && t < 28.6) {
    const every = outro ? beat*2 : beat;
    const kt = t % every;
    const kick = Math.sin(2*Math.PI*(44+80*Math.exp(-kt*24))*kt) * Math.exp(-kt*10) * 0.19 * (outro ? 0.6 : 1);
    l += kick; r += kick;
  }
  // snare ghost on 2&4 during river/trade
  if ((river || trade) && t < 28) {
    const st = (t + beat) % (beat*2);
    if (st < 0.08) {
      const sn = ((rnd()*2-1)*0.6 + Math.sin(2*Math.PI*180*st)*0.4) * Math.exp(-st*40) * 0.08;
      l += sn; r += sn;
    }
  }
  // slinky bass riff
  if (on && t < 28 && !outro) {
    const stp = Math.floor(t/sixt);
    const deg = RIFF[stp % 16];
    if (deg !== null) {
      const at = t - stp*sixt;
      const b = sq(NOTE(45+deg)*t) * Math.exp(-at*8) * 0.075 * busy * pump * ramp(t,3,3.5);
      l += b; r += b;
    }
  }
  // marimba-ish comp — triangle chord stabs on offbeats
  if (on && t < 26 && busy > 0.5) {
    const st = (t + eighth) % (beat*2);
    if (st < 0.5) {
      let stab = 0;
      for (const nn of chord) stab += tri(NOTE(nn)*t);
      stab *= Math.exp(-st*9) * 0.028 * busy * pump;
      l += stab*0.7; r += stab;
    }
  }
  // hats — swung 16ths in the river
  if (river || trade) {
    const stp = Math.floor(t/sixt);
    const swing = stp % 2 ? sixt*0.12 : 0;
    const ht = t - stp*sixt - swing;
    if (ht > 0 && ht < 0.018) {
      const h = (rnd()*2-1)*Math.exp(-ht*260)*0.032*(stp%4===2?1.5:1);
      l += h; r += h;
    }
  }

  // coin blips (rarity ladder) — bright sine plinks
  for (const bl of BLIPS) {
    bl.notes.forEach((nn, k) => {
      const bt = t - bl.at - k*0.09;
      if (bt > 0 && bt < 0.35) {
        const plink = Math.sin(2*Math.PI*NOTE(nn)*t) * Math.exp(-bt*14) * 0.12;
        l += plink*0.7; r += plink;
      }
    });
  }

  // zap sting at the trade crossing
  {
    const zt = t - ZAP_AT;
    if (zt > 0 && zt < 0.4) {
      const zap = sq((900 - zt*1400)*t) * Math.exp(-zt*12) * 0.07
                + (rnd()*2-1)*Math.exp(-zt*30)*0.05;
      l += zap; r += zap*0.8;
    }
  }

  // outro pad — resolve to A major-ish warmth
  if (outro) {
    let pad = 0;
    for (const nn of [57, 61, 64, 69]) pad += Math.sin(2*Math.PI*NOTE(nn)*t) + Math.sin(2*Math.PI*NOTE(nn)*1.003*t);
    pad *= 0.015 * ramp(t,26.2,27.2);
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
fs.writeFileSync(new URL('./bazaar-music.wav', import.meta.url), Buffer.concat([hdr, data]));
console.log('bazaar music written');

// July 4 promo bed — bright festive fanfare, 120 BPM, C major. 30s WAV.
//  0-3    quiet + rising rocket whistle → BOOM at 3.1
//  3-10   fanfare: kick, snare 2/4, square lead, bass (booms under the show)
// 10-15   shaped-shell booms on cue
// 15-21   soft bridge (Liberty feature)
// 21-25   groove + sparkler crackle
// 25-30   finale barrage, crescendo, fade
import fs from 'node:fs';

const SR = 44100, DUR = 25, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const CHORDS = [[60,64,67],[65,69,72],[67,71,74],[60,64,67]]; // C F G C
const BPM = 120, beat = 60/BPM, bar = beat*4, eighth = beat/2;
const sq = (ph) => (ph % 1 < 0.5 ? 1 : -1);
const tri = (ph) => 2*Math.abs(2*(ph%1)-1)-1;
let seedv = 74;
const rnd = () => { seedv = (seedv*1103515245+12345)&0x7fffffff; return seedv/0x7fffffff; };
const ramp = (t,a,b) => Math.max(0, Math.min(1, (t-a)/(b-a)));

const BOOMS = [3.1, 11.0, 11.7, 12.4, 13.2, 14.1]; // shaped shells: launch + ~1.2s travel
for (let b0 = 4.6; b0 < 10; b0 += 0.9 + (b0*7 % 1)*0.4) BOOMS.push(b0);
for (let b0 = 16.4; b0 < 19.9; b0 += 0.45) BOOMS.push(b0); // finale barrage

// simple fanfare melody (scale degrees over C major), one note per eighth, 2-bar loop
const MELODY = [72,72,76,79, 76,79,81,79, 77,77,81,84, 79,76,72,74];

for (let i = 0; i < N; i++) {
  const t = i / SR;
  const chord = CHORDS[Math.floor(((t-3)/bar % 4 + 4) % 4)] ?? CHORDS[0];
  let l = 0, r = 0;

  // rocket whistle 0.5-2.9 — rising, quiet
  if (t > 0.5 && t < 2.95) {
    const p = (t-0.5)/2.45;
    const wh = Math.sin(2*Math.PI*(500+1100*p*p)*t) * 0.035 * Math.sin(Math.PI*p);
    l += wh*0.8; r += wh;
  }

  // booms — deep pitch-drop + crack (the sky show's percussion section)
  for (const b0 of BOOMS) {
    const bt = t - b0;
    if (bt > 0 && bt < 0.6) {
      const big = b0 < 3.5 || b0 > 25 ? 0.3 : 0.16;
      const boom = Math.sin(2*Math.PI*(32+95*Math.exp(-bt*16))*bt) * Math.exp(-bt*5.5) * big;
      const crack = (rnd()*2-1) * Math.exp(-bt*35) * big*0.5;
      l += boom+crack; r += boom+crack;
    }
  }

  const on = t >= 3.1;
  const bandEnd = 19.6;
  const pump = on && t < bandEnd ? 1 - 0.4*Math.exp(-(t % beat)*9) : 1;

  // kick — every beat while the band plays
  if (on && t < bandEnd) {
    const kt = t % beat;
    const kick = Math.sin(2*Math.PI*(45+85*Math.exp(-kt*24))*kt) * Math.exp(-kt*10) * 0.2;
    l += kick; r += kick;
  }
  // snare — beats 2 & 4
  if (on && t < bandEnd) {
    const st = (t + beat) % (beat*2);
    if (st < 0.09) {
      const sn = ((rnd()*2-1)*0.7 + Math.sin(2*Math.PI*190*st)*0.3) * Math.exp(-st*38) * 0.11;
      l += sn; r += sn;
    }
  }
  // bass — eighths, root/fifth
  if (on && t < bandEnd) {
    const stp = Math.floor(t/eighth);
    const bt2 = t - stp*eighth;
    const bn = chord[0] - 24 + (stp % 4 === 2 ? 7 : 0);
    const b = sq(NOTE(bn)*t) * Math.exp(-bt2*6) * 0.07 * ramp(t,3.1,3.6) * pump;
    l += b; r += b;
  }
  // lead — fanfare melody (square), pushes a little harder through the finale
  if (on && t < bandEnd) {
    const stp = Math.floor((t-3.1)/eighth);
    const mn = MELODY[stp % MELODY.length];
    const at = (t-3.1) - stp*eighth;
    const g = 0.075 * ramp(t,3.1,3.5) * pump * (t > 15.2 ? 1.15 : 1);
    const ld = sq(NOTE(mn)*t) * Math.exp(-at*5) * g;
    l += ld*0.7; r += ld;
  }
  // outro pad under the end card
  if (t >= 19.8) {
    let pad = 0;
    for (const nn of CHORDS[0]) pad += tri(NOTE(nn)*t*0.5) * 0.5 + Math.sin(2*Math.PI*NOTE(nn)*t);
    pad *= 0.02 * ramp(t,19.8,20.8);
    l += pad; r += pad;
  }
  // hats — offbeat
  if (on && t < bandEnd) {
    const ht = (t % beat) - beat/2;
    if (ht > 0 && ht < 0.02) { const h = (rnd()*2-1)*Math.exp(-ht*220)*0.035; l += h; r += h; }
  }

  const fade = Math.min(1, t/0.4) * Math.min(1, (DUR-t)/1.6);
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
fs.writeFileSync(new URL('./july4-music.wav', import.meta.url), Buffer.concat([hdr, data]));
console.log('july4 music written');

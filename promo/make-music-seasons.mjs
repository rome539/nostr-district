// "A city with seasons" bed — one continuous piece whose mood tracks the acts.
// 92 BPM. Feb: warm waltz sines · Jul: bright + distant booms · Mid-Autumn:
// pentatonic plucks · Oct: parallel-minor spook · montage: everything · resolve.
import fs from 'node:fs';

const SR = 44100, DUR = 34, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const BPM = 92, beat = 60/BPM, bar = beat*4, eighth = beat/2;
const tri = (ph) => 2*Math.abs(2*(ph%1)-1)-1;
let seedv = 4;
const rnd = () => { seedv = (seedv*1103515245+12345)&0x7fffffff; return seedv/0x7fffffff; };
const ramp = (t,a,b) => Math.max(0, Math.min(1, (t-a)/(b-a)));
const env2 = (t,a,b) => Math.min(1, Math.max(0,(t-a)/0.7)) * Math.min(1, Math.max(0,(b-t)/0.7));

// section chords
const FEB = [[53,57,60],[48,52,55]];          // F, C — warm
const JUL = [[48,52,55],[55,59,62]];          // C, G — bright
const MID = [[57,60,64],[55,60,64]];          // Am-ish pentatonic base
const OCT = [[50,53,57],[49,53,56]];          // Dm → Db-ish shiver
const PENTA = [60, 62, 64, 67, 69, 72, 74, 76]; // C pentatonic for mid-autumn plucks

const JUL_BOOMS = [];
for (let b0 = 9.4; b0 < 13.4; b0 += 0.9 + (b0*3 % 1)*0.3) JUL_BOOMS.push(b0);
// calendar act: ascending pentatonic plinks, one per row reveal (11 rows)
const REVEALS = Array.from({ length: 11 }, (_, i) => 23.3 + i*0.3);

for (let i = 0; i < N; i++) {
  const t = i / SR;
  let l = 0, r = 0;

  const aFeb = env2(t,3,8.6), aJul = env2(t,8,13.6), aMid = env2(t,13,18.6), aOct = env2(t,18,23.6);
  const aMon = env2(t,23,29.6), aEnd = ramp(t,29.2,30.2);
  const chordOf = (set) => set[Math.floor(t/bar) % 2];

  // ── base heartbeat: soft kick every beat, whole piece after 3s ──
  if (t >= 3 && t < 32) {
    const kt = t % beat;
    const kick = Math.sin(2*Math.PI*(42+70*Math.exp(-kt*22))*kt) * Math.exp(-kt*11) * 0.13;
    l += kick; r += kick;
  }

  // ── FEB: warm detuned sine chords, waltzy 3-feel arp ──
  if (aFeb > 0) {
    const c = chordOf(FEB);
    let pad = 0;
    for (const nn of c) pad += Math.sin(2*Math.PI*NOTE(nn)*t) + Math.sin(2*Math.PI*NOTE(nn)*1.004*t);
    l += pad*0.018*aFeb; r += pad*0.018*aFeb;
    const stp = Math.floor(t/(beat*2/3));
    const an = c[stp % 3] + 12;
    const at = t - stp*(beat*2/3);
    const arp = Math.sin(2*Math.PI*NOTE(an)*t) * Math.exp(-at*4) * 0.05 * aFeb;
    l += arp*0.7; r += arp;
  }

  // ── JUL: brighter triangle arps + distant booms ──
  if (aJul > 0) {
    const c = chordOf(JUL);
    const stp = Math.floor(t/eighth);
    const an = c[stp % 3] + 12 + (stp % 4 === 3 ? 12 : 0);
    const at = t - stp*eighth;
    const arp = tri(NOTE(an)*t) * Math.exp(-at*6) * 0.06 * aJul;
    const side = stp % 2 ? 0.35 : 0.85;
    l += arp*side; r += arp*(1.2-side);
    let pad = 0;
    for (const nn of c) pad += Math.sin(2*Math.PI*NOTE(nn)*t);
    l += pad*0.012*aJul; r += pad*0.012*aJul;
  }
  for (const b0 of JUL_BOOMS) {
    const bt = t - b0;
    if (bt > 0 && bt < 0.5) {
      const boom = Math.sin(2*Math.PI*(34+80*Math.exp(-bt*15))*bt) * Math.exp(-bt*6) * 0.12;
      l += boom; r += boom;
    }
  }
  // calendar row plinks — climb the pentatonic as the year fills in
  REVEALS.forEach((r0, k) => {
    const pt = t - r0;
    if (pt > 0 && pt < 0.3) {
      const pl = tri(NOTE(PENTA[k % PENTA.length] + (k > 7 ? 12 : 0))*t) * Math.exp(-pt*11) * 0.06;
      l += pl*(k%2?0.5:0.9); r += pl*(k%2?0.9:0.5);
    }
  });

  // ── MID-AUTUMN: pentatonic plucks over a drone ──
  if (aMid > 0) {
    const drone = Math.sin(2*Math.PI*NOTE(45)*t) * 0.05 * aMid;
    l += drone; r += drone;
    const stp = Math.floor(t/(beat*0.75));
    const hash = Math.abs(Math.sin(stp*127.1))*PENTA.length;
    const an = PENTA[hash|0];
    const at = t - stp*(beat*0.75);
    const pk = tri(NOTE(an)*t) * Math.exp(-at*5) * 0.055 * aMid;
    l += pk*(stp%2?0.4:0.9); r += pk*(stp%2?0.9:0.4);
  }

  // ── OCT: minor shiver — low fifths pulse + sparse high sting ──
  if (aOct > 0) {
    const c = chordOf(OCT);
    const pt = t % (beat*2);
    const pulse = (Math.sin(2*Math.PI*NOTE(c[0]-12)*t) + Math.sin(2*Math.PI*NOTE(c[2]-12)*t))
      * Math.exp(-pt*3) * 0.06 * aOct;
    l += pulse; r += pulse;
    const st2 = Math.floor(t/(bar));
    const stAt = t - st2*bar - beat*3;
    if (stAt > 0 && stAt < 0.8) {
      const sting = Math.sin(2*Math.PI*NOTE(c[1]+24)*t) * Math.exp(-stAt*5) * 0.035 * aOct;
      l += sting; r += sting*0.7;
    }
  }

  // ── montage/end: full major pad swells and resolves ──
  if (aMon > 0 || aEnd > 0) {
    const g2 = Math.max(aMon, aEnd);
    let pad = 0;
    for (const nn of [48,52,55,60]) pad += Math.sin(2*Math.PI*NOTE(nn)*t) + Math.sin(2*Math.PI*NOTE(nn)*1.003*t);
    pad *= 0.016 * g2;
    l += pad; r += pad;
  }

  const fade = Math.min(1, t/1.0) * Math.min(1, (DUR-t)/2.2);
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
fs.writeFileSync(new URL('./seasons-music.wav', import.meta.url), Buffer.concat([hdr, data]));
console.log('seasons music written');

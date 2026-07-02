// "MAKE IT HOME" bed — cozy 96 BPM, warm F major. Soft thunk-pops land on each
// furniture placement (3.4→10.6 every 0.8s), row plinks on the catalog beats,
// quick whoosh-pops on the arrange-mode teleports, warm resolve.
import fs from 'node:fs';

const SR = 44100, DUR = 30, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const BPM = 96, beat = 60/BPM, bar = beat*4, eighth = beat/2;
const tri = (ph) => 2*Math.abs(2*(ph%1)-1)-1;
const sq = (ph) => (ph % 1 < 0.5 ? 1 : -1);
let seedv = 61;
const rnd = () => { seedv = (seedv*1103515245+12345)&0x7fffffff; return seedv/0x7fffffff; };
const ramp = (t,a,b) => Math.max(0, Math.min(1, (t-a)/(b-a)));

const CHORDS = [[53,57,60],[48,53,57],[50,53,57],[48,52,55]]; // F Dm... warm loop
const PLACES = Array.from({length:10},(_,i)=>3.4+i*0.8);
const ROWSB  = [16.4, 17.8, 19.2, 20.6];
const TELEPORTS = Array.from({length:6},(_,i)=>22.4+i*0.6);

for (let i = 0; i < N; i++) {
  const t = i / SR;
  const chord = CHORDS[Math.floor(t/bar) % 4];
  let l = 0, r = 0;

  const on = t >= 3.0;
  const outro = t >= 26;

  // soft kick — every other beat (cozy, not clubby)
  if (on && t < 28) {
    const kt = t % (beat*2);
    const kick = Math.sin(2*Math.PI*(44+70*Math.exp(-kt*22))*kt) * Math.exp(-kt*10) * 0.13;
    l += kick; r += kick;
  }
  // warm bass — half notes
  if (on && !outro) {
    const stp = Math.floor(t/(beat*2));
    const at = t - stp*(beat*2);
    const b = Math.sin(2*Math.PI*NOTE(chord[0]-12)*t) * Math.exp(-at*1.6) * 0.09 * ramp(t,3,3.6);
    l += b; r += b;
  }
  // music-box plucks — gentle melody on eighths, sparse (rests via hash)
  if (on && t < 26) {
    const stp = Math.floor(t/eighth);
    const hash = Math.abs(Math.sin(stp*91.7));
    if (hash > 0.35) {
      const nn = chord[(stp + Math.floor(hash*3)) % 3] + 24;
      const at = t - stp*eighth;
      const pk = tri(NOTE(nn)*t) * Math.exp(-at*6) * 0.045;
      l += pk*(stp%2?0.4:0.9); r += pk*(stp%2?0.9:0.4);
    }
  }
  // pad — always under, breathing
  {
    let pad = 0;
    for (const nn of chord) pad += Math.sin(2*Math.PI*NOTE(nn)*t) + Math.sin(2*Math.PI*NOTE(nn)*1.004*t);
    pad *= 0.013 * (0.5+0.5*Math.sin(2*Math.PI*t/9)) * ramp(t,0.5,2);
    l += pad; r += pad;
  }

  // placement thunk-pops — soft wood knock + rising blip per piece
  PLACES.forEach((p0, k) => {
    const pt = t - p0;
    if (pt > 0 && pt < 0.3) {
      const knock = (rnd()*2-1)*Math.exp(-pt*55)*0.12
                  + Math.sin(2*Math.PI*(70+50*Math.exp(-pt*20))*pt)*Math.exp(-pt*9)*0.12;
      const blip = Math.sin(2*Math.PI*NOTE(60+(k%7)*2)*t) * Math.exp(-pt*14) * 0.06;
      l += knock+blip*0.7; r += knock*0.8+blip;
    }
  });
  // catalog row plinks — two-note motif per row
  ROWSB.forEach((r0, k) => {
    [0, 0.11].forEach((off, j) => {
      const pt = t - r0 - off;
      if (pt > 0 && pt < 0.25) {
        const pl = tri(NOTE(65+k*3+j*4)*t) * Math.exp(-pt*13) * 0.07;
        l += pl*0.7; r += pl;
      }
    });
  });
  // arrange-mode teleports — whoosh (filtered noise sweep) + pop
  TELEPORTS.forEach((t0) => {
    const pt = t - t0;
    if (pt > 0 && pt < 0.2) {
      const wh = (rnd()*2-1) * Math.exp(-pt*24) * 0.07 * Math.sin(Math.PI*pt/0.2);
      const pop = Math.sin(2*Math.PI*(500-1200*pt)*pt) * Math.exp(-pt*20) * 0.05;
      l += wh+pop; r += wh*0.7+pop;
    }
  });

  // outro — resolve
  if (outro) {
    let pad = 0;
    for (const nn of [53,57,60,65]) pad += Math.sin(2*Math.PI*NOTE(nn)*t) + Math.sin(2*Math.PI*NOTE(nn)*1.003*t);
    pad *= 0.016 * ramp(t,26,27);
    l += pad; r += pad;
  }

  const fade = Math.min(1, t/0.8) * Math.min(1, (DUR-t)/2.0);
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
fs.writeFileSync(new URL('./home-music.wav', import.meta.url), Buffer.concat([hdr, data]));
console.log('home music written');

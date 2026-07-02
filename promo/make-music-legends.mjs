// "The Legends" bed — mysterious lake at night. 82 BPM, D minor. 28s WAV.
// Wood-knock THUNKs when posters nail in (3.4/6.9/10.4/13.9/17.4), a small
// shimmer on each reveal (+1.0s), a deep swell for the coelacanth, warm
// resolve for the recap + end card.
import fs from 'node:fs';

const SR = 44100, DUR = 28, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const BPM = 82, beat = 60/BPM, bar = beat*4;
const tri = (ph) => 2*Math.abs(2*(ph%1)-1)-1;
let seedv = 91;
const rnd = () => { seedv = (seedv*1103515245+12345)&0x7fffffff; return seedv/0x7fffffff; };
const ramp = (t,a,b) => Math.max(0, Math.min(1, (t-a)/(b-a)));

// Dm ambience; recap/end shift toward warm F major
const DM = [50, 53, 57], FMAJ = [53, 57, 60];
const THUNKS = [3.4, 6.9, 10.4, 13.9, 17.4];
const SHIMMERS = [4.4, 7.9, 11.4, 14.9]; // reveals (coelacanth gets a swell instead)
let wind = 0;

for (let i = 0; i < N; i++) {
  const t = i / SR;
  const chord = t >= 21 ? FMAJ : DM;
  let l = 0, r = 0;

  // deep drone — root two octaves down, slow breathing
  const droneAmp = 0.09 * (0.7 + 0.3*Math.sin(2*Math.PI*t/7));
  const drone = Math.sin(2*Math.PI*NOTE(chord[0]-24)*t) * droneAmp
              + Math.sin(2*Math.PI*NOTE(chord[0]-12)*t) * droneAmp*0.4;
  l += drone; r += drone;

  // sparse plucks — one per bar on 1, one on the and-of-3
  const bt = t % bar;
  for (const [off, ni] of [[0, 0], [beat*2.5, 2]]) {
    const pt = bt - off;
    if (pt > 0 && pt < 1.2) {
      const p2 = tri(NOTE(chord[ni])*t) * Math.exp(-pt*4) * 0.07;
      l += p2*0.8; r += p2;
    }
  }

  // wind — lowpassed noise breathing
  wind = wind*0.995 + (rnd()*2-1)*0.005;
  const breathe = 0.5+0.5*Math.sin(2*Math.PI*t/9+2);
  l += wind*2.0*(0.008+0.012*breathe); r += wind*2.0*(0.008+0.012*(1-breathe));

  // THUNK — wood knock + low boom
  for (const t0 of THUNKS) {
    const kt = t - t0;
    if (kt > 0 && kt < 0.4) {
      const knock = (rnd()*2-1)*Math.exp(-kt*60)*0.22;                  // wood crack
      const boom = Math.sin(2*Math.PI*(55+60*Math.exp(-kt*20))*kt)*Math.exp(-kt*9)*0.22;
      l += knock+boom; r += knock*0.8+boom;
    }
  }

  // reveal shimmer — quick rising triangle arpeggio
  for (const t0 of SHIMMERS) {
    const stt = t - t0;
    if (stt > 0 && stt < 0.6) {
      const step = Math.floor(stt/0.09);
      const nn = chord[step % 3] + 24 + 12*Math.floor(step/3);
      const sh = tri(NOTE(nn)*t) * Math.exp(-(stt%0.09)*22) * 0.05 * (1-stt/0.6);
      l += sh; r += sh*1.2;
    }
  }

  // coelacanth swell — dark rising drone 17.4-19.4
  {
    const ct = t - 17.4;
    if (ct > 0 && ct < 2.2) {
      const k = Math.sin(Math.PI*ct/2.2);
      const sw = Math.sin(2*Math.PI*(NOTE(38)*(1+ct*0.02))*t) * k * 0.10;
      l += sw; r += sw;
    }
  }

  // recap/end — gentle bell melody
  if (t >= 21) {
    const st = Math.floor((t-21)/(beat/2));
    const seq = [65, 69, 72, 69, 74, 72, 69, 65];
    const at = (t-21) - st*(beat/2);
    const bell = Math.sin(2*Math.PI*NOTE(seq[st % 8])*t) * Math.exp(-at*5) * 0.05 * ramp(t,21,21.5);
    l += bell*0.8; r += bell;
  }

  const fade = Math.min(1, t/1.2) * Math.min(1, (DUR-t)/2.2);
  L[i] = l * fade; R[i] = r * fade;
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
fs.writeFileSync(new URL('./legends-music.wav', import.meta.url), Buffer.concat([hdr, data]));
console.log('legends music written');

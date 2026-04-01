/**
 * SoundEngine.ts — Web Audio API synthesis. No external files needed.
 * Singleton — call SoundEngine.get() anywhere.
 */

export type RoomId = 'hub' | 'lounge' | 'relay' | 'feed' | 'myroom' | 'market';

const STORAGE_KEY = 'nd_sound';
const MYROOM_TRACK_KEY = 'nd_myroom_track';

const BASE = 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/';

export const MYROOM_TRACKS = [
  { id: 'hiding',  label: 'Hiding Your Reality', url: `${BASE}Hiding%20Your%20Reality.mp3` },
  { id: 'sneaky',  label: 'Sneaky Snitch',        url: `${BASE}Sneaky%20Snitch.mp3`        },
  { id: 'hyperfun',label: 'Hyperfun',             url: `${BASE}Hyperfun.mp3`               },
] as const;

export type MyRoomTrackId = typeof MYROOM_TRACKS[number]['id'] | 'off';

export class SoundEngine {
  private static _inst: SoundEngine | null = null;
  static get(): SoundEngine {
    if (!SoundEngine._inst) SoundEngine._inst = new SoundEngine();
    return SoundEngine._inst;
  }

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private ambGain: GainNode | null = null;
  private ambNodes: AudioScheduledSourceNode[] = [];
  private streamEl: HTMLAudioElement | null = null;
  private currentRoom: RoomId | '' = '';
  private footL = true;
  private _sfxVol = 0.65;
  private _ambVol = 0.04;
  private _muted = false;
  private _myRoomTrack: MyRoomTrackId = 'off';

  private constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (typeof s.sfx   === 'number')  this._sfxVol = s.sfx;
      if (typeof s.amb   === 'number')  this._ambVol = s.amb;
      if (typeof s.muted === 'boolean') this._muted  = s.muted;
    } catch {}
    const saved = localStorage.getItem(MYROOM_TRACK_KEY) as MyRoomTrackId | null;
    if (saved === 'off' || MYROOM_TRACKS.some(t => t.id === saved)) this._myRoomTrack = saved!;
  }

  get myRoomTrack(): MyRoomTrackId { return this._myRoomTrack; }

  setMyRoomTrack(id: MyRoomTrackId): void {
    this._myRoomTrack = id;
    localStorage.setItem(MYROOM_TRACK_KEY, id);
    if (this.currentRoom === 'myroom') {
      this._stopStream();
      if (id !== 'off') {
        this._startStream(MYROOM_TRACKS.find(t => t.id === id)!.url);
      }
    }
  }

  /** Apply a track immediately while staying in myroom — used for visitor sync */
  applyMyRoomTrack(id: MyRoomTrackId): void {
    this._myRoomTrack = id;
    if (this.currentRoom === 'myroom') {
      this._stopStream();
      if (id !== 'off') {
        this._startStream(MYROOM_TRACKS.find(t => t.id === id)!.url);
      }
    }
  }

  private _startStream(url: string): void {
    this._stopStream();
    const el = new Audio();
    el.src = url;
    el.loop = true;
    el.volume = this._muted ? 0 : this._ambVol;
    el.play().catch(() => {});
    this.streamEl = el;
  }

  private _stopStream(): void {
    if (this.streamEl) {
      this.streamEl.pause();
      this.streamEl.src = '';
      this.streamEl = null;
    }
  }

  get muted()       { return this._muted; }
  get sfxVolume()   { return this._sfxVol; }
  get ambVolume()   { return this._ambVol; }
  get currentRoomId() { return this.currentRoom; }

  setMuted(v: boolean): void {
    this._muted = v;
    if (this.masterGain) this.masterGain.gain.setTargetAtTime(v ? 0 : 1, this.ac().currentTime, 0.05);
    if (this.streamEl) this.streamEl.volume = v ? 0 : this._ambVol;
    this.save();
  }

  setSfxVolume(v: number): void {
    this._sfxVol = Math.max(0, Math.min(1, v));
    if (this.sfxGain) this.sfxGain.gain.setTargetAtTime(this._sfxVol, this.ac().currentTime, 0.05);
    this.save();
  }

  setAmbVolume(v: number): void {
    this._ambVol = Math.max(0, Math.min(1, v));
    if (this.ambGain) this.ambGain.gain.setTargetAtTime(this._ambVol, this.ac().currentTime, 0.1);
    if (this.streamEl) this.streamEl.volume = this._muted ? 0 : this._ambVol;
    this.save();
  }

  private save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ sfx: this._sfxVol, amb: this._ambVol, muted: this._muted })); } catch {}
  }

  private ac(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this._muted ? 0 : 1;
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this._sfxVol;
      this.sfxGain.connect(this.masterGain);

      this.ambGain = this.ctx.createGain();
      this.ambGain.gain.value = this._ambVol;
      this.ambGain.connect(this.masterGain);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private sfx(): AudioNode { return this.sfxGain  ?? this.ac().destination; }
  private amb(): AudioNode { return this.ambGain   ?? this.ac().destination; }

  // ── Core builders ─────────────────────────────────────────────────────────────

  private osc(freq: number, type: OscillatorType, t: number, dur: number, peak: number, dest: AudioNode): void {
    const ctx = this.ac();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(0.005, dur * 0.1));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private noiseBuf(dur: number): AudioBuffer {
    const ctx = this.ac();
    const n   = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private noiseShot(dur: number, ftype: BiquadFilterType, ffreq: number, fq: number, gain: number, dest: AudioNode, delay = 0): void {
    const ctx = this.ac();
    const t   = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf(dur);
    const f = ctx.createBiquadFilter();
    f.type = ftype; f.frequency.value = ffreq; f.Q.value = fq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t); src.stop(t + dur + 0.01);
  }

  private noiseLoop(dur: number, ftype: BiquadFilterType, ffreq: number, fq: number, gain: number): void {
    const ctx = this.ac();
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf(dur);
    src.loop   = true;
    const f = ctx.createBiquadFilter();
    f.type = ftype; f.frequency.value = ffreq; f.Q.value = fq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.amb());
    src.start();
    this.ambNodes.push(src);
  }

  private oscLoop(freq: number, type: OscillatorType, gain: number): void {
    const ctx = this.ac();
    const o   = ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    o.connect(g); g.connect(this.amb());
    o.start();
    this.ambNodes.push(o);
  }

  /** Oscillator with slow LFO tremolo (gain wobble) and optional vibrato (freq wobble) */
  private oscModLoop(
    freq: number, type: OscillatorType, gain: number,
    tremoloRate: number, tremoloDepth: number,
    vibratoRate = 0, vibratoDepth = 0,
  ): void {
    const ctx = this.ac();
    const o   = ctx.createOscillator();
    o.type = type; o.frequency.value = freq;

    // Tremolo LFO → gain
    const lfoT = ctx.createOscillator();
    lfoT.frequency.value = tremoloRate;
    const lfoTGain = ctx.createGain();
    lfoTGain.gain.value = tremoloDepth;
    lfoT.connect(lfoTGain);

    const g = ctx.createGain();
    g.gain.value = gain;
    lfoTGain.connect(g.gain);

    // Vibrato LFO → frequency
    if (vibratoRate > 0) {
      const lfoV = ctx.createOscillator();
      lfoV.frequency.value = vibratoRate;
      const lfoVGain = ctx.createGain();
      lfoVGain.gain.value = vibratoDepth;
      lfoV.connect(lfoVGain);
      lfoVGain.connect(o.frequency);
      lfoV.start();
      this.ambNodes.push(lfoV);
    }

    o.connect(g); g.connect(this.amb());
    o.start(); lfoT.start();
    this.ambNodes.push(o, lfoT);
  }

  // ── SFX ───────────────────────────────────────────────────────────────────────

  zapSound(): void {
    const ctx = this.ac(); const t = ctx.currentTime; const d = this.sfx();
    // Electric crackle — noise burst with high-freq filter
    this.noiseShot(0.06, 'highpass', 4000, 2.0, 0.18, d);
    this.noiseShot(0.12, 'bandpass', 2200, 1.5, 0.10, d, 0.03);
    // Rising tone ⚡
    this.osc(220, 'sawtooth', t,        0.10, 0.04, d);
    this.osc(440, 'sawtooth', t + 0.04, 0.10, 0.04, d);
    this.osc(880, 'sine',     t + 0.08, 0.12, 0.06, d);
    this.osc(1320,'sine',     t + 0.11, 0.10, 0.05, d);
  }

  chatPing(): void {
    const t = this.ac().currentTime; const d = this.sfx();
    this.osc(880,  'sine', t,        0.13, 0.07, d);
    this.osc(1100, 'sine', t + 0.08, 0.13, 0.055, d);
  }

  dmPing(): void {
    const t = this.ac().currentTime; const d = this.sfx();
    this.osc(660,  'sine', t,        0.11, 0.09, d);
    this.osc(880,  'sine', t + 0.07, 0.13, 0.09, d);
    this.osc(1100, 'sine', t + 0.14, 0.18, 0.11, d);
  }

  roomEnter(): void {
    const ctx = this.ac(); const t = ctx.currentTime; const d = this.sfx();
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf(0.6);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.4);
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    src.connect(f); f.connect(g); g.connect(d);
    src.start(t); src.stop(t + 0.6);
    this.osc(392, 'sine', t + 0.28, 0.32, 0.045, d);
  }

  roomLeave(): void {
    const ctx = this.ac(); const t = ctx.currentTime; const d = this.sfx();
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf(0.5);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(1600, t);
    f.frequency.exponentialRampToValueAtTime(160, t + 0.38);
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    src.connect(f); f.connect(g); g.connect(d);
    src.start(t); src.stop(t + 0.5);
  }

  footstep(): void {
    const ctx = this.ac(); const t = ctx.currentTime; const d = this.sfx();
    const pitch = this.footL ? 180 : 160;
    this.footL = !this.footL;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf(0.055);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = pitch;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f); f.connect(g); g.connect(d);
    src.start(t); src.stop(t + 0.06);
  }

  lighterFlick(): void {
    const d = this.sfx();
    this.noiseShot(0.07,  'highpass', 3500, 1.5, 0.14, d);
    this.noiseShot(0.18,  'bandpass',  900, 1.2, 0.08, d, 0.06);
  }

  coinFlip(): void {
    const ctx = this.ac(); const t = ctx.currentTime; const d = this.sfx();
    for (let i = 0; i < 8; i++) {
      this.osc(700 + Math.random() * 500, 'triangle', t + i * 0.042, 0.038, 0.04, d);
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf(0.12);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 250;
    const g = ctx.createGain();
    const lt = t + 0.37;
    g.gain.setValueAtTime(0.18, lt);
    g.gain.exponentialRampToValueAtTime(0.0001, lt + 0.11);
    src.connect(f); f.connect(g); g.connect(d);
    src.start(lt); src.stop(lt + 0.13);
  }

  slotSpin(): void {
    const t = this.ac().currentTime; const d = this.sfx();
    for (let i = 0; i < 14; i++) {
      this.osc(280 + i * 18, 'square', t + i * 0.045, 0.038, 0.025, d);
    }
  }

  slotJackpot(): void {
    const t = this.ac().currentTime; const d = this.sfx();
    [523, 659, 784, 1047].forEach((f, i) => this.osc(f, 'triangle', t + i * 0.1, 0.28, 0.11, d));
    setTimeout(() => { const t2 = this.ac().currentTime; this.osc(2093, 'sine', t2, 0.45, 0.06, this.sfx()); }, 470);
  }

  slotTwoMatch(): void {
    const t = this.ac().currentTime; const d = this.sfx();
    this.osc(659, 'triangle', t,       0.17, 0.09, d);
    this.osc(784, 'triangle', t + 0.1, 0.21, 0.09, d);
  }

  rpsWin(): void {
    const t = this.ac().currentTime; const d = this.sfx();
    [523, 659, 784].forEach((f, i) => this.osc(f, 'triangle', t + i * 0.08, 0.2, 0.1, d));
  }

  rpsLose(): void {
    const t = this.ac().currentTime; const d = this.sfx();
    [392, 330, 262].forEach((f, i) => this.osc(f, 'triangle', t + i * 0.1, 0.2, 0.08, d));
  }

  rpsTie(): void {
    const t = this.ac().currentTime; const d = this.sfx();
    this.osc(440, 'sine', t,        0.13, 0.07, d);
    this.osc(440, 'sine', t + 0.16, 0.13, 0.07, d);
  }

  // ── Ambient ───────────────────────────────────────────────────────────────────

  setRoom(room: RoomId | ''): void {
    if (room === this.currentRoom) return;
    this._stopAmbient();
    this.currentRoom = room;
    if (!room) return;
    if (room === 'lounge') {
      this._startStream(`${BASE}Backbay%20Lounge.mp3`);
    } else if (room === 'myroom') {
      if (this._myRoomTrack !== 'off') {
        const track = MYROOM_TRACKS.find(t => t.id === this._myRoomTrack)!;
        this._startStream(track.url);
      }
    } else {
      this._startAmbient(room);
    }
  }

  private _stopAmbient(): void {
    this._stopStream();
    this.ambNodes.forEach(n => { try { n.stop(); } catch {} });
    this.ambNodes = [];
  }

  private _startAmbient(room: RoomId): void {
    switch (room) {
      case 'hub':    return this._ambHub();
      case 'relay':  return this._ambRelay();
      case 'feed':   return this._ambFeed();
      case 'market': return this._ambMarket();
    }
  }

  // Hub — night city: deep drone + neon buzz with slow pulse
  private _ambHub(): void {
    this.oscModLoop(45,  'sine', 0.10, 0.08, 0.03);  // deep sub, slow pulse
    this.oscModLoop(55,  'sine', 0.07, 0.11, 0.02);
    this.oscLoop(120, 'sine', 0.022); // neon tube hum
    this.oscLoop(240, 'sine', 0.010);
    this.oscLoop(360, 'sine', 0.005);
  }

  /** Start the boot scene track (Neon Laser Horizon) — call once on first user gesture */
  startBoot(): void {
    this._startStream(`${BASE}Neon%20Laser%20Horizon.mp3`);
  }

  /** Stop boot music when transitioning into the hub */
  stopBoot(): void {
    this._stopStream();
  }

  // Relay — server hum with mechanical wobble
  private _ambRelay(): void {
    this.oscModLoop(55,  'sawtooth', 0.03,  0.25, 0.008);
    this.oscModLoop(110, 'sawtooth', 0.015, 0.33, 0.005);
    this.oscLoop(220, 'square', 0.006);
    this.oscModLoop(82,  'sine',     0.025, 0.18, 0.007);
  }

  // Feed — restless hum, faster modulation
  private _ambFeed(): void {
    this.oscModLoop(65,  'sine', 0.07, 0.20, 0.025);
    this.oscModLoop(130, 'sine', 0.03, 0.15, 0.012);
    this.oscLoop(195, 'sine', 0.012);
  }

  // My Room — quiet, slow breathing tone
  private _ambMyRoom(): void {
    this.oscModLoop(50, 'sine', 0.028, 0.04, 0.012);
    this.oscModLoop(75, 'sine', 0.014, 0.06, 0.008);
  }

  // Market — layered drone, medium energy
  private _ambMarket(): void {
    this.oscModLoop(55,  'sine', 0.09, 0.12, 0.03);
    this.oscModLoop(110, 'sine', 0.04, 0.09, 0.015);
    this.oscLoop(165, 'sine', 0.018);
    this.oscLoop(220, 'sine', 0.009);
  }
}

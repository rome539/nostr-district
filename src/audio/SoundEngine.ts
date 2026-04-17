/**
 * SoundEngine.ts — Web Audio API synthesis. No external files needed.
 * Singleton — call SoundEngine.get() anywhere.
 */

export type RoomId = 'hub' | 'lounge' | 'relay' | 'feed' | 'myroom' | 'market' | 'woods' | 'cabin' | 'alley';

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
  private _loopEl: HTMLAudioElement | null = null;
  private _loopVol = 1.0;
  private bufferSrc: AudioBufferSourceNode | null = null;
  private _xfadeNodes: Array<{ src: AudioBufferSourceNode; gain: GainNode }> = [];
  private _loopTimer: ReturnType<typeof setTimeout> | null = null;
  private currentRoom: RoomId | '' = '';
  private footL = true;
  private _sfxVol = 0.65;
  private _ambVol = 0.04;
  private _muted = false;
  private _myRoomTrack: MyRoomTrackId = 'off';
  private _audioUnlocked = false;
  // Room to restart after the AudioContext unlocks (set when setRoom is called while context is suspended)
  private _pendingRoomRestart: RoomId | null = null;
  // Decoded buffer cached while waiting for the AudioContext to unlock.
  // Avoids a second fetch when the context finally becomes 'running'.
  private _pendingBuffer: AudioBuffer | null = null;
  private _pendingBufferLoopAt: number | undefined;
  private _pendingBufferGainMult = 1.0;
  // AbortController for the in-flight _startStreamGapless fetch — cancelled
  // when a new fetch is started so stale callbacks can't cause double-play.
  private _fetchAbort: AbortController | null = null;
  // Silent looping source that keeps the AudioContext from being auto-suspended by iOS
  private _keepAliveNode: AudioBufferSourceNode | null = null;
  // Persistent looping HTML Audio element that keeps the iOS audio session alive.
  // Without this, iOS Safari throttles/silences Web Audio output (both ambient buffers
  // and oscillator SFX) in scenes that don't already have an HTML Audio element playing.
  // Woods works by accident because it starts cabin-fire.m4a at volume 0 for the
  // approach-the-cabin crossfade; hub and alley have nothing, so Web Audio goes silent.
  private _sessionKeeper: HTMLAudioElement | null = null;

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

  get audioUnlocked(): boolean { return this._audioUnlocked; }

  /**
   * Call from every user-gesture handler until audioUnlocked is true.
   * Does NOT guard on _audioUnlocked — touchstart can fail silently on iOS
   * so we keep retrying on every gesture (touchend, click, pointerdown) until
   * ctx.state confirms 'running'.
   */
  unlock(): void {
    const ctx = this.ac(); // create context now while inside a gesture handler
    this._dbg(`unlock() state=${ctx.state}`);
    this._startSessionKeeper();

    // Play a 1-sample silent buffer — required to properly unlock iOS AudioContext.
    // ctx.resume() alone is sometimes rejected silently on iOS Safari; starting
    // an actual AudioBufferSourceNode inside the gesture handler is more reliable.
    try {
      const silentBuf = ctx.createBuffer(1, 1, ctx.sampleRate);
      const silentSrc = ctx.createBufferSource();
      silentSrc.buffer = silentBuf;
      silentSrc.connect(ctx.destination);
      silentSrc.start(0);
    } catch {}

    if (ctx.state === 'suspended') {
      // The statechange listener on the AudioContext handles the 'running' transition
      // reliably. ctx.resume().then() is also called as a nudge, but we do NOT check
      // ctx.state inside the .then() — on iOS Safari the promise can resolve before
      // the state actually flips, causing onContextRunning to be skipped entirely.
      ctx.resume().then(() => this._dbg(`resume() resolved state=${ctx.state}`)).catch((e) => this._dbg(`resume() rejected: ${e?.message || e}`));
    } else if (ctx.state === 'running') {
      this._onContextRunning();
    }
  }

  /**
   * Start a permanent looping silent HTML Audio element so iOS keeps the audio
   * session active. Must be called from a user-gesture stack so .play() resolves.
   * Idempotent — subsequent calls retry play() on the existing element if it was
   * paused (iOS may pause it after backgrounding).
   */
  private _startSessionKeeper(): void {
    if (!this._sessionKeeper) {
      const el = new Audio('/assets/audio/silent.wav');
      el.disableRemotePlayback = true;
      el.loop = true;
      el.volume = 0;
      this._sessionKeeper = el;
    }
    if (this._sessionKeeper.paused) {
      this._sessionKeeper.play().then(
        () => this._dbg('sessionKeeper playing'),
        (e) => this._dbg(`sessionKeeper play rejected: ${e?.message || e}`),
      );
    }
  }

  // ── On-screen debug HUD (toggle with /audio debug in chat, or ?audioDebug=1) ──
  private _dbgEl: HTMLDivElement | null = null;
  private _dbgLines: string[] = [];
  private _dbgEnabled = false;
  enableDebugHud(): void {
    if (this._dbgEnabled) return;
    this._dbgEnabled = true;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:4px;left:4px;z-index:99999;background:rgba(0,0,0,0.75);color:#0f0;font:10px/1.2 monospace;padding:4px 6px;max-width:60vw;pointer-events:none;white-space:pre;border:1px solid #0a0;border-radius:3px;';
    document.body.appendChild(el);
    this._dbgEl = el;
    this._dbg('HUD enabled');
    setInterval(() => this._dbgRefresh(), 500);
  }
  private _dbg(msg: string): void {
    if (!this._dbgEnabled) return;
    const ts = new Date().toTimeString().slice(0, 8);
    this._dbgLines.push(`${ts} ${msg}`);
    if (this._dbgLines.length > 8) this._dbgLines.shift();
    this._dbgRefresh();
  }
  private _dbgRefresh(): void {
    if (!this._dbgEl) return;
    const state = this.ctx?.state ?? 'no-ctx';
    const head = `ctx=${state} unlocked=${this._audioUnlocked} room=${this.currentRoom || '-'}\npending=${this._pendingRoomRestart || '-'} keepAlive=${!!this._keepAliveNode}\n`;
    this._dbgEl.textContent = head + this._dbgLines.join('\n');
  }

  /**
   * Called whenever the AudioContext transitions to 'running' — either via the
   * statechange event listener (primary path, reliable on iOS) or directly from
   * unlock() when the context is already running. Idempotent: safe to call many times.
   */
  private _onContextRunning(): void {
    this._dbg(`_onContextRunning pending=${this._pendingRoomRestart || '-'} hasBuf=${!!this._pendingBuffer}`);
    this._audioUnlocked = true;
    // Keep-alive: loop a 1-second non-silent buffer so iOS never auto-suspends the
    // AudioContext. A zero-sample buffer is detected as silence and doesn't help;
    // a 1 Hz sine at -100 dB (amplitude 1e-5) keeps the scheduler ticking.
    if (!this._keepAliveNode && this.ctx) {
      try {
        const ctx = this.ctx;
        const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          data[i] = Math.sin(2 * Math.PI * i / ctx.sampleRate) * 1e-5;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(ctx.destination);
        src.start();
        this._keepAliveNode = src;
      } catch {}
    }
    // Retry the session keeper in case its initial play() was blocked.
    this._startSessionKeeper();
    // Retry HTML audio elements that had their .play() blocked (cabin, lounge, myroom).
    if (this.streamEl?.paused) this.streamEl.play().catch(() => {});
    if (this._loopEl?.paused)  this._loopEl.play().catch(() => {});
    // Restart Web Audio ambient (hub, alley, woods) that was set up while the context
    // was suspended. If the buffer was already decoded, use it directly without
    // re-fetching. Otherwise re-trigger setRoom which starts a fresh fetch.
    if (this._pendingRoomRestart) {
      const room = this._pendingRoomRestart;
      const buf  = this._pendingBuffer;
      const loopAt   = this._pendingBufferLoopAt;
      const gainMult = this._pendingBufferGainMult;
      this._pendingRoomRestart = null;
      this._pendingBuffer = null;
      this._pendingBufferLoopAt = undefined;
      this._pendingBufferGainMult = 1.0;
      if (buf) {
        // Buffer is already decoded — start the crossfade loop immediately.
        // currentRoom is already set to `room` from the original setRoom() call.
        this._startCrossfadeLoop(buf, loopAt, gainMult);
      } else {
        // Fetch hadn't completed yet when the context unlocked — re-trigger.
        this.currentRoom = ''; // reset so setRoom() won't bail on the equality check
        this.setRoom(room);
      }
    }
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
    el.disableRemotePlayback = true;
    el.src = url;
    el.loop = true;
    el.volume = this._muted ? 0 : this._ambVol;
    el.play().catch(() => {});
    this.streamEl = el;
  }

  /** Gapless loop via Web Audio buffer — avoids MP3 encoder padding gap.
   *  loopAt: seconds into the track to start the crossfade (default: auto). */
  private _startStreamGapless(url: string, forRoom: RoomId, loopAt?: number, gainMult = 1.0): void {
    this._stopStream();
    // Cancel any previous in-flight fetch for this room so its callback can't
    // race and cause double-play if a second _startStreamGapless call is made.
    if (this._fetchAbort) { this._fetchAbort.abort(); }
    this._fetchAbort = new AbortController();
    const signal = this._fetchAbort.signal;
    const ctx = this.ac();
    fetch(url, { signal })
      .then(r => r.arrayBuffer())
      .then(ab => ctx.decodeAudioData(ab))
      .then(buf => {
        if (this.currentRoom !== forRoom) return;
        if (ctx.state !== 'running') {
          // Context is still suspended — cache the decoded buffer so _onContextRunning
          // can start playback immediately without a second fetch round-trip.
          this._pendingRoomRestart = forRoom;
          this._pendingBuffer = buf;
          this._pendingBufferLoopAt = loopAt;
          this._pendingBufferGainMult = gainMult;
          return;
        }
        this._startCrossfadeLoop(buf, loopAt, gainMult);
      })
      .catch((e) => {
        if (e?.name !== 'AbortError') console.warn('[SoundEngine] decode failed for', url, e);
      });
  }

  /** Crossfade loop — each node loops internally (loop=true) and a new instance
   *  fades in while the previous fades out, making the repeat point inaudible.
   *  loopAt: seconds at which to start the crossfade (defaults to near end of buffer). */
  private _startCrossfadeLoop(buf: AudioBuffer, loopAt?: number, gainMult = 1.0): void {
    const ctx = this.ac();
    const xfade = Math.min(2, buf.duration * 0.4); // crossfade ≤ 40% of track, max 2s
    const interval = loopAt ?? (buf.duration - xfade); // when to start the next layer

    const play = () => {
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = buf;
      src.loop = true; // sustains indefinitely — we stop it manually after fade-out
      src.connect(gain);
      gain.connect(this.amb());

      // Fade in over xfade seconds
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(gainMult, now + xfade);
      src.start(now);

      // Fade out and release the previous node
      if (this._xfadeNodes.length > 0) {
        const prev = this._xfadeNodes[this._xfadeNodes.length - 1];
        prev.gain.gain.cancelScheduledValues(now);
        prev.gain.gain.setValueAtTime(gainMult, now);
        prev.gain.gain.linearRampToValueAtTime(0, now + xfade);
        const ref = prev;
        setTimeout(() => {
          try { ref.src.stop(); } catch {}
          try { ref.src.disconnect(); } catch {}
          try { ref.gain.disconnect(); } catch {}
          this._xfadeNodes = this._xfadeNodes.filter(n => n !== ref);
        }, (xfade + 0.3) * 1000);
      }

      this._xfadeNodes.push({ src, gain });
      this.bufferSrc = src;

      // Schedule the next crossfade
      this._loopTimer = setTimeout(play, interval * 1000);
    };

    play();
  }

  private _stopBufferSrc(): void {
    if (this._loopTimer !== null) { clearTimeout(this._loopTimer); this._loopTimer = null; }
    this._xfadeNodes.forEach(({ src, gain }) => {
      try { src.stop(); } catch {}
      try { src.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
    });
    this._xfadeNodes = [];
    if (this.bufferSrc) {
      try { this.bufferSrc.stop(); } catch {}
      try { this.bufferSrc.disconnect(); } catch {}
      this.bufferSrc = null;
    }
  }

  private _stopStream(): void {
    this._stopBufferSrc();
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
    if (this._loopEl) this._loopEl.volume = v ? 0 : Math.min(1, this._ambVol * this._loopVol);
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
    if (this._loopEl) this._loopEl.volume = this._muted ? 0 : Math.min(1, this._ambVol * this._loopVol);
    this.save();
  }

  private save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ sfx: this._sfxVol, amb: this._ambVol, muted: this._muted })); } catch {}
  }

  private ac(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();

      // Reliable unlock detection: statechange fires when the context actually
      // transitions to 'running', even on iOS Safari where ctx.resume()'s promise
      // can resolve before the state is truly updated.
      this.ctx.addEventListener('statechange', () => {
        if (this.ctx?.state === 'running') this._onContextRunning();
      });

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
    if (this.ctx.state === 'suspended') {
      // Only resume inside a gesture handler — outside one this is a no-op on mobile.
      // The unlock() method is the proper place for gesture-triggered resume.
      this.ctx.resume().catch(() => {});
    } else if (this.ctx.state === 'running') {
      this._audioUnlocked = true;
    }
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

  // Decoded SFX buffers cached by URL. Web Audio buffer sources give us precise
  // timing (no HTMLAudioElement play() startup delay) and are not subject to iOS's
  // "only one HTMLAudioElement at a time" throttling, which was making tarot/fortune
  // SFX only play once per session.
  private _fileBufCache = new Map<string, Promise<AudioBuffer>>();
  private _fileSrcs: Array<{ src: AudioBufferSourceNode; gain: GainNode }> = [];
  private _fileEpoch = 0;

  private _loadFileBuf(path: string): Promise<AudioBuffer> {
    let p = this._fileBufCache.get(path);
    if (!p) {
      const ctx = this.ac();
      p = fetch(path)
        .then((r) => r.arrayBuffer())
        .then((ab) => ctx.decodeAudioData(ab));
      this._fileBufCache.set(path, p);
      p.catch((e) => {
        this._fileBufCache.delete(path);
        if (e?.name !== 'AbortError') console.warn('[SoundEngine] file decode failed for', path, e);
      });
    }
    return p;
  }

  private _playFile(path: string, volume = 1.0, startAt = 0, stopAfterMs = 0): void {
    const epoch = this._fileEpoch;
    this._loadFileBuf(path).then(async (buf) => {
      if (epoch !== this._fileEpoch) return;
      const ctx = this.ac();
      if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch {}
      }
      if (ctx.state !== 'running') return;
      if (epoch !== this._fileEpoch) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = Math.min(1, volume);
      src.connect(gain);
      gain.connect(this.sfx());

      const entry = { src, gain };
      this._fileSrcs.push(entry);
      src.onended = () => {
        try { src.disconnect(); } catch {}
        try { gain.disconnect(); } catch {}
        this._fileSrcs = this._fileSrcs.filter((e) => e !== entry);
      };

      const offset = Math.max(0, startAt);
      src.start(0, offset);
      if (stopAfterMs > 0) {
        const stopIn = Math.min(stopAfterMs / 1000, Math.max(0, buf.duration - offset));
        src.stop(ctx.currentTime + stopIn);
      }
    }).catch(() => {});
  }

  stopFileSounds(): void {
    this._fileEpoch++;
    this._fileSrcs.forEach(({ src, gain }) => {
      try { src.stop(); } catch {}
      try { src.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
    });
    this._fileSrcs = [];
  }

  tarotCardFlip(): void {
    this._playFile('/assets/audio/214034__hubsons__flipping-cards.wav', 1.0, 30, 10000);
  }

  fortuneTellerReveal(): void {
    this._playFile('/assets/audio/584244__smokinghotdog__magic-stars-retro-sparkle.wav', 0.15);
  }

  stokeFireplace(): void {
    const d = this.sfx();
    // Crackling pops
    this.noiseShot(0.16, 'bandpass', 600, 2.0, 0.09, d, 0);
    this.noiseShot(0.20, 'bandpass', 500, 2.5, 0.11, d, 0.05);
    this.noiseShot(0.14, 'bandpass', 720, 3.0, 0.07, d, 0.10);
    this.noiseShot(0.12, 'bandpass', 460, 2.0, 0.08, d, 0.16);
    this.noiseShot(0.10, 'bandpass', 840, 3.0, 0.06, d, 0.22);
    // Low warm whoosh
    this.noiseShot(0.10, 'lowpass', 280, 1.0, 0.40, d, 0);
  }

  roomRequest(): void {
    const t = this.ac().currentTime; const d = this.sfx();
    // Knock — low thud pair
    this.noiseShot(0.06, 'lowpass', 280, 1.0, 0.18, d, 0);
    this.noiseShot(0.06, 'lowpass', 280, 1.0, 0.14, d, 0.14);
    // Bell shimmer on top
    this.osc(1047, 'sine', t + 0.01,  0.22, 0.10, d);
    this.osc(1319, 'sine', t + 0.015, 0.20, 0.07, d);
    this.osc(1047, 'sine', t + 0.15,  0.18, 0.10, d);
    this.osc(1319, 'sine', t + 0.155, 0.17, 0.07, d);
  }

  // ── Ambient ───────────────────────────────────────────────────────────────────

  setRoom(room: RoomId | ''): void {
    this._dbg(`setRoom(${room}) ctx=${this.ctx?.state ?? 'none'}`);
    if (room === this.currentRoom) return;
    this._stopAmbient();
    // Clear all pending state from the previous room so a stale restart or
    // cached buffer can't trigger audio for the wrong room after a room change.
    this._pendingRoomRestart = null;
    this._pendingBuffer = null;
    this._pendingBufferLoopAt = undefined;
    this._pendingBufferGainMult = 1.0;
    this.currentRoom = room;
    if (!room) return;
    if (room === 'hub') {
      this._startStreamGapless('/assets/audio/hub-ambient.m4a', 'hub');
    } else if (room === 'woods') {
      this._startStreamGapless('/assets/audio/woods-night.mp3', 'woods');
      this._startLoopEl('/assets/audio/cabin-fire.m4a', 2.5);
      if (this._loopEl) this._loopEl.volume = 0;
    } else if (room === 'cabin') {
      // Use HTML Audio — more reliable than Web Audio on iOS Safari
      this._startStream('/assets/audio/cabin-fire.m4a');
    } else if (room === 'alley') {
      this._startStreamGapless('/assets/audio/rain-alley.m4a', 'alley');
    } else if (room === 'lounge') {
      this._startStream(`${BASE}Backbay%20Lounge.mp3`);
    } else if (room === 'myroom') {
      if (this._myRoomTrack !== 'off') {
        const track = MYROOM_TRACKS.find(t => t.id === this._myRoomTrack)!;
        this._startStream(track.url);
      }
    } else {
      this._startAmbient(room);
    }

    // If the AudioContext isn't running yet (mobile browsers start it suspended),
    // mark this room so _onContextRunning() can restart the ambient once it resumes.
    // HTML-audio rooms (lounge, myroom, cabin) are retried via streamEl/loopEl in
    // _onContextRunning — Web Audio rooms (hub, alley, woods, oscillator rooms) need
    // the pending restart path.
    const usesWebAudio = room !== 'lounge' && room !== 'myroom' && room !== 'cabin';
    if (usesWebAudio && this.ctx && this.ctx.state !== 'running') {
      this._pendingRoomRestart = room;
    }
  }

  private _startLoopEl(url: string, volume: number): void {
    if (this._loopEl) { this._loopEl.pause(); this._loopEl.src = ''; this._loopEl = null; }
    this._loopVol = volume;
    const el = new Audio(url);
    el.disableRemotePlayback = true;
    el.loop = true;
    el.volume = this._muted ? 0 : Math.min(1, this._ambVol * volume);
    el.play().catch(() => {});
    this._loopEl = el;
  }

  private _stopLoopEl(): void {
    if (this._loopEl) { this._loopEl.pause(); this._loopEl.src = ''; this._loopEl = null; }
  }

  setLoopElVolume(t: number): void {
    if (this._loopEl) this._loopEl.volume = this._muted ? 0 : Math.min(1, this._ambVol * this._loopVol * t);
  }

  private _stopAmbient(): void {
    this._stopStream();
    this._stopLoopEl();
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

import { P } from '../config/game.config';

interface LoginBuilding {
  x: number; y: number; w: number; h: number; shade: string;
  windows: { x: number; y: number; flicker: number }[];
  sign?: { y: number; w: number; hue: 'accent' | 'purp' | 'pink' };
  far: boolean;
}

interface Star {
  x: number; y: number; r: number; base: number; speed: number; color: string;
}

interface ShootingStar {
  startX: number; startY: number;
  vx: number; vy: number;
  startTime: number; duration: number;
}

export class LoginScreen {
  private container: HTMLDivElement;
  private onExtensionLogin: () => void;
  private onNsecLogin: (nsec: string) => void;
  private onGuestLogin: () => void;
  private onBunkerLogin: (url: string) => void;
  private onBunkerClientFlow: (() => void) | null = null;
  private onBunkerCancel: (() => void) | null = null;

  private canvas: HTMLCanvasElement | null = null;
  private animFrameId: number | null = null;
  private buildings: LoginBuilding[] = [];
  private stars: Star[] = [];
  private shootingStar: ShootingStar | null = null;
  private shootingStarNext = 0;
  // 0=new, 0.25=first quarter, 0.5=full, 0.75=last quarter — random each session
  private handleResize = (): void => {
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.generateBuildings();
  };

  constructor(callbacks: {
    onExtensionLogin: () => void;
    onNsecLogin: (nsec: string) => void;
    onGuestLogin: () => void;
    onBunkerLogin: (url: string) => void;
    onBunkerClientFlow?: () => void;
    onBunkerCancel?: () => void;
  }) {
    this.onExtensionLogin = callbacks.onExtensionLogin;
    this.onNsecLogin = callbacks.onNsecLogin;
    this.onGuestLogin = callbacks.onGuestLogin;
    this.onBunkerLogin = callbacks.onBunkerLogin;
    this.onBunkerClientFlow = callbacks.onBunkerClientFlow || null;
    this.onBunkerCancel = callbacks.onBunkerCancel || null;

    this.container = document.createElement('div');
    this.container.id = 'login-screen';
    this.container.innerHTML = this.getHTML();
    this.applyStyles();
    document.body.appendChild(this.container);
    this.bindEvents();
    this.initSkyline();
  }

  // ─── HTML ──────────────────────────────────────────────────────────────────

  private getHTML(): string {
    return `
      <canvas id="login-canvas"></canvas>
      <div class="login-box">
        <h1 class="login-title">NOSTR DISTRICT</h1>
        <p class="login-subtitle">a pixel art social world</p>

        <div id="login-main" class="login-methods">
          <button id="login-bunker" class="login-btn login-btn-primary">
            <span class="btn-label">Connect with Nostr</span>
            <span class="btn-sub">NIP-46 Remote Signer — Recommended</span>
          </button>

          <button id="login-extension" class="login-btn login-btn-secondary">
            <span class="btn-label">Browser Extension</span>
            <span class="btn-sub">Alby, nos2x, or similar</span>
          </button>

          <div class="login-divider"></div>

          <div id="nsec-section" class="nsec-section">
            <button id="nsec-toggle" class="login-link">Use private key instead</button>
            <div id="nsec-form" class="nsec-form hidden">
              <div class="nsec-warning">
                <label class="warning-check">
                  <input type="checkbox" id="nsec-accept">
                  <span>I understand my key will be held in memory. This is less secure than the options above.</span>
                </label>
              </div>
              <div id="nsec-input-wrap" class="nsec-input-wrap hidden">
                <input type="password" id="nsec-input" placeholder="nsec1..." class="nsec-input" autocomplete="off" spellcheck="false">
                <button id="nsec-submit" class="login-btn login-btn-nsec">Login</button>
              </div>
            </div>
          </div>

          <div class="login-divider"></div>

          <button id="login-guest" class="login-link guest-link">Just look around (guest mode)</button>
        </div>

        <div id="login-bunker-view" class="hidden">
          <p class="bunker-instruction">Scan with your signer app</p>
          <p class="bunker-apps">Primal, Amber, nsec.app</p>

          <div id="bunker-qr" class="bunker-qr">
            <div class="bunker-qr-loading">Generating...</div>
          </div>

          <div id="bunker-uri-display" class="bunker-uri-row hidden">
            <div id="bunker-uri-text" class="bunker-uri-text"></div>
            <button id="bunker-uri-copy" class="bunker-uri-copy">Copy</button>
          </div>

          <div id="bunker-status" class="bunker-status">Waiting for signer approval...</div>

          <div class="bunker-or">
            <span class="bunker-or-line"></span>
            <span class="bunker-or-text">or paste a bunker:// URL</span>
            <span class="bunker-or-line"></span>
          </div>

          <div class="bunker-url-row">
            <input type="text" id="bunker-input" placeholder="bunker://..." class="bunker-url-input" autocomplete="off">
            <button id="bunker-url-submit" class="bunker-url-btn">Go</button>
          </div>

          <button id="bunker-cancel" class="login-link bunker-cancel">\u2190 Back</button>
        </div>

        <div id="login-status" class="login-status"></div>
      </div>
    `;
  }

  // ─── Styles ────────────────────────────────────────────────────────────────

  private applyStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      #login-screen {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: var(--nd-bg);
        display: flex; align-items: center; justify-content: center;
        z-index: 9999; font-family: 'Courier New', monospace; overflow-y: auto;
      }
      #login-canvas {
        position: fixed; inset: 0; width: 100%; height: 100%;
        pointer-events: none;
      }
      .login-box {
        position: relative; z-index: 1;
        width: min(440px, 96vw); padding: clamp(16px, 5vw, 36px); text-align: center;
        background: color-mix(in srgb, var(--nd-bg) 82%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-dpurp) 40%, transparent);
        border-radius: 12px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.6), 0 0 60px color-mix(in srgb, var(--nd-accent) 6%, transparent);
        backdrop-filter: blur(6px);
      }
      .login-title {
        font-size: 32px; color: var(--nd-accent);
        margin: 0 0 6px 0; letter-spacing: 3px;
        text-shadow: 0 0 20px color-mix(in srgb, var(--nd-accent) 50%, transparent);
      }
      .login-subtitle {
        font-size: 13px; color: var(--nd-subtext); opacity: 0.6; margin: 0 0 32px 0;
      }
      .login-methods { display: flex; flex-direction: column; gap: 12px; }
      .login-btn {
        display: block; width: 100%; padding: 14px 18px;
        border: none; border-radius: 6px; cursor: pointer;
        font-family: 'Courier New', monospace; text-align: left;
        transition: opacity 0.15s, box-shadow 0.15s;
      }
      .login-btn:hover {
        opacity: 0.85;
        box-shadow: 0 0 12px color-mix(in srgb, var(--nd-accent) 20%, transparent);
      }
      .login-btn-primary {
        background: var(--nd-purp); color: #fff;
      }
      .login-btn-secondary {
        background: var(--nd-navy); color: var(--nd-subtext);
        border: 1px solid var(--nd-dpurp);
      }
      .login-btn-nsec {
        background: var(--nd-navy); color: #f0b040;
        border: 1px solid var(--nd-dpurp); padding: 10px 18px; text-align: center;
      }
      .btn-label { display: block; font-size: 14px; font-weight: bold; }
      .btn-sub { display: block; font-size: 11px; opacity: 0.6; margin-top: 3px; }
      .login-divider {
        height: 1px; background: var(--nd-dpurp); opacity: 0.3; margin: 6px 0;
      }
      .login-link {
        background: none; border: none; color: var(--nd-subtext);
        font-family: 'Courier New', monospace; font-size: 13px;
        cursor: pointer; padding: 8px; transition: color 0.15s;
      }
      .login-link:hover { color: var(--nd-accent); }
      .guest-link { color: var(--nd-subtext); font-size: 12px; }
      .nsec-section { text-align: left; }
      .nsec-form { margin-top: 10px; }
      .nsec-warning {
        background: rgba(240,176,64,0.08); border: 1px solid rgba(240,176,64,0.2);
        border-radius: 4px; padding: 10px 12px; margin-bottom: 10px;
      }
      .warning-check {
        display: flex; align-items: flex-start; gap: 8px;
        font-size: 12px; color: #f0b040; cursor: pointer;
      }
      .warning-check input { margin-top: 2px; }
      .nsec-input-wrap { display: flex; gap: 6px; }
      .nsec-input {
        flex: 1; background: var(--nd-navy);
        border: 1px solid var(--nd-dpurp); border-radius: 4px;
        color: var(--nd-text); font-family: 'Courier New', monospace;
        font-size: 13px; padding: 10px; outline: none;
      }
      .nsec-input:focus { border-color: color-mix(in srgb, var(--nd-accent) 55%, transparent); }
      .nsec-input::placeholder { color: var(--nd-dpurp); }
      .hidden { display: none !important; }
      .login-status { margin-top: 18px; font-size: 12px; color: var(--nd-accent); min-height: 18px; }
      .login-status.error { color: #e85454; }

      .bunker-instruction {
        font-size: 18px; color: var(--nd-text); font-weight: bold; margin: 0 0 4px 0;
      }
      .bunker-apps {
        font-size: 13px; color: var(--nd-subtext); opacity: 0.6; margin: 0 0 20px 0;
      }
      .bunker-qr {
        display: flex; justify-content: center; align-items: center;
        margin: 0 auto 20px; min-height: 260px;
      }
      .bunker-qr-loading { color: var(--nd-subtext); opacity: 0.6; font-size: 14px; }
      .bunker-uri-row {
        display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
        background: color-mix(in srgb, var(--nd-bg) 80%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-dpurp) 20%, transparent);
        border-radius: 6px; padding: 10px 12px;
      }
      .bunker-uri-text {
        flex: 1; font-size: 12px; color: var(--nd-subtext); opacity: 0.7;
        word-break: break-all; max-height: 44px; overflow: hidden;
        text-align: left; line-height: 1.4;
      }
      .bunker-uri-copy {
        background: color-mix(in srgb, var(--nd-accent) 13%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-accent) 27%, transparent);
        border-radius: 4px; color: var(--nd-accent);
        font-family: 'Courier New', monospace; font-size: 13px;
        padding: 6px 14px; cursor: pointer; white-space: nowrap;
      }
      .bunker-uri-copy:hover { background: color-mix(in srgb, var(--nd-accent) 20%, transparent); }
      .bunker-status { color: var(--nd-accent); font-size: 14px; margin-bottom: 18px; min-height: 18px; }
      .bunker-or { display: flex; align-items: center; gap: 10px; margin: 0 0 14px 0; }
      .bunker-or-line { flex: 1; height: 1px; background: color-mix(in srgb, var(--nd-dpurp) 20%, transparent); }
      .bunker-or-text { font-size: 12px; color: var(--nd-subtext); opacity: 0.5; white-space: nowrap; }
      .bunker-url-row { display: flex; gap: 8px; margin-bottom: 14px; }
      .bunker-url-input {
        flex: 1; background: color-mix(in srgb, var(--nd-bg) 80%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-dpurp) 27%, transparent);
        border-radius: 6px; color: var(--nd-text);
        font-family: 'Courier New', monospace; font-size: 14px;
        padding: 12px 14px; outline: none; box-sizing: border-box;
      }
      .bunker-url-input::placeholder { color: color-mix(in srgb, var(--nd-subtext) 33%, transparent); }
      .bunker-url-input:focus { border-color: color-mix(in srgb, var(--nd-accent) 33%, transparent); }
      .bunker-url-btn {
        background: var(--nd-purp); border: none; border-radius: 6px;
        color: #fff; font-family: 'Courier New', monospace;
        font-size: 14px; font-weight: bold; padding: 12px 20px;
        cursor: pointer; transition: opacity 0.15s;
      }
      .bunker-url-btn:hover { opacity: 0.85; }
      .bunker-cancel { font-size: 14px; color: var(--nd-subtext); margin-top: 6px; }
    `;
    document.head.appendChild(style);
  }

  // ─── Skyline ───────────────────────────────────────────────────────────────

  private initSkyline(): void {
    this.canvas = this.container.querySelector('#login-canvas') as HTMLCanvasElement;
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.generateBuildings();
    window.addEventListener('resize', this.handleResize);
    const loop = (time: number) => {
      this.drawFrame(time);
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private generateBuildings(): void {
    const W = this.canvas!.width;
    const H = this.canvas!.height;
    // Push buildings to bottom 20% — gives "distant skyline" feel
    const groundY = Math.floor(H * 0.82);
    this.buildings = [];
    this.stars = [];

    // Deterministic LCG so buildings/stars don't change between frames
    let seed = 99991;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };

    // Stars — scattered across upper 75% of screen
    // Palette: mostly white/cream, occasional colored (teal, purple, amber, pink)
    const starPalette = [
      '#ffffff', '#ffffff', '#ffffff',
      '#fff5e6', '#fff5e6',
      '#b8a8f8',
      '#5dcaa5',
      '#f0b040',
      '#ff71ce',
      '#7b68ee',
    ];
    const starCount = Math.floor(W * H / 3000);
    for (let i = 0; i < starCount; i++) {
      this.stars.push({
        x: rand() * W,
        y: rand() * H * 0.75,
        r: 0.3 + rand() * 1.1,
        base: 0.3 + rand() * 0.7,
        speed: 0.3 + rand() * 1.2,
        color: starPalette[Math.floor(rand() * starPalette.length)],
      });
    }

    // Far layer — very small, very dark silhouettes
    let x = -20;
    while (x < W + 20) {
      const w = 10 + rand() * 40;
      const h = 18 + rand() * (groundY * 0.22);
      const shade = (['#02010a', '#04020e', '#030110', '#020108'] as const)[Math.floor(rand() * 4)];
      this.buildings.push({ x, y: groundY - h, w, h, shade, windows: [], far: true });
      x += w + 1 + rand() * 8;
    }

    // Near layer — still small (distant), with sparse windows and rare signs
    seed = 77773;
    x = -30;
    while (x < W + 30) {
      const w = 18 + rand() * 70;
      const h = 40 + rand() * (groundY * 0.42);
      const shade = (['#04030e', '#06051a', '#07061a', '#050416'] as const)[Math.floor(rand() * 4)];

      const windows: LoginBuilding['windows'] = [];
      const floors = Math.floor(h / 16);
      const cols = Math.floor(w / 13);
      for (let f = 1; f < floors - 1; f++) {
        for (let c = 0; c < cols - 1; c++) {
          if (rand() > 0.28) continue; // sparse windows for distance feel
          windows.push({
            x: x + 4 + c * 13,
            y: groundY - h + 10 + f * 16,
            flicker: rand() * Math.PI * 2,
          });
        }
      }

      let sign: LoginBuilding['sign'] | undefined;
      if (rand() > 0.82 && w > 30) { // rare signs at distance
        sign = {
          y: groundY - h + 10 + rand() * (h * 0.3),
          w: 8 + rand() * 22,
          hue: (['accent', 'purp', 'pink'] as const)[Math.floor(rand() * 3)],
        };
      }

      this.buildings.push({ x, y: groundY - h, w, h, shade, windows, sign, far: false });
      x += w + 2 + rand() * 18;
    }
  }

  private drawFrame(time: number): void {
    const canvas = this.canvas!;
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d')!;
    const t = time * 0.001;

    // Theme accent only for tiny neon signs — everything else is fixed night colors
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--nd-accent').trim() || '#5dcaa5';
    const pink = '#ff71ce';
    const purp = '#7b68ee';

    const groundY = Math.floor(H * 0.82);

    ctx.clearRect(0, 0, W, H);

    // ── Fixed starry night sky ──────────────────────────────────────────────
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0,   '#01000a');
    sky.addColorStop(0.4, '#03010f');
    sky.addColorStop(0.75,'#060218');
    sky.addColorStop(1,   '#0a0320');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Stars — each with its own color
    for (const s of this.stars) {
      const twinkle = s.base + Math.sin(t * s.speed + s.x * 0.05) * (1 - s.base) * 0.6;
      ctx.globalAlpha = twinkle;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── Shooting star ────────────────────────────────────────────────────────
    if (!this.shootingStar && time >= this.shootingStarNext) {
      // Angle: 15–35° — mostly horizontal so it reads as a shooting star, not a meteor
      const angle = (Math.PI / 12) + Math.random() * (Math.PI / 9);
      const speed = 420 + Math.random() * 260; // px/s
      this.shootingStar = {
        startX: W * 0.05 + Math.random() * W * 0.5,
        startY: H * 0.03 + Math.random() * H * 0.2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        startTime: time,
        duration: 500 + Math.random() * 400,
      };
      this.shootingStarNext = time + 8000 + Math.random() * 12000;
    }
    if (this.shootingStar) {
      const ss = this.shootingStar;
      const elapsed = time - ss.startTime;
      const progress = elapsed / ss.duration;
      if (progress >= 1) {
        this.shootingStar = null;
      } else {
        const cx = ss.startX + ss.vx * (elapsed / 1000);
        const cy = ss.startY + ss.vy * (elapsed / 1000);

        // Fade in first 15%, full brightness 15–65%, fade out last 35%
        let alpha: number;
        if (progress < 0.15) alpha = progress / 0.15;
        else if (progress > 0.65) alpha = (1 - progress) / 0.35;
        else alpha = 1;

        // Longer trail — 0.22s of movement behind the head
        const trailSecs = 0.22;
        const tx = cx - ss.vx * trailSecs;
        const ty = cy - ss.vy * trailSecs;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.lineCap = 'round';

        // Wide soft glow stroke
        const glow = ctx.createLinearGradient(tx, ty, cx, cy);
        glow.addColorStop(0, 'rgba(200,185,255,0)');
        glow.addColorStop(1, 'rgba(200,185,255,0.35)');
        ctx.strokeStyle = glow;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(cx, cy);
        ctx.stroke();

        // Bright core stroke
        const core = ctx.createLinearGradient(tx, ty, cx, cy);
        core.addColorStop(0, 'rgba(255,245,230,0)');
        core.addColorStop(0.4, 'rgba(210,195,255,0.7)');
        core.addColorStop(1, 'rgba(255,255,255,1)');
        ctx.strokeStyle = core;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(cx, cy);
        ctx.stroke();

        // Bright head dot with glow
        ctx.shadowColor = '#ddd8ff';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // ── Far buildings (tiny silhouettes) ────────────────────────────────────
    for (const b of this.buildings) {
      if (!b.far) continue;
      ctx.fillStyle = b.shade;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }

    // ── Near buildings with sparse windows and rare neon ────────────────────
    for (const b of this.buildings) {
      if (b.far) continue;
      ctx.fillStyle = b.shade;
      ctx.fillRect(b.x, b.y, b.w, b.h);

      // Lit windows — warm pale amber/white at distance
      for (const w of b.windows) {
        const flicker = Math.sin(t * 0.6 + w.flicker * 3.7) > 0.96 ? 0.05 : 1;
        const a = (0.2 + Math.sin(t * 0.2 + w.flicker) * 0.07) * flicker;
        ctx.fillStyle = `rgba(220,190,130,${a.toFixed(3)})`;
        ctx.fillRect(w.x, w.y, 5, 6);
      }

      // Tiny neon sign (uses theme accent so it feels part of the world)
      if (b.sign) {
        const col = b.sign.hue === 'accent' ? accent : b.sign.hue === 'purp' ? purp : pink;
        const pulse = 0.4 + Math.sin(t * 1.6 + b.x * 0.015) * 0.35;
        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = 6 * pulse;
        ctx.fillStyle = this.rgba(col, pulse * 0.8);
        ctx.fillRect(b.x + 3, b.sign.y, b.sign.w, 3);
        ctx.restore();
      }
    }

    // ── Fog / distance haze — multiple layers ────────────────────────────────
    // Deep fog at horizon blending buildings into darkness
    const fog1 = ctx.createLinearGradient(0, groundY - 80, 0, groundY + 20);
    fog1.addColorStop(0, 'rgba(3,1,14,0)');
    fog1.addColorStop(0.5, 'rgba(4,1,16,0.55)');
    fog1.addColorStop(1, 'rgba(5,2,18,0.88)');
    ctx.fillStyle = fog1;
    ctx.fillRect(0, groundY - 80, W, 100);

    // Mid-distance atmospheric haze over the buildings
    const fog2 = ctx.createLinearGradient(0, groundY - 180, 0, groundY);
    fog2.addColorStop(0, 'rgba(2,0,12,0)');
    fog2.addColorStop(1, 'rgba(3,1,14,0.35)');
    ctx.fillStyle = fog2;
    ctx.fillRect(0, groundY - 180, W, 180);

    // Ground — pure dark below
    ctx.fillStyle = '#020010';
    ctx.fillRect(0, groundY, W, H - groundY);

    // Thin horizon glow — just a breath of color
    const hglow = ctx.createLinearGradient(0, groundY - 4, 0, groundY + 8);
    hglow.addColorStop(0, this.rgba(accent, 0.06));
    hglow.addColorStop(1, 'transparent');
    ctx.fillStyle = hglow;
    ctx.fillRect(0, groundY - 4, W, 12);
  }

  private rgba(hex: string, alpha: number): string {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  }

  // ─── Events ────────────────────────────────────────────────────────────────

  private bindEvents(): void {
    this.el('login-extension').addEventListener('click', () => {
      this.setStatus('Connecting to extension...');
      this.onExtensionLogin();
    });

    this.el('login-bunker').addEventListener('click', () => {
      this.el('login-main').classList.add('hidden');
      this.el('login-bunker-view').classList.remove('hidden');
      this.setStatus('');
      if (this.onBunkerClientFlow) this.onBunkerClientFlow();
    });

    this.el('bunker-cancel').addEventListener('click', () => {
      if (this.onBunkerCancel) this.onBunkerCancel();
      this.el('login-bunker-view').classList.add('hidden');
      this.el('login-main').classList.remove('hidden');
      this.setStatus('');
    });

    this.el('bunker-url-submit').addEventListener('click', () => {
      const input = this.el('bunker-input') as HTMLInputElement;
      const url = input.value.trim();
      if (!url) return;
      this.setBunkerStatus('Connecting...');
      this.onBunkerLogin(url);
    });
    (this.el('bunker-input') as HTMLInputElement).addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const input = this.el('bunker-input') as HTMLInputElement;
        const url = input.value.trim();
        if (!url) return;
        this.setBunkerStatus('Connecting...');
        this.onBunkerLogin(url);
      }
    });

    this.el('bunker-uri-copy').addEventListener('click', () => {
      const text = this.el('bunker-uri-text').textContent || '';
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          (this.el('bunker-uri-copy') as HTMLElement).textContent = 'Copied!';
          setTimeout(() => { (this.el('bunker-uri-copy') as HTMLElement).textContent = 'Copy'; }, 2000);
        }).catch(() => {});
      }
    });

    this.el('nsec-toggle').addEventListener('click', () => {
      this.el('nsec-form').classList.toggle('hidden');
    });
    this.el('nsec-accept').addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      if (checked) this.el('nsec-input-wrap').classList.remove('hidden');
      else this.el('nsec-input-wrap').classList.add('hidden');
    });
    this.el('nsec-submit').addEventListener('click', () => {
      const input = this.el('nsec-input') as HTMLInputElement;
      const nsec = input.value.trim();
      input.value = '';
      if (!nsec) return;
      this.setStatus('Logging in...');
      this.onNsecLogin(nsec);
    });

    this.el('login-guest').addEventListener('click', () => this.onGuestLogin());
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  showConnectUri(uri: string): void {
    const display = this.el('bunker-uri-display');
    const text = this.el('bunker-uri-text');
    if (display && text) {
      text.textContent = uri;
      display.classList.remove('hidden');
    }
  }

  getQRContainer(): HTMLElement | null {
    return this.container.querySelector('#bunker-qr');
  }

  setBunkerStatus(msg: string, isError = false): void {
    const el = this.container.querySelector('#bunker-status') as HTMLElement;
    if (el) {
      el.textContent = msg;
      el.style.color = isError ? '#e85454' : 'var(--nd-accent)';
    }
  }

  setStatus(msg: string, isError = false): void {
    const el = this.el('login-status');
    el.textContent = msg;
    el.className = isError ? 'login-status error' : 'login-status';
  }

  destroy(): void {
    if (this.animFrameId !== null) cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this.handleResize);
    this.container.remove();
  }

  private el(id: string): HTMLElement {
    return this.container.querySelector(`#${id}`)!;
  }
}

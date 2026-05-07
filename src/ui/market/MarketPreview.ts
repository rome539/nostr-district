/**
 * MarketPreview.ts — Item preview panel (desktop floating + mobile inline tap)
 *
 * Owns the mp-preview DOM element (desktop) and all canvas-rendering logic.
 * MarketPanel calls init() after building the panel shell and update() on hover/tap.
 */

import { authStore } from '../../stores/authStore';
import { getAvatar, AvatarConfig } from '../../stores/avatarStore';
import { renderHubSprite } from '../../entities/AvatarRenderer';
import { MarketItem, isAnimatedColor, getAnimatedColor, ROD_SKINS } from '../../stores/marketStore';

const SLOT_BADGE = `color:var(--nd-subtext);background:color-mix(in srgb,var(--nd-dpurp) 20%,transparent);border:1px solid color-mix(in srgb,var(--nd-dpurp) 35%,transparent);`;
const NEON_COLORS = new Set(['#39ff14', '#ff2d78', '#ffaa00']);

const SLOT_LABEL: Record<string, string> = {
  hair: 'HAIR', top: 'TOP', bottom: 'BOT',
  hat: 'HAT', accessory: 'ACC', nameColor: 'COLOR',
  chatColor: 'COLOR', rodSkin: 'ROD', nameAnim: 'ANIM',
  aura: 'AURA', eyes: 'EYES', furniture: 'ROOM', lighting: 'LIGHT', floorStyle: 'FLOOR',
};

const WEARABLE_SLOTS = new Set<string>(['hair', 'top', 'bottom', 'hat', 'accessory', 'eyes']);

export const FURNITURE_PATHS: Record<string, string> = {
  walltapestry1:   'assets/furniture/decor/walltapestry1.png',
  walltapestry2:   'assets/furniture/decor/walltapestry2.png',
  walltapestry3:   'assets/furniture/decor/walltapestry3.png',
  sworddec:        'assets/furniture/decor/sworddec.png',
  persianrugwall1: 'assets/furniture/decor/persianrugwall1.png',
  persianrug:      'assets/furniture/lounge/persianrug.png',
  bearskin:        'assets/furniture/lounge/bearskin.png',
  striperug:       'assets/furniture/lounge/striperug.png',
  couch:           'assets/furniture/lounge/couch.png',
  beanbag:         'assets/furniture/lounge/beanbag.png',
  armchair:        'assets/furniture/lounge/armchair.png',
  plant1:          'assets/furniture/decor/plant1.png',
  plant2:          'assets/furniture/decor/plant2.png',
  plant3:          'assets/furniture/decor/plant3.png',
  plant4:          'assets/furniture/decor/plant4.png',
  plant5:          'assets/furniture/decor/plant5.png',
  nostrsign:       'assets/furniture/tech/NOSTR.png',
  plant6:            'assets/furniture/decor/plant6.png',
  cactus:            'assets/furniture/decor/cactus.png',
  daffodils:         'assets/furniture/decor/Daffodils.png',
  neonskull:         'assets/furniture/tech/neonskull.png',
  neoncoffee:        'assets/furniture/tech/neoncoffee.png',
  decoratedcouch:    'assets/furniture/lounge/decoratedcouch.png',
  decoratedarmchair: 'assets/furniture/lounge/decoratedarmchair.png',
  tigerskin:         'assets/furniture/lounge/tigerskin.png',
  coelacanthmount:   'assets/furniture/lounge/coelacanthmount.png',
  safe:              'assets/furniture/lounge/safe.png',
  neongfy:           'assets/furniture/tech/neongfy.png',
  neon58k:           'assets/furniture/tech/neon58k.png',
  bitcoincircularrug: 'assets/furniture/lounge/bitcoincircularrug.png',
  endtable:           'assets/furniture/lounge/endtable.png',
};

export class MarketPreview {
  private static _animId: number | null = null;
  /** Tracks which item is previewed on mobile (tap-toggle). */
  static previewedId: string | null = null;

  // ── Lifecycle ────────────────────────────────────────────────

  /** Creates the floating mp-preview element to the left of the panel (desktop only). */
  static init(panelEl: HTMLElement): void {
    document.getElementById('mp-preview')?.remove();
    const preview = document.createElement('div');
    preview.id = 'mp-preview';
    preview.style.cssText = `
      position:fixed;z-index:3999;
      background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
      border:1px solid color-mix(in srgb,var(--nd-amber,#f0b040) 35%,transparent);
      border-radius:10px;padding:10px;
      display:flex;flex-direction:column;align-items:center;gap:6px;
      pointer-events:none;
      opacity:0;transition:opacity 0.15s;
      backdrop-filter:blur(6px);
      box-shadow:0 6px 24px rgba(0,0,0,0.8);
      width:140px;
    `;
    preview.innerHTML = `
      <div id="mp-canvas-wrap" style="width:111px;height:168px;image-rendering:pixelated;"></div>
      <div id="mp-preview-name" style="color:var(--nd-text);font-size:9px;font-weight:bold;text-align:center;line-height:1.3;word-break:break-word;"></div>
      <div id="mp-preview-tier"></div>
      <div id="mp-preview-extra"></div>
    `;
    document.body.appendChild(preview);

    const position = () => {
      const rect = panelEl.getBoundingClientRect();
      preview.style.left      = `${rect.left - 140 - 10}px`;
      preview.style.top       = `${rect.top + rect.height / 2}px`;
      preview.style.transform = `translateY(-50%)`;
    };
    position();
    window.addEventListener('resize', position);
  }

  static destroy(): void {
    MarketPreview.cancelAnim();
    document.getElementById('mp-preview')?.remove();
    MarketPreview.previewedId = null;
  }

  static cancelAnim(): void {
    if (MarketPreview._animId !== null) {
      cancelAnimationFrame(MarketPreview._animId);
      MarketPreview._animId = null;
    }
  }

  // ── Public update entry-point ────────────────────────────────

  static update(item: MarketItem | null, isMobile: boolean): void {
    if (isMobile) { MarketPreview._updateInline(item); return; }
    MarketPreview._updateDesktop(item);
  }

  // ── Desktop floating preview ─────────────────────────────────

  private static _updateDesktop(item: MarketItem | null): void {
    const overlay = document.getElementById('mp-preview') as HTMLElement | null;
    const nameEl  = overlay?.querySelector('#mp-preview-name') as HTMLElement | null;
    const tierEl  = overlay?.querySelector('#mp-preview-tier') as HTMLElement | null;
    const extraEl = overlay?.querySelector('#mp-preview-extra') as HTMLElement | null;
    if (!nameEl || !tierEl || !extraEl) return;

    if (!item) { MarketPreview.cancelAnim(); if (overlay) overlay.style.opacity = '0'; return; }
    if (overlay) overlay.style.opacity = '1';

    nameEl.style.cssText = 'color:var(--nd-text);font-size:12px;font-weight:bold;';
    nameEl.textContent   = item.name;
    tierEl.innerHTML     = `<span style="font-size:8px;padding:1px 5px;border-radius:3px;letter-spacing:0.05em;${SLOT_BADGE}">${SLOT_LABEL[item.slot] ?? item.slot}</span>`;
    extraEl.innerHTML    = '';

    MarketPreview.cancelAnim();

    if (item.slot === 'nameColor' || item.slot === 'chatColor') {
      const makeCanvas = (col: string) => MarketPreview._makeColorCanvas(getAvatar(), col);
      if (isAnimatedColor(item.value)) {
        const loop = () => {
          MarketPreview._setCanvas(makeCanvas(getAnimatedColor(item.value, Date.now())));
          MarketPreview._animId = requestAnimationFrame(loop);
        };
        loop();
      } else {
        MarketPreview._setCanvas(makeCanvas(item.value));
      }
    } else if (item.slot === 'nameAnim') {
      const avatar = getAvatar();
      const color  = avatar.nameColor || '#ffffff';
      const loop = () => {
        const t = Date.now();
        let tagTransform: { tx?: number; ty?: number; scale?: number; angle?: number; alpha?: number; shadowColor?: string; shadowBlur?: number; charOffsets?: number[] } = {};
        const name = (authStore.getState().displayName ?? 'Player').slice(0, 14);
        switch (item.value) {
          case 'bob':    tagTransform = { ty: Math.sin(t / 400) * 4 }; break;
          case 'pulse':  tagTransform = { scale: 1 + Math.sin(t / 350) * 0.08 }; break;
          case 'jitter': tagTransform = { tx: (Math.random() - 0.5) * 2, ty: (Math.random() - 0.5) * 1.5 }; break;
          case 'zoom': {
            const p = (t % 900) / 900;
            const b1 = p < 0.22 ? Math.sin((p / 0.22) * Math.PI) : 0;
            const b2 = p >= 0.28 && p < 0.46 ? Math.sin(((p - 0.28) / 0.18) * Math.PI) : 0;
            tagTransform = { scale: 1 + b1 * 0.2 + b2 * 0.12 };
            break;
          }
          case 'swing':  tagTransform = { angle: Math.sin(t / 550) * (10 * Math.PI / 180) }; break;
          case 'wave': {
            const offsets = Array.from({ length: name.length }, (_, i) => Math.sin(t / 280 + i * 0.7) * 4);
            tagTransform = { charOffsets: offsets };
            break;
          }
          case 'glow': {
            const flicker = Math.random() < 0.015 ? 0.25 : Math.random() < 0.04 ? 0.75 : 1;
            tagTransform = { alpha: flicker, shadowColor: color, shadowBlur: 10 + Math.sin(t / 600) * 4 };
            break;
          }
        }
        MarketPreview._setCanvas(MarketPreview._makeNameTagCanvas(avatar, color, tagTransform));
        MarketPreview._animId = requestAnimationFrame(loop);
      };
      loop();
    } else if (item.slot === 'eyes' && ['blaze', 'frost', 'cosmic', 'cry'].includes(item.value)) {
      const src = renderHubSprite({ ...getAvatar(), eyes: item.value } as AvatarConfig);
      const W = 111, H = 168;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d')!;
      const lx  = 46.5;
      const rx  = item.value === 'blaze' ? 58.5 : 61.5;
      const eyY = 73.5;

      if (item.value === 'cry') {
        const SPX = (v: number) => v * 0.33 / 60 * 3;
        const toRad = (deg: number) => deg * Math.PI / 180;
        const rand  = (a: number, b: number) => a + Math.random() * (b - a);
        const pick  = (a: string[]) => a[Math.floor(Math.random() * a.length)];
        interface Ptcl { x:number; y:number; vx:number; vy:number; gy:number; life:number; decay:number; r:number; col:string; }
        const pts: Ptcl[] = [];
        const spawn = (ex: number): Ptcl => {
          const a = toRad(rand(88, 92)), sp = SPX(rand(1, 4));
          return { x: ex + rand(-0.5, 0.5), y: eyY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, gy: SPX(10) / 60,
                   life: 1, decay: 1 / rand(36, 66), r: rand(1.5, 3.0), col: pick(['#4488ff','#88aaff','#2266dd','#66aaff']) };
        };
        let lastSpawn = 0;
        const loop = () => {
          const now = Date.now();
          ctx.clearRect(0, 0, W, H);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(src, 0, 0, W, H);
          if (now - lastSpawn > 650) { pts.push(spawn(lx), spawn(rx)); lastSpawn = now; }
          ctx.globalCompositeOperation = 'lighter';
          for (let i = pts.length - 1; i >= 0; i--) {
            const p = pts[i];
            p.x += p.vx; p.y += p.vy; p.vy += p.gy; p.life -= p.decay;
            if (p.life <= 0) { pts.splice(i, 1); continue; }
            ctx.globalAlpha = p.life * 0.9;
            ctx.fillStyle = p.col;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
          }
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          MarketPreview._animId = requestAnimationFrame(loop);
        };
        MarketPreview._setCanvas(c);
        loop();
      } else {
        const PALETTES: Record<string, string[]> = {
          blaze:  ['#ff6600','#ff3300','#ffaa00','#ffdd00','#ff4400'],
          frost:  ['#aaddff','#ffffff','#88ccff','#cceeff','#44aaff'],
          cosmic: ['#ffffff','#aa88ff','#ff88ff','#88ffff','#ffff88'],
        };
        const SPEED_MS: Record<string, number> = { blaze: 100, frost: 280, cosmic: 360 };
        const pal = PALETTES[item.value];
        const spd = SPEED_MS[item.value];
        let lastStep = -1;
        const loop = () => {
          const step = Math.floor(Date.now() / spd) % pal.length;
          if (step !== lastStep) {
            lastStep = step;
            const frame = renderHubSprite({ ...getAvatar(), eyes: item.value, eyeColor: pal[step] } as AvatarConfig);
            ctx.clearRect(0, 0, W, H);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(frame, 0, 0, W, H);
          }
          MarketPreview._animId = requestAnimationFrame(loop);
        };
        MarketPreview._setCanvas(c);
        loop();
      }
    } else if (item.slot === 'rodSkin') {
      if (item.value === 'legendary') {
        const loop = () => {
          MarketPreview._setCanvas(MarketPreview._makeRodCanvas(item.value));
          MarketPreview._animId = requestAnimationFrame(loop);
        };
        loop();
      } else {
        MarketPreview._setCanvas(MarketPreview._makeRodCanvas(item.value));
      }
    } else if (item.slot === 'furniture') {
      MarketPreview._setCanvas(MarketPreview.makeFurnitureCanvas(item.value));
    } else if (item.slot === 'wallTheme') {
      MarketPreview._setCanvas(MarketPreview._makeWallThemeCanvas(item.value));
    } else if (item.slot === 'floorStyle') {
      MarketPreview._setCanvas(MarketPreview._makeFloorCanvas(item.value));
    } else if (WEARABLE_SLOTS.has(item.slot)) {
      MarketPreview._drawAvatarCanvas({ ...getAvatar(), [item.slot]: item.value } as AvatarConfig);
    } else {
      MarketPreview._drawAvatarCanvas(getAvatar());
    }
  }

  // ── Mobile inline preview ────────────────────────────────────

  private static _updateInline(item: MarketItem | null): void {
    const el = document.getElementById('mp-inline-prev') as HTMLElement | null;
    if (!el) return;
    if (!item) { el.style.display = 'none'; return; }

    el.style.display = 'flex';
    const nameEl     = el.querySelector('#mp-inline-name')   as HTMLElement;
    const tierEl     = el.querySelector('#mp-inline-tier')   as HTMLElement;
    const canvasWrap = el.querySelector('#mp-inline-canvas') as HTMLElement;

    nameEl.textContent = item.name;
    tierEl.innerHTML   = `<span style="font-size:8px;padding:1px 5px;border-radius:3px;letter-spacing:0.05em;${SLOT_BADGE}">${SLOT_LABEL[item.slot] ?? item.slot}</span>`;

    let canvas: HTMLCanvasElement;
    if (item.slot === 'nameColor')        canvas = MarketPreview._makeNameTagCanvas(getAvatar(), item.value);
    else if (item.slot === 'chatColor')   canvas = MarketPreview._makeChatCanvas(getAvatar(), item.value);
    else if (item.slot === 'rodSkin')     canvas = MarketPreview._makeRodCanvas(item.value);
    else if (item.slot === 'furniture')   canvas = MarketPreview.makeFurnitureCanvas(item.value);
    else if (item.slot === 'wallTheme')   canvas = MarketPreview._makeWallThemeCanvas(item.value);
    else if (item.slot === 'floorStyle')  canvas = MarketPreview._makeFloorCanvas(item.value);
    else if (WEARABLE_SLOTS.has(item.slot)) canvas = renderHubSprite({ ...getAvatar(), [item.slot]: item.value } as AvatarConfig);
    else                                  canvas = renderHubSprite(getAvatar());

    canvas.style.cssText = 'width:37px;height:56px;image-rendering:pixelated;display:block;';
    canvasWrap.innerHTML = '';
    canvasWrap.appendChild(canvas);
  }

  // ── Canvas helpers ───────────────────────────────────────────

  private static _setCanvas(canvas: HTMLCanvasElement): void {
    const wrap = document.getElementById('mp-canvas-wrap');
    if (!wrap) return;
    canvas.style.cssText = `width:111px;height:168px;display:block;`;
    wrap.innerHTML = '';
    wrap.appendChild(canvas);
  }

  private static _drawAvatarCanvas(config: AvatarConfig): void {
    const wrap = document.getElementById('mp-canvas-wrap');
    if (!wrap) return;
    const canvas = renderHubSprite(config);
    canvas.style.cssText = `width:111px;height:168px;image-rendering:pixelated;display:block;`;
    wrap.innerHTML = '';
    wrap.appendChild(canvas);
  }

  private static _makeWallThemeCanvas(value: string): HTMLCanvasElement {
    const W = 111, H = 168;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;
    if (value === 'void') {
      ctx.fillStyle = '#060608'; ctx.fillRect(0, 0, W, H);
      const seeded = (n: number) => Math.abs(Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1;
      for (let i = 0; i < 80; i++) {
        const br = 0.3 + seeded(i * 1.9) * 0.7;
        ctx.globalAlpha = br; ctx.fillStyle = '#ffffff';
        ctx.fillRect(seeded(i * 2.1) * W, seeded(i * 3.7) * H, seeded(i * 5.3) > 0.8 ? 2 : 1, 1);
      }
      for (let i = 80; i < 200; i++) {
        ctx.globalAlpha = 0.12 + seeded(i * 2.7) * 0.3; ctx.fillStyle = '#d0d8ff';
        ctx.fillRect(seeded(i * 3.3) * W, seeded(i * 1.7) * H, 1, 1);
      }
      const grad = ctx.createRadialGradient(W * 0.62, H * 0.35, 0, W * 0.62, H * 0.35, 55);
      grad.addColorStop(0, 'rgba(80,50,140,0.08)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad; ctx.globalAlpha = 1; ctx.fillRect(0, 0, W, H);
    } else if (value === 'cityview') {
      const seeded = (n: number) => Math.abs(Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1;
      // Sky gradient
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#010508'); sky.addColorStop(0.55, '#060e20'); sky.addColorStop(1, '#0a1530');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      // Stars
      for (let i = 0; i < 28; i++) {
        ctx.globalAlpha = 0.3 + seeded(i * 3.7) * 0.7;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(seeded(i * 2.1) * W, seeded(i * 4.3) * H * 0.52, 1, 1);
      }
      ctx.globalAlpha = 1;
      // Moon
      ctx.globalAlpha = 0.9; ctx.fillStyle = '#e8dca8';
      ctx.beginPath(); ctx.arc(W * 0.78, H * 0.12, 6, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // Buildings
      const bldgs = [[0,.10,.38],[.10,.14,.54],[.24,.09,.42],[.33,.16,.65],
                     [.49,.12,.78],[.61,.09,.56],[.70,.14,.68],[.84,.10,.44],[.94,.06,.30]];
      const horizY = H * 0.58;
      for (let bi = 0; bi < bldgs.length; bi++) {
        const [bxf, bwf, bhf] = bldgs[bi];
        const bx = bxf * W, bw = bwf * W, bh = bhf * (H - horizY);
        const btop = H - bh;
        ctx.fillStyle = '#060a14'; ctx.fillRect(bx, btop, bw, H - btop);
        const cols = Math.max(1, Math.floor(bw / 4));
        const rows = Math.max(1, Math.floor(bh / 6));
        for (let r = 0; r < rows; r++) {
          for (let col = 0; col < cols; col++) {
            const s = bi * 1000 + r * 50 + col;
            if (seeded(s) > 0.42) {
              ctx.fillStyle = seeded(s + .5) > .28 ? '#f0da60' : '#80b8f8';
              ctx.globalAlpha = 0.6 + seeded(s + .3) * 0.4;
              ctx.fillRect(bx + col * 4 + 1, btop + r * 6 + 2, 2, 2);
            }
          }
        }
        ctx.globalAlpha = 1;
      }
      // Window frame overlay
      ctx.strokeStyle = '#1a1e2a'; ctx.lineWidth = 6;
      ctx.strokeRect(0, 0, W, H);
      ctx.strokeStyle = '#1a1e2a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    } else if (value === 'cabin') {
      const r = (ax: number, ay: number, aw: number, ah: number, col: string) => { ctx.fillStyle = col; ctx.fillRect(ax, ay, aw, ah); };
      // Log wall bands
      const LOGS = ['#28140a', '#321a0c'];
      const LOG_H = 14, CHINK = 1;
      for (let li = 0, ly = 0; ly < H; li++, ly += LOG_H + CHINK) {
        r(0, ly, W, LOG_H, LOGS[li % 2]);
        ctx.globalAlpha = 0.13; r(0, ly, W, 1, '#b07848');
        ctx.globalAlpha = 0.20; r(0, ly + LOG_H - 2, W, 2, '#000');
        ctx.globalAlpha = 1;    r(0, ly + LOG_H, W, CHINK, '#0c0604');
      }
      // Fireplace stone surround
      const fpX = W / 2, fpW = 44, fpH = 52;
      const fpY = H - fpH;
      r(fpX - fpW / 2, fpY, fpW, fpH, '#706860');
      // Mortar lines
      ctx.fillStyle = '#3c3430'; ctx.globalAlpha = 0.55;
      for (let sy = fpY; sy < H; sy += 10) ctx.fillRect(fpX - fpW / 2, sy, fpW, 1);
      for (let row = 0; row < 6; row++) {
        const ry = fpY + row * 10, off = row % 2 === 0 ? 0 : 8;
        for (let vx = fpX - fpW / 2 + off; vx < fpX + fpW / 2; vx += 16) ctx.fillRect(vx, ry, 1, 10);
      }
      ctx.globalAlpha = 1;
      // Mantel
      r(fpX - fpW / 2 - 5, fpY - 5, fpW + 10, 6, '#3a2010');
      ctx.globalAlpha = 0.18; r(fpX - fpW / 2 - 5, fpY - 5, fpW + 10, 1, '#c09060'); ctx.globalAlpha = 1;
      // Firebox
      const fbX = fpX - fpW / 2 + 6, fbW = fpW - 12, fbH = fpH - 8;
      r(fbX, fpY + 4, fbW, fbH, '#080402');
      // Ember glow
      const eg = ctx.createRadialGradient(fpX, H - 6, 2, fpX, H - 6, fbW * 0.7);
      eg.addColorStop(0, 'rgba(255,120,0,0.55)'); eg.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = eg; ctx.fillRect(fbX, fpY + 4, fbW, fbH);
      // Flame rects
      const fc = ['#f0a040', '#e87030', '#fac060', '#ff6020', '#e85030'];
      for (let i = 0; i < 5; i++) {
        const fh = 12 + (i % 3) * 4;
        const bx = fbX + 3 + i * (fbW - 6) / 4;
        ctx.globalAlpha = 0.75; ctx.fillStyle = fc[i % fc.length];
        ctx.fillRect(bx - 1, H - 8 - fh, 3, fh);
        ctx.fillStyle = '#ffd060'; ctx.globalAlpha = 0.5;
        ctx.fillRect(bx, H - 8 - fh * 0.5, 1, fh * 0.4);
      }
      ctx.globalAlpha = 1;
      // Hearth ledge
      r(fpX - fpW / 2 - 2, H - 5, fpW + 4, 5, '#5a5248');
    } else if (value === 'dungeon' || value === 'brickwall' || value === 'oldpaperwall') {
      ctx.fillStyle = '#0c0c0e'; ctx.fillRect(0, 0, W, H);
      const srcs: Record<string, string> = {
        dungeon:      'assets/furniture/walls/dungeonwall.png',
        brickwall:    'assets/furniture/walls/brickwall.png',
        oldpaperwall: 'assets/furniture/walls/oldpaperwall.png',
      };
      const img = new Image();
      img.onload = () => {
        const scale = Math.max(W / img.width, H / img.height);
        const dw = img.width * scale, dh = img.height * scale;
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      };
      img.src = srcs[value];
    } else {
      ctx.fillStyle = '#0d0820'; ctx.fillRect(0, 0, W, H);
    }
    return c;
  }

  private static _makeFloorCanvas(value: string): HTMLCanvasElement {
    const W = 111, H = 168;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0d0820'; ctx.fillRect(0, 0, W, H);
    const srcs: Record<string, string> = {
      dungeon:        'assets/furniture/floors/dungeonfloor.png',
      dirtfloor:      'assets/furniture/floors/dirtfloor.png',
      oldwoodenfloor: 'assets/furniture/floors/oldwoodenfloor.png',
    };
    const src = srcs[value];
    if (src) {
      const img = new Image();
      img.onload = () => {
        const scale = Math.max(W / img.width, H / img.height);
        const dw = img.width * scale, dh = img.height * scale;
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      };
      img.src = src;
    }
    return c;
  }

  /** PNG furniture item — dark bg, image fitted with padding. Loads async and redraws in-place. */
  static makeFurnitureCanvas(value: string): HTMLCanvasElement {
    const W = 111, H = 168;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0d0820';
    ctx.fillRect(0, 0, W, H);

    const path = FURNITURE_PATHS[value];
    if (!path) return c;

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0d0820';
      ctx.fillRect(0, 0, W, H);
      const pad = 10;
      const scale = Math.min((W - pad * 2) / img.width, (H - pad * 2) / img.height);
      const dw = img.width  * scale;
      const dh = img.height * scale;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    };
    img.src = path;
    return c;
  }

  /** 111×168 canvas: avatar + name-tag pill + optional chat bubble (for nameColor/chatColor). */
  private static _makeColorCanvas(avatar: AvatarConfig, color: string): HTMLCanvasElement {
    const src = renderHubSprite(avatar);
    const S = 3;
    const W = src.width * S;
    const H = src.height * S;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    const isRainbow = color === 'rainbow';
    const rawName   = authStore.getState().displayName ?? 'Player';
    const name      = rawName.length > 12 ? rawName.slice(0, 11) + '…' : rawName;

    const maxW = W - 8;
    let fSize  = 13;
    ctx.font   = `bold ${fSize}px monospace`;
    let tw     = ctx.measureText(name).width;
    if (tw > maxW - 10) { fSize = 11; ctx.font = `bold ${fSize}px monospace`; tw = ctx.measureText(name).width; }
    if (tw > maxW - 10) { fSize = 9;  ctx.font = `bold ${fSize}px monospace`; tw = ctx.measureText(name).width; }

    const ph  = fSize + 7;
    const pad = 6;
    const pw  = Math.min(tw + pad * 2, maxW);
    const nx  = Math.round((W - pw) / 2);
    const ny  = H - ph - 6;

    ctx.drawImage(src, 0, ny - 4 - H, W, H);

    const rainbowGrad = (x0: number, x1: number) => {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      ['0','60','120','180','240','300','360'].forEach((h, i, a) =>
        g.addColorStop(i / (a.length - 1), `hsl(${h},90%,68%)`));
      return g;
    };

    const fill = isRainbow ? rainbowGrad(nx, nx + pw) : color;
    const isNeon = NEON_COLORS.has(color);
    ctx.fillStyle = '#0a0014ee';
    ctx.beginPath(); ctx.roundRect(nx, ny, pw, ph, 4); ctx.fill();
    ctx.fillStyle = fill; ctx.font = `bold ${fSize}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (isNeon) { ctx.shadowColor = color; ctx.shadowBlur = 8; }
    ctx.fillText(name, W / 2, ny + ph / 2 + 0.5, pw - pad);
    ctx.shadowBlur = 0;

    const msg    = 'Hello!';
    const cfSize = 12;
    ctx.font = `${cfSize}px monospace`;
    const ctw = ctx.measureText(msg).width;
    const cph = cfSize + 7;
    const cpw = ctw + pad * 2;
    const bx  = Math.round((W - cpw) / 2);
    const by  = 4;
    const bfill = isRainbow ? rainbowGrad(bx, bx + cpw) : color;
    ctx.fillStyle = '#0a0014ee';
    ctx.beginPath(); ctx.roundRect(bx, by, cpw, cph, 4); ctx.fill();
    ctx.fillStyle = bfill;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (isNeon) { ctx.shadowColor = color; ctx.shadowBlur = 8; }
    ctx.fillText(msg, W / 2, by + cph / 2 + 0.5);
    ctx.shadowBlur = 0;
    const mid = W / 2;
    ctx.fillStyle = isRainbow ? rainbowGrad(mid - 4, mid + 4) : color + 'cc';
    ctx.beginPath();
    ctx.moveTo(mid - 4, by + cph); ctx.lineTo(mid + 4, by + cph); ctx.lineTo(mid, by + cph + 6);
    ctx.closePath(); ctx.fill();

    return c;
  }

  /** 111×168 canvas: avatar + optionally-transformed name-tag pill (for nameAnim). */
  private static _makeNameTagCanvas(
    avatar: AvatarConfig,
    color: string,
    tagTransform?: { tx?: number; ty?: number; scale?: number; angle?: number; alpha?: number; shadowColor?: string; shadowBlur?: number; charOffsets?: number[] },
  ): HTMLCanvasElement {
    const src = renderHubSprite(avatar);
    const S = 3;
    const W = src.width  * S;
    const H = src.height * S;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    const isRainbow = color === 'rainbow';
    const rawName   = authStore.getState().displayName ?? 'Player';
    const name      = rawName.length > 12 ? rawName.slice(0, 11) + '…' : rawName;

    const maxW  = W - 8;
    let fSize   = 13;
    ctx.font    = `bold ${fSize}px monospace`;
    let tw      = ctx.measureText(name).width;
    if (tw > maxW - 10) { fSize = 11; ctx.font = `bold ${fSize}px monospace`; tw = ctx.measureText(name).width; }
    if (tw > maxW - 10) { fSize = 9;  ctx.font = `bold ${fSize}px monospace`; tw = ctx.measureText(name).width; }

    const ph  = fSize + 7;
    const pad = 6;
    const pw  = Math.min(tw + pad * 2, maxW);
    const nx  = Math.round((W - pw) / 2);
    const ny  = H - ph - 6;

    ctx.drawImage(src, 0, ny - 4 - H, W, H);

    const rainbowGrad = (x0: number, x1: number) => {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0,    'hsl(0,90%,68%)');
      g.addColorStop(0.17, 'hsl(60,90%,68%)');
      g.addColorStop(0.33, 'hsl(120,90%,68%)');
      g.addColorStop(0.50, 'hsl(180,90%,68%)');
      g.addColorStop(0.67, 'hsl(240,90%,68%)');
      g.addColorStop(0.83, 'hsl(300,90%,68%)');
      g.addColorStop(1,    'hsl(360,90%,68%)');
      return g;
    };

    const tx          = tagTransform?.tx          ?? 0;
    const ty          = tagTransform?.ty          ?? 0;
    const scale       = tagTransform?.scale       ?? 1;
    const angle       = tagTransform?.angle       ?? 0;
    const alpha       = tagTransform?.alpha       ?? 1;
    const shadowColor = tagTransform?.shadowColor ?? null;
    const shadowBlur  = tagTransform?.shadowBlur  ?? 0;
    const charOffsets = tagTransform?.charOffsets ?? null;
    const cx          = nx + pw / 2;
    const cy          = ny + ph / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx + tx, cy + ty);
    ctx.scale(scale, scale);
    ctx.rotate(angle);
    ctx.translate(-cx, -cy);

    ctx.fillStyle = '#0a0014ee';
    ctx.beginPath(); ctx.roundRect(nx, ny, pw, ph, 4); ctx.fill();
    ctx.font = `bold ${fSize}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (shadowColor) { ctx.shadowColor = shadowColor; ctx.shadowBlur = shadowBlur; }

    if (charOffsets && charOffsets.length > 0) {
      const charW  = ctx.measureText('W').width;
      const startX = W / 2 - (name.length * charW) / 2 + charW / 2;
      ctx.fillStyle = isRainbow ? rainbowGrad(nx, nx + pw) : color;
      ctx.textAlign = 'left';
      for (let i = 0; i < name.length; i++) {
        ctx.fillText(name[i], startX + i * charW - charW / 2, ny + ph / 2 + 0.5 + (charOffsets[i] ?? 0));
      }
    } else {
      ctx.fillStyle = isRainbow ? rainbowGrad(nx, nx + pw) : color;
      ctx.fillText(name, W / 2, ny + ph / 2 + 0.5, pw - pad);
    }

    ctx.restore();
    return c;
  }

  /** 111×168 canvas: avatar + chat bubble (for chatColor preview). */
  private static _makeChatCanvas(avatar: AvatarConfig, color: string): HTMLCanvasElement {
    const src = renderHubSprite(avatar);
    const S = 3;
    const W = src.width  * S;
    const H = src.height * S;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, W, H);

    const isRainbow = color === 'rainbow';
    const msg   = 'Hello!';
    const fSize = 12;
    ctx.font = `${fSize}px monospace`;
    const tw  = ctx.measureText(msg).width;
    const ph  = fSize + 7;
    const pad = 6;
    const pw  = tw + pad * 2;
    const bx  = Math.round((W - pw) / 2);
    const by  = 6;

    const rainbowGrad = (x0: number, x1: number) => {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0,    'hsl(0,90%,68%)');  g.addColorStop(0.17, 'hsl(60,90%,68%)');
      g.addColorStop(0.33, 'hsl(120,90%,68%)'); g.addColorStop(0.50, 'hsl(180,90%,68%)');
      g.addColorStop(0.67, 'hsl(240,90%,68%)'); g.addColorStop(0.83, 'hsl(300,90%,68%)');
      g.addColorStop(1,    'hsl(360,90%,68%)');
      return g;
    };

    ctx.fillStyle = '#0a0014ee';
    ctx.beginPath(); ctx.roundRect(bx, by, pw, ph, 4); ctx.fill();
    ctx.fillStyle    = isRainbow ? rainbowGrad(bx, bx + pw) : color;
    ctx.textAlign    = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(msg, W / 2, by + ph / 2 + 0.5);
    const mid = W / 2;
    ctx.fillStyle = isRainbow ? rainbowGrad(mid - 4, mid + 4) : color + 'cc';
    ctx.beginPath();
    ctx.moveTo(mid - 4, by + ph); ctx.lineTo(mid + 4, by + ph); ctx.lineTo(mid, by + ph + 7);
    ctx.closePath(); ctx.fill();

    return c;
  }

  /** 111×168 canvas: dark bg + rod illustration. */
  private static _makeRodCanvas(rodSkin: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 111; c.height = 168;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0d0820';
    ctx.fillRect(0, 0, c.width, c.height);

    const skin        = ROD_SKINS[rodSkin] ?? ROD_SKINS[''];
    const isLegendary = rodSkin === 'legendary';
    const hue         = (Date.now() / 20) % 360;
    const col = (offset: number, hex: number) =>
      isLegendary ? `hsl(${(hue + offset) % 360},80%,62%)` : '#' + hex.toString(16).padStart(6, '0');

    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const S = 3;
    ctx.strokeStyle = col(0,  skin.grip);  ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(34*S, 52*S); ctx.lineTo(24*S, 32*S); ctx.stroke();
    ctx.strokeStyle = col(40, skin.tip);   ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(24*S, 32*S); ctx.lineTo(12*S, 8*S);  ctx.stroke();
    ctx.strokeStyle = col(80, skin.line);  ctx.lineWidth = 2; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(12*S, 8*S);  ctx.lineTo(3*S,  46*S); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = col(120, skin.bobber); ctx.fillRect(2*S, 43*S, 4*S, 4*S);
    ctx.fillStyle = '#f0f0f0';             ctx.fillRect(2*S, 47*S, 4*S, 4*S);
    ctx.strokeStyle = '#5dcaa550'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.ellipse(4*S, 51*S, 15, 4, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;

    const label = rodSkin === '' ? 'Classic' : rodSkin.charAt(0).toUpperCase() + rodSkin.slice(1);
    ctx.font = 'bold 11px monospace'; ctx.fillStyle = '#ffffff55';
    ctx.textAlign = 'center'; ctx.fillText(label, c.width / 2, 14);

    return c;
  }

}

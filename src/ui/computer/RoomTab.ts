import {
  getRoomConfig, setRoomConfig, RoomConfig, FurnitureId, PosterId,
  setFurnitureColor, getFurnitureColor, DEFAULT_FURNITURE_COLORS,
  WALL_THEMES, FLOOR_STYLES, LIGHTING_MOODS, FURNITURE_DATA, POSTER_DATA,
  ALL_POSTERS, WallTheme, FloorStyle, LightingMood,
  getDefaultPos, FURNITURE_BOUNDS,
} from '../../stores/roomStore';
import { isOwned, getFreeFlowerForPubkey } from '../../stores/marketStore';
import { FURNITURE_PATHS } from '../market/MarketPreview';
import { PNG_TINT_WHITE_IDS } from '../../rooms/RoomRenderer';
import { drawMyRoomFurniture } from '../../rooms/roomFurniture';
import { drawForegroundItems } from '../../rooms/roomForeground';
import { getPet, PetSelection, PetSpecies, DOG_BREEDS, CAT_BREEDS } from '../../stores/petStore';
import { authStore } from '../../stores/authStore';
import { publishRoomConfig } from '../../nostr/nostrService';
import { SoundEngine, MYROOM_TRACKS, MyRoomTrackId } from '../../audio/SoundEngine';
import type { TabCtx } from './types';

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

function _makeWallPreviewDataURL(type: 'cityview' | 'cabin'): string {
  const W = 120, H = 28;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d')!;
  if (type === 'cityview') {
    const sky = x.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#010508'); sky.addColorStop(0.6, '#060e20'); sky.addColorStop(1, '#0a1530');
    x.fillStyle = sky; x.fillRect(0, 0, W, H);
    // Stars
    const sd = (n: number) => Math.abs(Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1;
    for (let i = 0; i < 18; i++) {
      x.globalAlpha = 0.4 + sd(i * 2.3) * 0.6;
      x.fillStyle = '#ffffff'; x.fillRect(sd(i * 3.1) * W, sd(i * 1.7) * H * 0.55, 1, 1);
    }
    x.globalAlpha = 1;
    // Buildings
    const bldgs = [[0,18,12,10],[12,18,8,16],[20,18,10,12],[30,18,14,8],[44,18,10,14],[54,18,12,10],[66,18,8,18],[74,18,12,12],[86,18,10,10],[96,18,10,16],[106,18,14,8]] as const;
    for (const [bx, by, bw, bh] of bldgs) {
      x.fillStyle = '#050a14'; x.fillRect(bx, by - bh, bw, bh + H);
      // windows
      x.fillStyle = '#f0da60';
      for (let wy = by - bh + 2; wy < by; wy += 4) {
        for (let wx = bx + 1; wx < bx + bw - 1; wx += 3) {
          x.globalAlpha = Math.random() > 0.4 ? 0.6 + Math.random() * 0.3 : 0;
          x.fillRect(wx, wy, 2, 2);
        }
      }
    }
    x.globalAlpha = 1;
  } else {
    // Log bands
    x.fillStyle = '#1a0d06'; x.fillRect(0, 0, W, H);
    for (let ly = 0, i = 0; ly < H; ly += 7, i++) {
      x.fillStyle = i % 2 === 0 ? '#1a0d06' : '#221108';
      x.fillRect(0, ly, W, 6);
      x.globalAlpha = 0.2; x.fillStyle = '#000'; x.fillRect(0, ly + 6, W, 1);
      x.globalAlpha = 1;
    }
    // Small fireplace center
    const cx = W / 2, fpW = 22, fpH = 18, fpY = H - fpH;
    x.fillStyle = '#706860'; x.fillRect(cx - fpW / 2, fpY, fpW, fpH);
    x.fillStyle = '#3a2010'; x.fillRect(cx - fpW / 2 - 2, fpY - 2, fpW + 4, 3); // mantel
    x.fillStyle = '#080402'; x.fillRect(cx - 7, fpY + 3, 14, 13); // firebox
    // Ember glow
    const eg = x.createRadialGradient(cx, H - 4, 1, cx, H - 4, 10);
    eg.addColorStop(0, 'rgba(255,100,0,0.6)'); eg.addColorStop(1, 'rgba(255,80,0,0)');
    x.fillStyle = eg; x.fillRect(cx - 10, H - 16, 20, 14);
    // Flame rects
    const fc = ['#f0a040','#e87030','#fac060','#ff6020'];
    for (let fi = 0; fi < 4; fi++) {
      const fh = 4 + (fi % 2) * 3;
      x.globalAlpha = 0.85; x.fillStyle = fc[fi];
      x.fillRect(cx - 5 + fi * 3, H - 4 - fh, 2, fh);
    }
    x.globalAlpha = 1;
  }
  return cv.toDataURL();
}

const _CITY_PREVIEW_URL  = _makeWallPreviewDataURL('cityview');
const _CABIN_PREVIEW_URL = _makeWallPreviewDataURL('cabin');

function _wallPreviewStyle(key: string, theme: { brick: string }): string {
  const PNG_MAP: Record<string, string> = {
    dungeon:      'background-image:url(assets/furniture/walls/dungeonwall.png);background-size:cover;',
    brickwall:    'background-image:url(assets/furniture/walls/brickwall.png);background-size:cover;',
    oldpaperwall: 'background-image:url(assets/furniture/walls/oldpaperwall.png);background-size:cover;',
    cityview:     `background-image:url(${_CITY_PREVIEW_URL});background-size:cover;`,
    cabin:        `background-image:url(${_CABIN_PREVIEW_URL});background-size:cover;`,
    void: 'background:#060608;background-image:radial-gradient(circle at 20% 30%,rgba(255,255,255,0.9) 1px,transparent 1px),radial-gradient(circle at 60% 15%,rgba(250,212,128,0.8) 1px,transparent 1px),radial-gradient(circle at 80% 45%,rgba(123,104,238,0.8) 1px,transparent 1px),radial-gradient(circle at 35% 70%,rgba(255,255,255,0.7) 1px,transparent 1px),radial-gradient(circle at 90% 20%,rgba(232,122,171,0.8) 1px,transparent 1px),radial-gradient(circle at 10% 60%,rgba(93,202,165,0.8) 1px,transparent 1px);',
  };
  return PNG_MAP[key] ?? `background:${theme.brick};`;
}

export class RoomTab {
  private draftRoom: RoomConfig | null = null;
  private previewBaseline: RoomConfig | null = null;
  private previewSaved = false;
  private currentRoomSection: 'walls' | 'floor' | 'lighting' | 'furniture' | 'posters' | 'pets' | 'music' = 'walls';
  private activePosterSlot: 0 | 1 | 2 = 0;
  private activeFurnitureColor: FurnitureId | null = null;
  private activeFurnitureCategory = 'lounge';
  private activeFurniturePage = 0;
  private _wallPage = 0;
  private _floorPage = 0;
  private _lightPage = 0;
  private body: HTMLElement | null = null;
  private ctx: TabCtx | null = null;

  private _furPreviewEl: HTMLElement | null = null;
  private _furPreviewResize: (() => void) | null = null;

  private _initFurPreview(): void {
    document.getElementById('rt-fur-preview-float')?.remove();
    const el = document.createElement('div');
    el.id = 'rt-fur-preview-float';
    el.style.cssText = `
      position:fixed;z-index:3999;pointer-events:none;
      background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
      border:1px solid color-mix(in srgb,var(--nd-accent) 35%,transparent);
      border-radius:10px;padding:10px;
      display:flex;flex-direction:column;align-items:center;gap:6px;
      box-shadow:0 6px 24px rgba(0,0,0,0.8);
      width:150px;opacity:0;transition:opacity 0.15s;
    `;
    el.innerHTML = `
      <div id="rt-fur-pv-wrap" style="width:120px;height:120px;display:flex;align-items:center;justify-content:center;"></div>
      <div id="rt-fur-pv-name" style="color:var(--nd-text);font-size:10px;font-weight:bold;text-align:center;word-break:break-word;line-height:1.3;"></div>
    `;
    document.body.appendChild(el);
    this._furPreviewEl = el;

    const position = () => {
      const panel = document.getElementById('computer-panel');
      if (!panel || !el) return;
      const r = panel.getBoundingClientRect();
      el.style.left      = `${r.left - 150 - 10}px`;
      el.style.top       = `${r.top + r.height / 2}px`;
      el.style.transform = `translateY(-50%)`;
    };
    position();
    this._furPreviewResize = position;
    window.addEventListener('resize', position);
  }

  private _destroyFurPreview(): void {
    document.getElementById('rt-fur-preview-float')?.remove();
    this._furPreviewEl = null;
    if (this._furPreviewResize) {
      window.removeEventListener('resize', this._furPreviewResize);
      this._furPreviewResize = null;
    }
  }

  // Couch has no FURNITURE_BOUNDS entry — provide the crop manually
  private static readonly _PROCEDURAL_CROP: Partial<Record<FurnitureId, { x: number; y: number; w: number; h: number }>> = {
    couch: { x: 25, y: 235, w: 165, h: 80 },
  };

  private _showFurPreview(id: FurnitureId): void {
    const el = this._furPreviewEl;
    if (!el) return;
    const wrap   = el.querySelector('#rt-fur-pv-wrap')  as HTMLElement;
    const nameEl = el.querySelector('#rt-fur-pv-name')  as HTMLElement;
    wrap.innerHTML = '';
    nameEl.textContent = FURNITURE_DATA[id].label;

    const path = FURNITURE_PATHS[id];

    if (path) {
      const cfg   = this.draftRoom ?? getRoomConfig();
      const color = getFurnitureColor(cfg, id);

      if (PNG_TINT_WHITE_IDS.has(id)) {
        // White-tint items (e.g. plant1): only near-white pixels get the color — mirrors applyWhiteTint in the room
        const W = 120, H = 120;
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        cv.style.cssText = 'image-rendering:pixelated;width:120px;height:120px;';
        const ctx2d = cv.getContext('2d')!;
        ctx2d.fillStyle = '#0d0820';
        ctx2d.fillRect(0, 0, W, H);
        const img = new Image();
        img.onload = () => {
          const pad = 8;
          const scale = Math.min((W - pad * 2) / img.width, (H - pad * 2) / img.height);
          const dw = Math.round(img.width  * scale);
          const dh = Math.round(img.height * scale);
          const dx = Math.round((W - dw) / 2);
          const dy = Math.round((H - dh) / 2);
          if (color && color !== '#ffffff') {
            const tmp = document.createElement('canvas');
            tmp.width = dw; tmp.height = dh;
            const tc = tmp.getContext('2d')!;
            tc.imageSmoothingEnabled = false;
            tc.drawImage(img, 0, 0, dw, dh);
            const imgData = tc.getImageData(0, 0, dw, dh);
            const d = imgData.data;
            const cr = parseInt(color.slice(1, 3), 16);
            const cg = parseInt(color.slice(3, 5), 16);
            const cb = parseInt(color.slice(5, 7), 16);
            for (let i = 0; i < d.length; i += 4) {
              if (d[i + 3] === 0) continue;
              if (d[i] >= 131 && d[i + 1] >= 130 && d[i + 2] >= 130) {
                d[i]     = Math.round(d[i]     * cr / 255);
                d[i + 1] = Math.round(d[i + 1] * cg / 255);
                d[i + 2] = Math.round(d[i + 2] * cb / 255);
              }
            }
            tc.putImageData(imgData, 0, 0);
            ctx2d.imageSmoothingEnabled = false;
            ctx2d.drawImage(tmp, dx, dy);
          } else {
            ctx2d.imageSmoothingEnabled = false;
            ctx2d.drawImage(img, dx, dy, dw, dh);
          }
        };
        img.src = path;
        wrap.appendChild(cv);
        el.style.opacity = '1';
        return;
      }

      // Regular PNG furniture — use HTML img + CSS multiply overlay to avoid canvas compositing artifacts.
      // CSS mix-blend-mode:multiply operates in the compositor and never modifies alpha.
      const pv = document.createElement('div');
      pv.style.cssText = 'position:relative;width:120px;height:120px;background:#0d0820;overflow:hidden;border-radius:4px;flex-shrink:0;';

      const imgEl = document.createElement('img');
      imgEl.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);max-width:104px;max-height:104px;image-rendering:pixelated;';
      imgEl.src = path;
      pv.appendChild(imgEl);

      if (color && color !== '#ffffff') {
        const overlay = document.createElement('div');
        overlay.style.cssText = `position:absolute;inset:0;background:${color};mix-blend-mode:multiply;pointer-events:none;`;
        pv.appendChild(overlay);
      }

      wrap.appendChild(pv);
      el.style.opacity = '1';
      return;
    }

    // Procedural furniture — render on offscreen canvas, crop item region
    const W = 120, H = 120;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.style.cssText = 'image-rendering:pixelated;width:120px;height:120px;';
    const ctx2d = c.getContext('2d')!;
    ctx2d.fillStyle = '#0d0820';
    ctx2d.fillRect(0, 0, W, H);

    const bounds = FURNITURE_BOUNDS[id] ?? RoomTab._PROCEDURAL_CROP[id];
    const pos    = bounds ? getDefaultPos(id) : undefined;
    if (bounds && pos) {
      const GW = 800, GH = 520, FY = 300;
      const off = document.createElement('canvas');
      off.width = GW; off.height = GH;
      const octx = off.getContext('2d')!;
      octx.imageSmoothingEnabled = false;

      const cfg   = this.draftRoom ?? getRoomConfig();
      const wall  = WALL_THEMES[cfg.wallTheme];
      const light = LIGHTING_MOODS[cfg.lighting] ?? LIGHTING_MOODS['teal'];
      const fakeCfg = { ...cfg, furniture: [id] as FurnitureId[], furniturePositions: {} };
      drawMyRoomFurniture(octx, GW, FY, fakeCfg, wall, light, [], [], id);
      drawForegroundItems(octx, GW, GH, fakeCfg, id);

      const pad = 10;
      const cropX = 'x' in bounds ? (bounds as { x: number; y: number; w: number; h: number }).x - pad : pos.x - pad;
      const cropY = 'x' in bounds ? (bounds as { x: number; y: number; w: number; h: number }).y - pad : pos.y - pad;
      const cropW = bounds.w + pad * 2;
      const cropH = bounds.h + pad * 2;

      const scale = Math.min(W / cropW, H / cropH);
      const dw = cropW * scale;
      const dh = cropH * scale;
      ctx2d.imageSmoothingEnabled = false;
      ctx2d.drawImage(off, cropX, cropY, cropW, cropH, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }

    wrap.appendChild(c);
    el.style.opacity = '1';
  }

  private _hideFurPreview(): void {
    if (this._furPreviewEl) this._furPreviewEl.style.opacity = '0';
  }

  render(body: HTMLElement, ctx: TabCtx): void {
    this.body = body;
    this.ctx = ctx;
    if (!this.draftRoom) this.draftRoom = getRoomConfig();

    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="color:var(--nd-subtext);font-size:10px;letter-spacing:0.08em;opacity:0.55;">ROOM CUSTOMIZATION</span>
        <div style="display:flex;gap:6px;">
          <button id="room-preview-btn" style="
            padding:5px 12px;border-radius:4px;cursor:pointer;
            font-family:'Courier New',monospace;font-size:11px;
            background:color-mix(in srgb,var(--nd-accent) 10%,transparent);
            border:1px solid color-mix(in srgb,var(--nd-accent) 35%,transparent);
            color:var(--nd-accent);white-space:nowrap;transition:all 0.12s;
          " onmouseover="this.style.background='color-mix(in srgb,var(--nd-accent) 20%,transparent)'" onmouseout="this.style.background='color-mix(in srgb,var(--nd-accent) 10%,transparent)'">Preview</button>
          <button id="room-save-btn" style="
            padding:5px 12px;border-radius:4px;cursor:pointer;
            font-family:'Courier New',monospace;font-size:11px;
            background:color-mix(in srgb,var(--nd-accent) 20%,transparent);
            border:1px solid color-mix(in srgb,var(--nd-accent) 50%,transparent);
            color:var(--nd-accent);white-space:nowrap;transition:all 0.12s;
          " onmouseover="this.style.background='color-mix(in srgb,var(--nd-accent) 30%,transparent)'" onmouseout="this.style.background='color-mix(in srgb,var(--nd-accent) 20%,transparent)'">Save</button>
        </div>
      </div>
      <div id="room-section-tabs" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:14px;"></div>
      <div id="room-section-body"></div>
    `;

    body.querySelector('#room-preview-btn')?.addEventListener('click', () => this.previewRoom());

    const saveBtn = body.querySelector('#room-save-btn') as HTMLButtonElement | null;
    if (authStore.getState().isGuest) {
      if (saveBtn) saveBtn.style.display = 'none';
    } else {
      saveBtn?.addEventListener('click', () => {
        if (!saveBtn || !this.draftRoom) return;
        const committed = setRoomConfig(this.draftRoom);
        this.ctx?.onRoomChange?.(committed);
        this.ctx?.onPetChange?.(this.draftRoom.pet);
        publishRoomConfig(committed);
        this.previewSaved = true;
        this.previewBaseline = null;
        this.draftRoom = getRoomConfig();
        saveBtn.textContent = 'Saved!';
        saveBtn.disabled = true;
        setTimeout(() => { if (saveBtn.isConnected) { saveBtn.textContent = 'Save'; saveBtn.disabled = false; } }, 1500);
      });
    }

    this.renderRoomSectionTabs();
    this.renderRoomSectionBody();
  }

  resetSection(): void { this.currentRoomSection = 'walls'; }

  revertIfNeeded(): void {
    if (this.previewBaseline && !this.previewSaved) {
      setRoomConfig(this.previewBaseline);
      this.ctx?.onRoomChange?.(getRoomConfig());
    }
  }

  destroy(): void {
    this._destroyFurPreview();
    this.draftRoom = null;
    this.previewBaseline = null;
    this.previewSaved = false;
    this.body = null;
    this.ctx = null;
  }

  private _applyLivePreview(): void {
    if (!this.draftRoom) return;
    if (!this.previewBaseline) this.previewBaseline = getRoomConfig();
    setRoomConfig(this.draftRoom);
    this.ctx?.onRoomChange?.(this.draftRoom);
  }

  private previewRoom(): void {
    if (!this.draftRoom) return;
    if (!this.previewBaseline) this.previewBaseline = getRoomConfig();
    this.previewSaved = false;
    setRoomConfig(this.draftRoom);
    this.ctx?.onRoomChange?.(getRoomConfig());
    this.ctx?.onPetChange?.(this.draftRoom.pet);
    this.ctx?.hideForPreview();
  }

  private renderRoomSectionTabs(): void {
    const body = this.body!;
    const container = body.querySelector('#room-section-tabs');
    if (!container) return;

    const sections = [
      { key: 'walls',     label: 'Walls' },
      { key: 'floor',     label: 'Floor' },
      { key: 'lighting',  label: 'Lights' },
      { key: 'furniture', label: 'Furniture' },
      { key: 'posters',   label: 'Posters' },
      { key: 'pets',      label: 'Pets' },
      { key: 'music',     label: 'Music' },
    ];

    container.innerHTML = sections.map(s => `
      <button class="rs" data-sec="${s.key}" style="
        padding:6px 12px;border-radius:4px;font-family:'Courier New',monospace;font-size:11px;
        cursor:pointer;border:1px solid ${this.currentRoomSection === s.key ? 'color-mix(in srgb,var(--nd-accent) 40%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 20%,transparent)'};
        background:${this.currentRoomSection === s.key ? 'color-mix(in srgb,var(--nd-accent) 13%,transparent)' : 'transparent'};
        color:${this.currentRoomSection === s.key ? 'var(--nd-accent)' : 'var(--nd-subtext)'};
      ">${s.label}</button>
    `).join('');

    container.querySelectorAll('.rs').forEach(el => {
      el.addEventListener('click', () => {
        this.currentRoomSection = (el as HTMLElement).dataset.sec as any;
        this.renderRoomSectionTabs();
        this.renderRoomSectionBody();
      });
    });
  }

  private renderRoomSectionBody(): void {
    const body = this.body!;
    const container = body.querySelector('#room-section-body') as HTMLElement;
    if (!container) return;

    if (this.currentRoomSection === 'furniture') {
      this._initFurPreview();
    } else {
      this._destroyFurPreview();
    }

    switch (this.currentRoomSection) {
      case 'walls':     this.renderWallPicker(container);      break;
      case 'floor':     this.renderFloorPicker(container);     break;
      case 'lighting':  this.renderLightingPicker(container);  break;
      case 'furniture': this.renderFurniturePicker(container); break;
      case 'posters':   this.renderPosterPicker(container);    break;
      case 'pets':      this.renderPets(container);            break;
      case 'music':     this.renderMusicPicker(container);     break;
    }
  }

  private renderWallPicker(container: HTMLElement): void {
    const cfg = this.draftRoom ?? getRoomConfig();
    const all = (Object.entries(WALL_THEMES) as [WallTheme, typeof WALL_THEMES[WallTheme]][]).filter(([key]) => isOwned('wallTheme', key));
    const PER = 9;
    const totalPages = Math.ceil(all.length / PER);
    this._wallPage = Math.min(this._wallPage, totalPages - 1);
    const page = all.slice(this._wallPage * PER, this._wallPage * PER + PER);

    container.innerHTML = `
      <div style="color:var(--nd-text);font-size:12px;margin-bottom:10px;">Wall Theme</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
        ${page.map(([key, theme]) => {
          const active = cfg.wallTheme === key;
          return `
          <button class="wt" data-wall="${key}" style="
            padding:8px 6px 7px;border-radius:6px;font-family:'Courier New',monospace;font-size:10px;
            cursor:pointer;text-align:center;transition:all 0.15s;
            border:2px solid ${active ? 'var(--nd-accent)' : 'rgba(255,255,255,0.08)'};
            background:${active ? 'color-mix(in srgb,var(--nd-accent) 10%,rgba(0,0,0,0.4))' : 'rgba(0,0,0,0.3)'};
            color:${active ? 'var(--nd-accent)' : 'rgba(255,255,255,0.55)'};
          ">
            <div style="width:100%;height:28px;border-radius:3px;margin-bottom:5px;border:1px solid ${theme.accent};box-shadow:inset 0 0 0 1px rgba(255,255,255,0.04);${_wallPreviewStyle(key, theme)}"></div>
            ${esc(theme.label)}
          </button>`;
        }).join('')}
      </div>
      ${totalPages > 1 ? `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
        <button id="wp-prev" style="font-family:'Courier New',monospace;font-size:10px;padding:4px 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.55);cursor:pointer;${this._wallPage === 0 ? 'opacity:0.3;pointer-events:none;' : ''}">← Prev</button>
        <span style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.35);">${this._wallPage + 1} / ${totalPages}</span>
        <button id="wp-next" style="font-family:'Courier New',monospace;font-size:10px;padding:4px 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.55);cursor:pointer;${this._wallPage >= totalPages - 1 ? 'opacity:0.3;pointer-events:none;' : ''}">Next →</button>
      </div>` : ''}
    `;

    container.querySelectorAll('.wt').forEach(el => {
      el.addEventListener('click', () => {
        this.draftRoom = { ...(this.draftRoom ?? getRoomConfig()), wallTheme: (el as HTMLElement).dataset.wall as WallTheme };
        this._applyLivePreview();
        this.renderWallPicker(container);
      });
    });
    container.querySelector('#wp-prev')?.addEventListener('click', () => { this._wallPage--; this.renderWallPicker(container); });
    container.querySelector('#wp-next')?.addEventListener('click', () => { this._wallPage++; this.renderWallPicker(container); });
  }

  private renderFloorPicker(container: HTMLElement): void {
    const cfg = this.draftRoom ?? getRoomConfig();
    const all = (Object.entries(FLOOR_STYLES) as [FloorStyle, typeof FLOOR_STYLES[FloorStyle]][]).filter(([key]) => isOwned('floorStyle', key));
    const PER = 9;
    const totalPages = Math.ceil(all.length / PER);
    this._floorPage = Math.min(this._floorPage, totalPages - 1);
    const floors = all.slice(this._floorPage * PER, this._floorPage * PER + PER);

    const floorPreview = (key: string): string => {
      switch (key) {
        case 'hardwood': return `background:repeating-linear-gradient(180deg,#5a2e10 0px,#5a2e10 10px,#2a1406 10px,#2a1406 12px);`;
        case 'tile':     return `background-color:#1a1838;background-image:linear-gradient(45deg,#2a285044 25%,transparent 25%,transparent 75%,#2a285044 75%),linear-gradient(45deg,#2a285044 25%,#1a1838 25%,#1a1838 75%,#2a285044 75%);background-size:8px 8px;background-position:0 0,4px 4px;`;
        case 'carpet':   return `background:#2e1850;`;
        case 'concrete': return `background-color:#222228;background-image:repeating-linear-gradient(135deg,#2a2a30 0px,#2a2a30 1px,transparent 1px,transparent 4px);background-size:4px 4px;`;
        case 'neon':     return `background-color:#06060e;background-image:linear-gradient(0deg,transparent 85%,rgba(80,220,180,0.5) 85%,rgba(80,220,180,0.5) 90%,transparent 90%),linear-gradient(90deg,transparent 85%,rgba(80,220,180,0.5) 85%,rgba(80,220,180,0.5) 90%,transparent 90%);background-size:10px 10px;`;
        case 'marble':   return `background:#dcd8ec;background-image:linear-gradient(125deg,transparent 28%,rgba(80,72,104,0.35) 30%,rgba(80,72,104,0.15) 33%,transparent 35%),linear-gradient(55deg,transparent 45%,rgba(80,72,104,0.25) 47%,transparent 50%);`;
        case 'tatami':   return `background-color:#2a2010;background-image:repeating-linear-gradient(0deg,rgba(100,80,30,0.5) 0px,rgba(100,80,30,0.5) 1px,transparent 1px,transparent 9px),repeating-linear-gradient(90deg,rgba(100,80,30,0.5) 0px,rgba(100,80,30,0.5) 1px,transparent 1px,transparent 18px);`;
        case 'hex':      return `background-color:#12101e;background-image:linear-gradient(30deg,#1a182c 12%,transparent 12.5%,transparent 87%,#1a182c 87.5%),linear-gradient(150deg,#1a182c 12%,transparent 12.5%,transparent 87%,#1a182c 87.5%),linear-gradient(30deg,#1a182c 12%,transparent 12.5%,transparent 87%,#1a182c 87.5%),linear-gradient(150deg,#1a182c 12%,transparent 12.5%,transparent 87%,#1a182c 87.5%),linear-gradient(60deg,#1a182c 25%,transparent 25.5%,transparent 75%,#1a182c 75.5%),linear-gradient(60deg,#1a182c 25%,transparent 25.5%,transparent 75%,#1a182c 75.5%);background-size:10px 18px;background-position:0 0,0 0,5px 9px,5px 9px,0 0,5px 9px;`;
        case 'bamboo':        return `background-color:#2a2e12;background-image:repeating-linear-gradient(90deg,#3e4418 0px,#3e4418 13px,#1a1e08 13px,#1a1e08 14px),repeating-linear-gradient(0deg,transparent 0px,transparent 7px,rgba(26,30,8,0.6) 7px,rgba(26,30,8,0.6) 9px,transparent 9px,transparent 18px);background-size:14px 18px;`;
        case 'dungeon':       return `background-image:url(assets/furniture/floors/dungeonfloor.png);background-size:cover;`;
        case 'dirtfloor':     return `background-image:url(assets/furniture/floors/dirtfloor.png);background-size:cover;`;
        case 'oldwoodenfloor':return `background-image:url(assets/furniture/floors/oldwoodenfloor.png);background-size:cover;`;
        default:              return `background:#1e1040;`;
      }
    };

    container.innerHTML = `
      <div style="color:var(--nd-text);font-size:12px;margin-bottom:10px;">Floor Style</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
        ${floors.map(([key, style]) => {
          const active = cfg.floorStyle === key;
          return `
          <button class="ft" data-floor="${key}" style="
            padding:8px 6px 7px;border-radius:6px;font-family:'Courier New',monospace;font-size:10px;
            cursor:pointer;text-align:center;transition:all 0.15s;
            border:2px solid ${active ? 'var(--nd-accent)' : 'rgba(255,255,255,0.08)'};
            background:${active ? 'color-mix(in srgb,var(--nd-accent) 10%,rgba(0,0,0,0.4))' : 'rgba(0,0,0,0.3)'};
            color:${active ? 'var(--nd-accent)' : 'rgba(255,255,255,0.55)'};
          ">
            <div style="width:100%;height:24px;border-radius:3px;margin-bottom:5px;border:1px solid rgba(255,255,255,0.08);${floorPreview(key)}"></div>
            ${esc(style.label)}
          </button>`;
        }).join('')}
      </div>
      ${totalPages > 1 ? `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
        <button id="fp-prev" style="font-family:'Courier New',monospace;font-size:10px;padding:4px 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.55);cursor:pointer;${this._floorPage === 0 ? 'opacity:0.3;pointer-events:none;' : ''}">← Prev</button>
        <span style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.35);">${this._floorPage + 1} / ${totalPages}</span>
        <button id="fp-next" style="font-family:'Courier New',monospace;font-size:10px;padding:4px 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.55);cursor:pointer;${this._floorPage >= totalPages - 1 ? 'opacity:0.3;pointer-events:none;' : ''}">Next →</button>
      </div>` : ''}
    `;

    container.querySelectorAll('.ft').forEach(el => {
      el.addEventListener('click', () => {
        this.draftRoom = { ...(this.draftRoom ?? getRoomConfig()), floorStyle: (el as HTMLElement).dataset.floor as FloorStyle };
        this._applyLivePreview();
        this.renderFloorPicker(container);
      });
    });
    container.querySelector('#fp-prev')?.addEventListener('click', () => { this._floorPage--; this.renderFloorPicker(container); });
    container.querySelector('#fp-next')?.addEventListener('click', () => { this._floorPage++; this.renderFloorPicker(container); });
  }

  private renderLightingPicker(container: HTMLElement): void {
    const cfg = this.draftRoom ?? getRoomConfig();
    const all = Object.entries(LIGHTING_MOODS) as [LightingMood, typeof LIGHTING_MOODS[LightingMood]][];
    const PER = 9;
    const totalPages = Math.ceil(all.length / PER);
    this._lightPage = Math.min(this._lightPage, totalPages - 1);
    const moods = all.slice(this._lightPage * PER, this._lightPage * PER + PER);

    container.innerHTML = `
      <div style="color:var(--nd-text);font-size:12px;margin-bottom:10px;">Lighting Mood</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
        ${moods.map(([key, mood]) => {
          const active = cfg.lighting === key;
          return `
          <button class="lt" data-light="${key}" style="
            padding:12px 6px;border-radius:6px;font-family:'Courier New',monospace;font-size:10px;
            cursor:pointer;text-align:center;transition:all 0.15s;
            border:2px solid ${active ? mood.primary : 'rgba(255,255,255,0.08)'};
            background:${active ? mood.primary + '30' : 'rgba(0,0,0,0.25)'};
            color:${active ? mood.primary : 'rgba(255,255,255,0.45)'};
            box-shadow:${active ? `0 0 14px ${mood.primary}44` : 'none'};
          ">
            <div style="width:22px;height:22px;border-radius:50%;margin:0 auto 4px;background:${mood.primary};box-shadow:0 0 ${active ? '16px' : '8px'} ${mood.primary}${active ? 'aa' : '55'};"></div>
            ${esc(mood.label)}
          </button>`;
        }).join('')}
      </div>
      ${totalPages > 1 ? `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
        <button id="lp-prev" style="font-family:'Courier New',monospace;font-size:10px;padding:4px 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.55);cursor:pointer;${this._lightPage === 0 ? 'opacity:0.3;pointer-events:none;' : ''}">← Prev</button>
        <span style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.35);">${this._lightPage + 1} / ${totalPages}</span>
        <button id="lp-next" style="font-family:'Courier New',monospace;font-size:10px;padding:4px 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.55);cursor:pointer;${this._lightPage >= totalPages - 1 ? 'opacity:0.3;pointer-events:none;' : ''}">Next →</button>
      </div>` : ''}
    `;

    container.querySelectorAll('.lt').forEach(el => {
      el.addEventListener('click', () => {
        const key = (el as HTMLElement).dataset.light as LightingMood;
        this.draftRoom = { ...(this.draftRoom ?? getRoomConfig()), lighting: key };
        this._applyLivePreview();
        this.renderLightingPicker(container);
      });
    });
    container.querySelector('#lp-prev')?.addEventListener('click', () => { this._lightPage--; this.renderLightingPicker(container); });
    container.querySelector('#lp-next')?.addEventListener('click', () => { this._lightPage++; this.renderLightingPicker(container); });
  }

  private renderFurniturePicker(container: HTMLElement): void {
    const cfg = this.draftRoom ?? getRoomConfig();

    const PALETTES: Record<FurnitureId, { label: string; colors: string[] }> = {
      desk:         { label: 'Wood Tones',   colors: ['#2e1e0e','#3d2810','#5a3818','#7a5230','#1a1208','#2a2218','#0e0c08','#4a3020'] },
      bookshelf:    { label: 'Wood Tones',   colors: ['#2a1a08','#3a2610','#5a3818','#7a5230','#1a1208','#3d3020','#0e0c08','#4a3828'] },
      couch:        { label: 'Fabric',       colors: ['#3d2860','#6b2840','#283d6b','#28503d','#5a3a1a','#5a1a1a','#1a1a5a','#4a4a4a'] },
      plant:        { label: 'Pot Colors',   colors: ['#1e3a1a','#3a2818','#c87840','#a85030','#2a3a4a','#3a1a3a','#4a4020','#8a6040'] },
      rug:          { label: 'Fabric',       colors: ['#2a1858','#581828','#183058','#184830','#484018','#381838','#282858','#582818'] },
      lamp:         { label: 'Metal / Wood', colors: ['#1e1432','#2a2010','#3a3030','#1a2a1a','#302010','#1a1a2a','#2a1a10','#3a2828'] },
      speaker:      { label: 'Casing',       colors: ['#1e1432','#181818','#1a2818','#281818','#1a1828','#282010','#203028','#282828'] },
      minifridge:   { label: 'Casing',       colors: ['#1e1432','#181828','#1a2a1a','#2a1a1a','#1a2028','#282828','#202820','#1a1818'] },
      beanbag:      { label: 'Fabric',       colors: ['#c44060','#e0603a','#40a060','#4060c4','#a040a0','#c0a030','#30a0a0','#c06040'] },
      arcade:       { label: 'Cabinet',      colors: ['#1e1432','#1a0808','#081a08','#08081a','#201008','#0a1020','#181020','#201818'] },
      tv:           { label: 'Bezel',        colors: ['#1a1830','#181818','#141420','#201418','#181420','#141818','#1a1818','#141414'] },
      pet_bed:      { label: 'Cushion',      colors: ['#7a3858','#c44060','#6b2840','#3d5a80','#2a6040','#7a4828','#6040a0','#5a5a5a'] },
      cat_tree:     { label: 'Sisal / Wood', colors: ['#5a3a1a','#7a5530','#3a2810','#8a7050','#2a1808','#6a4a28','#4a3818','#9a8060'] },
      pet_bowl:     { label: 'Bowl Color',   colors: ['#2a1e3e','#181828','#2a2010','#1a2a1a','#281a18','#1e2a28','#281828','#202028'] },
      coffee_table: { label: 'Wood Tones',   colors: ['#2a1a0c','#3d2810','#5a3818','#7a5230','#1a1208','#2a2218','#4a3020','#0e0c08'] },
      record_player:{ label: 'Casing',       colors: ['#1e1432','#181818','#181028','#1a0808','#0a0a18','#201028','#281020','#0a0818'] },
      lava_lamp:    { label: 'Blob Color',   colors: ['#e87aab','#7b68ee','#5dcaa5','#f0b040','#e85454','#ff6090','#60d0ff','#aaff44'] },
      whiteboard:   { label: 'Frame Wood',   colors: ['#2a1a0c','#3d2810','#5a3818','#7a5230','#1a1208','#2a2218','#3a2218','#4a3020'] },
      server_rack:  { label: 'Casing',       colors: ['#1e1432','#181818','#1a0808','#081a08','#08081a','#201028','#1a1828','#282828'] },
      candles:      { label: 'Wax Color',    colors: ['#f0e0a8','#f5e8d0','#e8d0b0','#d0c8e0','#e0f0e8','#f0d0d0','#e8e0f0','#f8f0e8'] },
      record_crates:{ label: 'Crate Color',  colors: ['#c87840','#e09050','#a06030','#d0a060','#8a5020','#e8b870','#c06820','#b05818'] },
      trunk:        { label: 'Wood / Leather', colors: ['#3a2410','#5a3818','#2a1808','#7a5030','#1a1008','#4a3020','#3a2818','#6a4828'] },
      bookstack:    { label: 'Spine Color',  colors: ['#2a1858','#581828','#183058','#184830','#484018','#381838','#282858','#582818'] },
      bar_cart:     { label: 'Frame Color',  colors: ['#2a2a2a','#1a1a1a','#3a3030','#2a2018','#383030','#282838','#303828','#383028'] },
      walltapestry1:{ label: 'Fabric',       colors: ['#d4c4a8','#8b4513','#2f4f4f','#4b0082','#8b0000','#006400','#1a1a2e','#5c4033'] },
      walltapestry2:{ label: 'Fabric',       colors: ['#d4c4a8','#8b4513','#2f4f4f','#4b0082','#8b0000','#006400','#1a1a2e','#5c4033'] },
      walltapestry3:{ label: 'Fabric',       colors: ['#d4c4a8','#8b4513','#2f4f4f','#4b0082','#8b0000','#006400','#1a1a2e','#5c4033'] },
      sworddec:       { label: 'Metal',        colors: ['#c8c8c8','#a8a8a8','#888888','#c8a060','#a07840','#805830','#6060a0','#404040'] },
      persianrugwall1:{ label: 'Fabric',       colors: ['#d4c4a8','#8b4513','#2f4f4f','#4b0082','#8b0000','#006400','#1a1a2e','#5c4033'] },
      persianrug:     { label: 'Fabric',       colors: ['#2a1858','#581828','#183058','#184830','#484018','#381838','#282858','#582818'] },
      bearskin:       { label: 'Fur Color',    colors: ['#c8b89a','#a89070','#887050','#d4c4a8','#6b4c2a','#e8d8b8','#4a3020','#f0e8d0'] },
      striperug:      { label: 'Stripe Color', colors: ['#2a1858','#581828','#183058','#184830','#484018','#381838','#282858','#582818'] },
      armchair:       { label: 'Fabric',       colors: ['#3d2860','#6b2840','#283d6b','#28503d','#5a3a1a','#5a1a1a','#1a1a5a','#4a4a4a'] },
      plant1:         { label: 'Pot Color',    colors: ['#ffffff','#c87840','#3d2860','#8b0000','#1e3a1a','#2a1a08','#1a1a2e','#b08060'] },
      plant2:         { label: 'Pot Color',    colors: ['#ffffff','#c87840','#3d2860','#8b0000','#1e3a1a','#2a1a08','#1a1a2e','#b08060'] },
      plant3:         { label: 'Pot Color',    colors: ['#ffffff','#c87840','#3d2860','#8b0000','#1e3a1a','#2a1a08','#1a1a2e','#b08060'] },
      plant4:         { label: 'Pot Color',    colors: ['#ffffff','#c87840','#3d2860','#8b0000','#1e3a1a','#2a1a08','#1a1a2e','#b08060'] },
      plant5:         { label: 'Pot Color',    colors: ['#ffffff','#c87840','#3d2860','#8b0000','#1e3a1a','#2a1a08','#1a1a2e','#b08060'] },
      nostrsign:      { label: 'Sign Color',   colors: ['#7b2ff7','#5dcaa5','#e87aab','#f0b040','#00e5ff','#e85454','#aaff44','#ffffff'] },
      plant6:            { label: 'Pot Color',    colors: ['#ffffff','#c87840','#3d2860','#8b0000','#1e3a1a','#2a1a08','#1a1a2e','#b08060'] },
      cactus:            { label: 'Pot Color',    colors: ['#ffffff','#c87840','#3d2860','#8b0000','#1e3a1a','#2a1a08','#1a1a2e','#b08060'] },
      daffodils:         { label: 'Pot Color',    colors: ['#ffffff','#c87840','#3d2860','#8b0000','#1e3a1a','#2a1a08','#1a1a2e','#b08060'] },
      neonskull:         { label: 'Sign Color',   colors: ['#ff3355','#5dcaa5','#7b68ee','#00e5ff','#f0b040','#e87aab','#aaff44','#ffffff'] },
      neoncoffee:        { label: 'Sign Color',   colors: ['#ff9020','#5dcaa5','#7b68ee','#00e5ff','#e87aab','#ff3355','#aaff44','#ffffff'] },
      decoratedcouch:    { label: 'Fabric',       colors: ['#3d2860','#6b2840','#283d6b','#28503d','#5a3a1a','#5a1a1a','#1a1a5a','#4a4a4a'] },
      decoratedarmchair: { label: 'Fabric',       colors: ['#3d2860','#6b2840','#283d6b','#28503d','#5a3a1a','#5a1a1a','#1a1a5a','#4a4a4a'] },
      tigerskin:         { label: 'Fur Tint',     colors: ['#ffffff'] },
      coelacanthmount:   { label: 'Mount',        colors: ['#ffffff'] },
      safe:              { label: 'Safe',         colors: ['#ffffff'] },
      neongfy:           { label: 'Sign Color',   colors: ['#ff3355','#5dcaa5','#7b68ee','#00e5ff','#f0b040','#e87aab','#aaff44','#ffffff'] },
      neon58k:           { label: 'Sign Color',   colors: ['#ff3355','#5dcaa5','#7b68ee','#00e5ff','#f0b040','#e87aab','#aaff44','#ffffff'] },
      bitcoincircularrug: { label: 'Rug Tint',    colors: ['#2a1858','#581828','#183058','#184830','#484018','#381838','#282858','#582818'] },
      endtable:           { label: 'Wood Tones',  colors: ['#2a1a08','#3d2810','#5a3818','#7a5230','#1a1208','#2a2218','#4a3020','#0e0c08'] },
    };

    const CATEGORIES: Record<string, { label: string; emoji: string; items: FurnitureId[] }> = {
      lounge: { label: 'Lounge', emoji: '🛋', items: ['couch', 'armchair', 'beanbag', 'rug', 'persianrug', 'bearskin', 'striperug', 'tigerskin', 'bitcoincircularrug', 'coffee_table', 'endtable', 'candles', 'trunk', 'bar_cart', 'safe', 'decoratedcouch', 'decoratedarmchair'] },
      decor:  { label: 'Decor',  emoji: '🌿', items: ['lamp', 'lava_lamp', 'whiteboard', 'bookshelf', 'bookstack', 'walltapestry1', 'walltapestry2', 'walltapestry3', 'sworddec', 'persianrugwall1', 'coelacanthmount', 'plant', 'plant1', 'plant2', 'plant3', 'plant4', 'plant5', 'plant6', 'daffodils', 'cactus'] },
      tech:   { label: 'Tech',   emoji: '🖥',  items: ['desk', 'nostrsign', 'neonskull', 'neoncoffee', 'neongfy', 'neon58k', 'speaker', 'minifridge', 'arcade', 'tv', 'record_player', 'server_rack', 'record_crates'] },
      pets:   { label: 'Pets',   emoji: '🐾', items: ['pet_bed', 'cat_tree', 'pet_bowl'] },
    };

    const cat = this.activeFurnitureCategory;
    const allCatItems = (CATEGORIES[cat]?.items ?? CATEGORIES['lounge'].items)
      .filter(id => id === 'desk' || isOwned('furniture', id));
    const PAGE_SIZE = 8;
    const totalPages = Math.ceil(allCatItems.length / PAGE_SIZE);
    const page = Math.min(this.activeFurniturePage, totalPages - 1);
    const catItems = allCatItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const activeColor = this.activeFurnitureColor;
    const activePalette = activeColor ? PALETTES[activeColor] : null;
    const currentColor = activeColor ? getFurnitureColor(cfg, activeColor) : null;

    const pubkey = authStore.getState().pubkey ?? '';
    const freeFlower = pubkey ? getFreeFlowerForPubkey(pubkey) : '';

    const furItemHTML = (id: FurnitureId) => {
      const data = FURNITURE_DATA[id];
      const active = cfg.furniture.includes(id);
      const isDesk = id === 'desk';
      const locked = !isDesk && !isOwned('furniture', id);
      const color = getFurnitureColor(cfg, id);
      const isExpanded = activeColor === id;
      const isFreeFlower = id.startsWith('plant') && id === freeFlower;
      return `
        <div style="
          border-radius:6px;overflow:hidden;
          border:1px solid ${locked ? 'rgba(255,255,255,0.06)' : isExpanded ? 'var(--nd-accent)' : active || isDesk ? 'color-mix(in srgb,var(--nd-accent) 55%,transparent)' : 'rgba(255,255,255,0.07)'};
          background:${locked ? 'rgba(0,0,0,0.15)' : active || isDesk ? 'color-mix(in srgb,var(--nd-accent) 12%,rgba(0,0,0,0.3))' : 'rgba(0,0,0,0.2)'};
          opacity:${isDesk ? '0.75' : locked ? '0.6' : '1'};
        ">
          <div class="fur-row" data-fid="${id}" data-locked="${locked}" style="
            padding:8px 10px;display:flex;align-items:center;gap:8px;
            cursor:${isDesk || locked ? 'default' : 'pointer'};
          ">
            <div style="flex:1;min-width:0;">
              <div style="font-size:11px;color:${locked ? 'rgba(255,255,255,0.3)' : active || isDesk ? 'var(--nd-accent)' : 'rgba(255,255,255,0.45)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(data.label)}</div>
              <div style="font-size:9px;color:${locked ? 'rgba(255,255,255,0.2)' : active || isDesk ? 'var(--nd-accent)' : 'rgba(255,255,255,0.3)'};opacity:${active || isDesk ? '0.6' : '0.8'};">${isDesk ? 'Always on' : locked ? (isFreeFlower ? '🌸 Free — log in' : '🔒 Buy in Market') : active ? 'Placed' : 'Tap to add'}</div>
            </div>
            ${(active || isDesk) ? `
              <div class="fur-palette-btn" data-fid="${id}" style="
                width:16px;height:16px;border-radius:3px;flex-shrink:0;
                background:${color};border:1px solid rgba(255,255,255,0.2);
                cursor:pointer;
              " title="Change color"></div>
            ` : ''}
          </div>
          ${isExpanded && activePalette ? `
            <div style="padding:6px 8px 8px;border-top:1px solid color-mix(in srgb,var(--nd-accent) 13%,transparent);">
              <div style="font-size:9px;color:var(--nd-subtext);opacity:0.6;margin-bottom:5px;">${activePalette.label}</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px;">
                ${activePalette.colors.map(c => `
                  <div class="pal-swatch" data-fid="${id}" data-color="${c}" style="
                    width:20px;height:20px;border-radius:3px;cursor:pointer;
                    background:${c};
                    border:2px solid ${currentColor === c ? 'var(--nd-accent)' : 'rgba(255,255,255,0.12)'};
                    transition:transform 0.1s;
                  "></div>
                `).join('')}
                <div class="pal-reset" data-fid="${id}" style="
                  width:20px;height:20px;border-radius:3px;cursor:pointer;
                  background:transparent;border:1px solid color-mix(in srgb,var(--nd-dpurp) 33%,transparent);
                  display:flex;align-items:center;justify-content:center;
                  font-size:11px;color:var(--nd-dpurp);
                " title="Reset">↺</div>
              </div>
            </div>
          ` : ''}
        </div>
      `;
    };

    container.innerHTML = `
      <div style="color:var(--nd-text);font-size:12px;margin-bottom:8px;">Furniture</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:10px;">
        ${Object.entries(CATEGORIES).map(([key, c]) => {
          const isActive = cat === key;
          const ownedItems = c.items.filter(id => id === 'desk' || isOwned('furniture', id));
          const placedCount = ownedItems.filter(id => id === 'desk' || cfg.furniture.includes(id)).length;
          return `
            <button class="fur-cat" data-cat="${key}" style="
              padding:6px 4px;border-radius:5px;font-family:'Courier New',monospace;font-size:9px;
              cursor:pointer;text-align:center;line-height:1.4;
              background:${isActive ? 'color-mix(in srgb,var(--nd-accent) 18%,rgba(0,0,0,0.45))' : 'rgba(0,0,0,0.25)'};
              color:${isActive ? 'var(--nd-accent)' : 'rgba(255,255,255,0.4)'};
              border:1px solid ${isActive ? 'color-mix(in srgb,var(--nd-accent) 50%,transparent)' : 'rgba(255,255,255,0.06)'};
            ">
              <div style="font-size:13px;line-height:1.2;">${c.emoji}</div>
              <div style="font-weight:bold;">${c.label}</div>
              <div style="font-size:8px;opacity:0.55;">${placedCount}/${ownedItems.length}</div>
            </button>
          `;
        }).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:5px;">
        ${catItems.map(id => furItemHTML(id)).join('')}
      </div>
      ${totalPages > 1 ? `
        <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:8px;">
          <button class="fur-page-prev" style="
            font-family:'Courier New',monospace;font-size:10px;padding:3px 10px;border-radius:4px;cursor:pointer;
            background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.5);
            border:1px solid rgba(255,255,255,0.1);
            opacity:${page === 0 ? '0.3' : '1'};pointer-events:${page === 0 ? 'none' : 'auto'};
          ">← prev</button>
          <span style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.35);">${page + 1} / ${totalPages}</span>
          <button class="fur-page-next" style="
            font-family:'Courier New',monospace;font-size:10px;padding:3px 10px;border-radius:4px;cursor:pointer;
            background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.5);
            border:1px solid rgba(255,255,255,0.1);
            opacity:${page === totalPages - 1 ? '0.3' : '1'};pointer-events:${page === totalPages - 1 ? 'none' : 'auto'};
          ">next →</button>
        </div>
      ` : ''}
    `;

    container.querySelectorAll('.fur-cat').forEach(el => {
      el.addEventListener('click', () => {
        this.activeFurnitureCategory = (el as HTMLElement).dataset.cat!;
        this.activeFurnitureColor = null;
        this.activeFurniturePage = 0;
        this.renderFurniturePicker(container);
      });
    });
    container.querySelector('.fur-page-prev')?.addEventListener('click', () => {
      this.activeFurniturePage = Math.max(0, page - 1);
      this.renderFurniturePicker(container);
    });
    container.querySelector('.fur-page-next')?.addEventListener('click', () => {
      this.activeFurniturePage = Math.min(totalPages - 1, page + 1);
      this.renderFurniturePicker(container);
    });
    container.querySelectorAll('.fur-row').forEach(el => {
      el.addEventListener('click', (e) => {
        const fid = (el as HTMLElement).dataset.fid as FurnitureId;
        if (fid === 'desk') return;
        if ((el as HTMLElement).dataset.locked === 'true') return;
        if ((e.target as HTMLElement).classList.contains('fur-palette-btn')) return;
        if ((e.target as HTMLElement).classList.contains('pal-swatch')) return;
        if ((e.target as HTMLElement).classList.contains('pal-reset')) return;
        if (this.activeFurnitureColor === fid) { this.activeFurnitureColor = null; this.renderFurniturePicker(container); return; }
        if (this.activeFurnitureColor !== null) this.activeFurnitureColor = null;
        const base = this.draftRoom ?? getRoomConfig();
        const furniture = [...base.furniture];
        const idx = furniture.indexOf(fid);
        const adding = idx < 0;
        if (idx >= 0) furniture.splice(idx, 1); else furniture.push(fid);
        this.draftRoom = { ...base, furniture };
        this._applyLivePreview();
        if (adding && fid !== 'bookshelf' && this.ctx?.onEnterArrange) {
          // Auto-commit so closing won't revert, then hand off to arrange mode
          setRoomConfig(this.draftRoom);
          this.previewSaved = true;
          this.previewBaseline = null;
          this.ctx.onEnterArrange(fid);
          return;
        }
        this.renderFurniturePicker(container);
      });
    });

    container.querySelectorAll('.fur-row').forEach(el => {
      el.addEventListener('mouseenter', () => this._showFurPreview((el as HTMLElement).dataset.fid as FurnitureId));
      el.addEventListener('mouseleave', () => this._hideFurPreview());
    });

    container.querySelectorAll('.fur-palette-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const fid = (el as HTMLElement).dataset.fid as FurnitureId;
        this.activeFurnitureColor = this.activeFurnitureColor === fid ? null : fid;
        this.renderFurniturePicker(container);
      });
    });
    container.querySelectorAll('.pal-swatch').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const fid = (el as HTMLElement).dataset.fid as FurnitureId;
        const color = (el as HTMLElement).dataset.color!;
        // Commit directly — not subject to the preview/revert system so closing without Save won't undo it
        setFurnitureColor(fid, color);
        const base = this.draftRoom ?? getRoomConfig();
        this.draftRoom = { ...base, furnitureColors: { ...base.furnitureColors, [fid]: color } };
        // Keep previewBaseline in sync so a later revert doesn't undo this committed change
        if (this.previewBaseline) {
          this.previewBaseline = { ...this.previewBaseline, furnitureColors: { ...this.previewBaseline.furnitureColors, [fid]: color } };
        }
        this.ctx?.onRoomChange?.(getRoomConfig());
        this.renderFurniturePicker(container);
      });
    });
    container.querySelectorAll('.pal-reset').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const fid = (el as HTMLElement).dataset.fid as FurnitureId;
        const defaultColor = DEFAULT_FURNITURE_COLORS[fid];
        setFurnitureColor(fid, defaultColor);
        const base = this.draftRoom ?? getRoomConfig();
        this.draftRoom = { ...base, furnitureColors: { ...base.furnitureColors, [fid]: defaultColor } };
        if (this.previewBaseline) {
          this.previewBaseline = { ...this.previewBaseline, furnitureColors: { ...this.previewBaseline.furnitureColors, [fid]: defaultColor } };
        }
        this.ctx?.onRoomChange?.(getRoomConfig());
        this.renderFurniturePicker(container);
      });
    });
  }

  private renderPosterPicker(container: HTMLElement): void {
    const cfg = this.draftRoom ?? getRoomConfig();
    const slotLabels = ['Left Wall', 'Center Wall', 'Right Wall'];

    container.innerHTML = `
      <div style="color:var(--nd-text);font-size:12px;margin-bottom:10px;">Wall Posters</div>
      <div style="display:flex;gap:4px;margin-bottom:12px;">
        ${[0, 1, 2].map(i => {
          const slotActive = this.activePosterSlot === i;
          return `
          <button class="ps" data-pslot="${i}" style="
            flex:1;padding:7px 6px;border-radius:4px;font-family:'Courier New',monospace;font-size:10px;
            cursor:pointer;text-align:center;
            border:1px solid ${slotActive ? 'var(--nd-accent)' : 'rgba(255,255,255,0.1)'};
            background:${slotActive ? 'color-mix(in srgb,var(--nd-accent) 18%,rgba(0,0,0,0.3))' : 'rgba(0,0,0,0.25)'};
            color:${slotActive ? 'var(--nd-accent)' : 'rgba(255,255,255,0.45)'};
          ">${slotLabels[i]}<br/><span style="font-size:9px;opacity:0.7;">${POSTER_DATA[cfg.posters[i]].label}</span></button>`;
        }).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
        ${ALL_POSTERS.map(id => {
          const data = POSTER_DATA[id];
          const active = cfg.posters[this.activePosterSlot] === id;
          return `
            <button class="po" data-pid="${id}" style="
              padding:10px 6px;border-radius:6px;font-family:'Courier New',monospace;font-size:10px;
              cursor:pointer;text-align:center;transition:all 0.15s;
              border:1px solid ${active ? 'var(--nd-accent)' : 'rgba(255,255,255,0.08)'};
              background:${active ? 'color-mix(in srgb,var(--nd-accent) 22%,rgba(0,0,0,0.3))' : 'rgba(0,0,0,0.2)'};
              color:${active ? 'var(--nd-accent)' : 'rgba(255,255,255,0.5)'};
            ">
              <span style="font-size:9px;">${esc(data.label)}</span>
            </button>`;
        }).join('')}
      </div>
    `;

    container.querySelectorAll('.ps').forEach(el => {
      el.addEventListener('click', () => {
        this.activePosterSlot = Number((el as HTMLElement).dataset.pslot) as 0 | 1 | 2;
        this.renderPosterPicker(container);
      });
    });
    container.querySelectorAll('.po').forEach(el => {
      el.addEventListener('click', () => {
        const pid = (el as HTMLElement).dataset.pid as PosterId;
        const base = this.draftRoom ?? getRoomConfig();
        const posters = [...base.posters] as [PosterId, PosterId, PosterId];
        posters[this.activePosterSlot] = pid;
        this.draftRoom = { ...base, posters };
        this._applyLivePreview();
        this.renderPosterPicker(container);
      });
    });
  }

  private renderPets(container: HTMLElement): void {
    const current = this.draftRoom ? this.draftRoom.pet : getPet();

    const petCard = (species: PetSpecies, breed: number, name: string, scale = 1.0) => {
      const isSelected = current.species === species && current.breed === breed;
      const imgUrl = `pets/${species}-${breed}-idle.png`;
      const baseH      = species === 'dog' ? 60 : 52;
      const dispH      = Math.round(baseH * scale);
      const dispW      = dispH;
      const nativeSize = species === 'dog' ? 100 : 50;
      const idleFrames = 10;
      const bgW        = Math.round(nativeSize * idleFrames * (dispH / nativeSize));
      const bgSize     = `${bgW}px ${dispH}px`;
      return `
        <button class="pet-btn" data-species="${species}" data-breed="${breed}" style="
          display:flex;flex-direction:column;align-items:center;gap:4px;
          padding:8px 6px;border-radius:6px;cursor:pointer;
          border:1px solid ${isSelected ? 'color-mix(in srgb,var(--nd-accent) 53%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 20%,transparent)'};
          background:${isSelected ? 'color-mix(in srgb,var(--nd-accent) 10%,transparent)' : 'color-mix(in srgb,black 35%,var(--nd-bg))'};
          color:${isSelected ? 'var(--nd-accent)' : 'var(--nd-text)'};
          font-family:'Courier New',monospace;font-size:9px;transition:all 0.12s;
        ">
          <div style="
            width:${dispW}px;height:${dispH}px;overflow:hidden;
            background-image:url('${imgUrl}');background-size:${bgSize};
            background-position:0 0;background-repeat:no-repeat;image-rendering:pixelated;
          "></div>
          <span>${esc(name)}</span>
        </button>
      `;
    };

    container.innerHTML = `
      <button class="pet-btn" data-species="none" data-breed="0" style="
        width:100%;padding:8px;border-radius:6px;cursor:pointer;
        border:1px solid ${current.species === 'none' ? 'color-mix(in srgb,var(--nd-accent) 66%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 20%,transparent)'};
        background:${current.species === 'none' ? 'color-mix(in srgb,var(--nd-accent) 18%,transparent)' : 'transparent'};
        color:${current.species === 'none' ? 'var(--nd-accent)' : 'var(--nd-subtext)'};
        font-family:'Courier New',monospace;font-size:11px;margin-bottom:12px;display:block;
      ">No Pet</button>
      <div style="color:var(--nd-accent);font-size:10px;font-weight:bold;margin-bottom:8px;letter-spacing:1px;">DOGS</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:14px;">
        ${DOG_BREEDS.map(b => petCard('dog', b.id, b.name, b.scale)).join('')}
      </div>
      <div style="color:var(--nd-accent);font-size:10px;font-weight:bold;margin-bottom:8px;letter-spacing:1px;">CATS</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
        ${CAT_BREEDS.map(b => petCard('cat', b.id, b.name)).join('')}
      </div>
    `;

    container.querySelectorAll('.pet-btn').forEach(el => {
      el.addEventListener('click', () => {
        const species = (el as HTMLElement).dataset.species as PetSpecies;
        const breed   = Number((el as HTMLElement).dataset.breed);
        const base = this.draftRoom ?? getRoomConfig();
        this.draftRoom = { ...base, pet: { species, breed } };
        this.renderPets(container);
      });
    });
  }

  private renderMusicPicker(container: HTMLElement): void {
    const snd = SoundEngine.get();
    const allOptions: { id: MyRoomTrackId; label: string }[] = [
      { id: 'off', label: 'Off' },
      ...MYROOM_TRACKS,
    ];

    const render = () => {
      container.innerHTML = `
        <div style="padding:8px 0;">
          <div style="color:var(--nd-subtext);font-size:10px;letter-spacing:0.08em;margin-bottom:12px;">ROOM TRACK</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${allOptions.map(t => {
              const active = t.id === snd.myRoomTrack;
              return `
                <div class="mu-track" data-trackid="${t.id}" style="
                  display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:6px;cursor:pointer;
                  border:1px solid ${active ? 'var(--nd-accent)' : 'rgba(255,255,255,0.08)'};
                  background:${active ? 'color-mix(in srgb,var(--nd-accent) 18%,rgba(0,0,0,0.3))' : 'rgba(0,0,0,0.2)'};
                  transition:background 0.15s,border-color 0.15s;
                ">
                  <span style="display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0;
                    background:${active ? 'var(--nd-accent)' : 'transparent'};
                    border:1px solid ${active ? 'var(--nd-accent)' : 'rgba(255,255,255,0.3)'};
                    box-shadow:${active ? '0 0 6px var(--nd-accent)' : 'none'};
                  "></span>
                  <span style="color:${active ? 'var(--nd-accent)' : 'rgba(255,255,255,0.6)'};font-size:12px;">${esc(t.label)}</span>
                  ${active ? `<span style="color:var(--nd-accent);font-size:10px;margin-left:auto;opacity:0.7;">${t.id === 'off' ? 'silent' : 'playing'}</span>` : ''}
                </div>
              `;
            }).join('')}
          </div>
          <div style="color:var(--nd-subtext);font-size:10px;opacity:0.45;margin-top:14px;line-height:1.5;">
            Music by Kevin MacLeod (incompetech.com)<br>Licensed under CC BY 4.0
          </div>
        </div>
      `;

      container.querySelectorAll('.mu-track').forEach(el => {
        (el as HTMLElement).addEventListener('mouseenter', () => {
          if ((el as HTMLElement).dataset.trackid !== snd.myRoomTrack)
            (el as HTMLElement).style.background = 'color-mix(in srgb,var(--nd-dpurp) 12%,transparent)';
        });
        (el as HTMLElement).addEventListener('mouseleave', () => {
          if ((el as HTMLElement).dataset.trackid !== snd.myRoomTrack)
            (el as HTMLElement).style.background = 'transparent';
        });
        (el as HTMLElement).addEventListener('click', () => {
          const tid = (el as HTMLElement).dataset.trackid as MyRoomTrackId;
          snd.setMyRoomTrack(tid);
          this.ctx?.onMusicChange?.(tid);
          render();
        });
      });
    };

    render();
  }
}

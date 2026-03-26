/**
 * ComputerUI.ts — Interactive computer terminal in MY ROOM
 *
 * Opens when player presses E near the computer desk.
 * Tabs: Wardrobe, Profile (kind:0 edit), Room Customization
 */

import { P } from '../config/game.config';
import { AvatarConfig, getAvatar, setAvatar, AVATAR_OPTIONS, COLOR_PRESETS } from '../stores/avatarStore';
import { renderRoomSprite } from '../entities/AvatarRenderer';
import { authStore } from '../stores/authStore';
import { publishEvent, signEvent } from '../nostr/nostrService';
import {
  getRoomConfig, setRoomConfig, toggleFurniture, setPoster, markSetupComplete,
  setFurnitureColor, getFurnitureColor, DEFAULT_FURNITURE_COLORS,
  WALL_THEMES, FLOOR_STYLES, LIGHTING_MOODS, FURNITURE_DATA, POSTER_DATA,
  ALL_FURNITURE, ALL_POSTERS,
  WallTheme, FloorStyle, LightingMood, FurnitureId, PosterId, RoomConfig,
} from '../stores/roomStore';

const PANEL_ID = 'computer-panel';

type OnAvatarChange = (avatar: AvatarConfig) => void;
type OnRoomChange = (config: RoomConfig) => void;

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

export class ComputerUI {
  private backdrop: HTMLDivElement | null = null;
  private panel: HTMLDivElement | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private onAvatarChange: OnAvatarChange | null = null;
  private onProfileSave: ((name: string) => void) | null = null;
  private onRoomChange: OnRoomChange | null = null;
  private currentTab: 'wardrobe' | 'profile' | 'room' = 'wardrobe';
  private currentSlot = 'top';
  private currentRoomSection: 'walls' | 'floor' | 'lighting' | 'furniture' | 'posters' = 'walls';
  private activePosterSlot: 0 | 1 | 2 = 0;
  private activeFurnitureColor: FurnitureId | null = null;

  open(onAvatarChange?: OnAvatarChange, onProfileSave?: (name: string) => void, onRoomChange?: OnRoomChange): void {
    if (this.panel) this.close();
    this.onAvatarChange = onAvatarChange || null;
    this.onProfileSave = onProfileSave || null;
    this.onRoomChange = onRoomChange || null;
    this.currentTab = 'wardrobe';
    this.buildPanel();
  }

  /** Open directly to the Room tab (for first-time setup) */
  openToRoom(onAvatarChange?: OnAvatarChange, onProfileSave?: (name: string) => void, onRoomChange?: OnRoomChange): void {
    if (this.panel) this.close();
    this.onAvatarChange = onAvatarChange || null;
    this.onProfileSave = onProfileSave || null;
    this.onRoomChange = onRoomChange || null;
    this.currentTab = 'room';
    this.currentRoomSection = 'walls';
    this.buildPanel();
  }

  close(): void {
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    if (this.backdrop) { this.backdrop.remove(); this.backdrop = null; }
    if (this.panel) { this.panel.remove(); this.panel = null; }
  }

  isOpen(): boolean { return !!this.panel; }

  private buildPanel(): void {
    this.backdrop = document.createElement('div');
    this.backdrop.style.cssText = `
      position:fixed;inset:0;z-index:2999;
      background:rgba(4,2,12,0.35);backdrop-filter:blur(1px);
    `;
    this.backdrop.addEventListener('click', () => this.close());
    document.body.appendChild(this.backdrop);

    this.panel = document.createElement('div');
    this.panel.id = PANEL_ID;
    this.panel.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:3000;
      background:linear-gradient(180deg,#0a0818,#0e0828);
      border:1px solid ${P.teal}44;border-radius:10px;
      font-family:'Courier New',monospace;
      box-shadow:0 8px 30px rgba(0,0,0,0.8),0 0 40px ${P.teal}08;
      width:460px;max-width:94vw;max-height:88vh;overflow:hidden;
      display:flex;flex-direction:column;
    `;

    this.panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid ${P.dpurp}33;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="color:${P.teal};font-size:11px;">&#9679;</span>
          <span style="color:${P.lcream};font-size:14px;font-weight:bold;">TERMINAL</span>
        </div>
        <button id="comp-close" style="background:none;border:none;color:${P.dpurp};font-size:18px;cursor:pointer;padding:4px 8px;">\u2715</button>
      </div>
      <div id="comp-tabs" style="display:flex;border-bottom:1px solid ${P.dpurp}22;"></div>
      <div id="comp-body" style="flex:1;overflow-y:auto;padding:16px 18px;"></div>
    `;

    this.panel.addEventListener('keydown', (e) => e.stopPropagation());
    this.panel.addEventListener('mousedown', (e) => e.stopPropagation());
    document.body.appendChild(this.panel);

    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
    document.addEventListener('keydown', this.keydownHandler);

    this.panel.querySelector('#comp-close')!.addEventListener('click', () => this.close());

    this.renderTabs();
    this.renderBody();
  }

  private renderTabs(): void {
    const container = this.panel?.querySelector('#comp-tabs');
    if (!container) return;

    const tabs = [
      { key: 'wardrobe', label: '\uD83D\uDC55 Wardrobe' },
      { key: 'room', label: '\uD83C\uDFE0 Room' },
      { key: 'profile', label: '\uD83D\uDC64 Profile' },
    ];

    container.innerHTML = tabs.map(t => `
      <button class="comp-tab" data-tab="${t.key}" style="
        flex:1;padding:10px;border:none;font-family:'Courier New',monospace;font-size:12px;
        cursor:pointer;transition:all 0.15s;
        background:${this.currentTab === t.key ? P.teal + '15' : 'transparent'};
        color:${this.currentTab === t.key ? P.teal : P.lpurp};
        border-bottom:2px solid ${this.currentTab === t.key ? P.teal : 'transparent'};
      ">${t.label}</button>
    `).join('');

    container.querySelectorAll('.comp-tab').forEach(el => {
      el.addEventListener('click', () => {
        this.currentTab = (el as HTMLElement).dataset.tab as any;
        this.renderTabs();
        this.renderBody();
      });
    });
  }

  private renderBody(): void {
    const body = this.panel?.querySelector('#comp-body') as HTMLElement;
    if (!body) return;
    switch (this.currentTab) {
      case 'wardrobe': this.renderWardrobe(body); break;
      case 'profile': this.renderProfile(body); break;
      case 'room': this.renderRoom(body); break;
    }
  }

  // ══════════════════════════════════════
  // WARDROBE TAB
  // ══════════════════════════════════════
  private renderWardrobe(body: HTMLElement): void {
    const avatar = getAvatar();
    body.innerHTML = `
      <div style="display:flex;gap:16px;margin-bottom:14px;">
        <div id="ward-preview" style="width:96px;height:180px;background:linear-gradient(180deg,#5a5672 0%,#4b465f 68%,#40394f 100%);border:1px solid rgba(255,255,255,0.12);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.04), inset 0 -18px 28px rgba(24,18,36,0.22);position:relative;overflow:hidden;"></div>
        <div style="flex:1;">
          <div id="ward-slots" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;"></div>
          <div id="ward-options"></div>
        </div>
      </div>
      <div id="ward-colors"></div>
    `;
    this.renderPreview(avatar);
    this.renderSlotTabs(body);
    this.renderOptions(body);
    this.renderColors(body);
  }

  private renderPreview(avatar: AvatarConfig): void {
    const container = this.panel?.querySelector('#ward-preview');
    if (!container) return;
    container.innerHTML = '';
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:absolute;inset:0;background:radial-gradient(circle at 50% 24%, rgba(255,255,255,0.12), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 52%, transparent 52%), linear-gradient(90deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 16px), linear-gradient(180deg, transparent 0%, transparent 78%, rgba(255,244,200,0.10) 78%, rgba(255,244,200,0.16) 100%);pointer-events:none;';
    container.appendChild(backdrop);
    const spriteCanvas = renderRoomSprite(avatar);
    const preview = document.createElement('canvas');
    preview.width = 72; preview.height = 156;
    const px = preview.getContext('2d')!;
    px.imageSmoothingEnabled = false;
    px.drawImage(spriteCanvas, 0, 0, 24, 52, 0, 0, 72, 156);
    preview.style.cssText = 'image-rendering:pixelated;position:relative;z-index:1;filter:drop-shadow(0 1px 0 rgba(255,255,255,0.14)) drop-shadow(0 2px 8px rgba(0,0,0,0.38));';
    container.appendChild(preview);
  }

  private renderSlotTabs(body: HTMLElement): void {
    const container = body.querySelector('#ward-slots');
    if (!container) return;
    const slots = [
      { key: 'hair', label: 'Hair' },
      { key: 'top', label: 'Top' }, { key: 'bottom', label: 'Bottom' },
      { key: 'hat', label: 'Hat' }, { key: 'accessory', label: 'Acc' },
      { key: 'eyes', label: 'Eyes' },
    ];
    container.innerHTML = slots.map(s => `
      <button class="ws" data-slot="${s.key}" style="
        padding:5px 9px;border-radius:4px;font-family:'Courier New',monospace;font-size:11px;
        cursor:pointer;border:1px solid ${this.currentSlot === s.key ? P.teal + '66' : P.dpurp + '33'};
        background:${this.currentSlot === s.key ? P.teal + '22' : 'transparent'};
        color:${this.currentSlot === s.key ? P.teal : P.lpurp};
      ">${s.label}</button>
    `).join('');
    container.querySelectorAll('.ws').forEach(el => {
      el.addEventListener('click', () => {
        this.currentSlot = (el as HTMLElement).dataset.slot!;
        this.renderSlotTabs(body); this.renderOptions(body); this.renderColors(body);
      });
    });
  }

  private renderOptions(body: HTMLElement): void {
    const container = body.querySelector('#ward-options');
    if (!container) return;
    const avatar = getAvatar();
    const optMap: Record<string, readonly string[]> = {
      hair: AVATAR_OPTIONS.hair, top: AVATAR_OPTIONS.top,
      bottom: AVATAR_OPTIONS.bottom, hat: AVATAR_OPTIONS.hat, accessory: AVATAR_OPTIONS.accessory,
      eyes: AVATAR_OPTIONS.eyes,
    };
    const valMap: Record<string, string> = {
      hair: avatar.hair, top: avatar.top,
      bottom: avatar.bottom, hat: avatar.hat, accessory: avatar.accessory,
      eyes: avatar.eyes,
    };
    const options = optMap[this.currentSlot] || [];
    const current = valMap[this.currentSlot] || '';

    container.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:4px;">
      ${options.map(opt => `
        <button class="wo" data-v="${opt}" style="
          padding:5px 9px;border-radius:4px;font-family:'Courier New',monospace;font-size:11px;
          cursor:pointer;border:1px solid ${current === opt ? P.pink + '66' : P.dpurp + '33'};
          background:${current === opt ? P.pink + '22' : P.navy};
          color:${current === opt ? P.pink : P.lcream};
        ">${esc(opt)}</button>
      `).join('')}
    </div>`;
    container.querySelectorAll('.wo').forEach(el => {
      el.addEventListener('click', () => {
        const update: any = {}; update[this.currentSlot] = (el as HTMLElement).dataset.v;
        const newAvatar = setAvatar(update);
        this.renderPreview(newAvatar); this.renderOptions(body);
        this.onAvatarChange?.(newAvatar);
      });
    });
  }

  private renderColors(body: HTMLElement): void {
    const container = body.querySelector('#ward-colors');
    if (!container) return;
    const avatar = getAvatar();
    const keyMap: Record<string, string> = {
      hair: 'hairColor', top: 'topColor',
      bottom: 'bottomColor', hat: 'hatColor', accessory: 'accessoryColor',
      eyes: 'eyeColor',
    };
    const colorKey = keyMap[this.currentSlot];
    if (!colorKey) { container.innerHTML = ''; return; }
    const currentColor = (avatar as any)[colorKey] as string;

    container.innerHTML = `
      <div style="color:${P.lpurp};font-size:10px;margin-bottom:6px;opacity:0.5;">Color</div>
      <div style="display:flex;flex-wrap:wrap;gap:3px;">
        ${COLOR_PRESETS.map(c => `
          <div class="wc" data-c="${c}" style="
            width:22px;height:22px;border-radius:4px;cursor:pointer;
            background:${c};border:2px solid ${currentColor === c ? '#fff' : 'transparent'};
          "></div>
        `).join('')}
      </div>
    `;
    container.querySelectorAll('.wc').forEach(el => {
      el.addEventListener('click', () => {
        const update: any = {}; update[colorKey] = (el as HTMLElement).dataset.c;
        const newAvatar = setAvatar(update);
        this.renderPreview(newAvatar); this.renderColors(body);
        this.onAvatarChange?.(newAvatar);
      });
    });
  }

  // ══════════════════════════════════════
  // PROFILE TAB
  // ══════════════════════════════════════
  private renderProfile(body: HTMLElement): void {
    const state = authStore.getState();
    const profile = state.profile;
    const isGuest = state.loginMethod === 'guest';

    if (isGuest) {
      body.innerHTML = `
        <div style="text-align:center;padding:30px 0;">
          <div style="color:${P.lpurp};font-size:13px;margin-bottom:8px;">Guests can't edit profiles</div>
          <div style="color:${P.dpurp};font-size:11px;">Login with a key to set your Nostr profile</div>
        </div>
      `;
      return;
    }

    body.innerHTML = `
      <div style="color:${P.lcream};font-size:13px;font-weight:bold;margin-bottom:14px;">Edit Nostr Profile</div>
      <div style="margin-bottom:10px;">
        <label style="color:${P.lpurp};font-size:11px;display:block;margin-bottom:4px;">Display Name</label>
        <input id="prof-name" type="text" value="${esc(profile.display_name || profile.name || '')}" style="
          width:100%;padding:8px 10px;background:${P.navy};border:1px solid ${P.dpurp}44;border-radius:4px;
          color:${P.lcream};font-family:'Courier New',monospace;font-size:13px;outline:none;box-sizing:border-box;
        "/>
      </div>
      <div style="margin-bottom:10px;">
        <label style="color:${P.lpurp};font-size:11px;display:block;margin-bottom:4px;">About</label>
        <textarea id="prof-about" rows="3" style="
          width:100%;padding:8px 10px;background:${P.navy};border:1px solid ${P.dpurp}44;border-radius:4px;
          color:${P.lcream};font-family:'Courier New',monospace;font-size:12px;outline:none;box-sizing:border-box;resize:vertical;
        ">${esc(profile.about || '')}</textarea>
      </div>
      <div style="margin-bottom:14px;">
        <label style="color:${P.lpurp};font-size:11px;display:block;margin-bottom:4px;">Picture URL</label>
        <input id="prof-pic" type="text" value="${esc(profile.picture || '')}" style="
          width:100%;padding:8px 10px;background:${P.navy};border:1px solid ${P.dpurp}44;border-radius:4px;
          color:${P.lcream};font-family:'Courier New',monospace;font-size:12px;outline:none;box-sizing:border-box;
        "/>
      </div>
      <button id="prof-save" style="
        width:100%;padding:10px;background:${P.teal}33;border:1px solid ${P.teal}55;border-radius:6px;
        color:${P.teal};font-family:'Courier New',monospace;font-size:13px;cursor:pointer;font-weight:bold;
      ">Publish Profile (kind:0)</button>
      <div id="prof-status" style="color:${P.dpurp};font-size:11px;margin-top:8px;text-align:center;min-height:16px;"></div>
    `;

    body.querySelector('#prof-save')?.addEventListener('click', async () => {
      const statusEl = body.querySelector('#prof-status') as HTMLElement;
      statusEl.style.color = P.teal;
      statusEl.textContent = 'Publishing...';
      try {
        const name = (body.querySelector('#prof-name') as HTMLInputElement).value.trim();
        const about = (body.querySelector('#prof-about') as HTMLTextAreaElement).value.trim();
        const picture = (body.querySelector('#prof-pic') as HTMLInputElement).value.trim();
        const existing = authStore.getState().profile;
        const content: Record<string, any> = { ...existing };
        if (name) { content.name = name; content.display_name = name; }
        if (about) content.about = about;
        if (picture) content.picture = picture;

        const event: any = {
          kind: 0, created_at: Math.floor(Date.now() / 1000),
          tags: [], content: JSON.stringify(content),
        };

        let signed: any;
        try {
          signed = await signEvent(event);
        } catch (sigErr: any) {
          statusEl.style.color = P.red;
          statusEl.textContent = sigErr.message || 'Signing failed';
          return;
        }

        const ok = await publishEvent(signed);
        if (!ok) {
          statusEl.style.color = P.amber;
          statusEl.textContent = 'No relay confirmed — try again';
          return;
        }

        authStore.updateProfile(content);
        if (name) this.onProfileSave?.(name);

        statusEl.style.color = P.teal;
        statusEl.textContent = 'Published!';
      } catch (e: any) {
        statusEl.style.color = P.red;
        statusEl.textContent = e.message || 'Failed';
      }
    });
  }

  // ══════════════════════════════════════
  // ROOM TAB — Full Customization
  // ══════════════════════════════════════
  private renderRoom(body: HTMLElement): void {
    const cfg = getRoomConfig();

    body.innerHTML = `
      <div id="room-section-tabs" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:14px;"></div>
      <div id="room-section-body"></div>
    `;

    this.renderRoomSectionTabs(body);
    this.renderRoomSectionBody(body);
  }

  private renderRoomSectionTabs(body: HTMLElement): void {
    const container = body.querySelector('#room-section-tabs');
    if (!container) return;

    const sections = [
      { key: 'walls', label: 'Walls' },
      { key: 'floor', label: 'Floor' },
      { key: 'lighting', label: 'Lights' },
      { key: 'furniture', label: 'Furniture' },
      { key: 'posters', label: 'Posters' },
    ];

    container.innerHTML = sections.map(s => `
      <button class="rs" data-sec="${s.key}" style="
        padding:6px 12px;border-radius:4px;font-family:'Courier New',monospace;font-size:11px;
        cursor:pointer;border:1px solid ${this.currentRoomSection === s.key ? P.teal + '66' : P.dpurp + '33'};
        background:${this.currentRoomSection === s.key ? P.teal + '22' : 'transparent'};
        color:${this.currentRoomSection === s.key ? P.teal : P.lpurp};
      ">${s.label}</button>
    `).join('');

    container.querySelectorAll('.rs').forEach(el => {
      el.addEventListener('click', () => {
        this.currentRoomSection = (el as HTMLElement).dataset.sec as any;
        this.renderRoomSectionTabs(body);
        this.renderRoomSectionBody(body);
      });
    });
  }

  private renderRoomSectionBody(body: HTMLElement): void {
    const container = body.querySelector('#room-section-body') as HTMLElement;
    if (!container) return;

    switch (this.currentRoomSection) {
      case 'walls': this.renderWallPicker(container, body); break;
      case 'floor': this.renderFloorPicker(container, body); break;
      case 'lighting': this.renderLightingPicker(container, body); break;
      case 'furniture': this.renderFurniturePicker(container, body); break;
      case 'posters': this.renderPosterPicker(container, body); break;
    }
  }

  private renderWallPicker(container: HTMLElement, body: HTMLElement): void {
    const cfg = getRoomConfig();
    const themes = Object.entries(WALL_THEMES) as [WallTheme, typeof WALL_THEMES[WallTheme]][];

    container.innerHTML = `
      <div style="color:${P.lcream};font-size:12px;margin-bottom:10px;">Wall Theme</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
        ${themes.map(([key, theme]) => `
          <button class="wt" data-wall="${key}" style="
            padding:10px 6px;border-radius:6px;font-family:'Courier New',monospace;font-size:10px;
            cursor:pointer;text-align:center;transition:all 0.15s;
            border:2px solid ${cfg.wallTheme === key ? P.teal : P.dpurp + '33'};
            background:${theme.bg};color:${cfg.wallTheme === key ? P.teal : P.lpurp};
          ">
            <div style="width:100%;height:28px;border-radius:3px;margin-bottom:6px;background:${theme.brick};border:1px solid ${theme.accent};"></div>
            ${esc(theme.label)}
          </button>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('.wt').forEach(el => {
      el.addEventListener('click', () => {
        const wallTheme = (el as HTMLElement).dataset.wall as WallTheme;
        const newCfg = setRoomConfig({ wallTheme });
        this.onRoomChange?.(newCfg);
        this.renderWallPicker(container, body);
      });
    });
  }

  private renderFloorPicker(container: HTMLElement, body: HTMLElement): void {
    const cfg = getRoomConfig();
    const floors = Object.entries(FLOOR_STYLES) as [FloorStyle, typeof FLOOR_STYLES[FloorStyle]][];

    container.innerHTML = `
      <div style="color:${P.lcream};font-size:12px;margin-bottom:10px;">Floor Style</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
        ${floors.map(([key, style]) => `
          <button class="ft" data-floor="${key}" style="
            padding:10px 6px;border-radius:6px;font-family:'Courier New',monospace;font-size:10px;
            cursor:pointer;text-align:center;transition:all 0.15s;
            border:2px solid ${cfg.floorStyle === key ? P.teal : P.dpurp + '33'};
            background:${P.navy};color:${cfg.floorStyle === key ? P.teal : P.lpurp};
          ">
            <div style="width:100%;height:24px;border-radius:3px;margin-bottom:6px;background:${style.base};border:1px solid ${style.alt};
              ${key === 'tile' ? `background-image:linear-gradient(45deg,${style.alt} 25%,transparent 25%,transparent 75%,${style.alt} 75%);background-size:8px 8px;` : ''}
            "></div>
            ${esc(style.label)}
          </button>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('.ft').forEach(el => {
      el.addEventListener('click', () => {
        const floorStyle = (el as HTMLElement).dataset.floor as FloorStyle;
        const newCfg = setRoomConfig({ floorStyle });
        this.onRoomChange?.(newCfg);
        this.renderFloorPicker(container, body);
      });
    });
  }

  private renderLightingPicker(container: HTMLElement, body: HTMLElement): void {
    const cfg = getRoomConfig();
    const moods = Object.entries(LIGHTING_MOODS) as [LightingMood, typeof LIGHTING_MOODS[LightingMood]][];

    container.innerHTML = `
      <div style="color:${P.lcream};font-size:12px;margin-bottom:10px;">Lighting Mood</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
        ${moods.map(([key, mood]) => `
          <button class="lt" data-light="${key}" style="
            padding:12px 6px;border-radius:6px;font-family:'Courier New',monospace;font-size:10px;
            cursor:pointer;text-align:center;transition:all 0.15s;
            border:2px solid ${cfg.lighting === key ? mood.primary : P.dpurp + '33'};
            background:${cfg.lighting === key ? mood.primary + '15' : P.navy};
            color:${cfg.lighting === key ? mood.primary : P.lpurp};
          ">
            <div style="width:20px;height:20px;border-radius:50%;margin:0 auto 6px;background:${mood.primary};box-shadow:0 0 12px ${mood.primary}66;"></div>
            ${esc(mood.label)}
          </button>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('.lt').forEach(el => {
      el.addEventListener('click', () => {
        const lighting = (el as HTMLElement).dataset.light as LightingMood;
        const newCfg = setRoomConfig({ lighting });
        this.onRoomChange?.(newCfg);
        this.renderLightingPicker(container, body);
      });
    });
  }

  private renderFurniturePicker(container: HTMLElement, body: HTMLElement): void {
    const cfg = getRoomConfig();

    // Curated palettes per furniture type
    const PALETTES: Record<FurnitureId, { label: string; colors: string[] }> = {
      desk:       { label: 'Wood Tones',   colors: ['#2e1e0e','#3d2810','#5a3818','#7a5230','#1a1208','#2a2218','#0e0c08','#4a3020'] },
      bookshelf:  { label: 'Wood Tones',   colors: ['#2a1a08','#3a2610','#5a3818','#7a5230','#1a1208','#3d3020','#0e0c08','#4a3828'] },
      couch:      { label: 'Fabric',       colors: ['#3d2860','#6b2840','#283d6b','#28503d','#5a3a1a','#5a1a1a','#1a1a5a','#4a4a4a'] },
      plant:      { label: 'Pot Colors',   colors: ['#1e3a1a','#3a2818','#c87840','#a85030','#2a3a4a','#3a1a3a','#4a4020','#8a6040'] },
      rug:        { label: 'Fabric',       colors: ['#2a1858','#581828','#183058','#184830','#484018','#381838','#282858','#582818'] },
      lamp:       { label: 'Metal / Wood', colors: ['#1e1432','#2a2010','#3a3030','#1a2a1a','#302010','#1a1a2a','#2a1a10','#3a2828'] },
      speaker:    { label: 'Casing',       colors: ['#1e1432','#181818','#1a2818','#281818','#1a1828','#282010','#203028','#282828'] },
      minifridge: { label: 'Casing',       colors: ['#1e1432','#181828','#1a2a1a','#2a1a1a','#1a2028','#282828','#202820','#1a1818'] },
      beanbag:    { label: 'Fabric',       colors: ['#c44060','#e0603a','#40a060','#4060c4','#a040a0','#c0a030','#30a0a0','#c06040'] },
      arcade:     { label: 'Cabinet',      colors: ['#1e1432','#1a0808','#081a08','#08081a','#201008','#0a1020','#181020','#201818'] },
      tv:         { label: 'Bezel',        colors: ['#1a1830','#181818','#141420','#201418','#181420','#141818','#1a1818','#141414'] },
    };

    const activeColor = this.activeFurnitureColor;
    const activePalette = activeColor ? PALETTES[activeColor] : null;
    const currentColor = activeColor ? getFurnitureColor(cfg, activeColor) : null;

    container.innerHTML = `
      <div style="color:${P.lcream};font-size:12px;margin-bottom:10px;">Furniture</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:5px;">
        ${ALL_FURNITURE.map(id => {
          const data = FURNITURE_DATA[id];
          const active = cfg.furniture.includes(id);
          const isDesk = id === 'desk';
          const color = getFurnitureColor(cfg, id);
          const isExpanded = activeColor === id;
          return `
            <div style="
              border-radius:6px;overflow:hidden;
              border:1px solid ${isExpanded ? P.teal + '88' : active ? P.teal + '44' : P.dpurp + '22'};
              background:${active || isDesk ? P.teal + '0a' : P.navy};
              opacity:${isDesk ? '0.7' : '1'};
            ">
              <div class="fur-row" data-fid="${id}" style="
                padding:8px 10px;display:flex;align-items:center;gap:8px;
                cursor:${isDesk ? 'default' : 'pointer'};
              ">
                <span style="font-size:15px;">${data.emoji}</span>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:11px;color:${active || isDesk ? P.teal : P.lpurp};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(data.label)}</div>
                  <div style="font-size:9px;opacity:0.45;">${isDesk ? 'Always on' : active ? 'Placed' : 'Tap to add'}</div>
                </div>
                ${active || isDesk ? `
                  <div class="fur-palette-btn" data-fid="${id}" style="
                    width:16px;height:16px;border-radius:3px;flex-shrink:0;
                    background:${color};border:1px solid rgba(255,255,255,0.2);
                    cursor:pointer;
                  " title="Change color"></div>
                ` : ''}
              </div>
              ${isExpanded && activePalette ? `
                <div style="padding:6px 8px 8px;border-top:1px solid ${P.teal}22;">
                  <div style="font-size:9px;color:${P.lpurp};opacity:0.6;margin-bottom:5px;">${activePalette.label}</div>
                  <div style="display:flex;flex-wrap:wrap;gap:4px;">
                    ${activePalette.colors.map(c => `
                      <div class="pal-swatch" data-fid="${id}" data-color="${c}" style="
                        width:20px;height:20px;border-radius:3px;cursor:pointer;
                        background:${c};
                        border:2px solid ${currentColor === c ? P.teal : 'rgba(255,255,255,0.12)'};
                        transition:transform 0.1s;
                      "></div>
                    `).join('')}
                    <div class="pal-reset" data-fid="${id}" style="
                      width:20px;height:20px;border-radius:3px;cursor:pointer;
                      background:transparent;border:1px solid ${P.dpurp}55;
                      display:flex;align-items:center;justify-content:center;
                      font-size:11px;color:${P.dpurp};
                    " title="Reset">↺</div>
                  </div>
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Toggle place/remove
    container.querySelectorAll('.fur-row').forEach(el => {
      el.addEventListener('click', (e) => {
        const fid = (el as HTMLElement).dataset.fid as FurnitureId;
        if (fid === 'desk') return;
        // Don't toggle if clicking the color swatch
        if ((e.target as HTMLElement).classList.contains('fur-palette-btn')) return;
        const newCfg = toggleFurniture(fid);
        if (this.activeFurnitureColor === fid && !newCfg.furniture.includes(fid)) {
          this.activeFurnitureColor = null;
        }
        this.onRoomChange?.(newCfg);
        this.renderFurniturePicker(container, body);
      });
    });

    // Open/close palette
    container.querySelectorAll('.fur-palette-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const fid = (el as HTMLElement).dataset.fid as FurnitureId;
        this.activeFurnitureColor = this.activeFurnitureColor === fid ? null : fid;
        this.renderFurniturePicker(container, body);
      });
    });

    // Pick a swatch color
    container.querySelectorAll('.pal-swatch').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const fid = (el as HTMLElement).dataset.fid as FurnitureId;
        const color = (el as HTMLElement).dataset.color!;
        const newCfg = setFurnitureColor(fid, color);
        this.onRoomChange?.(newCfg);
        this.renderFurniturePicker(container, body);
      });
    });

    // Reset to default
    container.querySelectorAll('.pal-reset').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const fid = (el as HTMLElement).dataset.fid as FurnitureId;
        const newCfg = setFurnitureColor(fid, DEFAULT_FURNITURE_COLORS[fid]);
        this.onRoomChange?.(newCfg);
        this.renderFurniturePicker(container, body);
      });
    });
  }

  private renderPosterPicker(container: HTMLElement, body: HTMLElement): void {
    const cfg = getRoomConfig();

    const slotLabels = ['Left Wall', 'Center Wall', 'Right Wall'];

    container.innerHTML = `
      <div style="color:${P.lcream};font-size:12px;margin-bottom:10px;">Wall Posters</div>
      <div style="display:flex;gap:4px;margin-bottom:12px;">
        ${[0, 1, 2].map(i => `
          <button class="ps" data-pslot="${i}" style="
            flex:1;padding:6px;border-radius:4px;font-family:'Courier New',monospace;font-size:10px;
            cursor:pointer;text-align:center;
            border:1px solid ${this.activePosterSlot === i ? P.pink + '66' : P.dpurp + '33'};
            background:${this.activePosterSlot === i ? P.pink + '15' : 'transparent'};
            color:${this.activePosterSlot === i ? P.pink : P.lpurp};
          ">${slotLabels[i]}<br/><span style="font-size:9px;opacity:0.6;">${POSTER_DATA[cfg.posters[i]].label}</span></button>
        `).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
        ${ALL_POSTERS.map(id => {
          const data = POSTER_DATA[id];
          const active = cfg.posters[this.activePosterSlot] === id;
          return `
            <button class="po" data-pid="${id}" style="
              padding:10px 6px;border-radius:6px;font-family:'Courier New',monospace;font-size:10px;
              cursor:pointer;text-align:center;transition:all 0.15s;
              border:1px solid ${active ? P.pink + '66' : P.dpurp + '33'};
              background:${active ? P.pink + '22' : P.navy};
              color:${active ? P.pink : P.lcream};
            ">
              <span style="font-size:16px;">${data.emoji}</span><br/>
              <span style="font-size:9px;">${esc(data.label)}</span>
            </button>
          `;
        }).join('')}
      </div>
    `;

    container.querySelectorAll('.ps').forEach(el => {
      el.addEventListener('click', () => {
        this.activePosterSlot = Number((el as HTMLElement).dataset.pslot) as 0 | 1 | 2;
        this.renderPosterPicker(container, body);
      });
    });

    container.querySelectorAll('.po').forEach(el => {
      el.addEventListener('click', () => {
        const pid = (el as HTMLElement).dataset.pid as PosterId;
        const newCfg = setPoster(this.activePosterSlot, pid);
        this.onRoomChange?.(newCfg);
        this.renderPosterPicker(container, body);
      });
    });
  }
}

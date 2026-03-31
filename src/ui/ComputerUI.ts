/**
 * ComputerUI.ts — Interactive computer terminal in MY ROOM
 *
 * Opens when player presses E near the computer desk.
 * Tabs: Wardrobe, Profile (kind:0 edit), Room Customization
 */

import { P } from '../config/game.config';
import { AvatarConfig, getAvatar, setAvatar, AVATAR_OPTIONS, COLOR_PRESETS, getOutfits, saveOutfit, deleteOutfit } from '../stores/avatarStore';
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
import { getPet, setPet, PetSelection, PetSpecies, DOG_BREEDS, CAT_BREEDS } from '../stores/petStore';
import { sendStatusUpdate } from '../nostr/presenceService';
import { SoundEngine, MYROOM_TRACKS, MyRoomTrackId } from '../audio/SoundEngine';

const PANEL_ID = 'computer-panel';

type OnAvatarChange   = (avatar: AvatarConfig) => void;
type OnRoomChange     = (config: RoomConfig) => void;
type OnPetChange      = (sel: PetSelection) => void;
type OnStatusUpdate   = (status: string) => void;
type OnMusicChange    = (trackId: MyRoomTrackId) => void;

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
  private onPetChange: OnPetChange | null = null;
  private onStatusUpdate: OnStatusUpdate | null = null;
  private onMusicChange: OnMusicChange | null = null;
  private currentTab: 'wardrobe' | 'profile' | 'room' = 'wardrobe';
  private currentSlot = 'top';
  private currentRoomSection: 'walls' | 'floor' | 'lighting' | 'furniture' | 'posters' | 'pets' | 'note' | 'music' = 'walls';
  private activePosterSlot: 0 | 1 | 2 = 0;
  private activeFurnitureColor: FurnitureId | null = null;

  open(onAvatarChange?: OnAvatarChange, onProfileSave?: (name: string) => void, onRoomChange?: OnRoomChange, onPetChange?: OnPetChange, onStatusUpdate?: OnStatusUpdate, onMusicChange?: OnMusicChange): void {
    if (this.panel) this.close();
    this.onAvatarChange = onAvatarChange || null;
    this.onProfileSave = onProfileSave || null;
    this.onRoomChange = onRoomChange || null;
    this.onPetChange = onPetChange || null;
    this.onStatusUpdate = onStatusUpdate || null;
    this.onMusicChange = onMusicChange || null;
    this.currentTab = 'wardrobe';
    this.buildPanel();
  }

  /** Open directly to the Room tab (for first-time setup) */
  openToRoom(onAvatarChange?: OnAvatarChange, onProfileSave?: (name: string) => void, onRoomChange?: OnRoomChange, onPetChange?: OnPetChange, onStatusUpdate?: OnStatusUpdate, onMusicChange?: OnMusicChange): void {
    if (this.panel) this.close();
    this.onAvatarChange = onAvatarChange || null;
    this.onProfileSave = onProfileSave || null;
    this.onRoomChange = onRoomChange || null;
    this.onPetChange = onPetChange || null;
    this.onStatusUpdate = onStatusUpdate || null;
    this.onMusicChange = onMusicChange || null;
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
      background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
      border:1px solid color-mix(in srgb,var(--nd-accent) 27%,transparent);border-radius:10px;
      font-family:'Courier New',monospace;
      box-shadow:0 8px 30px rgba(0,0,0,0.8),0 0 40px color-mix(in srgb,var(--nd-accent) 3%,transparent);
      width:460px;max-width:94vw;max-height:88vh;overflow:hidden;
      display:flex;flex-direction:column;
    `;

    this.panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid color-mix(in srgb,var(--nd-dpurp) 20%,transparent);">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="color:var(--nd-accent);font-size:11px;">&#9679;</span>
          <span style="color:var(--nd-text);font-size:14px;font-weight:bold;">TERMINAL</span>
        </div>
        <button id="comp-close" style="background:none;border:none;color:var(--nd-dpurp);font-size:18px;cursor:pointer;padding:4px 8px;">\u2715</button>
      </div>
      <div id="comp-tabs" style="display:flex;border-bottom:1px solid color-mix(in srgb,var(--nd-dpurp) 13%,transparent);"></div>
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
      { key: 'room',     label: '\uD83C\uDFE0 Room' },
      { key: 'profile',  label: '\uD83D\uDC64 Profile' },
    ];

    container.innerHTML = tabs.map(t => `
      <button class="comp-tab" data-tab="${t.key}" style="
        flex:1;padding:10px;border:none;font-family:'Courier New',monospace;font-size:12px;
        cursor:pointer;transition:all 0.15s;
        background:${this.currentTab === t.key ? 'color-mix(in srgb,var(--nd-accent) 8%,transparent)' : 'transparent'};
        color:${this.currentTab === t.key ? 'var(--nd-accent)' : 'var(--nd-subtext)'};
        border-bottom:2px solid ${this.currentTab === t.key ? 'var(--nd-accent)' : 'transparent'};
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
      case 'profile':  this.renderProfile(body);  break;
      case 'room':     this.renderRoom(body);      break;
    }
  }

  // ══════════════════════════════════════
  // WARDROBE TAB
  // ══════════════════════════════════════
  private renderWardrobe(body: HTMLElement): void {
    const avatar = getAvatar();
    body.innerHTML = `
      <div style="display:flex;gap:16px;margin-bottom:14px;">
        <div id="ward-preview" style="width:96px;height:180px;background:linear-gradient(180deg,color-mix(in srgb,var(--nd-purp) 55%,var(--nd-navy)) 0%,var(--nd-navy) 68%,var(--nd-bg) 100%);border:1px solid color-mix(in srgb,var(--nd-dpurp) 44%,transparent);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.04),inset 0 -18px 28px rgba(0,0,0,0.3);position:relative;overflow:hidden;"></div>
        <div style="flex:1;">
          <div id="ward-slots" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;"></div>
          <div id="ward-options"></div>
        </div>
      </div>
      <div id="ward-colors"></div>
      <div id="ward-outfits" style="margin-top:14px;"></div>
    `;
    this.renderPreview(avatar);
    this.renderSlotTabs(body);
    this.renderOptions(body);
    this.renderColors(body);
    this.renderOutfits(body);
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
        cursor:pointer;border:1px solid ${this.currentSlot === s.key ? 'color-mix(in srgb,var(--nd-accent) 40%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 20%,transparent)'};
        background:${this.currentSlot === s.key ? 'color-mix(in srgb,var(--nd-accent) 13%,transparent)' : 'transparent'};
        color:${this.currentSlot === s.key ? 'var(--nd-accent)' : 'var(--nd-subtext)'};
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
          cursor:pointer;border:1px solid ${current === opt ? 'color-mix(in srgb,var(--nd-accent) 66%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 20%,transparent)'};
          background:${current === opt ? 'color-mix(in srgb,var(--nd-accent) 22%,transparent)' : 'transparent'};
          color:${current === opt ? 'var(--nd-accent)' : 'var(--nd-text)'};
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
      <div style="color:var(--nd-subtext);font-size:10px;margin-bottom:6px;opacity:0.5;">Color</div>
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

  private renderOutfits(body: HTMLElement): void {
    const container = body.querySelector('#ward-outfits') as HTMLElement;
    if (!container) return;
    const outfits = getOutfits();
    const inputStyle = `width:100%;padding:6px 8px;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);border-radius:4px;color:var(--nd-text);font-family:'Courier New',monospace;font-size:12px;outline:none;box-sizing:border-box;`;
    container.innerHTML = `
      <div style="color:var(--nd-subtext);font-size:10px;margin-bottom:6px;opacity:0.5;">SAVED OUTFITS</div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <input id="outfit-name" type="text" maxlength="20" placeholder="Outfit name..." style="${inputStyle}flex:1;"/>
        <button id="outfit-save" style="padding:6px 10px;background:color-mix(in srgb,var(--nd-accent) 13%,transparent);border:1px solid color-mix(in srgb,var(--nd-accent) 27%,transparent);border-radius:4px;color:var(--nd-accent);font-family:'Courier New',monospace;font-size:11px;cursor:pointer;white-space:nowrap;">Save</button>
      </div>
      <div id="outfit-list" style="display:flex;flex-direction:column;gap:4px;max-height:120px;overflow-y:auto;">
        ${outfits.length === 0 ? `<div style="color:var(--nd-dpurp);font-size:11px;text-align:center;padding:8px 0;">No saved outfits</div>` : outfits.map((o, i) => `
          <div style="display:flex;align-items:center;gap:6px;background:color-mix(in srgb,black 40%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 12%,transparent);border-radius:4px;padding:5px 8px;">
            <span style="flex:1;color:var(--nd-text);font-size:11px;">${esc(o.name)}</span>
            <button class="outfit-load" data-i="${i}" style="padding:3px 8px;background:color-mix(in srgb,var(--nd-accent) 22%,transparent);border:1px solid color-mix(in srgb,var(--nd-accent) 44%,transparent);border-radius:3px;color:var(--nd-accent);font-family:'Courier New',monospace;font-size:10px;cursor:pointer;">Wear</button>
            <button class="outfit-del" data-i="${i}" style="padding:3px 6px;background:none;border:1px solid color-mix(in srgb,var(--nd-dpurp) 20%,transparent);border-radius:3px;color:var(--nd-subtext);font-family:'Courier New',monospace;font-size:10px;cursor:pointer;">✕</button>
          </div>
        `).join('')}
      </div>
    `;
    container.querySelector('#outfit-save')?.addEventListener('click', () => {
      const nameEl = container.querySelector('#outfit-name') as HTMLInputElement;
      const name = nameEl.value.trim();
      if (!name) return;
      saveOutfit(name);
      nameEl.value = '';
      this.renderOutfits(body);
    });
    container.querySelectorAll('.outfit-load').forEach(el => {
      el.addEventListener('click', () => {
        const i = parseInt((el as HTMLElement).dataset.i!);
        const outfit = getOutfits()[i];
        if (!outfit) return;
        const newAvatar = setAvatar(outfit.avatar);
        this.renderPreview(newAvatar);
        this.renderOptions(body);
        this.renderColors(body);
        this.onAvatarChange?.(newAvatar);
      });
    });
    container.querySelectorAll('.outfit-del').forEach(el => {
      el.addEventListener('click', () => {
        deleteOutfit(parseInt((el as HTMLElement).dataset.i!));
        this.renderOutfits(body);
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
      const currentName = state.displayName || 'guest';
      body.innerHTML = `
        <div style="color:var(--nd-text);font-size:13px;font-weight:bold;margin-bottom:14px;">Display Name</div>
        <div style="margin-bottom:10px;">
          <input id="guest-name" type="text" maxlength="32" value="${esc(currentName)}" style="
            width:100%;padding:8px 10px;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);border-radius:4px;
            color:var(--nd-text);font-family:'Courier New',monospace;font-size:13px;outline:none;box-sizing:border-box;
          "/>
        </div>
        <div style="margin-top:10px;">
          <label style="color:var(--nd-subtext);font-size:11px;display:block;margin-bottom:4px;">Status</label>
          <input id="guest-status" type="text" maxlength="60" value="${esc(localStorage.getItem('nd_status') || '')}" placeholder="vibing, afk, busy..." style="
            width:100%;padding:8px 10px;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);border-radius:4px;
            color:var(--nd-text);font-family:'Courier New',monospace;font-size:12px;outline:none;box-sizing:border-box;
          "/>
        </div>
        <button id="guest-name-save" style="
          width:100%;padding:10px;margin-top:10px;background:color-mix(in srgb,var(--nd-accent) 20%,transparent);border:1px solid color-mix(in srgb,var(--nd-accent) 33%,transparent);border-radius:6px;
          color:var(--nd-accent);font-family:'Courier New',monospace;font-size:13px;cursor:pointer;font-weight:bold;
        ">Save</button>
        <div id="guest-name-status" style="color:var(--nd-dpurp);font-size:11px;margin-top:8px;text-align:center;min-height:16px;"></div>
        <div style="color:var(--nd-dpurp);font-size:11px;margin-top:20px;text-align:center;">Login with a Nostr key to set a full profile</div>
      `;
      const statusEl = body.querySelector('#guest-name-status') as HTMLElement;
      body.querySelector('#guest-name-save')?.addEventListener('click', () => {
        const name = ((body.querySelector('#guest-name') as HTMLInputElement).value || '').trim().slice(0, 32);
        const status = ((body.querySelector('#guest-status') as HTMLInputElement).value || '').trim().slice(0, 60);
        if (!name) return;
        localStorage.setItem('nostr_district_guest_name', name);
        localStorage.setItem('nd_status', status);
        authStore.setDisplayName(name);
        this.onProfileSave?.(name);
        sendStatusUpdate(status);
        this.onStatusUpdate?.(status);
        statusEl.style.color = 'var(--nd-accent)';
        statusEl.textContent = 'Saved!';
      });
      return;
    }

    body.innerHTML = `
      <div style="color:var(--nd-text);font-size:13px;font-weight:bold;margin-bottom:14px;">Edit Nostr Profile</div>
      <div style="margin-bottom:10px;">
        <label style="color:var(--nd-subtext);font-size:11px;display:block;margin-bottom:4px;">Display Name</label>
        <input id="prof-name" type="text" value="${esc(profile.display_name || profile.name || '')}" style="
          width:100%;padding:8px 10px;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);border-radius:4px;
          color:var(--nd-text);font-family:'Courier New',monospace;font-size:13px;outline:none;box-sizing:border-box;
        "/>
      </div>
      <div style="margin-bottom:10px;">
        <label style="color:var(--nd-subtext);font-size:11px;display:block;margin-bottom:4px;">About</label>
        <textarea id="prof-about" rows="3" style="
          width:100%;padding:8px 10px;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);border-radius:4px;
          color:var(--nd-text);font-family:'Courier New',monospace;font-size:12px;outline:none;box-sizing:border-box;resize:vertical;
        ">${esc(profile.about || '')}</textarea>
      </div>
      <div style="margin-bottom:14px;">
        <label style="color:var(--nd-subtext);font-size:11px;display:block;margin-bottom:4px;">Picture URL</label>
        <input id="prof-pic" type="text" value="${esc(profile.picture || '')}" style="
          width:100%;padding:8px 10px;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);border-radius:4px;
          color:var(--nd-text);font-family:'Courier New',monospace;font-size:12px;outline:none;box-sizing:border-box;
        "/>
      </div>
      <div style="margin-bottom:14px;">
        <label style="color:var(--nd-subtext);font-size:11px;display:block;margin-bottom:4px;">Status</label>
        <input id="prof-status-input" type="text" maxlength="60" value="${esc(localStorage.getItem('nd_status') || '')}" placeholder="vibing, afk, busy..." style="
          width:100%;padding:8px 10px;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);border-radius:4px;
          color:var(--nd-text);font-family:'Courier New',monospace;font-size:12px;outline:none;box-sizing:border-box;
        "/>
        <button id="prof-status-save" style="
          width:100%;margin-top:6px;padding:7px;background:color-mix(in srgb,var(--nd-purp) 13%,transparent);border:1px solid color-mix(in srgb,var(--nd-purp) 27%,transparent);border-radius:4px;
          color:var(--nd-subtext);font-family:'Courier New',monospace;font-size:11px;cursor:pointer;
        ">Update Status</button>
      </div>
      <button id="prof-save" style="
        width:100%;padding:10px;background:color-mix(in srgb,var(--nd-accent) 20%,transparent);border:1px solid color-mix(in srgb,var(--nd-accent) 33%,transparent);border-radius:6px;
        color:var(--nd-accent);font-family:'Courier New',monospace;font-size:13px;cursor:pointer;font-weight:bold;
      ">Publish Profile (kind:0)</button>
      <div id="prof-status" style="color:var(--nd-dpurp);font-size:11px;margin-top:8px;text-align:center;min-height:16px;"></div>
    `;

    body.querySelector('#prof-status-save')?.addEventListener('click', () => {
      const status = ((body.querySelector('#prof-status-input') as HTMLInputElement).value || '').trim().slice(0, 60);
      localStorage.setItem('nd_status', status);
      sendStatusUpdate(status);
      this.onStatusUpdate?.(status);
      const el = body.querySelector('#prof-status') as HTMLElement;
      if (el) { el.style.color = 'var(--nd-accent)'; el.textContent = 'Status updated!'; setTimeout(() => { el.textContent = ''; }, 2000); }
    });

    body.querySelector('#prof-save')?.addEventListener('click', async () => {
      const statusEl = body.querySelector('#prof-status') as HTMLElement;
      statusEl.style.color = 'var(--nd-accent)';
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

        statusEl.style.color = 'var(--nd-accent)';
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
      { key: 'walls',     label: 'Walls' },
      { key: 'floor',     label: 'Floor' },
      { key: 'lighting',  label: 'Lights' },
      { key: 'furniture', label: 'Furniture' },
      { key: 'posters',   label: 'Posters' },
      { key: 'pets',      label: 'Pets' },
      { key: 'note',      label: 'Note' },
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
        this.renderRoomSectionTabs(body);
        this.renderRoomSectionBody(body);
      });
    });
  }

  private renderRoomSectionBody(body: HTMLElement): void {
    const container = body.querySelector('#room-section-body') as HTMLElement;
    if (!container) return;

    switch (this.currentRoomSection) {
      case 'walls':     this.renderWallPicker(container, body);      break;
      case 'floor':     this.renderFloorPicker(container, body);     break;
      case 'lighting':  this.renderLightingPicker(container, body);  break;
      case 'furniture': this.renderFurniturePicker(container, body); break;
      case 'posters':   this.renderPosterPicker(container, body);    break;
      case 'pets':      this.renderPets(container);                  break;
      case 'note':      this.renderNotePicker(container);            break;
      case 'music':     this.renderMusicPicker(container);           break;
    }
  }

  private renderWallPicker(container: HTMLElement, body: HTMLElement): void {
    const cfg = getRoomConfig();
    const themes = Object.entries(WALL_THEMES) as [WallTheme, typeof WALL_THEMES[WallTheme]][];

    container.innerHTML = `
      <div style="color:var(--nd-text);font-size:12px;margin-bottom:10px;">Wall Theme</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
        ${themes.map(([key, theme]) => `
          <button class="wt" data-wall="${key}" style="
            padding:10px 6px;border-radius:6px;font-family:'Courier New',monospace;font-size:10px;
            cursor:pointer;text-align:center;transition:all 0.15s;
            border:2px solid ${cfg.wallTheme === key ? 'var(--nd-accent)' : 'color-mix(in srgb,var(--nd-dpurp) 20%,transparent)'};
            background:${theme.bg};color:${cfg.wallTheme === key ? 'var(--nd-accent)' : 'var(--nd-subtext)'};
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
        case 'bamboo':   return `background-color:#2a2e12;background-image:repeating-linear-gradient(90deg,#3e4418 0px,#3e4418 13px,#1a1e08 13px,#1a1e08 14px),repeating-linear-gradient(0deg,transparent 0px,transparent 7px,rgba(26,30,8,0.6) 7px,rgba(26,30,8,0.6) 9px,transparent 9px,transparent 18px);background-size:14px 18px;`;
        default:         return `background:#1e1040;`;
      }
    };

    container.innerHTML = `
      <div style="color:var(--nd-text);font-size:12px;margin-bottom:10px;">Floor Style</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
        ${floors.map(([key, style]) => `
          <button class="ft" data-floor="${key}" style="
            padding:10px 6px;border-radius:6px;font-family:'Courier New',monospace;font-size:10px;
            cursor:pointer;text-align:center;transition:all 0.15s;
            border:2px solid ${cfg.floorStyle === key ? 'var(--nd-accent)' : 'color-mix(in srgb,var(--nd-dpurp) 20%,transparent)'};
            background:transparent;color:${cfg.floorStyle === key ? 'var(--nd-accent)' : 'var(--nd-subtext)'};
          ">
            <div style="width:100%;height:24px;border-radius:3px;margin-bottom:6px;border:1px solid color-mix(in srgb,var(--nd-dpurp) 20%,transparent);${floorPreview(key)}"></div>
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
      <div style="color:var(--nd-text);font-size:12px;margin-bottom:10px;">Lighting Mood</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
        ${moods.map(([key, mood]) => `
          <button class="lt" data-light="${key}" style="
            padding:12px 6px;border-radius:6px;font-family:'Courier New',monospace;font-size:10px;
            cursor:pointer;text-align:center;transition:all 0.15s;
            border:2px solid ${cfg.lighting === key ? mood.primary : 'color-mix(in srgb,var(--nd-dpurp) 20%,transparent)'};
            background:${cfg.lighting === key ? mood.primary + '15' : 'transparent'};
            color:${cfg.lighting === key ? mood.primary : 'var(--nd-subtext)'};
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
      pet_bed:    { label: 'Cushion',      colors: ['#7a3858','#c44060','#6b2840','#3d5a80','#2a6040','#7a4828','#6040a0','#5a5a5a'] },
      cat_tree:   { label: 'Sisal / Wood', colors: ['#5a3a1a','#7a5530','#3a2810','#8a7050','#2a1808','#6a4a28','#4a3818','#9a8060'] },
      pet_bowl:   { label: 'Bowl Color',   colors: ['#2a1e3e','#181828','#2a2010','#1a2a1a','#281a18','#1e2a28','#281828','#202028'] },
    };

    const activeColor = this.activeFurnitureColor;
    const activePalette = activeColor ? PALETTES[activeColor] : null;
    const currentColor = activeColor ? getFurnitureColor(cfg, activeColor) : null;

    container.innerHTML = `
      <div style="color:var(--nd-text);font-size:12px;margin-bottom:10px;">Furniture</div>
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
              border:1px solid ${isExpanded ? 'color-mix(in srgb,var(--nd-accent) 53%,transparent)' : active ? 'color-mix(in srgb,var(--nd-accent) 27%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 13%,transparent)'};
              background:${active || isDesk ? 'color-mix(in srgb,var(--nd-accent) 3%,transparent)' : 'transparent'};
              opacity:${isDesk ? '0.7' : '1'};
            ">
              <div class="fur-row" data-fid="${id}" style="
                padding:8px 10px;display:flex;align-items:center;gap:8px;
                cursor:${isDesk ? 'default' : 'pointer'};
              ">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:11px;color:${active || isDesk ? 'var(--nd-accent)' : 'var(--nd-subtext)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(data.label)}</div>
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
      <div style="color:var(--nd-text);font-size:12px;margin-bottom:10px;">Wall Posters</div>
      <div style="display:flex;gap:4px;margin-bottom:12px;">
        ${[0, 1, 2].map(i => `
          <button class="ps" data-pslot="${i}" style="
            flex:1;padding:6px;border-radius:4px;font-family:'Courier New',monospace;font-size:10px;
            cursor:pointer;text-align:center;
            border:1px solid ${this.activePosterSlot === i ? 'color-mix(in srgb,var(--nd-accent) 66%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 20%,transparent)'};
            background:${this.activePosterSlot === i ? 'color-mix(in srgb,var(--nd-accent) 15%,transparent)' : 'transparent'};
            color:${this.activePosterSlot === i ? 'var(--nd-accent)' : 'var(--nd-subtext)'};
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
              border:1px solid ${active ? 'color-mix(in srgb,var(--nd-accent) 66%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 20%,transparent)'};
              background:${active ? 'color-mix(in srgb,var(--nd-accent) 22%,transparent)' : 'transparent'};
              color:${active ? 'var(--nd-accent)' : 'var(--nd-text)'};
            ">
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

  // ══════════════════════════════════════
  // PETS TAB
  // ══════════════════════════════════════
  private renderPets(container: HTMLElement): void {
    const current = getPet();

    const petCard = (species: PetSpecies, breed: number, name: string, scale = 1.0) => {
      const isSelected = current.species === species && current.breed === breed;
      const imgUrl = `pets/${species}-${breed}-idle.png`;
      const baseH  = species === 'dog' ? 60 : 52;
      const dispH  = Math.round(baseH * scale);
      const dispW  = dispH; // frames are square
      const bgSize = `${dispW}px ${dispH}px`;
      return `
        <button class="pet-btn" data-species="${species}" data-breed="${breed}" style="
          display:flex;flex-direction:column;align-items:center;gap:4px;
          padding:8px 6px;border-radius:6px;cursor:pointer;
          border:1px solid ${isSelected ? 'color-mix(in srgb,var(--nd-accent) 53%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 20%,transparent)'};
          background:${isSelected ? 'color-mix(in srgb,var(--nd-accent) 10%,transparent)' : 'color-mix(in srgb,black 35%,var(--nd-bg))'};
          color:${isSelected ? 'var(--nd-accent)' : 'var(--nd-text)'};
          font-family:'Courier New',monospace;font-size:9px;
          transition:all 0.12s;
        ">
          <div style="
            width:${dispW}px;height:${dispH}px;overflow:hidden;
            background-image:url('${imgUrl}');
            background-size:${bgSize};
            background-position:0 0;
            background-repeat:no-repeat;
            image-rendering:pixelated;
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
        const sel = setPet({ species, breed });
        this.onPetChange?.(sel);
        this.renderPets(container);
      });
    });
  }

  private renderNotePicker(container: HTMLElement): void {
    const cfg = getRoomConfig();
    const current = cfg.pinnedNote || '';
    const MAX = 220;

    container.innerHTML = `
      <div style="color:var(--nd-text);font-size:12px;margin-bottom:8px;">Wall Note</div>
      <div style="color:var(--nd-subtext);font-size:10px;margin-bottom:12px;line-height:1.5;">
        Pin a note to your room wall. Visitors can read it when they click the note.
      </div>
      <textarea id="note-input" maxlength="${MAX}" style="
        width:100%;height:110px;resize:none;box-sizing:border-box;
        background:color-mix(in srgb,black 45%,var(--nd-bg));
        border:1px solid color-mix(in srgb,var(--nd-dpurp) 30%,transparent);
        border-radius:6px;padding:10px;
        color:var(--nd-text);font-family:'Courier New',monospace;font-size:12px;
        line-height:1.6;outline:none;
      " placeholder="Leave a note for visitors...">${esc(current)}</textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
        <span id="note-counter" style="color:var(--nd-subtext);font-size:10px;">${current.length}/${MAX}</span>
        <div style="display:flex;gap:8px;">
          ${current ? `<button id="note-clear" style="
            padding:6px 14px;border-radius:4px;cursor:pointer;
            background:transparent;border:1px solid color-mix(in srgb,var(--nd-amber) 30%,transparent);
            color:var(--nd-amber);font-family:'Courier New',monospace;font-size:11px;
          ">Remove</button>` : ''}
          <button id="note-save" style="
            padding:6px 18px;border-radius:4px;cursor:pointer;
            background:color-mix(in srgb,var(--nd-accent) 18%,transparent);
            border:1px solid color-mix(in srgb,var(--nd-accent) 40%,transparent);
            color:var(--nd-accent);font-family:'Courier New',monospace;font-size:11px;
          ">Pin Note</button>
        </div>
      </div>
      <div id="note-saved" style="color:var(--nd-accent);font-size:11px;margin-top:8px;opacity:0;transition:opacity 0.3s;">
        ✓ Note pinned to wall
      </div>
    `;

    const textarea = container.querySelector('#note-input') as HTMLTextAreaElement;
    const counter  = container.querySelector('#note-counter') as HTMLElement;
    const saved    = container.querySelector('#note-saved') as HTMLElement;

    textarea.addEventListener('input', () => {
      counter.textContent = `${textarea.value.length}/${MAX}`;
    });

    container.querySelector('#note-save')?.addEventListener('click', () => {
      const text = textarea.value.trim();
      const newCfg = setRoomConfig({ pinnedNote: text || null });
      this.onRoomChange?.(newCfg);
      saved.style.opacity = '1';
      setTimeout(() => { saved.style.opacity = '0'; }, 2000);
      // Re-render to show/hide the Remove button
      this.renderNotePicker(container);
    });

    container.querySelector('#note-clear')?.addEventListener('click', () => {
      const newCfg = setRoomConfig({ pinnedNote: null });
      this.onRoomChange?.(newCfg);
      this.renderNotePicker(container);
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
                  border:1px solid ${active ? 'color-mix(in srgb,var(--nd-accent) 44%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 22%,transparent)'};
                  background:${active ? 'color-mix(in srgb,var(--nd-accent) 10%,transparent)' : 'transparent'};
                  transition:background 0.15s,border-color 0.15s;
                ">
                  <span style="display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0;
                    background:${active ? 'var(--nd-accent)' : 'transparent'};
                    border:1px solid ${active ? 'var(--nd-accent)' : 'var(--nd-subtext)'};
                  "></span>
                  <span style="color:${active ? 'var(--nd-accent)' : 'var(--nd-text)'};font-size:12px;">${esc(t.label)}</span>
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
          this.onMusicChange?.(tid);
          render();
        });
      });
    };

    render();
  }
}

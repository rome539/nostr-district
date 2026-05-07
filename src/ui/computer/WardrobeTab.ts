import { AvatarConfig, getAvatar, setAvatar, AVATAR_OPTIONS, COLOR_PRESETS, getOutfits, saveOutfit, deleteOutfit } from '../../stores/avatarStore';
import { isOwned, CATALOG } from '../../stores/marketStore';
import { renderRoomSprite } from '../../entities/AvatarRenderer';
import { authStore } from '../../stores/authStore';
import { publishOutfits, publishAvatar } from '../../nostr/nostrService';
import type { TabCtx } from './types';

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
function fmtLabel(s: string): string {
  return esc(s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
}

export class WardrobeTab {
  private draftAvatar: AvatarConfig | null = null;
  private wardrobePage = 0;
  private currentSlot = 'top';
  private _previewAnimId: number | null = null;
  private body: HTMLElement | null = null;
  private ctx: TabCtx | null = null;

  render(body: HTMLElement, ctx: TabCtx): void {
    this.body = body;
    this.ctx = ctx;
    if (!this.draftAvatar) this.draftAvatar = { ...getAvatar() };
    const avatar = this.draftAvatar;

    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="color:var(--nd-subtext);font-size:10px;letter-spacing:0.08em;opacity:0.55;">WARDROBE</span>
        <button id="ward-nostr-sync" style="
          padding:5px 12px;border-radius:4px;cursor:pointer;
          font-family:'Courier New',monospace;font-size:11px;
          background:color-mix(in srgb,var(--nd-accent) 20%,transparent);
          border:1px solid color-mix(in srgb,var(--nd-accent) 50%,transparent);
          color:var(--nd-accent);white-space:nowrap;transition:all 0.12s;
        " onmouseover="this.style.background='color-mix(in srgb,var(--nd-accent) 30%,transparent)'" onmouseout="this.style.background='color-mix(in srgb,var(--nd-accent) 20%,transparent)'">Save</button>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:14px;">
        <div id="ward-preview" style="width:96px;height:216px;background:linear-gradient(180deg,color-mix(in srgb,var(--nd-purp) 55%,var(--nd-navy)) 0%,var(--nd-navy) 68%,var(--nd-bg) 100%);border:1px solid color-mix(in srgb,var(--nd-dpurp) 44%,transparent);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.04),inset 0 -18px 28px rgba(0,0,0,0.3);position:relative;overflow:hidden;"></div>
        <div style="flex:1;min-width:0;">
          <div id="ward-slots" style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:10px;"></div>
          <div id="ward-options"></div>
        </div>
      </div>
      <div id="ward-colors"></div>
      <div id="ward-outfits" style="margin-top:14px;"></div>
    `;

    this.renderPreview(avatar);
    this.renderSlotTabs();
    this.renderOptions();
    this.renderColors();
    this.renderOutfits();

    const wardSync = body.querySelector('#ward-nostr-sync') as HTMLButtonElement | null;
    if (authStore.getState().isGuest) {
      if (wardSync) wardSync.style.display = 'none';
    } else {
      wardSync?.addEventListener('click', () => {
        if (!wardSync || !this.draftAvatar) return;
        const committed = setAvatar(this.draftAvatar);
        this.ctx?.onAvatarChange?.(committed);
        publishAvatar(committed);
        wardSync.textContent = 'Saved!';
        wardSync.disabled = true;
        setTimeout(() => { if (wardSync.isConnected) { wardSync.textContent = 'Save'; wardSync.disabled = false; } }, 1500);
      });
    }
  }

  destroy(): void {
    if (this._previewAnimId !== null) { cancelAnimationFrame(this._previewAnimId); this._previewAnimId = null; }
    this.draftAvatar = null;
    this.body = null;
    this.ctx = null;
  }

  private renderPreview(avatar: AvatarConfig): void {
    if (this._previewAnimId !== null) { cancelAnimationFrame(this._previewAnimId); this._previewAnimId = null; }
    const container = this.ctx?.panel.querySelector('#ward-preview');
    if (!container) return;
    container.innerHTML = '';
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:absolute;inset:0;background:radial-gradient(circle at 50% 24%, rgba(255,255,255,0.12), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 52%, transparent 52%), linear-gradient(90deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 16px), linear-gradient(180deg, transparent 0%, transparent 78%, rgba(255,244,200,0.10) 78%, rgba(255,244,200,0.16) 100%);pointer-events:none;';
    container.appendChild(backdrop);
    const preview = document.createElement('canvas');
    preview.style.cssText = 'image-rendering:pixelated;position:relative;z-index:1;';
    container.appendChild(preview);

    const EYE_CYCLE_TYPES = new Set(['blaze', 'frost', 'cosmic']);
    const EYE_PALETTES: Record<string, string[]> = {
      blaze:  ['#ff6600', '#ff3300', '#ffaa00', '#ffdd00', '#ff4400'],
      frost:  ['#aaddff', '#ffffff', '#88ccff', '#cceeff', '#44aaff'],
      cosmic: ['#ffffff', '#aa88ff', '#ff88ff', '#88ffff', '#ffff88'],
    };
    const EYE_SPEED: Record<string, number> = { blaze: 100, frost: 280, cosmic: 360 };

    if (this.currentSlot === 'eyes' && EYE_CYCLE_TYPES.has(avatar.eyes ?? '')) {
      const pal = EYE_PALETTES[avatar.eyes!];
      const spd = EYE_SPEED[avatar.eyes!];
      let lastStep = -1;
      const loop = () => {
        const step = Math.floor(Date.now() / spd) % pal.length;
        if (step !== lastStep) {
          lastStep = step;
          const src = renderRoomSprite({ ...avatar, eyeColor: pal[step] });
          preview.width = src.width * 3; preview.height = src.height * 3;
          const px = preview.getContext('2d')!;
          px.imageSmoothingEnabled = false;
          px.drawImage(src, 0, 0, src.width, src.height, 0, 0, src.width * 3, src.height * 3);
        }
        this._previewAnimId = requestAnimationFrame(loop);
      };
      loop();
    } else {
      const src = renderRoomSprite(avatar);
      preview.width = src.width * 3; preview.height = src.height * 3;
      const px = preview.getContext('2d')!;
      px.imageSmoothingEnabled = false;
      px.drawImage(src, 0, 0, src.width, src.height, 0, 0, src.width * 3, src.height * 3);
    }
  }

  private renderSlotTabs(): void {
    const body = this.body!;
    const container = body.querySelector('#ward-slots');
    if (!container) return;
    const slots = [
      { key: 'hair', label: 'Hair' },
      { key: 'top', label: 'Top' }, { key: 'bottom', label: 'Bottom' },
      { key: 'hat', label: 'Hat' }, { key: 'accessory', label: 'Acc' },
      { key: 'eyes', label: 'Eyes' },
      { key: 'nameColor', label: 'Name' }, { key: 'chatColor', label: 'Chat' },
      { key: 'rodSkin', label: 'Rod' }, { key: 'nameAnim', label: 'Anim' },
      { key: 'aura', label: 'Aura' },
    ];
    container.innerHTML = slots.map(s => `
      <button class="ws" data-slot="${s.key}" style="
        padding:4px 7px;border-radius:4px;font-family:'Courier New',monospace;font-size:10px;white-space:nowrap;
        cursor:pointer;border:1px solid ${this.currentSlot === s.key ? 'color-mix(in srgb,var(--nd-accent) 40%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 20%,transparent)'};
        background:${this.currentSlot === s.key ? 'color-mix(in srgb,var(--nd-accent) 13%,transparent)' : 'transparent'};
        color:${this.currentSlot === s.key ? 'var(--nd-accent)' : 'var(--nd-subtext)'};
      ">${s.label}</button>
    `).join('');
    container.querySelectorAll('.ws').forEach(el => {
      el.addEventListener('click', () => {
        this.currentSlot = (el as HTMLElement).dataset.slot!;
        this.wardrobePage = 0;
        this.renderSlotTabs(); this.renderOptions(); this.renderColors();
      });
    });
  }

  private renderOptions(): void {
    const body = this.body!;
    const container = body.querySelector('#ward-options');
    if (!container) return;
    const avatar = this.draftAvatar ?? getAvatar();

    const COSMETIC_SLOTS = ['nameColor', 'chatColor', 'rodSkin', 'nameAnim', 'aura'] as const;
    if ((COSMETIC_SLOTS as readonly string[]).includes(this.currentSlot)) {
      const current = (avatar as any)[this.currentSlot] as string;
      const catalogSlot = this.currentSlot === 'chatColor' ? 'nameColor' : this.currentSlot;
      const ownedItems = CATALOG.filter(i => i.slot === catalogSlot && isOwned(i.slot, i.value));

      container.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
        <button class="wo" data-v="" style="
          padding:5px 9px;border-radius:4px;font-family:'Courier New',monospace;font-size:11px;cursor:pointer;
          border:1px solid ${current === '' ? 'color-mix(in srgb,var(--nd-accent) 66%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 20%,transparent)'};
          background:${current === '' ? 'color-mix(in srgb,var(--nd-accent) 22%,transparent)' : 'transparent'};
          color:${current === '' ? 'var(--nd-accent)' : 'var(--nd-subtext)'};
        ">None</button>
        ${ownedItems.map(item => {
          const active = current === item.value;
          const isColor = item.value.startsWith('#');
          const swatch = isColor
            ? `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${item.value};vertical-align:middle;margin-right:4px;flex-shrink:0;border:1px solid rgba(255,255,255,0.2);"></span>`
            : '';
          const label = item.name.replace(/ Name Tag$| Chat$| Rod$/, '').trim();
          return `<button class="wo" data-v="${item.value}" style="
            padding:5px 9px;border-radius:4px;font-family:'Courier New',monospace;font-size:11px;cursor:pointer;
            border:1px solid ${active ? 'color-mix(in srgb,var(--nd-accent) 66%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 20%,transparent)'};
            background:${active ? 'color-mix(in srgb,var(--nd-accent) 22%,transparent)' : 'transparent'};
            color:${active ? 'var(--nd-accent)' : 'var(--nd-text)'};
            display:flex;align-items:center;
          ">${swatch}${esc(label)}</button>`;
        }).join('')}
        ${ownedItems.length === 0 ? `<span style="color:var(--nd-subtext);font-size:10px;opacity:0.5;">No items owned — visit the shop (/shop)</span>` : ''}
      </div>`;

      container.querySelectorAll('.wo').forEach(el => {
        el.addEventListener('click', () => {
          const v = (el as HTMLElement).dataset.v;
          const patch: Partial<AvatarConfig> = { [this.currentSlot]: v } as any;
          if (this.currentSlot === 'nameColor') patch.chatColor = v;
          this.draftAvatar = { ...(this.draftAvatar ?? getAvatar()), ...patch };
          this.renderPreview(this.draftAvatar); this.renderOptions(); this.renderColors();
        });
      });
      return;
    }

    const optMap: Record<string, readonly string[]> = {
      hair: AVATAR_OPTIONS.hair, top: AVATAR_OPTIONS.top,
      bottom: [...AVATAR_OPTIONS.bottom, ...CATALOG.filter(i => i.slot === 'bottom' && i.earn).map(i => i.value as any)],
      hat:    [...AVATAR_OPTIONS.hat,    ...CATALOG.filter(i => i.slot === 'hat'    && i.earn).map(i => i.value as any)],
      accessory: AVATAR_OPTIONS.accessory,
      eyes: [...AVATAR_OPTIONS.eyes, ...CATALOG.filter(i => i.slot === 'eyes' && i.value !== 'cry').map(i => i.value as any)],
    };
    const valMap: Record<string, string> = {
      hair: avatar.hair, top: avatar.top,
      bottom: avatar.bottom, hat: avatar.hat, accessory: avatar.accessory,
      eyes: avatar.eyes,
    };
    const allOptions = (optMap[this.currentSlot] || []).filter(opt => isOwned(this.currentSlot, opt));
    const current = valMap[this.currentSlot] || '';

    const PAGE_SIZE = 16;
    const totalPages = Math.ceil(allOptions.length / PAGE_SIZE);
    this.wardrobePage = Math.min(this.wardrobePage, Math.max(0, totalPages - 1));
    const pageOpts = allOptions.slice(this.wardrobePage * PAGE_SIZE, (this.wardrobePage + 1) * PAGE_SIZE);

    const btnBase = `padding:5px 9px;border-radius:4px;font-family:'Courier New',monospace;font-size:11px;cursor:pointer;`;
    const arrowBtn = (sym: string, id: string, disabled: boolean) =>
      `<button id="${id}" style="min-width:44px;min-height:36px;padding:0 10px;background:none;border:none;font-size:16px;cursor:pointer;opacity:${disabled ? '0.15' : '0.35'};color:var(--nd-subtext);${disabled ? 'pointer-events:none;' : ''}">${sym}</button>`;

    container.innerHTML = `
      <div style="position:relative;min-height:${totalPages > 1 ? '168px' : '0'};">
        <div style="display:flex;flex-wrap:wrap;gap:4px;padding-bottom:${totalPages > 1 ? '36px' : '0'};">
          ${pageOpts.map(opt => {
            const active = current === opt;
            return `<button class="wo" data-v="${opt}" style="
              ${btnBase}
              border:1px solid ${active ? 'color-mix(in srgb,var(--nd-accent) 66%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 20%,transparent)'};
              background:${active ? 'color-mix(in srgb,var(--nd-accent) 22%,transparent)' : 'transparent'};
              color:${active ? 'var(--nd-accent)' : 'var(--nd-text)'};
            ">${fmtLabel(opt)}</button>`;
          }).join('')}
        </div>
        ${totalPages > 1 ? `
          <div style="position:absolute;bottom:0;right:0;display:flex;align-items:center;">
            ${arrowBtn('‹', 'ward-prev', this.wardrobePage === 0)}
            <span style="font-family:'Courier New',monospace;font-size:10px;color:var(--nd-subtext);opacity:0.25;min-width:28px;text-align:center;">${this.wardrobePage + 1}/${totalPages}</span>
            ${arrowBtn('›', 'ward-next', this.wardrobePage >= totalPages - 1)}
          </div>
        ` : ''}
      </div>
    `;
    container.querySelectorAll('.wo').forEach(el => {
      el.addEventListener('click', () => {
        this.draftAvatar = { ...(this.draftAvatar ?? getAvatar()), [this.currentSlot]: (el as HTMLElement).dataset.v };
        this.renderPreview(this.draftAvatar); this.renderOptions(); this.renderColors();
      });
    });
    container.querySelector('#ward-prev')?.addEventListener('click', () => {
      this.wardrobePage = Math.max(0, this.wardrobePage - 1);
      this.renderOptions();
    });
    container.querySelector('#ward-next')?.addEventListener('click', () => {
      this.wardrobePage = Math.min(totalPages - 1, this.wardrobePage + 1);
      this.renderOptions();
    });
  }

  private renderColors(): void {
    const body = this.body!;
    const container = body.querySelector('#ward-colors');
    if (!container) return;
    const avatar = this.draftAvatar ?? getAvatar();
    const keyMap: Record<string, string> = {
      hair: 'hairColor', top: 'topColor',
      bottom: 'bottomColor', hat: 'hatColor', accessory: 'accessoryColor',
      eyes: 'eyeColor',
    };
    const colorKey = keyMap[this.currentSlot];
    if (!colorKey) { container.innerHTML = ''; return; }
    const eyeCycleTypes = new Set(['blaze', 'frost', 'cosmic']);
    if (this.currentSlot === 'eyes' && eyeCycleTypes.has(avatar.eyes ?? '')) { container.innerHTML = ''; return; }
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
        this.draftAvatar = { ...(this.draftAvatar ?? getAvatar()), [colorKey]: (el as HTMLElement).dataset.c };
        this.renderPreview(this.draftAvatar); this.renderColors();
      });
    });
  }

  private renderOutfits(): void {
    const body = this.body!;
    const container = body.querySelector('#ward-outfits') as HTMLElement;
    if (!container) return;
    const outfits = getOutfits();
    const inputStyle = `width:100%;padding:6px 8px;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);border-radius:4px;color:var(--nd-text);font-family:'Courier New',monospace;font-size:12px;outline:none;box-sizing:border-box;`;
    container.innerHTML = `
      <div style="margin-bottom:6px;">
        <span style="color:var(--nd-subtext);font-size:10px;opacity:0.5;">SAVED OUTFITS</span>
      </div>
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
      this.renderOutfits();
      if (!authStore.getState().isGuest) publishOutfits(getOutfits());
    });
    container.querySelectorAll('.outfit-load').forEach(el => {
      el.addEventListener('click', () => {
        const i = parseInt((el as HTMLElement).dataset.i!);
        const outfit = getOutfits()[i];
        if (!outfit) return;
        const newAvatar = setAvatar(outfit.avatar);
        this.draftAvatar = { ...newAvatar };
        this.ctx?.onAvatarChange?.(newAvatar);
        if (!authStore.getState().isGuest) publishAvatar(newAvatar);
        this.renderPreview(newAvatar);
        this.renderOptions();
        this.renderColors();
        this.ctx?.onAvatarChange?.(newAvatar);
      });
    });
    container.querySelectorAll('.outfit-del').forEach(el => {
      el.addEventListener('click', () => {
        deleteOutfit(parseInt((el as HTMLElement).dataset.i!));
        this.renderOutfits();
        if (!authStore.getState().isGuest) publishOutfits(getOutfits());
      });
    });
  }
}

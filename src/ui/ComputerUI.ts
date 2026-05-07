import { WardrobeTab } from './computer/WardrobeTab';
import { ProfileTab }  from './computer/ProfileTab';
import { RoomTab }     from './computer/RoomTab';
import type { TabCtx, OnAvatarChange, OnRoomChange, OnPetChange, OnStatusUpdate, OnMusicChange } from './computer/types';

const PANEL_ID = 'computer-panel';

export class ComputerUI {
  private backdrop: HTMLDivElement | null = null;
  private panel: HTMLDivElement | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private previewPill: HTMLDivElement | null = null;
  private currentTab: 'wardrobe' | 'profile' | 'room' = 'wardrobe';
  private allowedTabs: ('wardrobe' | 'profile' | 'room')[] = ['wardrobe', 'profile', 'room'];

  private onAvatarChange:  OnAvatarChange | null = null;
  private onProfileSave:   ((name: string) => void) | null = null;
  private onRoomChange:    OnRoomChange | null = null;
  private onPetChange:     OnPetChange | null = null;
  private onStatusUpdate:  OnStatusUpdate | null = null;
  private onMusicChange:   OnMusicChange | null = null;
  private onEnterArrange:  ((newItemId?: string) => void) | null = null;

  private wardrobeTab = new WardrobeTab();
  private profileTab  = new ProfileTab();
  private roomTab     = new RoomTab();

  open(
    onAvatarChange?: OnAvatarChange,
    onProfileSave?:  (name: string) => void,
    onRoomChange?:   OnRoomChange,
    onPetChange?:    OnPetChange,
    onStatusUpdate?: OnStatusUpdate,
    onMusicChange?:  OnMusicChange,
    allowedTabs?:    ('wardrobe' | 'profile' | 'room')[],
    onEnterArrange?: (newItemId?: string) => void,
    startTab?:       'wardrobe' | 'profile' | 'room',
  ): void {
    if (this.panel) this.close();
    this.onAvatarChange  = onAvatarChange  || null;
    this.onProfileSave   = onProfileSave   || null;
    this.onRoomChange    = onRoomChange    || null;
    this.onPetChange     = onPetChange     || null;
    this.onStatusUpdate  = onStatusUpdate  || null;
    this.onMusicChange   = onMusicChange   || null;
    this.onEnterArrange  = onEnterArrange  || null;
    this.allowedTabs     = allowedTabs ?? ['wardrobe', 'profile', 'room'];
    this.currentTab      = startTab ?? this.allowedTabs[0];
    this.buildPanel();
  }

  openToRoom(
    onAvatarChange?: OnAvatarChange,
    onProfileSave?:  (name: string) => void,
    onRoomChange?:   OnRoomChange,
    onPetChange?:    OnPetChange,
    onStatusUpdate?: OnStatusUpdate,
    onMusicChange?:  OnMusicChange,
  ): void {
    if (this.panel) this.close();
    this.onAvatarChange  = onAvatarChange  || null;
    this.onProfileSave   = onProfileSave   || null;
    this.onRoomChange    = onRoomChange    || null;
    this.onPetChange     = onPetChange     || null;
    this.onStatusUpdate  = onStatusUpdate  || null;
    this.onMusicChange   = onMusicChange   || null;
    this.allowedTabs     = ['wardrobe', 'profile', 'room'];
    this.currentTab      = 'room';
    this.roomTab.resetSection();
    this.buildPanel();
  }

  close(): void {
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    this.previewPill?.remove();
    this.previewPill = null;
    this.roomTab.revertIfNeeded();
    this.wardrobeTab.destroy();
    this.roomTab.destroy();
    if (this.backdrop) { this.backdrop.remove(); this.backdrop = null; }
    if (this.panel)    { this.panel.remove();    this.panel    = null; }
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
      width:min(540px,96vw);max-height:min(88dvh,680px);overflow:hidden;
      display:flex;flex-direction:column;
    `;

    this.panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid color-mix(in srgb,var(--nd-dpurp) 20%,transparent);">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="color:var(--nd-accent);font-size:11px;">&#9679;</span>
          <span style="color:var(--nd-text);font-size:14px;font-weight:bold;">TERMINAL</span>
        </div>
        <button id="comp-close" style="background:none;border:none;color:var(--nd-dpurp);font-size:18px;cursor:pointer;padding:4px 8px;">✕</button>
      </div>
      <div id="comp-tabs" style="display:flex;border-bottom:1px solid color-mix(in srgb,var(--nd-dpurp) 13%,transparent);"></div>
      <div id="comp-body" style="flex:1;overflow-y:auto;padding:16px 18px;"></div>
    `;

    this.panel.addEventListener('keydown',     (e) => e.stopPropagation());
    this.panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(this.panel);

    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (this.previewPill) this.showAfterPreview();
        else this.close();
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
      { key: 'wardrobe', label: '👕 Wardrobe' },
      { key: 'room',     label: '🏠 Room' },
      { key: 'profile',  label: '👤 Profile' },
    ].filter(t => this.allowedTabs.includes(t.key as any));

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
    const ctx = this.makeCtx();
    switch (this.currentTab) {
      case 'wardrobe': this.wardrobeTab.render(body, ctx); break;
      case 'profile':  this.profileTab.render(body, ctx);  break;
      case 'room':     this.roomTab.render(body, ctx);     break;
    }
  }

  private makeCtx(): TabCtx {
    return {
      panel:            this.panel!,
      rerender:         () => this.renderBody(),
      hideForPreview:   () => this.hideForPreview(),
      showAfterPreview: () => this.showAfterPreview(),
      onAvatarChange:   this.onAvatarChange,
      onProfileSave:    this.onProfileSave,
      onRoomChange:     this.onRoomChange,
      onPetChange:      this.onPetChange,
      onStatusUpdate:   this.onStatusUpdate,
      onMusicChange:    this.onMusicChange,
      onEnterArrange:   this.onEnterArrange,
    };
  }

  private hideForPreview(): void {
    if (this.panel)    this.panel.style.display    = 'none';
    if (this.backdrop) this.backdrop.style.display = 'none';

    const pill = document.createElement('div');
    pill.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:4000;
      background:color-mix(in srgb,var(--nd-bg) 92%,transparent);
      border:1px solid color-mix(in srgb,var(--nd-accent) 40%,transparent);
      border-radius:20px;padding:8px 18px;
      color:var(--nd-accent);font-family:'Courier New',monospace;font-size:12px;
      cursor:pointer;backdrop-filter:blur(6px);
    `;
    pill.textContent = '↩ Back to Terminal';
    pill.addEventListener('click', () => this.showAfterPreview());
    document.body.appendChild(pill);
    this.previewPill = pill;
  }

  private showAfterPreview(): void {
    if (this.panel)    this.panel.style.display    = '';
    if (this.backdrop) this.backdrop.style.display = '';
    this.previewPill?.remove();
    this.previewPill = null;
  }
}

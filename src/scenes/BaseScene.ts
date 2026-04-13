/**
 * BaseScene.ts — Abstract base class shared by every playable scene.
 *
 * Provides all common panel fields, registry setup, shared keyboard handlers
 * (M, G, F, S, T, U, ENTER, ?), a common ESC chain helper, the emote command
 * helper, and a common shutdown cleanup method.
 *
 * ── How to use in a new scene ────────────────────────────────────────────────
 *
 *   export class MyScene extends BaseScene {
 *     private player!: Phaser.GameObjects.Image;
 *     // scene-specific fields only — all panels are inherited
 *
 *     create(): void {
 *       const myPubkey = this.registry.get('playerPubkey');
 *       this.snd.setRoom('myroom');
 *
 *       this.chatUI = new ChatUI();
 *       this.chatInput = this.chatUI.create('Placeholder…', ACCENT, (cmd) => this.handleCommand(cmd));
 *
 *       this.setupRegistryPanels(myPubkey);       // dmPanel, crewPanel, followsPanel
 *       this.setupCommonKeyboardHandlers();        // M G F S T U ENTER ?
 *
 *       this.input.keyboard?.on('keydown-E', () => { ... });  // scene-specific keys
 *       this.input.keyboard?.on('keydown-ESC', () => {
 *         if (document.activeElement === this.chatInput) return;
 *         if (this.hotkeyModal.isOpen()) { this.hotkeyModal.close(); return; }
 *         // scene-specific modals / overlays here…
 *         if (this.handleCommonEsc()) return;
 *         if (!this.isLeavingScene) { this.isLeavingScene = true; this.leaveScene(); }
 *       });
 *
 *       this.setupProfileSubscription();
 *       this.settingsPanel.create();
 *       this.events.on('shutdown', () => {
 *         this.shutdownCommonPanels();
 *         // scene-specific cleanup here…
 *       });
 *     }
 *
 *     // Override to block panel keys while a scene-specific modal is open:
 *     protected override shouldBlockPanelKeys(): boolean {
 *       return MyModal.isOpen();
 *     }
 *
 *     // Override for a custom T-key (terminal) behaviour:
 *     protected override onTKey(): void { ... }
 *   }
 */

import Phaser from 'phaser';
import { ChatUI } from '../ui/ChatUI';
import { DMPanel } from '../ui/DMPanel';
import { CrewPanel } from '../ui/CrewPanel';
import { FollowsPanel } from '../ui/FollowsPanel';
import { SettingsPanel } from '../ui/SettingsPanel';
import { HotkeyModal } from '../ui/HotkeyModal';
import { EmoteSet, EMOTE_FLAVORS, EMOTE_OFF_MSGS } from '../entities/EmoteSet';
import { SoundEngine } from '../audio/SoundEngine';
import { ComputerUI } from '../ui/ComputerUI';
import { MuteList } from '../ui/MuteList';
import { PlayerPicker } from '../ui/PlayerPicker';
import { ProfileModal } from '../ui/ProfileModal';
import { RpsGame } from '../ui/RpsGame';
import { PollBoard } from '../ui/PollBoard';
import { destroyPlayerMenu, showPlayerMenu, mutedPlayers } from '../ui/PlayerMenu';
import {
  sendChat, sendNameUpdate, sendRoomResponse,
  setPresenceCallbacks, sendAvatarUpdate,
  setRoomRequestHandler, setRoomGrantedHandler, setRoomDeniedHandler, setRoomKickHandler, clearRoomRequestHandler,
  requestOnlinePlayers,
  PresenceCallback,
} from '../nostr/presenceService';
import { toggleMute, addBannedWord, removeBannedWord, getCustomBannedWords, shouldFilter } from '../nostr/moderationService';
import { canUseDMs } from '../nostr/dmService';
import { authStore } from '../stores/authStore';
import { AvatarConfig, deserializeAvatar, getDefaultAvatar } from '../stores/avatarStore';
import { getRoomConfig } from '../stores/roomStore';
import { getStatus } from '../stores/statusStore';
import { GROUND_Y, P } from '../config/game.config';

// ── Other-player types ────────────────────────────────────────────────────────

/** Minimal fields required by BaseScene's remove/shutdown helpers. */
export interface BaseOtherPlayer {
  sprite: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  clickZone?: Phaser.GameObjects.Zone;
  emotes?: EmoteSet;
}

/** Full other-player record shared by all scenes. */
export interface OtherPlayer extends BaseOtherPlayer {
  targetX: number;
  targetY: number;
  facingRight: boolean;
  name: string;
  avatar?: string;
  status?: string;
  // fade-in mechanic (Hub / Cabin / Woods)
  joinTime?: number;
  shown?: boolean;
  // walk-frame animation (RoomScene)
  walkFrame?: number;
  walkTimer?: number;
}

/** Per-scene rendering & layout constants consumed by addOtherPlayer / updateOtherPlayers. */
export interface OtherPlayerConfig {
  /** Texture key prefix, e.g. 'avatar_hub_' or 'avatar_room_'. */
  texKeyPrefix: string;
  scale: number;
  /** Y offset from sprite.y for the name tag (negative = above). */
  nameYOffset: number;
  statusYOffset: number;
  nameColor: string;
  nameFontSize: string;
  statusFontSize: string;
  nameBg: string;
  namePadding: { x: number; y: number };
  /** Click zone dimensions and Y offset from sprite.y. */
  czW: number; czH: number; czYOffset: number;
  /** Five tint colours used when no avatar string is provided. */
  tintPalette: number[];
  /** If true, spawn at alpha 0 and reveal after 500 ms. */
  useFadeIn: boolean;
  /** If true, interpolate sprite.y toward targetY; if false, pin to playerY with walk-bob. */
  interpolateY: boolean;
  /** Context string passed to EmoteSet.updateAll() for other players. */
  emoteContext: 'hub' | 'cabin' | 'room';
}

export abstract class BaseScene extends Phaser.Scene {
  // ── Player text (assigned in each scene's createPlayer) ─────────────────
  protected playerName!: Phaser.GameObjects.Text;
  protected playerStatusText!: Phaser.GameObjects.Text;

  // ── Chat ─────────────────────────────────────────────────────────────────
  protected chatUI!: ChatUI;
  protected chatInput!: HTMLInputElement;

  // ── Registry-backed singleton panels (survive scene transitions) ─────────
  protected dmPanel!: DMPanel;
  protected crewPanel!: CrewPanel;
  protected followsPanel!: FollowsPanel;

  // ── Per-scene panels (recreated each scene visit) ────────────────────────
  protected settingsPanel = new SettingsPanel();
  protected hotkeyModal   = new HotkeyModal();
  protected computerUI    = new ComputerUI();
  protected muteList      = new MuteList();
  protected playerPicker  = new PlayerPicker();
  protected rpsGame       = new RpsGame();
  protected pollBoard     = new PollBoard();

  // ── Other players (shared by all scenes) ─────────────────────────────────
  protected otherPlayers = new Map<string, OtherPlayer>();
  protected dyingSprites = new Map<string, OtherPlayer>();
  protected onlineCount = 0;
  private pendingOnlineSample = false;

  // ── Emote graphics (assigned in each scene's create) ─────────────────────
  protected emoteGraphics!: Phaser.GameObjects.Graphics;

  // ── Emotes / Audio ────────────────────────────────────────────────────────
  protected emoteSet = new EmoteSet();
  protected snd      = SoundEngine.get();

  // ── Shared movement / walk fields ─────────────────────────────────────────
  protected targetX: number | null = null;
  protected isMoving       = false;
  protected isKeyboardMoving = false;
  protected facingRight    = true;
  protected playerY        = GROUND_Y + 8;
  protected walkTime       = 0;
  protected walkFrame      = 0;
  protected footTimer      = 0;

  // ── Mobile controls ────────────────────────────────────────────────────────
  protected mobileLeft  = false;
  protected mobileRight = false;
  private   mobileControlsEl: HTMLElement | null = null;

  // ── Scene state ────────────────────────────────────────────────────────────
  protected isLeavingScene = false;
  private unsubProfile?: () => void;
  private roomRequestToast: HTMLElement | null = null;
  private readonly roomRequestHandler = (rp: string, rn: string) => this.showRoomRequestToast(rp, rn);

  // ══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE — common init/shutdown helpers
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Resets emotes and the leaving-guard flag every time the scene starts.
   * Subclasses that override init() must call super.init(data) first.
   */
  init(_data?: object): void {
    this.emoteSet.stopAll();
    this.isLeavingScene = false;
    this.walkTime  = 0;
    this.walkFrame = 0;
    this.footTimer = 0;
    this.isMoving  = false;
    this.isKeyboardMoving = false;
    this.targetX   = null;
    this.mobileLeft  = false;
    this.mobileRight = false;
  }

  /**
   * Subscribes to authStore for display-name changes and stores the unsub
   * function so shutdownCommonPanels() can clean it up automatically.
   * Call once in create() after this.playerName has been assigned.
   */
  protected setupProfileSubscription(): void {
    this.unsubProfile = authStore.subscribe(() => {
      const newName = authStore.getState().displayName;
      if (newName && newName !== this.registry.get('playerName')) {
        this.registry.set('playerName', newName);
        this.playerName?.setText(newName.slice(0, 14));
        sendNameUpdate(newName);
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // OTHER PLAYER MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Fade-out and destroy an other-player entry. Moves the entry to
   * dyingSprites during the tween so re-joins can cancel it cleanly.
   */
  protected removeOtherPlayer(pk: string): void {
    const o = this.otherPlayers.get(pk); if (!o) return;
    this.otherPlayers.delete(pk);
    this.onBeforeRemoveOtherPlayer(pk);
    this.dyingSprites.set(pk, o);
    this.tweens.add({ targets: [o.sprite, o.nameText, o.statusText], alpha: 0, duration: 300, onComplete: () => {
      o.sprite.destroy(); o.nameText.destroy(); o.statusText.destroy(); if (o.clickZone) o.clickZone.destroy();
      this.dyingSprites.delete(pk);
    }});
  }

  /**
   * Called from removeOtherPlayer after the entry is removed from otherPlayers
   * but before it moves to dyingSprites. Override for scene-specific cleanup
   * (e.g. HubScene removes the entry from its playerNames lookup map).
   */
  protected onBeforeRemoveOtherPlayer(_pk: string): void {}

  // ══════════════════════════════════════════════════════════════════════════
  // OTHER PLAYER SPAWN / UPDATE
  // Scenes provide layout/render constants via getOtherPlayerConfig() and
  // a canvas renderer via renderOtherAvatar(). Everything else is shared.
  // ══════════════════════════════════════════════════════════════════════════

  /** Return layout and render constants for this scene's other-player sprites. */
  protected abstract getOtherPlayerConfig(): OtherPlayerConfig;

  /** Render an avatar canvas for another player (hub-scale or room-scale). */
  protected abstract renderOtherAvatar(cfg: AvatarConfig): HTMLCanvasElement;

  /**
   * Spawn an other-player sprite + labels + click zone.
   * Scenes should not override this; customise via getOtherPlayerConfig(),
   * setupClickZone(), and afterAddOtherPlayer() hooks instead.
   */
  protected addOtherPlayer(pk: string, name: string, px: number, py: number, avatarStr?: string, status?: string): void {
    const cfg = this.getOtherPlayerConfig();

    // Cancel any in-progress fade-out for this pk before re-rendering its texture
    const dying = this.dyingSprites.get(pk);
    if (dying) {
      this.tweens.killTweensOf([dying.sprite, dying.nameText, dying.statusText]);
      dying.sprite.destroy(); dying.nameText.destroy(); dying.statusText.destroy();
      if (dying.clickZone) dying.clickZone.destroy();
      this.dyingSprites.delete(pk);
    }

    const texKey = `${cfg.texKeyPrefix}${pk}`;
    const avatarConfig = avatarStr ? (deserializeAvatar(avatarStr) || getDefaultAvatar()) : getDefaultAvatar();
    if (this.textures.exists(texKey)) this.textures.remove(texKey);
    this.textures.addCanvas(texKey, this.renderOtherAvatar(avatarConfig));

    const sp = this.add.image(px, py, texKey).setOrigin(0.5, 1).setScale(cfg.scale).setDepth(8);
    if (!avatarStr) {
      const h = name.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
      sp.setTint(cfg.tintPalette[h % cfg.tintPalette.length]);
    }

    const isMuted = mutedPlayers.has(pk);
    const nt = this.add.text(px, py + cfg.nameYOffset, name.slice(0, 14), {
      fontFamily: '"Courier New", monospace', fontSize: cfg.nameFontSize,
      color: isMuted ? '#3d3d55' : cfg.nameColor, align: 'center', backgroundColor: cfg.nameBg,
      padding: cfg.namePadding,
    }).setOrigin(0.5).setDepth(9);

    const statusStr = (status || '').slice(0, 30);
    const st = this.add.text(px, py + cfg.statusYOffset, statusStr, {
      fontFamily: '"Courier New", monospace', fontSize: cfg.statusFontSize,
      color: P.lpurp, align: 'center',
    }).setOrigin(0.5).setDepth(9).setAlpha(statusStr ? 1 : 0);

    if (cfg.useFadeIn) { sp.setAlpha(0); nt.setAlpha(0); st.setAlpha(0); }

    const cz = this.add.zone(px, py + cfg.czYOffset, cfg.czW, cfg.czH)
      .setInteractive({ useHandCursor: true }).setDepth(12);
    this.setupClickZone(cz, pk, name);

    this.otherPlayers.set(pk, {
      sprite: sp, nameText: nt, statusText: st,
      targetX: px, targetY: py, facingRight: true,
      name: name.slice(0, 14), avatar: avatarStr, status: status || '',
      clickZone: cz,
      ...(cfg.useFadeIn ? { joinTime: Date.now(), shown: false } : {}),
    });

    this.afterAddOtherPlayer(pk, name);
  }

  /**
   * Wire up the click zone for an other-player sprite.
   * Default: simple pointerdown → PlayerMenu. RoomScene overrides for drag-guard.
   */
  protected setupClickZone(zone: Phaser.GameObjects.Zone, pk: string, name: string): void {
    zone.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if ((ptr.event.target as HTMLElement)?.tagName !== 'CANVAS') return;
      ptr.event.stopPropagation();
      const op = this.otherPlayers.get(pk);
      showPlayerMenu(pk, name.slice(0, 14), ptr.x, ptr.y,
        {
          onChat: (t, c) => this.chatUI.addMessage('system', t, c),
          getDMPanel: () => this.dmPanel,
          onMuteChange: (pubkey, muted) => this.updateMuteVisual(pubkey, muted),
        },
        op?.avatar, op?.status);
    });
  }

  private updateMuteVisual(pk: string, muted: boolean): void {
    const o = this.otherPlayers.get(pk);
    if (!o) return;
    o.nameText.setText(o.name);
    o.nameText.setColor(muted ? '#3d3d55' : this.getOtherPlayerConfig().nameColor);
  }

  /**
   * Called after addOtherPlayer writes the entry to this.otherPlayers.
   * Override for scene-specific extras (e.g. HubScene's playerNames map,
   * RoomScene's walkFrame/walkTimer fields).
   */
  protected afterAddOtherPlayer(_pk: string, _name: string): void {}

  /**
   * Update all other-player sprites: interpolation, walk-bob, label positioning,
   * emote rendering, fade-in gate. Call once per frame from update().
   */
  protected updateOtherPlayers(time: number, delta: number): void {
    const cfg = this.getOtherPlayerConfig();
    this.otherPlayers.forEach((o, pk) => {
      // Fade-in gate: hide until 500 ms after join, then snap to position
      if (cfg.useFadeIn && !o.shown) {
        if (o.joinTime !== undefined && Date.now() - o.joinTime >= 500) {
          o.sprite.x = o.targetX; o.sprite.y = this.playerY;
          o.sprite.setAlpha(1); o.nameText.setAlpha(1);
          o.statusText.setAlpha(o.statusText.text ? 1 : 0);
          o.shown = true;
        } else { return; }
      }

      const dx = o.targetX - o.sprite.x;
      if (Math.abs(dx) > 1) { o.sprite.x += dx * 0.12; o.facingRight = dx > 0; }

      if (cfg.interpolateY) {
        if (Math.abs(o.targetY - o.sprite.y) > 1) o.sprite.y += (o.targetY - o.sprite.y) * 0.12;
      } else {
        // Pin to ground level; bob up/down while moving
        o.sprite.y = Math.abs(dx) > 3
          ? this.playerY + Math.abs(Math.sin(time * Math.PI / 150)) * -2
          : this.playerY;
      }

      o.sprite.setFlipX(!o.facingRight);
      o.nameText.setPosition(o.sprite.x, o.sprite.y + cfg.nameYOffset);
      o.statusText.setPosition(o.sprite.x, o.sprite.y + cfg.statusYOffset);
      if (o.clickZone) o.clickZone.setPosition(o.sprite.x, o.sprite.y + cfg.czYOffset);
      o.emotes?.updateAll(this.emoteGraphics, delta, o.sprite.x, o.sprite.y, o.facingRight, cfg.emoteContext);
      o.sprite.setAlpha(o.emotes?.isActive('ghost') ? 0.3 : 1);

      this.updateOtherPlayerExtras(pk, o, dx, delta);
    });
  }

  /**
   * Per-player hook called inside the updateOtherPlayers forEach, after the
   * common interpolation and label updates. Override in RoomScene for
   * other-player walk-frame animation.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected updateOtherPlayerExtras(_pk: string, _o: OtherPlayer, _dx: number, _delta: number): void {}

  // ══════════════════════════════════════════════════════════════════════════
  // REGISTRY PANEL SETUP
  // Call once in create() after this.chatInput is assigned.
  // Fetches or creates dmPanel, crewPanel, followsPanel from the Phaser registry
  // so they persist across scene transitions.
  // ══════════════════════════════════════════════════════════════════════════
  protected setupRegistryPanels(myPubkey: string): void {
    this.dmPanel = this.registry.get('dmPanel') as DMPanel;
    if (!this.dmPanel) {
      this.dmPanel = new DMPanel(myPubkey);
      this.registry.set('dmPanel', this.dmPanel);
    }

    this.crewPanel = this.registry.get('crewPanel') as CrewPanel;
    if (!this.crewPanel) {
      this.crewPanel = new CrewPanel();
      this.registry.set('crewPanel', this.crewPanel);
    }

    let rfp = this.registry.get('followsPanel') as FollowsPanel | undefined;
    if (!rfp) { rfp = new FollowsPanel(); this.registry.set('followsPanel', rfp); }
    this.followsPanel = rfp;

    // On touch devices, add a DM shortcut button to the chat bar
    if ('ontouchstart' in window) {
      this.chatUI.setDMButton(() => { this.crewPanel.close(); this.dmPanel.toggle(); });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMMON KEYBOARD HANDLERS
  // Call once in create() after setupRegistryPanels().
  // Registers M, G, F, S, T, U, ENTER, ? hotkeys shared by every scene.
  // Subclasses can override shouldBlockPanelKeys() and onTKey() for custom
  // behaviour (e.g., blocking while a room-specific modal is open).
  // ══════════════════════════════════════════════════════════════════════════
  protected setupCommonKeyboardHandlers(): void {
    this.rpsGame.setChatUI(this.chatUI);

    const ci = () => document.activeElement === this.chatInput;
    const blk = () => this.shouldBlockPanelKeys();

    // M — DMs
    this.input.keyboard?.on('keydown-M', () => {
      if (blk() || ci()) return;
      this.crewPanel.close(); this.dmPanel.toggle();
    });

    // G — Crew
    this.input.keyboard?.on('keydown-G', () => {
      if (blk() || ci()) return;
      this.dmPanel.close(); this.crewPanel.toggle();
    });

    // F — Follows
    this.input.keyboard?.on('keydown-F', () => {
      if (blk() || ci()) return;
      this.followsPanel.toggle();
    });

    // S — Settings
    this.input.keyboard?.on('keydown-S', () => {
      if (blk() || ci()) return;
      this.settingsPanel.toggle();
    });

    // T — Terminal / Avatar (override onTKey for custom behaviour)
    this.input.keyboard?.on('keydown-T', () => {
      if (blk() || ci()) return;
      this.onTKey();
    });

    // U — Mute list
    this.input.keyboard?.on('keydown-U', () => {
      if (blk() || ci()) return;
      this.muteList.toggle();
    });

    // ENTER — focus chat / DM / crew input
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (blk()) return;
      if (document.activeElement?.closest('.dm-panel')) return;
      if (document.activeElement?.closest('.cp-panel')) return;
      if (this.dmPanel?.isOpen)        { this.dmPanel.focusInput();   return; }
      if (this.crewPanel?.isVisible()) { this.crewPanel.focusInput(); return; }
      if (document.activeElement !== this.chatInput) this.chatInput.focus();
    });

    // B — Poll board
    this.input.keyboard?.on('keydown-B', () => {
      if (blk() || ci()) return;
      this.pollBoard.toggle();
    });

    // ? — Hotkey modal (document-level listener so it works outside Phaser focus)
    const hotkeyHandler = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      if (ci()) return;
      this.hotkeyModal.toggle();
    };
    document.addEventListener('keydown', hotkeyHandler);
    this.events.once('shutdown', () => document.removeEventListener('keydown', hotkeyHandler));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ROOM REQUEST HANDLERS
  // Call once in create() to register the incoming room-request toast.
  // Sets setRoomRequestHandler to show an accept/deny toast; clears
  // granted/denied/kick handlers (HubScene overrides those itself after
  // calling its own setupRoomRequestHandlers).
  // ══════════════════════════════════════════════════════════════════════════
  protected setupRoomRequestHandlers(): void {
    setRoomRequestHandler(this.roomRequestHandler);
    setRoomGrantedHandler(null);
    setRoomDeniedHandler(null);
    setRoomKickHandler(null);
  }

  protected showRoomRequestToast(rp: string, rn: string): void {
    this.roomRequestToast?.remove();
    this.snd.roomRequest();
    const esc = (s: string) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    this.roomRequestToast = document.createElement('div');
    this.roomRequestToast.style.cssText = `position:fixed;top:20px;right:20px;z-index:3000;background:linear-gradient(180deg,var(--nd-bg) 0%, var(--nd-navy) 100%);border:1px solid color-mix(in srgb,var(--nd-dpurp) 44%, transparent);border-radius:10px;padding:16px 20px;font-family:'Courier New',monospace;box-shadow:0 4px 20px rgba(0,0,0,0.6);max-width:300px;`;
    this.roomRequestToast.innerHTML = `<div style="color:var(--nd-accent);font-size:14px;font-weight:bold;margin-bottom:10px;">Room Request</div><div style="color:var(--nd-text);font-size:13px;margin-bottom:14px;"><strong>${esc(rn)}</strong> wants to enter</div><div style="display:flex;gap:8px;"><button id="bc-ta" style="flex:1;padding:8px;background:color-mix(in srgb,var(--nd-accent) 18%, transparent);border:1px solid color-mix(in srgb,var(--nd-accent) 44%, transparent);border-radius:6px;color:var(--nd-accent);font-size:13px;cursor:pointer;font-weight:bold;">Accept</button><button id="bc-td" style="flex:1;padding:8px;background:${P.red}22;border:1px solid ${P.red}44;border-radius:6px;color:${P.red};font-size:13px;cursor:pointer;">Deny</button></div>`;
    document.body.appendChild(this.roomRequestToast);
    const dismiss = () => { this.roomRequestToast?.remove(); this.roomRequestToast = null; };
    this.roomRequestToast.querySelector('#bc-ta')!.addEventListener('click', () => { sendRoomResponse(rp, true, JSON.stringify(getRoomConfig())); dismiss(); });
    this.roomRequestToast.querySelector('#bc-td')!.addEventListener('click', () => { sendRoomResponse(rp, false); dismiss(); });
    setTimeout(() => { if (this.roomRequestToast) { sendRoomResponse(rp, false); dismiss(); } }, 30000);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HOOKS — override in subclasses as needed
  // ══════════════════════════════════════════════════════════════════════════

  /** Return the scene's local player sprite (used by setupPresenceCallbacks for chat bubbles). */
  protected abstract getPlayerSprite(): Phaser.GameObjects.Image;

  /**
   * Return true to block all panel hotkeys (M, G, F, S, T, U, ENTER).
   * Override in scenes where a scene-specific modal can capture keyboard input
   * (e.g., RoomScene overrides to return BookcaseModal.isOpen()).
   */
  protected shouldBlockPanelKeys(): boolean { return false; }

  /**
   * Called when the T key is pressed and not blocked.
   * Opens the ComputerUI in profile-only mode with name/status callbacks.
   * Override in scenes that need different terminal behaviour (e.g., RoomScene).
   */
  protected onTKey(): void {
    if (this.computerUI.isOpen()) { this.computerUI.close(); return; }
    this.computerUI.open(
      undefined,
      (newName) => {
        this.registry.set('playerName', newName);
        this.playerName.setText(newName.slice(0, 14));
        sendNameUpdate(newName);
      },
      undefined,
      undefined,
      (s) => {
        this.playerStatusText.setText(s.slice(0, 30));
        this.playerStatusText.setAlpha(s ? 1 : 0);
      },
      undefined,
      ['profile'],
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMMON ESC HANDLER
  // Call from the scene's keydown-ESC handler AFTER checking hotkeyModal and
  // any scene-specific overlays/modals, BEFORE calling leaveScene().
  // Returns true if a panel was closed — the caller should return early.
  //
  // Panel priority order:
  //   crewPanel → dmPanel → followsPanel → settingsPanel →
  //   playerPicker → muteList → profile-modal (DOM) → zap-modal (DOM)
  // ══════════════════════════════════════════════════════════════════════════
  protected handleCommonEsc(): boolean {
    if (this.crewPanel?.isVisible())    { this.crewPanel.pressEsc();    return true; }
    if (this.dmPanel?.isVisible())      { this.dmPanel.close();         return true; }
    if (this.followsPanel?.isVisible()) { this.followsPanel.close();    return true; }
    if (this.settingsPanel.isOpen())    { this.settingsPanel.toggle();  return true; }
    if (this.playerPicker.isOpen())     { this.playerPicker.close();    return true; }
    if (this.muteList.isOpen())         { this.muteList.close();        return true; }
    if (this.pollBoard.isVisible())     { this.pollBoard.close();       return true; }
    if (document.getElementById('profile-modal')) return true;
    if (document.getElementById('zap-modal'))     return true;
    return false;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RPS INCOMING CHAT HANDLER
  // Call from each scene's onChat callback BEFORE processing regular chat.
  // Returns true if the message was an RPS protocol message and was consumed
  // (the caller should return without further processing).
  // ══════════════════════════════════════════════════════════════════════════
  protected handleRpsIncoming(pk: string, name: string, text: string): boolean {
    if (!text.startsWith('/game:rps:')) return false;
    const myPk   = this.registry.get('playerPubkey') as string;
    const myName = (this.registry.get('playerName') as string) || 'Player';
    const ac     = this.getSceneAccent();
    return this.rpsGame.handleChat(pk, name, text, myPk, myName, (msg) => {
      this.chatUI.addMessage('system', msg, ac);
      if (msg.includes('wins') && msg.includes(myName)) this.snd.rpsWin();
      else if (msg.includes('wins')) this.snd.rpsLose();
      else this.snd.rpsTie();
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EMOTE COMMAND
  // Toggles an emote on/off, sends the nostr chat event, and posts a system
  // message. Identical across all scenes — subclasses just call this.
  // ══════════════════════════════════════════════════════════════════════════
  protected handleEmoteCommand(name: string): void {
    if (this.emoteSet.isActive(name)) {
      this.emoteSet.stop(name);
      this.chatUI.addMessage('system', EMOTE_OFF_MSGS[name] ?? 'Done', P.dpurp);
      sendChat(`/emote ${name}_off`);
    } else {
      this.emoteSet.start(name);
      if (name === 'smoke') this.snd.lighterFlick();
      const flavor = EMOTE_FLAVORS[name] ?? `*${name}*`;
      this.chatUI.addMessage('system', flavor, P.dpurp);
      sendChat(`/emote ${name}_on`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCENE ACCENT COLOR
  // Override in scenes that use a non-teal accent so system messages match.
  // ══════════════════════════════════════════════════════════════════════════
  protected getSceneAccent(): string { return P.teal; }

  // ══════════════════════════════════════════════════════════════════════════
  // PRESENCE CALLBACK HOOKS
  // Override these in subclasses to customise per-scene behaviour while
  // keeping the core callback logic in setupPresenceCallbacks() below.
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Extra guard called in onPlayerJoin after the standard
   * "not me / not already here" checks. Return false to skip the join.
   * Default: returns true (no extra guard).
   * Alley + Cabin override to return !this.isLeavingScene.
   * Room overrides to reject muted players.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected onPlayerJoinGuard(_p: { pubkey: string }): boolean { return true; }

  /**
   * Called after addOtherPlayer + sendAvatarUpdate in onPlayerJoin.
   * Override for scene-specific side-effects (e.g. RoomScene broadcasts music).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected afterPlayerJoin(_p: { pubkey: string; [k: string]: unknown }): void {}

  /**
   * Clamp or transform the y coordinate received from the server for other
   * players. Default: identity. RoomScene clamps to [340, 470].
   */
  protected clampPlayerMoveY(y: number): number { return y; }

  /**
   * Called with the server's count update. Default: no-op.
   * Hub stores it in onlineCount; Room stores it in globalPlayerCount.
   */
  protected onPresenceCountUpdate(c: number): void { this.onlineCount = c; }

  /**
   * Handle a scene-specific /command received in onChat BEFORE the common
   * /emote and chat paths run. Return true if the message was consumed.
   * Default: returns false. Cabin handles /stoke; Hub handles /zap:; Room
   * handles /game:music:.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected handleSceneChatCommand(_pk: string, _name: string, _text: string, _isMe: boolean): boolean { return false; }

  /**
   * The vertical offset (in pixels, relative to sprite.y) used for chat
   * bubbles above the player and other-player sprites.
   * Default: -48. Alley/Cabin: -94. Room: -155.
   */
  protected getBubbleYOffset(): number { return -48; }

  /**
   * Whether to show a sprite bubble when another player activates an emote.
   * Default: false. Hub and Woods return true.
   */
  protected showEmoteAsBubble(): boolean { return false; }

  // ══════════════════════════════════════════════════════════════════════════
  // ESC HANDLER HOOKS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Called from setupEscHandler() after hotkeyModal check, before
   * handleCommonEsc(). Return true if a scene-specific modal was closed
   * (the ESC is consumed). Default: false.
   */
  protected handleSceneEsc(): boolean { return false; }

  /**
   * Called from setupEscHandler() after handleCommonEsc() returns false
   * (nothing was open to close). Override to trigger scene exit on ESC.
   * Default: no-op. Cabin calls leaveToWoods(); Room calls leaveRoom().
   */
  protected onEscFallthrough(): void {}

  // ══════════════════════════════════════════════════════════════════════════
  // PRESENCE CALLBACK SETUP
  // Call once in create() after setupRegistryPanels() and chatInput setup.
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Build the PresenceCallback object. HubScene overrides setupPresenceCallbacks
   * to decide whether to call connectPresence or setPresenceCallbacks; all other
   * scenes call this via the default setupPresenceCallbacks() below.
   */
  protected buildPresenceCallbacks(myPubkey: string): PresenceCallback {
    return {
      onPlayerJoin: (p) => {
        if (p.pubkey === myPubkey || this.otherPlayers.has(p.pubkey)) return;
        if (!this.onPlayerJoinGuard(p)) return;
        this.addOtherPlayer(p.pubkey, p.name, p.x, this.clampPlayerMoveY(p.y), p.avatar, p.status);
        sendAvatarUpdate();
        this.afterPlayerJoin(p as { pubkey: string; [k: string]: unknown });
      },
      onPlayerMove: (pk, x, y, f) => {
        const o = this.otherPlayers.get(pk);
        if (o) { o.targetX = x; o.targetY = this.clampPlayerMoveY(y); if (f !== undefined) o.facingRight = f === 1; }
      },
      onPlayerLeave: (pk) => this.removeOtherPlayer(pk),
      onCountUpdate: (c) => this.onPresenceCountUpdate(c),
      onChat: (pk, name, text, emojis) => {
        const isMe = pk === myPubkey;
        if (this.handleSceneChatCommand(pk, name, text, isMe)) return;
        if (text.startsWith('/emote ')) {
          if (!isMe) {
            const payload = text.slice(7);
            const sep = payload.lastIndexOf('_');
            const emoteName = payload.slice(0, sep);
            const action    = payload.slice(sep + 1);
            const o = this.otherPlayers.get(pk);
            if (o && (action === 'on' || action === 'off')) {
              if (!o.emotes) o.emotes = new EmoteSet();
              if (action === 'on') {
                o.emotes.start(emoteName);
                const flavor = EMOTE_FLAVORS[emoteName];
                if (flavor) {
                  if (this.showEmoteAsBubble()) ChatUI.showBubble(this, o.sprite.x, o.sprite.y + this.getBubbleYOffset(), flavor, P.dpurp);
                  if (!mutedPlayers.has(pk)) this.chatUI.addMessage(name, flavor, P.dpurp, pk);
                }
              } else { o.emotes.stop(emoteName); }
            }
          }
          return;
        }
        if (this.handleRpsIncoming(pk, name, text)) return;
        if (!isMe && mutedPlayers.has(pk)) {
          this.chatUI.addMessage(name, text, '#3d3d55', pk, emojis);
          return;
        }
        if (!isMe && shouldFilter(text)) return;
        const accent = this.getSceneAccent();
        this.chatUI.addMessage(name, text, isMe ? accent : P.lpurp, pk, emojis);
        if (!isMe && !this.chatUI.isFocused()) this.snd.chatPing();
        const by = this.getBubbleYOffset();
        if (isMe) {
          const sp = this.getPlayerSprite();
          ChatUI.showBubble(this, sp.x, sp.y + by, text, accent, 4000, emojis);
        } else {
          const o = this.otherPlayers.get(pk);
          if (o) ChatUI.showBubble(this, o.sprite.x, o.sprite.y + by, text, P.lpurp, 4000, emojis);
        }
      },
      onAvatarUpdate: (pk, avatarStr) => {
        const o = this.otherPlayers.get(pk); if (!o) return;
        o.avatar = avatarStr;
        const cfg = this.getOtherPlayerConfig();
        const avatarConfig = deserializeAvatar(avatarStr) || getDefaultAvatar();
        const texKey = `${cfg.texKeyPrefix}${pk}`;
        if (this.textures.exists(texKey)) this.textures.remove(texKey);
        this.textures.addCanvas(texKey, this.renderOtherAvatar(avatarConfig));
        o.sprite.setTexture(texKey).setTint(0xffffff);
      },
      onNameUpdate: (pk, name) => {
        const o = this.otherPlayers.get(pk); if (!o) return;
        o.name = name;
        o.nameText.setText(name.slice(0, 14));
      },
      onStatusUpdate: (pk, status) => {
        const o = this.otherPlayers.get(pk); if (!o) return;
        o.status = status;
        o.statusText.setText(status.slice(0, 30));
        o.statusText.setAlpha(status ? 1 : 0);
      },
      onOnlinePlayers: (players) => {
        if (!this.pendingOnlineSample) return;
        this.pendingOnlineSample = false;
        const shuffled = [...players].sort(() => Math.random() - 0.5).slice(0, 5);
        const formatRoom = (r: string) => r.startsWith('myroom:') ? 'myroom' : r;
        const sample = shuffled.map(p => `${p.name} (${formatRoom(p.room)})`).join(', ');
        this.chatUI.addMessage('system', `${this.onlineCount} online — ${sample}${players.length > 5 ? ', ...' : ''}`, P.teal);
      },
    };
  }

  /**
   * Register presence callbacks via setPresenceCallbacks. HubScene overrides
   * this to use connectPresence on first load vs setPresenceCallbacks on return.
   */
  protected setupPresenceCallbacks(myPubkey: string): void {
    setPresenceCallbacks(this.buildPresenceCallbacks(myPubkey));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ESC HANDLER SETUP
  // Call once in create() after setupCommonKeyboardHandlers().
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Register the keydown-ESC handler using the template-method chain:
   *   chatInput focused → hotkeyModal → handleSceneEsc() → handleCommonEsc() → onEscFallthrough()
   */
  protected setupEscHandler(): void {
    this.input.keyboard?.on('keydown-ESC', () => {
      if (document.activeElement === this.chatInput) return;
      if (this.hotkeyModal.isOpen()) { this.hotkeyModal.close(); return; }
      if (this.handleSceneEsc()) return;
      if (this.handleCommonEsc()) return;
      this.onEscFallthrough();
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMMON COMMAND HANDLER
  // Call from every scene's handleCommand default case.
  // Returns true if the command was handled, false if unknown.
  // Scene-specific commands (leave, tp, dm, zap, players, visit) stay in each
  // scene's own switch before this is called.
  // ══════════════════════════════════════════════════════════════════════════
  protected handleCommonCommand(cmd: string, arg: string): boolean {
    const ac = this.getSceneAccent();
    switch (cmd) {
      // ── Online count ──────────────────────────────────────────────────────
      case 'players': case 'who': case 'online': {
        if (this.onlineCount >= 100) {
          this.pendingOnlineSample = true;
          requestOnlinePlayers();
        } else {
          const ps: string[] = [];
          this.otherPlayers.forEach(o => ps.push(o.name));
          const herePart = ps.length ? ` | here: ${ps.join(', ')}` : '';
          this.chatUI.addMessage('system', `${this.onlineCount} online${herePart}`, P.teal);
        }
        return true;
      }

      // ── Emotes ────────────────────────────────────────────────────────────
      case 'smoke':
      case 'coffee': case 'music': case 'zzz': case 'think': case 'hearts':
      case 'angry': case 'sweat': case 'sparkle': case 'confetti': case 'fire':
      case 'ghost': case 'rain':
        this.handleEmoteCommand(cmd); return true;

      // ── Social panels ─────────────────────────────────────────────────────
      case 'follows': case 'following': case 'friends':
        this.followsPanel.toggle(); return true;
      case 'crew': case 'crews':
        this.dmPanel.close(); this.crewPanel.toggle(); return true;
      case 'dm': case 'dms': case 'messages': case 'msg': {
        if (!canUseDMs()) { this.chatUI.addMessage('system', 'DMs require a Nostr key', P.amber); return true; }
        if (!arg) { this.crewPanel.close(); this.dmPanel.toggle(); return true; }
        // /dm <name> — find matching player in scene and open conversation
        let target: string | null = null;
        this.otherPlayers.forEach((o, pk) => {
          const name = (o.name ?? o.nameText?.text ?? '').toLowerCase();
          if (name.includes(arg.toLowerCase())) target = pk;
        });
        if (target) { this.dmPanel.open(target); this.chatUI.addMessage('system', 'Opening DM…', ac); }
        else this.chatUI.addMessage('system', `"${arg}" not found`, P.amber);
        return true;
      }

      // ── Moderation ────────────────────────────────────────────────────────
      case 'mute': {
        const s = toggleMute();
        this.chatUI.addMessage('system', s ? 'Muted' : 'Unmuted', s ? P.amber : ac);
        return true;
      }
      case 'mutelist': case 'mutes': case 'blocked':
        this.muteList.toggle(); return true;
      case 'filter': {
        if (!arg) { const w = getCustomBannedWords(); this.chatUI.addMessage('system', w.length ? `Filtered: ${w.join(', ')}` : 'No filters', ac); return true; }
        addBannedWord(arg); this.chatUI.addMessage('system', `Added "${arg}"`, ac); return true;
      }
      case 'unfilter':
        if (arg) removeBannedWord(arg);
        return true;

      // ── Terminal / profile ────────────────────────────────────────────────
      case 'terminal': case 'avatar': case 'outfit': case 'computer':
        this.onTKey(); return true;

      // ── Mini-games ────────────────────────────────────────────────────────
      case 'flip': case 'coin': {
        this.snd.coinFlip();
        const result = Math.random() < 0.5 ? '👑 HEADS' : '🦅 TAILS';
        sendChat(`🪙 flipped a coin: ${result}`);
        return true;
      }
      case '8ball': {
        if (!arg) { this.chatUI.addMessage('system', 'Usage: /8ball <question>', ac); return true; }
        const responses = [
          'It is certain.', 'Without a doubt.', 'Yes, definitely.', 'You may rely on it.',
          'As I see it, yes.', 'Most likely.', 'Outlook good.', 'Signs point to yes.',
          'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.',
          'Cannot predict now.', 'Concentrate and ask again.',
          "Don't count on it.", 'My reply is no.', 'My sources say no.',
          'Outlook not so good.', 'Very doubtful.', 'Absolutely not.', 'The stars say no.',
        ];
        sendChat(`🎱 ${arg} — ${responses[Math.floor(Math.random() * responses.length)]}`);
        return true;
      }
      case 'slots': {
        const reels = ['🍒','🍋','🍊','🍇','💎','🍀','⭐','🎰'];
        const r = () => reels[Math.floor(Math.random() * reels.length)];
        const [a, b, c] = [r(), r(), r()];
        const jackpot = a === b && b === c;
        const two = !jackpot && (a === b || b === c || a === c);
        const result = jackpot ? '🎉 JACKPOT!' : two ? '✨ Two of a kind!' : '💸 No match.';
        this.snd.slotSpin();
        if (jackpot) setTimeout(() => this.snd.slotJackpot(), 680);
        else if (two) setTimeout(() => this.snd.slotTwoMatch(), 680);
        sendChat(`🎰 [ ${a} | ${b} | ${c} ] — ${result}`);
        return true;
      }
      case 'ship': {
        const spaceIdx = arg.indexOf(' ');
        const n1 = spaceIdx > -1 ? arg.slice(0, spaceIdx).trim() : arg.trim();
        const n2 = spaceIdx > -1 ? arg.slice(spaceIdx + 1).trim() : '';
        if (!n1 || !n2) { this.chatUI.addMessage('system', 'Usage: /ship <name1> <name2>', ac); return true; }
        const seed = [n1.toLowerCase(), n2.toLowerCase()].sort().join('|');
        let hash = 0; for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) & 0xfffffff;
        const pct = hash % 101;
        const label = pct >= 90 ? '💕 Soulmates!' : pct >= 70 ? '💖 Great match!' : pct >= 50 ? '💛 Good vibes.' : pct >= 30 ? '🤝 Could work.' : '😬 Rough road ahead.';
        const d1 = n1.startsWith('npub1') ? n1.slice(0, 13) + '…' : n1;
        const d2 = n2.startsWith('npub1') ? n2.slice(0, 13) + '…' : n2;
        sendChat(`💘 ${d1} + ${d2}: ${pct}% compatible — ${label}`);
        return true;
      }
      case 'rps': {
        const choices = ['rock', 'paper', 'scissors'] as const;
        const choice = arg.toLowerCase() as typeof choices[number];
        if (!choices.includes(choice)) { this.chatUI.addMessage('system', 'Usage: /rps <rock|paper|scissors>', ac); return true; }
        const myName = this.registry.get('playerName') || 'Player';
        this.rpsGame.challenge(choice, myName);
        this.chatUI.addMessage('system', '🎮 RPS challenge sent! Waiting for someone to accept...', ac);
        return true;
      }

      // ── Polls ─────────────────────────────────────────────────────────────
      case 'polls':
        this.pollBoard.toggle(); return true;

      // ── Status ────────────────────────────────────────────────────────────
      case 'status': {
        const myStatus = getStatus() || '(none)';
        this.chatUI.addMessage('system', `Your status: ${myStatus}`, ac);
        return true;
      }

      // ── Help ──────────────────────────────────────────────────────────────
      case 'help': case '?':
        this.hotkeyModal.toggle(); return true;

      default: return false;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMMON SHUTDOWN CLEANUP
  // Call as the first thing inside the scene's shutdown event handler.
  // Destroys / closes all panels that BaseScene manages.
  // Add any scene-specific cleanup AFTER this call.
  // ══════════════════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Apply a proportional camera zoom on touch devices.
   * Call once in create() after camera bounds + startFollow are set.
   * Zoom is inversely proportional to device width so smaller phones get
   * a larger zoom — e.g. 1.80 on 667 px (iPhone SE), 1.42 on 844 px (iPhone 12).
   */
  protected setupMobileCamera(maxZoom = 2.5): void {
    if (!this.sys.game.device.input.touch) return;
    const zoom = Math.min(maxZoom, Math.max(1.2, 1400 / window.innerWidth));
    this.cameras.main.setZoom(zoom);
  }

  /**
   * Create a fixed HTML overlay with ◀ ▲ ▶ buttons for mobile.
   * ◀ / ▶ set this.mobileLeft / this.mobileRight continuously while held.
   * ▲ fires a synthetic 'E' keydown so every scene's interact handler fires.
   * Destroyed automatically by shutdownCommonPanels().
   */
  protected createMobileControls(): void {
    if (!this.sys.game.device.input.touch) return;
    // Remove any stale controls left by a previous scene visit
    document.getElementById('nd-mobile-controls')?.remove();
    this.mobileLeft  = false;
    this.mobileRight = false;

    const btnSize = Math.round(Math.min(64, window.innerWidth * 0.13));
    const gap     = Math.max(6, Math.round(btnSize * 0.18));

    const wrap = document.createElement('div');
    wrap.id = 'nd-mobile-controls';
    wrap.style.cssText = `position:fixed;bottom:${68 + gap}px;left:50%;transform:translateX(-50%);display:flex;gap:${gap}px;z-index:900;pointer-events:none;user-select:none;-webkit-user-select:none;`;

    const makeBtn = (label: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `width:${btnSize}px;height:${btnSize}px;background:rgba(10,0,20,0.65);border:1.5px solid rgba(155,127,232,0.35);border-radius:${Math.round(btnSize * 0.22)}px;color:rgba(200,168,255,0.85);font-size:${Math.round(btnSize * 0.44)}px;display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent;line-height:1;padding:0;font-family:monospace;`;
      return b;
    };

    const leftBtn  = makeBtn('◀');
    const upBtn    = makeBtn('▲');
    const rightBtn = makeBtn('▶');

    const active = (b: HTMLButtonElement) => { b.style.background = 'rgba(93,202,165,0.25)'; b.style.borderColor = 'rgba(93,202,165,0.7)'; b.style.color = 'rgba(93,202,165,1)'; };
    const idle   = (b: HTMLButtonElement) => { b.style.background = 'rgba(10,0,20,0.65)'; b.style.borderColor = 'rgba(155,127,232,0.35)'; b.style.color = 'rgba(200,168,255,0.85)'; };

    // ◀ Left — also unlock audio on first tap in case login gesture was missed
    leftBtn.addEventListener('pointerdown',   (e) => { e.preventDefault(); this.snd.unlock(); this.mobileLeft = true;  active(leftBtn);  });
    leftBtn.addEventListener('pointerup',     ()  => { this.mobileLeft = false;  idle(leftBtn);  });
    leftBtn.addEventListener('pointercancel', ()  => { this.mobileLeft = false;  idle(leftBtn);  });
    leftBtn.addEventListener('pointerleave',  ()  => { this.mobileLeft = false;  idle(leftBtn);  });

    // ▶ Right
    rightBtn.addEventListener('pointerdown',   (e) => { e.preventDefault(); this.snd.unlock(); this.mobileRight = true;  active(rightBtn); });
    rightBtn.addEventListener('pointerup',     ()  => { this.mobileRight = false; idle(rightBtn); });
    rightBtn.addEventListener('pointercancel', ()  => { this.mobileRight = false; idle(rightBtn); });
    rightBtn.addEventListener('pointerleave',  ()  => { this.mobileRight = false; idle(rightBtn); });

    // ▲ Interact — fires 'E' key so every scene's keydown-E handler responds
    upBtn.addEventListener('pointerdown',   (e) => { e.preventDefault(); this.snd.unlock(); active(upBtn); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', keyCode: 69, bubbles: true, cancelable: true })); });
    upBtn.addEventListener('pointerup',     () => idle(upBtn));
    upBtn.addEventListener('pointercancel', () => idle(upBtn));

    wrap.appendChild(leftBtn);
    wrap.appendChild(upBtn);
    wrap.appendChild(rightBtn);
    document.body.appendChild(wrap);
    this.mobileControlsEl = wrap;
  }

  protected shutdownCommonPanels(): void {
    this.unsubProfile?.();
    this.unsubProfile = undefined;
    // Cancel any in-flight fade-out tweens and destroy their objects
    this.dyingSprites.forEach(o => {
      this.tweens.killTweensOf([o.sprite, o.nameText, o.statusText]);
      o.sprite.destroy(); o.nameText.destroy(); o.statusText.destroy(); if (o.clickZone) o.clickZone.destroy();
    });
    this.dyingSprites.clear();
    // Destroy all remaining live other-player objects
    this.otherPlayers.forEach(o => {
      o.sprite.destroy(); o.nameText.destroy(); o.statusText.destroy(); if (o.clickZone) o.clickZone.destroy();
    });
    this.otherPlayers.clear();
    this.chatUI?.destroy();
    this.settingsPanel?.destroy();
    this.computerUI?.close();
    this.muteList?.destroy();
    this.playerPicker?.close();
    this.hotkeyModal?.close();
    if (this.dmPanel)      this.dmPanel.close();
    if (this.crewPanel)    this.crewPanel.close();
    if (this.followsPanel) this.followsPanel.close();
    destroyPlayerMenu();
    ProfileModal.destroy();
    this.rpsGame?.destroy();
    this.pollBoard?.destroy();
    this.roomRequestToast?.remove();
    this.roomRequestToast = null;
    clearRoomRequestHandler(this.roomRequestHandler);
    this.mobileControlsEl?.remove();
    this.mobileControlsEl = null;
  }
}

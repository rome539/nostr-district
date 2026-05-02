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
import { worldMap } from '../ui/WorldMap';
import { ZapModal } from '../ui/ZapModal';
import { destroyPlayerMenu, showPlayerMenu, mutedPlayers } from '../ui/PlayerMenu';
import {
  sendChat, sendNameUpdate, sendRoomChange, sendRoomResponse, sendRoomRequest,
  setPresenceCallbacks, sendAvatarUpdate,
  setRoomRequestHandler, setRoomGrantedHandler, setRoomDeniedHandler, setRoomKickHandler, clearRoomRequestHandler,
  requestOnlinePlayers,
  PresenceCallback,
} from '../nostr/presenceService';
import { toggleMute, addBannedWord, removeBannedWord, getCustomBannedWords, shouldFilter } from '../nostr/moderationService';
import { canUseDMs } from '../nostr/dmService';
import { authStore } from '../stores/authStore';
import { AvatarConfig, deserializeAvatar, getDefaultAvatar, getAvatar } from '../stores/avatarStore';
import { getRainbowColor, isAnimatedColor, getAnimatedColor } from '../stores/marketStore';
import { incrementAuraProgress } from '../stores/auraUnlockStore';
import { MarketPanel } from '../ui/MarketPanel';
import { TutorialOverlay } from '../ui/TutorialOverlay';
import { getRoomConfig } from '../stores/roomStore';
import { getStatus } from '../stores/statusStore';
import { GROUND_Y, P } from '../config/game.config';

// ── Aura particle system (Phaser ParticleEmitter) ────────────────────────────

// s = spriteHeight / 96  (room at scale 3 is the reference; hub/woods=0.33, alley/cabin=0.67)
const EYE_VFX_TYPES   = new Set(['cry']); // particle emitter eyes
const EYE_COLOR_TYPES = new Set(['blaze', 'frost', 'cosmic']); // color-cycling eyes (no particles)

const EYE_CYCLE_HEX: Record<string, string[]> = {
  blaze:  ['#ff6600', '#ff3300', '#ffaa00', '#ffdd00', '#ff4400'],
  frost:  ['#aaddff', '#ffffff', '#88ccff', '#cceeff', '#44aaff'],
  cosmic: ['#ffffff', '#aa88ff', '#ff88ff', '#88ffff', '#ffff88'],
};
const EYE_CYCLE_MS: Record<string, number> = { blaze: 100, frost: 280, cosmic: 360 };

function makeEyeVfxConfig(type: string, s: number): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
  const r = (n: number) => Math.round(n * s);
  // No emitZone — each emitter is placed at an exact eye pixel position.
  switch (type) {
    case 'blaze': return {
      speed: { min: r(10), max: r(22) }, angle: { min: 255, max: 285 },
      lifespan: { min: 200, max: 450 }, scale: { start: 0.8, end: 0 },
      alpha: { start: 1, end: 0 }, tint: [0xff6600, 0xff3300, 0xffaa00, 0xffdd00],
      frequency: 90, quantity: 1, gravityY: r(-8), blendMode: 'ADD',
    };
    case 'frost': return {
      speed: { min: r(5), max: r(14) }, angle: { min: 0, max: 360 },
      lifespan: { min: 600, max: 1400 }, scale: { start: 1.0, end: 0 },
      alpha: { start: 0.85, end: 0 }, tint: [0xaaddff, 0xffffff, 0x88ccff, 0xcceeff],
      frequency: 200, quantity: 1, gravityY: r(3), blendMode: 'ADD',
    };
    case 'cosmic': return {
      speed: { min: r(3), max: r(10) }, angle: { min: 0, max: 360 },
      lifespan: { min: 900, max: 1800 }, scale: { start: 1.2, end: 0 },
      alpha: { start: 0.9, end: 0 }, tint: [0xffffff, 0xaaaaff, 0xffaaff, 0xaaffff, 0xffffaa],
      frequency: 220, quantity: 1, gravityY: r(-2), blendMode: 'ADD',
    };
    case 'cry': return {
      speed: { min: r(1), max: r(4) }, angle: { min: 88, max: 92 },
      lifespan: { min: 600, max: 1100 }, scale: { start: 1.0, end: 0 },
      alpha: { start: 0.9, end: 0 }, tint: [0x4488ff, 0x88aaff, 0x2266dd, 0x66aaff],
      frequency: 650, quantity: 1, gravityY: r(10), blendMode: 'ADD',
    };
    default: return { frequency: 99999, quantity: 0 };
  }
}

function makeAuraConfig(type: string, s: number): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
  const r = (n: number) => Math.round(n * s);
  switch (type) {
    case 'sparkle': return {
      speed:    { min: r(5), max: r(16) },
      angle:    { min: 0, max: 360 },
      lifespan: { min: 900, max: 1600 },
      scale:    { start: 0.8, end: 0 },
      alpha:    { start: 0.9, end: 0 },
      tint:     [0xffffff, 0xf0d060, 0x9a6eff, 0x40e8ff],
      frequency: 140,
      quantity:  1,
      gravityY:  r(-8),
      emitZone: { type: 'random', source: new Phaser.Geom.Circle(0, 0, r(16)) } as any,
      blendMode: 'ADD',
    };
    case 'fire': return {
      speed:    { min: r(28), max: r(58) },
      angle:    { min: 250, max: 290 },
      lifespan: { min: 300, max: 700 },
      scale:    { start: 1.1, end: 0 },
      alpha:    { start: 1, end: 0 },
      tint:     [0xe05028, 0xf08020, 0xf0e020],
      frequency: 140,
      quantity:  1,
      gravityY:  r(-12),
      emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(r(-8), r(-4), r(16), r(8)) } as any,
      blendMode: 'ADD',
    };
    case 'ice': return {
      speed:    { min: r(3), max: r(12) },
      angle:    { min: 0, max: 360 },
      lifespan: { min: 1200, max: 2400 },
      scale:    { start: 0.6, end: 0 },
      alpha:    { start: 0.8, end: 0 },
      tint:     [0xa8d8ff, 0xffffff, 0x40e8ff],
      frequency: 160,
      quantity:  1,
      gravityY:  r(6),
      emitZone: { type: 'edge', source: new Phaser.Geom.Circle(0, 0, r(16)), quantity: 8 } as any,
      blendMode: 'ADD',
    };
    case 'electric': return {
      speed:    { min: r(40), max: r(80) },
      angle:    { min: 0, max: 360 },
      lifespan: { min: 80, max: 240 },
      scale:    { start: 0.7, end: 0 },
      alpha:    { start: 1, end: 0 },
      tint:     [0xffffff, 0x88aaff, 0x4488ff, 0xccddff],
      frequency: 55,
      quantity:  1,
      gravityY:  0,
      emitZone: { type: 'random', source: new Phaser.Geom.Circle(0, 0, r(14)) } as any,
      blendMode: 'ADD',
    };
    case 'void': return {
      speed:    { min: r(3), max: r(10) },
      angle:    { min: 0, max: 360 },
      lifespan: { min: 1800, max: 3200 },
      scale:    { start: 1.2, end: 3 },
      alpha:    { start: 0.55, end: 0 },
      tint:     [0x5a0898, 0x3a0660, 0x7a10c0, 0x200040],
      frequency: 150,
      quantity:  1,
      gravityY:  r(-2),
      emitZone: { type: 'random', source: new Phaser.Geom.Circle(0, 0, r(18)) } as any,
      blendMode: 'ADD',
    };
    case 'gold': return {
      speed:    { min: r(6), max: r(18) },
      angle:    { min: 0, max: 360 },
      lifespan: { min: 800, max: 1800 },
      scale:    { start: 1.0, end: 0 },
      alpha:    { start: 1, end: 0 },
      tint:     [0xffd700, 0xffaa00, 0xffe566, 0xffc200],
      frequency: 110,
      quantity:  1,
      gravityY:  r(-6),
      emitZone: { type: 'random', source: new Phaser.Geom.Circle(0, 0, r(18)) } as any,
      blendMode: 'ADD',
    };
    case 'rainbow': return {
      speed:    { min: r(8), max: r(20) },
      angle:    { min: 0, max: 360 },
      lifespan: { min: 700, max: 1400 },
      scale:    { start: 0.8, end: 0 },
      alpha:    { start: 0.95, end: 0 },
      tint:     [0xff4444, 0xff8844, 0xffff44, 0x44ff44, 0x44ffff, 0x4488ff, 0xaa44ff],
      frequency: 90,
      quantity:  1,
      gravityY:  r(-6),
      emitZone: { type: 'random', source: new Phaser.Geom.Circle(0, 0, r(20)) } as any,
      blendMode: 'ADD',
    };
    default: return { // smoke
      speed:    { min: r(8), max: r(20) },
      angle:    { min: 255, max: 285 },
      lifespan: { min: 1000, max: 2200 },
      scale:    { start: 1.0, end: 3.5 },
      alpha:    { start: 0.58, end: 0 },
      tint:     [0x3a2850, 0x4a3860, 0x5a4870],
      frequency: 140,
      quantity:  1,
      gravityY:  r(-5),
      emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(r(-6), r(-4), r(12), r(8)) } as any,
      blendMode: 'NORMAL',
    };
  }
}

// ── Other-player types ────────────────────────────────────────────────────────

interface WaveCharSet { chars: Phaser.GameObjects.Text[]; charW: number; text: string; bg: Phaser.GameObjects.Text; }

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
  protected worldMap      = worldMap;

  // ── Other players (shared by all scenes) ─────────────────────────────────
  protected otherPlayers = new Map<string, OtherPlayer>();
  protected dyingSprites = new Map<string, OtherPlayer>();
  protected onlineCount = 0;
  private pendingOnlineSample = false;

  // ── Emote graphics (assigned in each scene's create) ─────────────────────
  protected emoteGraphics!: Phaser.GameObjects.Graphics;

  // ── Aura particle state (Phaser ParticleEmitter per player) ─────────────
  private _localAuraEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private _localAuraType    = '';
  private _auraLastX        = NaN;
  private _auraStillTime    = 0;
  private _otherAuraMap     = new Map<string, { emitter: Phaser.GameObjects.Particles.ParticleEmitter; type: string }>();
  private _otherStillMap    = new Map<string, { lastTargetX: number; stillSince: number }>();
  private _localEyeL: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private _localEyeR: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private _localEyeType = '';
  private _localEyeColorStep = -1;
  private _otherEyeMap  = new Map<string, { left: Phaser.GameObjects.Particles.ParticleEmitter; right: Phaser.GameObjects.Particles.ParticleEmitter; type: string }>();
  private _otherEyeColorStepMap = new Map<string, number>();
  private _waveCharsMap = new Map<string, WaveCharSet>();
  private _playerWaveSet: WaveCharSet | null = null;
  protected _localPlayerTexKey = 'player';
  private static readonly EYE_ADJUST: Record<string, { dx: number; dy: number; dleft?: number }> = {
    blaze: { dx: 0, dy: 1, dleft: 2 },
    frost: { dx: 1,   dy: 1 },
    cry:   { dx: 0,   dy: 3 },
  };

  // ── Emotes / Audio ────────────────────────────────────────────────────────
  protected emoteSet = new EmoteSet();
  protected snd      = SoundEngine.get();

  // ── Shared movement / walk fields ─────────────────────────────────────────
  protected targetX: number | null = null;
  protected isMoving       = false;
  protected isKeyboardMoving = false;
  protected facingRight    = true;
  protected playerY        = GROUND_Y + 8;
  protected playerSprite:  Phaser.GameObjects.Image | null = null;
  protected walkTime       = 0;
  protected walkFrame      = 0;
  protected footTimer      = 0;

  // ── Mobile controls ────────────────────────────────────────────────────────
  protected mobileLeft  = false;
  protected mobileRight = false;
  private   mobileControlsEl: HTMLElement | null = null;

  // ── Scene state ────────────────────────────────────────────────────────────
  protected isLeavingScene = false;
  private _visitTimer: ReturnType<typeof setTimeout> | null = null;
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
    const ae = this._otherAuraMap.get(pk);
    if (ae) { ae.emitter.destroy(); this._otherAuraMap.delete(pk); }
    this._otherStillMap.delete(pk);
    const ee = this._otherEyeMap.get(pk);
    if (ee) { ee.left.destroy(); ee.right.destroy(); this._otherEyeMap.delete(pk); }
    const ws = this._waveCharsMap.get(pk);
    if (ws) { this._clearWaveSet(ws); this._waveCharsMap.delete(pk); }
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
      const dws = this._waveCharsMap.get(pk);
      if (dws) { this._clearWaveSet(dws); this._waveCharsMap.delete(pk); }
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
    const spawnNameColor = isMuted ? '#3d3d55'
      : (avatarConfig.nameColor && !isAnimatedColor(avatarConfig.nameColor) ? avatarConfig.nameColor : cfg.nameColor);
    const nt = this.add.text(px, py + cfg.nameYOffset, name.slice(0, 14), {
      fontFamily: '"Courier New", monospace', fontSize: cfg.nameFontSize,
      color: spawnNameColor, align: 'center', backgroundColor: cfg.nameBg,
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
  private _ensureAuraDotTexture(): void {
    if (this.textures.exists('aura_dot')) return;
    const g = this.make.graphics(undefined, false);
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 2, 2);
    g.generateTexture('aura_dot', 2, 2);
    g.destroy();
  }

  private _buildWaveSet(text: string, ref: Phaser.GameObjects.Text, color: string): WaveCharSet {
    const fontSize = ref.style.fontSize as string;
    const tmp = this.add.text(0, -9999, 'W', { fontFamily: '"Courier New", monospace', fontSize }).setVisible(false);
    const charW = tmp.width;
    tmp.destroy();

    // Background: same style as nameText but filled with spaces — renders the
    // exact same box (color, padding, corners) without showing any text.
    const pad = (ref.style as any).padding ?? { x: 4, y: 2 };
    const bg = this.add.text(0, 0, text.replace(/\S/g, ' '), {
      fontFamily: '"Courier New", monospace', fontSize,
      backgroundColor: ref.style.backgroundColor as string,
      padding: pad,
    }).setOrigin(0.5, 0.5).setDepth(8);

    const chars = Array.from(text).map(ch =>
      this.add.text(0, 0, ch, { fontFamily: '"Courier New", monospace', fontSize, color })
        .setOrigin(0.5, 0.5).setDepth(9)
    );
    return { chars, charW, text, bg };
  }

  private _applyWaveSet(ws: WaveCharSet, cx: number, cy: number, time: number, color: string): void {
    const { chars, charW, bg } = ws;
    const totalW = charW * chars.length;
    bg.setPosition(cx, cy);
    chars.forEach((c, i) => {
      c.setColor(color);
      c.x = cx - totalW / 2 + i * charW + charW / 2;
      c.y = cy + Math.sin(time / 280 + i * 0.7) * 4;
    });
  }

  private _clearWaveSet(ws: WaveCharSet): void {
    ws.bg.destroy();
    ws.chars.forEach(c => c.destroy());
  }

  private _makeAuraEmitter(type: string, x: number, y: number, spriteHeight: number): Phaser.GameObjects.Particles.ParticleEmitter {
    this._ensureAuraDotTexture();
    const s = Math.max(0.2, spriteHeight / 96); // 96 = room reference (32px texture × scale 3)
    return this.add.particles(x, y, 'aura_dot', makeAuraConfig(type, s)).setDepth(13);
  }

  /** Eye pixel offsets as fractions of displayHeight.
   *  lx/rx = X offset from sprite.x; yFrac = distance above sprite.y (bottom anchor).
   *  Override in scenes that use the room canvas (48×76) instead of the hub canvas (37×56). */
  protected getEyePixelOffsets(): { lx: number; rx: number; yFrac: number } {
    // Hub canvas 37×56: cry eyes at canvas x=15.5/20.5 → offsets -3/+2 from center 18.5; y=23 top → 33px from bottom
    return { lx: -3 / 56, rx: 2 / 56, yFrac: 33 / 56 };
  }

  private _makeEyePair(type: string, lx: number, rx: number, ey: number, spriteHeight: number) {
    this._ensureAuraDotTexture();
    const s = Math.max(0.2, spriteHeight / 96);
    const cfg = makeEyeVfxConfig(type, s);
    return {
      left:  this.add.particles(lx, ey, 'aura_dot', cfg).setDepth(14),
      right: this.add.particles(rx, ey, 'aura_dot', cfg).setDepth(14),
      type,
    };
  }

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

      if (o.avatar) {
        const oa = deserializeAvatar(o.avatar);
        if (oa) {
          // Color animation
          if (oa.nameColor && isAnimatedColor(oa.nameColor)) o.nameText.setColor(getAnimatedColor(oa.nameColor, time));

          // Name tag motion
          if (oa.nameAnim) {
            if (oa.nameAnim !== 'wave') {
              const ws = this._waveCharsMap.get(pk);
              if (ws) { this._clearWaveSet(ws); this._waveCharsMap.delete(pk); o.nameText.setVisible(true); }
            }
            o.nameText.setScale(1).setAngle(0).setAlpha(1).setShadow(0, 0, 'transparent', 0);
            switch (oa.nameAnim) {
              case 'bob':   o.nameText.y += Math.sin(time / 400) * 3; break;
              case 'pulse': o.nameText.setScale(1 + Math.sin(time / 350) * 0.08); break;
              case 'jitter':
                o.nameText.x += (Math.random() - 0.5) * 1.5;
                o.nameText.y += (Math.random() - 0.5) * 0.8;
                break;
              case 'zoom': {
                const p = (time % 900) / 900;
                const b1 = p < 0.22 ? Math.sin((p / 0.22) * Math.PI) : 0;
                const b2 = p >= 0.28 && p < 0.46 ? Math.sin(((p - 0.28) / 0.18) * Math.PI) : 0;
                o.nameText.setScale(1 + b1 * 0.2 + b2 * 0.12);
                break;
              }
              case 'swing':
                o.nameText.setAngle(Math.sin(time / 550) * 10);
                break;
              case 'wave': {
                const currentColor = o.nameText.style.color as string;
                let ws = this._waveCharsMap.get(pk);
                if (!ws || ws.text !== o.nameText.text) {
                  if (ws) this._clearWaveSet(ws);
                  o.nameText.setVisible(false);
                  ws = this._buildWaveSet(o.nameText.text, o.nameText, currentColor);
                  this._waveCharsMap.set(pk, ws);
                }
                this._applyWaveSet(ws, o.nameText.x, o.nameText.y, time, currentColor);
                break;
              }
              case 'glow': {
                const glowColor = o.nameText.style.color as string;
                const flicker = Math.random() < 0.015 ? 0.25 : Math.random() < 0.04 ? 0.75 : 1;
                const blur = 10 + Math.sin(time / 600) * 4;
                o.nameText.setAlpha(flicker).setShadow(0, 0, glowColor, blur, false, true);
                break;
              }
            }
          } else {
            const ws = this._waveCharsMap.get(pk);
            if (ws) { this._clearWaveSet(ws); this._waveCharsMap.delete(pk); o.nameText.setVisible(true); }
            o.nameText.setScale(1).setAngle(0).setAlpha(1).setShadow(0, 0, 'transparent', 0);
          }

          // Stillness tracking
          let still = this._otherStillMap.get(pk);
          if (!still) { still = { lastTargetX: o.targetX, stillSince: Date.now() }; this._otherStillMap.set(pk, still); }
          if (o.targetX !== still.lastTargetX) { still.stillSince = Date.now(); still.lastTargetX = o.targetX; }
          const otherStill = Date.now() - still.stillSince >= 1500;

          // Aura — only within 300px of local player
          const nearEnough = !this.playerSprite ||
            Math.abs(o.sprite.x - this.playerSprite.x) < 300;
          if (oa.aura && otherStill && nearEnough) {
            const nx = o.sprite.x;
            const grounded = oa.aura === 'fire' || oa.aura === 'smoke';
            const ny = o.sprite.y - o.sprite.displayHeight * (grounded ? 0.08 : 0.34);
            let entry = this._otherAuraMap.get(pk);
            if (!entry || entry.type !== oa.aura) {
              entry?.emitter.destroy();
              entry = { emitter: this._makeAuraEmitter(oa.aura, nx, ny, o.sprite.displayHeight), type: oa.aura };
              this._otherAuraMap.set(pk, entry);
            } else {
              entry.emitter.setPosition(nx, ny);
            }
          } else if (!otherStill || !oa.aura || !nearEnough) {
            const entry = this._otherAuraMap.get(pk);
            if (entry) { entry.emitter.destroy(); this._otherAuraMap.delete(pk); }
          }

          // Eye VFX — cry uses particles; blaze/frost/cosmic cycle eyeColor on the avatar texture
          const otherEyeType = (EYE_VFX_TYPES.has(oa.eyes) || EYE_COLOR_TYPES.has(oa.eyes)) ? oa.eyes : '';
          if (otherEyeType && nearEnough) {
            if (EYE_COLOR_TYPES.has(otherEyeType)) {
              const pal  = EYE_CYCLE_HEX[otherEyeType];
              const step = Math.floor(time / EYE_CYCLE_MS[otherEyeType]) % pal.length;
              const prev = this._otherEyeColorStepMap.get(pk) ?? -1;
              if (step !== prev) {
                this._otherEyeColorStepMap.set(pk, step);
                const cfg2 = this.getOtherPlayerConfig();
                const texKey = `${cfg2.texKeyPrefix}${pk}`;
                if (this.textures.exists(texKey)) this.textures.remove(texKey);
                this.textures.addCanvas(texKey, this.renderOtherAvatar({ ...oa, eyeColor: pal[step] }));
                o.sprite.setTexture(texKey);
              }
            } else {
              // cry — particle emitters at eye positions
              const { lx, rx, yFrac } = this.getEyePixelOffsets();
              const { dx, dy, dleft } = BaseScene.EYE_ADJUST[otherEyeType] ?? { dx: 0, dy: 0 };
              const fdx = dx + (o.sprite.flipX ? (dleft ?? 0) : 0);
              const dH  = o.sprite.displayHeight;
              const lEx = o.sprite.x + lx * dH + fdx;
              const rEx = o.sprite.x + rx * dH + fdx;
              const eyY = o.sprite.y - yFrac * dH + dy;
              let eyeEntry = this._otherEyeMap.get(pk);
              if (!eyeEntry || eyeEntry.type !== otherEyeType) {
                eyeEntry?.left.destroy();
                eyeEntry?.right.destroy();
                const pair = this._makeEyePair(otherEyeType, lEx, rEx, eyY, dH);
                this._otherEyeMap.set(pk, pair);
              } else {
                eyeEntry.left.setPosition(lEx, eyY);
                eyeEntry.right.setPosition(rEx, eyY);
              }
            }
          } else {
            const eyeEntry = this._otherEyeMap.get(pk);
            if (eyeEntry) { eyeEntry.left.destroy(); eyeEntry.right.destroy(); this._otherEyeMap.delete(pk); }
            this._otherEyeColorStepMap.delete(pk);
          }
        }
      }

      this.updateOtherPlayerExtras(pk, o, dx, delta);
    });
  }

  /** Call once per frame in each scene's update() to animate name tag + aura. */
  protected updateLocalNameColor(time: number, delta = 16): void {
    const av = getAvatar();

    // Color animation
    if (av.nameColor) {
      if (isAnimatedColor(av.nameColor)) {
        this.playerName?.setColor(getAnimatedColor(av.nameColor, time));
      } else {
        const current = this.playerName?.style.color;
        if (current !== av.nameColor) this.playerName?.setColor(av.nameColor);
      }
    }

    // Name tag motion
    if (this.playerName && av.nameAnim) {
      if (av.nameAnim !== 'wave') {
        if (this._playerWaveSet) { this._clearWaveSet(this._playerWaveSet); this._playerWaveSet = null; this.playerName.setVisible(true); }
      }
      this.playerName.setScale(1).setAngle(0).setAlpha(1).setShadow(0, 0, 'transparent', 0);
      switch (av.nameAnim) {
        case 'bob':   this.playerName.y += Math.sin(time / 400) * 3; break;
        case 'pulse': this.playerName.setScale(1 + Math.sin(time / 350) * 0.08); break;
        case 'jitter':
          this.playerName.x += (Math.random() - 0.5) * 1.5;
          this.playerName.y += (Math.random() - 0.5) * 0.8;
          break;
        case 'zoom': {
          const p = (time % 900) / 900;
          const b1 = p < 0.22 ? Math.sin((p / 0.22) * Math.PI) : 0;
          const b2 = p >= 0.28 && p < 0.46 ? Math.sin(((p - 0.28) / 0.18) * Math.PI) : 0;
          this.playerName.setScale(1 + b1 * 0.2 + b2 * 0.12);
          break;
        }
        case 'swing':
          this.playerName.setAngle(Math.sin(time / 550) * 10);
          break;
        case 'wave': {
          const color = this.playerName.style.color as string;
          if (!this._playerWaveSet || this._playerWaveSet.text !== this.playerName.text) {
            if (this._playerWaveSet) this._clearWaveSet(this._playerWaveSet);
            this.playerName.setVisible(false);
            this._playerWaveSet = this._buildWaveSet(this.playerName.text, this.playerName, color);
          }
          this._applyWaveSet(this._playerWaveSet, this.playerName.x, this.playerName.y, time, color);
          break;
        }
        case 'glow': {
          const glowColor = this.playerName.style.color as string;
          const flicker = Math.random() < 0.015 ? 0.25 : Math.random() < 0.04 ? 0.75 : 1;
          const blur = 10 + Math.sin(time / 600) * 4;
          this.playerName.setAlpha(flicker).setShadow(0, 0, glowColor, blur, false, true);
          break;
        }
      }
    } else {
      if (this._playerWaveSet) { this._clearWaveSet(this._playerWaveSet); this._playerWaveSet = null; this.playerName?.setVisible(true); }
      this.playerName?.setScale(1).setAngle(0).setAlpha(1).setShadow(0, 0, 'transparent', 0);
    }

    // Aura — only show after standing still for 1.5s
    if (av.aura && this.playerSprite) {
      const cx = this.playerSprite.x;
      if (isNaN(this._auraLastX)) { this._auraLastX = cx; this._auraStillTime = Date.now(); }
      if (Math.abs(cx - this._auraLastX) > 0.5) { this._auraStillTime = Date.now(); this._auraLastX = cx; }
      const localStill = Date.now() - this._auraStillTime >= 1500;

      if (localStill && this.playerName) {
        const px = this.playerName.x;
        const grounded = av.aura === 'fire' || av.aura === 'smoke';
        const py = this.playerSprite.y - this.playerSprite.displayHeight * (grounded ? 0.08 : 0.34);
        if (!this._localAuraEmitter || this._localAuraType !== av.aura) {
          this._localAuraEmitter?.destroy();
          this._localAuraEmitter = this._makeAuraEmitter(av.aura, px, py, this.playerSprite.displayHeight);
          this._localAuraType = av.aura;
        } else {
          this._localAuraEmitter.setPosition(px, py);
        }
      } else if (!localStill && this._localAuraEmitter) {
        this._localAuraEmitter.destroy();
        this._localAuraEmitter = null;
        this._localAuraType = '';
      }
    } else if (this._localAuraEmitter) {
      this._localAuraEmitter.destroy();
      this._localAuraEmitter = null;
      this._localAuraType = '';
      this._auraLastX = NaN;
    }

    // Eye VFX — cry uses particles; blaze/frost/cosmic cycle eyeColor on the avatar texture
    const eyeType = (EYE_VFX_TYPES.has(av.eyes) || EYE_COLOR_TYPES.has(av.eyes)) ? av.eyes : '';
    if (EYE_COLOR_TYPES.has(eyeType) && this.playerSprite) {
      const pal  = EYE_CYCLE_HEX[eyeType];
      const step = Math.floor(time / EYE_CYCLE_MS[eyeType]) % pal.length;
      if (step !== this._localEyeColorStep) {
        this._localEyeColorStep = step;
        const canvas = this.renderOtherAvatar({ ...av, eyeColor: pal[step] });
        if (this.textures.exists(this._localPlayerTexKey)) this.textures.remove(this._localPlayerTexKey);
        this.textures.addCanvas(this._localPlayerTexKey, canvas);
        this.playerSprite.setTexture(this._localPlayerTexKey);
      }
    } else if (eyeType && this.playerSprite) {
      // cry — particle emitters at eye positions
      const { lx, rx, yFrac } = this.getEyePixelOffsets();
      const { dx, dy, dleft } = BaseScene.EYE_ADJUST[eyeType] ?? { dx: 0, dy: 0 };
      const fdx = dx + (this.playerSprite.flipX ? (dleft ?? 0) : 0);
      const dH  = this.playerSprite.displayHeight;
      const lEx = this.playerSprite.x + lx * dH + fdx;
      const rEx = this.playerSprite.x + rx * dH + fdx;
      const eyY = this.playerSprite.y - yFrac * dH + dy;
      if (!this._localEyeL || this._localEyeType !== eyeType) {
        this._localEyeL?.destroy();
        this._localEyeR?.destroy();
        const pair = this._makeEyePair(eyeType, lEx, rEx, eyY, dH);
        this._localEyeL = pair.left;
        this._localEyeR = pair.right;
        this._localEyeType = eyeType;
      } else {
        this._localEyeL.setPosition(lEx, eyY);
        this._localEyeR?.setPosition(rEx, eyY);
      }
    } else {
      if (this._localEyeL) {
        this._localEyeL.destroy();
        this._localEyeR?.destroy();
        this._localEyeL = null;
        this._localEyeR = null;
        this._localEyeType = '';
      }
      this._localEyeColorStep = -1;
    }
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
    this.worldMap.refreshActive(); // update active zone highlight for this scene
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

    // When the canvas is clicked, blur any focused DOM element (e.g. chat input).
    // ChatUI's keydown handler calls stopPropagation(), which would otherwise
    // block arrow keys from reaching Phaser's window listener while the input
    // has focus, causing click-to-walk to "lock" and ignore keyboard input.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if ((p.event.target as HTMLElement)?.tagName !== 'CANVAS') return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) active.blur();
    });

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

    // Tab — World map (document-level so it works outside Phaser focus)
    const mapHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (ci()) return;
      e.preventDefault();
      this.worldMap.toggle();
    };
    document.addEventListener('keydown', mapHandler);
    this.events.once('shutdown', () => document.removeEventListener('keydown', mapHandler));
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
    if (MarketPanel.isOpen())           { MarketPanel.destroy();        return true; }
    if (this.worldMap.isOpen())         { this.worldMap.close();        return true; }
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
    const ac = this.getSceneAccent();
    if (this.emoteSet.isActive(name)) {
      this.emoteSet.stop(name);
      this.chatUI.addMessage('system', EMOTE_OFF_MSGS[name] ?? 'Done', ac);
      sendChat(`/emote ${name}_off`);
    } else {
      this.emoteSet.start(name);
      if (name === 'smoke') { this.snd.lighterFlick(); incrementAuraProgress('smoke'); }
      const flavor = EMOTE_FLAVORS[name] ?? `*${name}*`;
      this.chatUI.addMessage('system', flavor, ac);
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
  protected getBubbleYOffset(): number { return -36; }

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
      onDisconnect: () => {
        const pks = [...this.otherPlayers.keys()];
        pks.forEach(pk => this.removeOtherPlayer(pk));
      },
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
                // Apply rod skin from their avatar whenever fishing starts
                if (emoteName === 'fishing' && o.avatar) {
                  const oa = deserializeAvatar(o.avatar);
                  if (oa?.rodSkin !== undefined) o.emotes.setFishingSkin(oa.rodSkin);
                }
                const flavor = EMOTE_FLAVORS[emoteName];
                if (flavor) {
                  if (this.showEmoteAsBubble()) ChatUI.showBubble(this, o.sprite.x, o.sprite.y + this.getBubbleYOffset(), flavor, P.lpurp);
                  if (!mutedPlayers.has(pk)) this.chatUI.addMessage(name, flavor, P.lpurp, pk);
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
        const myAvatar = getAvatar();
        const myChatColor = myAvatar.chatColor
          ? (isAnimatedColor(myAvatar.chatColor) ? getAnimatedColor(myAvatar.chatColor, Date.now()) : myAvatar.chatColor)
          : accent;
        let senderChatColor = P.lpurp;
        if (!isMe) {
          const o = this.otherPlayers.get(pk);
          if (o?.avatar) {
            const oa = deserializeAvatar(o.avatar);
            if (oa?.chatColor) senderChatColor = isAnimatedColor(oa.chatColor) ? getAnimatedColor(oa.chatColor, Date.now()) : oa.chatColor;
          }
        }
        this.chatUI.addMessage(name, text, isMe ? myChatColor : senderChatColor, pk, emojis);
        if (!isMe && !this.chatUI.isFocused()) this.snd.chatPing();
        const by = this.getBubbleYOffset();
        if (isMe) {
          const sp = this.getPlayerSprite();
          ChatUI.showBubble(this, sp.x, sp.y + by, text, myChatColor, 4000, emojis);
        } else {
          const o = this.otherPlayers.get(pk);
          if (o) ChatUI.showBubble(this, o.sprite.x, o.sprite.y + by, text, senderChatColor, 4000, emojis);
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
        if (avatarConfig.nameColor && !isAnimatedColor(avatarConfig.nameColor)) {
          o.nameText.setColor(avatarConfig.nameColor);
        }
        if (avatarConfig.rodSkin !== undefined) {
          o.emotes?.setFishingSkin(avatarConfig.rodSkin);
        }
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
  // ROOM ALIAS MAP + TELEPORT
  // ══════════════════════════════════════════════════════════════════════════
  private static readonly ROOM_ALIASES: Record<string, string> = {
    hub: 'hub', woods: 'woods', forest: 'woods', camp: 'woods',
    cabin: 'cabin', relay: 'relay', feed: 'feed', thefeed: 'feed',
    myroom: 'myroom', room: 'picker', lounge: 'lounge', rooftop: 'lounge',
    market: 'market', shop: 'market', store: 'market',
  };

  protected teleportToRoom(roomId: string): void {
    const ac = this.getSceneAccent();

    if (roomId === 'picker') {
      const pk = this.registry.get('playerPubkey');
      const n = this.registry.get('playerName') || 'My Room';
      this.playerPicker.open(
        pk, n,
        () => {
          sendRoomChange('hub');
          this.chatUI.destroy();
          this.scene.start('RoomScene', {
            id: `myroom:${pk}`, name: `${n}'s Room`, neonColor: P.teal, ownerPubkey: pk,
          });
        },
        (opk) => {
          sendRoomChange(opk);
          this.chatUI.addMessage('system', 'Requesting access...', ac);
        },
      );
      return;
    }

    if (roomId === 'myroom') {
      const pk = this.registry.get('playerPubkey');
      const n = this.registry.get('playerName') || 'My Room';
      sendRoomChange('hub');
      this.chatUI.destroy();
      this.scene.start('RoomScene', {
        id: `myroom:${pk}`, name: `${n}'s Room`, neonColor: P.teal, ownerPubkey: pk,
      });
      return;
    }

    if (roomId === 'hub') {
      if (this.isLeavingScene) return;
      this.isLeavingScene = true;
      sendRoomChange('hub');
      this.chatUI.destroy();
      this.cameras.main.fadeOut(300, 10, 0, 20);
      this.time.delayedCall(300, () => {
        if (!this.scene.isActive()) return;
        this.scene.start('HubScene', { _returning: true });
      });
      return;
    }

    if (roomId === 'woods') {
      if (this.isLeavingScene) return;
      this.isLeavingScene = true;
      sendRoomChange('woods');
      this.chatUI.destroy();
      this.cameras.main.fadeOut(300, 10, 0, 20);
      this.time.delayedCall(300, () => {
        if (!this.scene.isActive()) return;
        this.scene.start('WoodsScene');
      });
      return;
    }

    if (roomId === 'cabin') {
      if (this.isLeavingScene) return;
      this.isLeavingScene = true;
      sendRoomChange('cabin');
      this.chatUI.destroy();
      this.cameras.main.fadeOut(300, 4, 2, 0);
      this.time.delayedCall(300, () => {
        if (!this.scene.isActive()) return;
        this.scene.start('CabinScene');
      });
      return;
    }

    sendRoomChange('hub');
    this.chatUI.destroy();
    this.scene.start('RoomScene', {
      id: roomId,
      name: roomId.charAt(0).toUpperCase() + roomId.slice(1),
      neonColor: P.teal,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMMON COMMAND HANDLER
  // ══════════════════════════════════════════════════════════════════════════
  protected handleCommonCommand(cmd: string, arg: string): boolean {
    const ac = this.getSceneAccent();
    switch (cmd) {
      // ── Teleport ──────────────────────────────────────────────────────────
      case 'tp': case 'teleport': case 'go': {
        if (!arg) {
          this.chatUI.addMessage('system', 'Rooms: hub, woods, cabin, relay, feed, myroom, lounge, market', ac);
          return true;
        }
        const rid = BaseScene.ROOM_ALIASES[arg.toLowerCase().replace(/\s+/g, '')];
        if (!rid) {
          this.chatUI.addMessage('system', `Unknown room "${arg}"`, P.amber);
          return true;
        }
        this.teleportToRoom(rid);
        return true;
      }

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

      // ── World map ──────────────────────────────────────────────────────────
      case 'map': case 'world':
        this.worldMap.toggle(); return true;

      // ── Visit ────────────────────────────────────────────────────────────
      case 'visit': {
        if (!arg) { this.chatUI.addMessage('system', 'Usage: /visit <name or npub>', ac); return true; }
        const resolvePk = async (): Promise<string | null> => {
          if (arg.startsWith('npub1')) {
            try {
              const { nip19 } = await import('nostr-tools');
              const d = nip19.decode(arg);
              if (d.type === 'npub') return d.data as string;
            } catch {}
            return null;
          }
          let found: string | null = null;
          this.otherPlayers.forEach((o, pk) => { if (o.name?.toLowerCase().includes(arg.toLowerCase())) found = pk; });
          return found;
        };
        resolvePk().then(pk => {
          if (!pk) { this.chatUI.addMessage('system', `"${arg}" not found`, P.amber); return; }
          this.chatUI.addMessage('system', 'Requesting access…', ac);
          const prevGranted = setRoomGrantedHandler((op, on, room, roomConfig) => {
            if (this._visitTimer) { clearTimeout(this._visitTimer); this._visitTimer = null; }
            this.chatUI.addMessage('system', `${on} accepted!`, ac);
            this.chatUI.destroy();
            this.scene.start('RoomScene', { id: room, name: `${on}'s Room`, neonColor: P.teal, ownerPubkey: op, ownerRoomConfig: roomConfig });
          });
          const prevDenied = setRoomDeniedHandler((r) => {
            if (this._visitTimer) { clearTimeout(this._visitTimer); this._visitTimer = null; }
            this.chatUI.addMessage('system', r || 'Denied', P.amber);
            setRoomGrantedHandler(prevGranted);
            setRoomDeniedHandler(prevDenied);
          });
          sendRoomRequest(pk);
          this._visitTimer = setTimeout(() => {
            this._visitTimer = null;
            this.chatUI.addMessage('system', 'Timed out', P.amber);
            setRoomGrantedHandler(prevGranted);
            setRoomDeniedHandler(prevDenied);
          }, 30000);
        });
        return true;
      }

      // ── Zap ─────────────────────────────────────────────────────────────
      case 'zap': {
        if (!arg) { this.chatUI.addMessage('system', 'Usage: /zap <name or npub>', ac); return true; }
        const za = authStore.getState();
        if (!za.pubkey || za.isGuest) { this.chatUI.addMessage('system', 'Login to zap', P.amber); return true; }
        if (arg.startsWith('npub1')) {
          import('nostr-tools').then(({ nip19 }) => {
            try {
              const decoded = nip19.decode(arg);
              if (decoded.type !== 'npub') throw new Error();
              const pk = decoded.data as string;
              const name = this.otherPlayers.get(pk)?.name ?? arg.slice(0, 13) + '…';
              ZapModal.show(pk, name);
            } catch { this.chatUI.addMessage('system', 'Invalid npub', P.amber); }
          });
          return true;
        }
        let zapTarget: string | null = null;
        let zapName = arg;
        this.otherPlayers.forEach((o, pk) => {
          if (o.name?.toLowerCase().includes(arg.toLowerCase())) { zapTarget = pk; zapName = o.name; }
        });
        if (!zapTarget) { this.chatUI.addMessage('system', `"${arg}" not found`, P.amber); return true; }
        ZapModal.show(zapTarget, zapName);
        return true;
      }

      // ── Status ────────────────────────────────────────────────────────────
      case 'status': {
        const myStatus = getStatus() || '(none)';
        this.chatUI.addMessage('system', `Your status: ${myStatus}`, ac);
        return true;
      }

      // ── Shop ─────────────────────────────────────────────────────────────
      case 'shop': case 'store': case 'market':
        MarketPanel.isOpen() ? MarketPanel.destroy() : MarketPanel.open();
        return true;

      // ── Tutorial ─────────────────────────────────────────────────────────
      case 'tutorial':
        new TutorialOverlay(() => {}); return true;

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
    document.getElementById('nd-mobile-controls-r')?.remove();
    this.mobileLeft  = false;
    this.mobileRight = false;

    const btnSize = Math.round(Math.min(60, Math.max(44, window.innerWidth * 0.11)));
    const gap     = Math.max(8, Math.round(btnSize * 0.18));
    const margin  = Math.round(Math.max(14, window.innerWidth * 0.035));

    // Tell ChatUI how much horizontal space the button groups occupy
    document.documentElement.style.setProperty('--nd-ctrl-offset', `${btnSize + margin + 6}px`);

    const makeBtn = (label: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `width:${btnSize}px;height:${btnSize}px;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1.5px solid color-mix(in srgb,var(--nd-dpurp) 55%,transparent);border-radius:${Math.round(btnSize * 0.22)}px;color:var(--nd-text);font-size:${Math.round(btnSize * 0.44)}px;display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent;line-height:1;padding:0;font-family:monospace;`;
      return b;
    };

    const leftBtn  = makeBtn('◀');
    const upBtnL   = makeBtn('▲'); // left side — for left-handed players
    const rightBtn = makeBtn('▶');
    const upBtnR   = makeBtn('▲'); // right side — for right-handed players

    const active = (b: HTMLButtonElement) => { b.style.background = 'color-mix(in srgb,var(--nd-accent) 25%,transparent)'; b.style.borderColor = 'color-mix(in srgb,var(--nd-accent) 70%,transparent)'; b.style.color = 'var(--nd-accent)'; };
    const idle   = (b: HTMLButtonElement) => { b.style.background = 'color-mix(in srgb,black 55%,var(--nd-bg))'; b.style.borderColor = 'color-mix(in srgb,var(--nd-dpurp) 55%,transparent)'; b.style.color = 'var(--nd-text)'; };

    // ◀ Left — touchend also retries audio unlock (touchstart unreliable on iOS)
    leftBtn.addEventListener('touchend',      ()  => { this.snd.unlock(); });
    leftBtn.addEventListener('pointerdown',   (e) => { e.preventDefault(); this.mobileLeft = true;  active(leftBtn);  });
    leftBtn.addEventListener('pointerup',     ()  => { this.mobileLeft = false;  idle(leftBtn);  });
    leftBtn.addEventListener('pointercancel', ()  => { this.mobileLeft = false;  idle(leftBtn);  });
    leftBtn.addEventListener('pointerleave',  ()  => { this.mobileLeft = false;  idle(leftBtn);  });

    // ▶ Right
    rightBtn.addEventListener('touchend',      ()  => { this.snd.unlock(); });
    rightBtn.addEventListener('pointerdown',   (e) => { e.preventDefault(); this.mobileRight = true;  active(rightBtn); });
    rightBtn.addEventListener('pointerup',     ()  => { this.mobileRight = false; idle(rightBtn); });
    rightBtn.addEventListener('pointercancel', ()  => { this.mobileRight = false; idle(rightBtn); });
    rightBtn.addEventListener('pointerleave',  ()  => { this.mobileRight = false; idle(rightBtn); });

    // ▲ Interact — fires 'E' key so every scene's keydown-E handler responds
    const wireInteract = (btn: HTMLButtonElement) => {
      btn.addEventListener('touchend',      ()  => { this.snd.unlock(); });
      btn.addEventListener('pointerdown',   (e) => { e.preventDefault(); active(btn); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', keyCode: 69, bubbles: true, cancelable: true })); });
      btn.addEventListener('pointerup',     () => idle(btn));
      btn.addEventListener('pointercancel', () => idle(btn));
    };
    wireInteract(upBtnL);
    wireInteract(upBtnR);

    // Left group: ▲ (top) + ◀ (bottom) — interact accessible for left-handed players
    const leftWrap = document.createElement('div');
    leftWrap.id = 'nd-mobile-controls';
    leftWrap.style.cssText = `position:fixed;bottom:calc(env(safe-area-inset-bottom,0px) + 8px);left:calc(env(safe-area-inset-left,0px) + ${margin}px);display:flex;flex-direction:column;gap:${gap}px;z-index:900;pointer-events:none;user-select:none;-webkit-user-select:none;`;
    leftWrap.appendChild(upBtnL);
    leftWrap.appendChild(leftBtn);

    // Right group: ▶ (top) + ▲ (bottom) — interact accessible for right-handed players
    const rightWrap = document.createElement('div');
    rightWrap.id = 'nd-mobile-controls-r';
    rightWrap.style.cssText = `position:fixed;bottom:calc(env(safe-area-inset-bottom,0px) + 8px);right:calc(env(safe-area-inset-right,0px) + ${margin}px);display:flex;flex-direction:column;gap:${gap}px;z-index:900;pointer-events:none;user-select:none;-webkit-user-select:none;`;
    rightWrap.appendChild(upBtnR);
    rightWrap.appendChild(rightBtn);

    document.body.appendChild(leftWrap);
    document.body.appendChild(rightWrap);
    this.mobileControlsEl = leftWrap;
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
    this._waveCharsMap.forEach(ws => this._clearWaveSet(ws));
    this._waveCharsMap.clear();
    if (this._playerWaveSet) { this._clearWaveSet(this._playerWaveSet); this._playerWaveSet = null; }
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
    // worldMap is a singleton — don't destroy, just leave it as-is
    this.roomRequestToast?.remove();
    this.roomRequestToast = null;
    clearRoomRequestHandler(this.roomRequestHandler);
    this.mobileControlsEl?.remove();
    this.mobileControlsEl = null;
    document.getElementById('nd-mobile-controls-r')?.remove();
    document.documentElement.style.removeProperty('--nd-ctrl-offset');
    this._localAuraEmitter?.destroy();
    this._localAuraEmitter = null;
    this._localAuraType = '';
    this._auraLastX = NaN;
    this._otherAuraMap.forEach(e => e.emitter.destroy());
    this._otherAuraMap.clear();
    this._otherStillMap.clear();
    this._localEyeL?.destroy();
    this._localEyeR?.destroy();
    this._localEyeL = null;
    this._localEyeR = null;
    this._localEyeType = '';
    this._otherEyeMap.forEach(e => { e.left.destroy(); e.right.destroy(); });
    this._otherEyeMap.clear();
    this._otherEyeColorStepMap.clear();
    this._localEyeColorStep = -1;
  }
}

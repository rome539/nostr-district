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
import { t as ti18n } from '../i18n/i18n';
import { DMPanel } from '../ui/DMPanel';
import { CrewPanel } from '../ui/CrewPanel';
import { FollowsPanel } from '../ui/FollowsPanel';
import { SettingsPanel } from '../ui/SettingsPanel';
import { WalletPanel } from '../ui/WalletPanel';
import { HotkeyModal } from '../ui/HotkeyModal';
import { EmoteSet, EMOTE_FLAVORS, EMOTE_OFF_MSGS } from '../entities/EmoteSet';
import { renderHubSprite, itemImagesReady } from '../entities/AvatarRenderer';
import { SoundEngine } from '../audio/SoundEngine';
import { EYE_PALETTES, EYE_CYCLE_MS, EYE_CYCLE_TYPES, EYE_MOTION_TYPES, eyeMotionStep } from '../entities/avatar/eyeCycles';
import { CHAR_ANIMS, charAnimStates } from '../entities/nameAnim';
import { AuraFireworks } from './auraFireworks';
import { HandSparkler } from './handSparkler';
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
import { registerSenderNameHint } from '../nostr/zapService';
import { ToastManager } from '../ui/ToastManager';
import { receiveMintedEvent, fetchInventoryFromRelays } from '../stores/tradeItemStore';
import { setItemMintedHandler as _setMintHandler, setItemReceivedHandler, setScavengeErrorHandler } from '../nostr/presenceService';
import { authStore } from '../stores/authStore';
import { AvatarConfig, deserializeAvatar, getDefaultAvatar, getAvatar } from '../stores/avatarStore';
import { getRainbowColor, isAnimatedColor, getAnimatedColor, isGradientColor, getGradientStops } from '../stores/marketStore';
import { MarketPanel } from '../ui/MarketPanel';
import { bazaarPanel, BazaarPanel } from '../ui/BazaarPanel';
import { NameOstrichPair, OSTRICH_SENTINEL_L, OSTRICH_SENTINEL_R } from '../utils/ostrichGlyph';
import { BountyBoardPanel } from '../ui/BountyBoardPanel';
import { TutorialOverlay } from '../ui/TutorialOverlay';
import { getRoomConfig } from '../stores/roomStore';
import { getStatus } from '../stores/statusStore';
import { GROUND_Y, P, NAME_FONT, PLAYER_SPEED } from '../config/game.config';
import { isRoaming, setRoaming, toggleRoaming } from '../stores/roamStore';
import { addSeenPubkey } from '../stores/seenPlayersStore';

// ── Aura particle system (Phaser ParticleEmitter) ────────────────────────────

// s = spriteHeight / 96  (room at scale 3 is the reference; hub/woods=0.33, alley/cabin=0.67)
// Whether the item PNGs have finished loading — folded into the avatar-texture cache key
// so the first render AFTER they load isn't skipped (same avatar hash, different output).
let _hubItemsReady = false;
itemImagesReady.then(() => { _hubItemsReady = true; });

const EYE_VFX_TYPES   = new Set(['cry']); // particle emitter eyes
const NEON_COLORS     = new Set(['#39ff14', '#ff2d78', '#ffaa00']);
// Color-cycling eyes (palettes + speeds) — single source of truth in eyeCycles.ts.
const EYE_COLOR_TYPES = EYE_CYCLE_TYPES;
const EYE_CYCLE_HEX   = EYE_PALETTES;

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

// The ₿ Bullion name color (Satoshi's Vault reward) brackets the name with ₿.
// Idempotent: strips any existing wrap first, so re-applying every frame is safe.
export function bullionName(name: string, nameColor?: string): string {
  const base = name.replace(/^₿ | ₿$/g, '');
  return nameColor === 'bullion' ? `₿ ${base} ₿` : base;
}

// Chat-name decoration: ₿ Bullion adds text brackets; 🦤 Nostrich wraps the name in
// sentinel chars that ChatUI swaps for the purple-ostrich <img> (no ostrich glyph
// exists, so it can't be a plain string wrap like bullion).
export function decorateChatName(name: string, nameColor?: string): string {
  const base = bullionName(name, nameColor);
  return nameColor === 'nostrich' ? `${OSTRICH_SENTINEL_L}${base}${OSTRICH_SENTINEL_R}` : base;
}

// Paint a gradient name color (e.g. ⛏ Halving) as a horizontal gradient that flows
// left→right across the text. Returns false if it couldn't (caller falls back).
function applyNameGradient(text: Phaser.GameObjects.Text, value: string, time: number): boolean {
  const w = text.width;
  if (!w) return false;
  const stops = getGradientStops(value, time);
  if (!stops.length) return false;
  const grad = text.context.createLinearGradient(0, 0, w, 0);
  for (const s of stops) grad.addColorStop(s.pos, s.color);
  text.setFill(grad); // Phaser Text.setFill accepts a CanvasGradient
  return true;
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
    case 'runes': return { // The Arcane set — slow ring of violet motes, faintly rising
      speed:    { min: r(2), max: r(8) },
      angle:    { min: 0, max: 360 },
      lifespan: { min: 1400, max: 2600 },
      scale:    { start: 0.9, end: 0 },
      alpha:    { start: 0.85, end: 0 },
      tint:     [0x9a6eff, 0xb88aff, 0x6a3aaa, 0xe0d0ff],
      frequency: 130,
      quantity:  1,
      gravityY:  r(-7),
      emitZone: { type: 'edge', source: new Phaser.Geom.Circle(0, 0, r(17)), quantity: 10 } as any,
      blendMode: 'ADD',
    };
    case 'bats': return { // All Hallows set — real bat silhouettes (aura_bat texture) circling the head
      speed:    { min: r(22), max: r(48) },
      angle:    { min: 0, max: 360 },
      lifespan: { min: 700, max: 1400 },
      scale:    { start: s * 1.1, end: s * 0.6 }, // texture is 13px wide — scale by sprite size
      alpha:    { start: 1, end: 0 },
      rotate:   { min: -25, max: 25 },
      tint:     [0x8a7ab0, 0x6a4a8a, 0x55406e, 0x9a9ac0],
      frequency: 260, // a few distinct bats at a time, not a swarm
      quantity:  1,
      gravityY:  0,
      emitZone: { type: 'random', source: new Phaser.Geom.Circle(0, -r(12), r(18)) } as any,
      blendMode: 'NORMAL',
    };
    case 'snow': return { // Cold Storage set — flurry from above the head, fading out by the legs
      speed:    { min: r(2), max: r(6) },
      angle:    { min: 80, max: 100 },
      lifespan: { min: 1400, max: 2200 },
      scale:    { start: 1.0, end: 0.4 },
      alpha:    { start: 1, end: 0 },
      tint:     [0xffffff, 0xeaf2ff, 0xc8deff],
      frequency: 80,
      quantity:  1,
      gravityY:  r(11),
      emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(r(-18), r(-34), r(36), r(8)) } as any,
      blendMode: 'ADD',
    };
    case 'steam': return { // Greasy Spoon (Eats) set — soft ramen-steam wisps rising + spreading
      speed:    { min: r(5), max: r(15) },
      angle:    { min: 258, max: 282 },
      lifespan: { min: 1000, max: 2000 },
      scale:    { start: 0.6, end: 2.6 },
      alpha:    { start: 0.42, end: 0 },
      tint:     [0xffffff, 0xeaeaf2, 0xd2d2de],
      frequency: 150,
      quantity:  1,
      gravityY:  r(-10),
      emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(r(-7), r(-3), r(14), r(6)) } as any,
      blendMode: 'NORMAL',
    };
    case 'fireworks': return { // Independence set — pops ABOVE the head, clear of the sprite
      speed:    { min: r(40), max: r(75) },
      angle:    { min: 0, max: 360 },
      lifespan: { min: 450, max: 850 },
      scale:    { start: 1.1, end: 0 },
      alpha:    { start: 1, end: 0 },
      tint:     [0xff5050, 0xf0f0ff, 0x5080ff, 0xffd700],
      frequency: 1000,
      quantity:  14,
      gravityY:  r(12),
      emitZone: { type: 'random', source: new Phaser.Geom.Circle(0, -r(34), r(10)) } as any,
      blendMode: 'ADD',
    };
    case 'spores': return { // Undergrowth (Flora) set — slow drifting green spores, gently rising
      speed:    { min: r(2), max: r(9) },
      angle:    { min: 0, max: 360 },
      lifespan: { min: 1600, max: 3000 },
      scale:    { start: 0.7, end: 0 },
      alpha:    { start: 0.7, end: 0 },
      tint:     [0x88cc44, 0xaaff66, 0x66aa33, 0xd0f0a0],
      frequency: 150,
      quantity:  1,
      gravityY:  r(-4),
      emitZone: { type: 'random', source: new Phaser.Geom.Circle(0, 0, r(18)) } as any,
      blendMode: 'ADD',
    };
    case 'nebula': return { // Falling Sky (Celestial) set — expanding cosmic cloud in galaxy hues
      speed:    { min: r(2), max: r(8) },
      angle:    { min: 0, max: 360 },
      lifespan: { min: 1800, max: 3400 },
      scale:    { start: 1.0, end: 2.8 },
      alpha:    { start: 0.5, end: 0 },
      tint:     [0x7a3cff, 0xc84cff, 0xff6ad5, 0x4ad8ff, 0xffffff],
      frequency: 130,
      quantity:  1,
      gravityY:  r(-2),
      emitZone: { type: 'random', source: new Phaser.Geom.Circle(0, 0, r(18)) } as any,
      blendMode: 'ADD',
    };
    case 'school': return { // Full Catch set — a school of fish (aura_fish texture) circling the player
      speed:    { min: r(16), max: r(38) },
      angle:    { min: 0, max: 360 },
      lifespan: { min: 900, max: 1700 },
      scale:    { start: s * 1.0, end: s * 0.7 }, // texture is 14px wide — scale by sprite size
      alpha:    { start: 1, end: 0 },
      rotate:   { min: -18, max: 18 },
      tint:     [0x8fd4ff, 0x5aa0d0, 0xffac5a, 0xe8f6ff], // silvery blues + a koi-orange accent
      frequency: 300, // a few fish at a time — a small school, not a swarm
      quantity:  1,
      gravityY:  0,
      emitZone: { type: 'random', source: new Phaser.Geom.Circle(0, -r(6), r(20)) } as any,
      blendMode: 'NORMAL',
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
  // Cached parse of `avatar` — re-parsed only when the string changes (see otherAvatar()).
  _avatarKey?: string;
  _avatarParsed?: AvatarConfig | null;
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

/**
 * Shared name-tag visual style — the single source of truth for a scene's name tags.
 * Used for BOTH the local player's name and `getOtherPlayerConfig`, so the two can't drift.
 * Tweak a scene's tag by editing its one NameTagStyle.
 */
export interface NameTagStyle {
  fontSize: string;
  color: string;
  bg: string;
  padding: { x: number; y: number };
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
  // The 'fireworks' aura is special: it runs the real FireworksEngine (AuraFireworks)
  // instead of a particle emitter, so either `emitter` or `fw` is set, never both.
  private _localAuraEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private _localAuraFw      : AuraFireworks | null = null;
  private _localAuraType    = '';
  private _auraLastX        = NaN;
  private _auraStillTime    = 0;
  private _otherAuraMap     = new Map<string, { emitter: Phaser.GameObjects.Particles.ParticleEmitter | null; fw: AuraFireworks | null; type: string }>();
  // Sparkler accessory — a live hand particle, one per player wearing it.
  private _localHandSparkler: HandSparkler | null = null;
  private _otherSparklerMap  = new Map<string, HandSparkler>();
  // 🦤 Nostrich name color — purple ostriches flanking the name tag, one pair per player.
  private _localOstrich      : NameOstrichPair | null = null;
  private _otherOstrichMap   = new Map<string, NameOstrichPair>();
  // Cursor keys, created ONCE and reused. createCursorKeys() rebuilds an object + re-adds
  // six keys on every call — calling it per frame (every scene did) is pure churn.
  protected _cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private _otherStillMap    = new Map<string, { lastTargetX: number; stillSince: number }>();
  private _localEyeL: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private _localEyeR: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private _localEyeType = '';
  private _localEyeColorStep = -1;
  private _localEyeMotionStep = -1;
  private _otherEyeMap  = new Map<string, { left: Phaser.GameObjects.Particles.ParticleEmitter; right: Phaser.GameObjects.Particles.ParticleEmitter; type: string }>();
  private _otherEyeColorStepMap = new Map<string, number>();
  private _otherEyeMotionStepMap = new Map<string, number>();
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

  // ── /roam autopilot (easter egg) ─────────────────────────────────────────────
  // Subclasses (hub, woods) set roamConfig in create() to participate. deepX = how
  // far INTO the scene to stroll before turning back; exitX = past the edge that
  // leads to the other scene (the scene's normal edge check does the transition).
  protected roamConfig: { deepX: number; exitX: number; restEmote?: string } | null = null;
  private roamPhase: 'explore' | 'exit' = 'explore';
  private roamWalking = false;
  private roamUntil = 0;
  private roamEmote: string | null = null; // emote currently shown by roam (so we clear it)

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
    ToastManager.init();
    // Wire oracle mint events → inventory (live arrivals get the "NEW" badge)
    _setMintHandler((event) => {
      const item = receiveMintedEvent(event, true);
      if (item) {
        window.dispatchEvent(new CustomEvent('nd-inventory-update'));
        this.snd.itemReward();
        const source = (event as any).tags?.find((t: string[]) => t[0] === 'source')?.[1];
        if (source === 'weekly_drop') {
          import('../stores/tradeItemStore').then(({ ITEM_CATALOG }) => {
            const def = ITEM_CATALOG.find(d => d.id === item.itemId);
            if (def) window.dispatchEvent(new CustomEvent('nd-toast', { detail: { msg: `Weekly drop: ${def.emoji} ${def.name}!`, color: '#c0a8ff', open: 'inventory' } }));
          });
        } else if (source === 'found') {
          // Scavenge result — the server rolled it, so the find is only known now.
          import('../stores/tradeItemStore').then(({ ITEM_CATALOG, RARITY_COLOR, confirmPendingScavenge }) => {
            confirmPendingScavenge(); // this collect succeeded — drop its in-flight spot
            const def = ITEM_CATALOG.find(d => d.id === item.itemId);
            if (def) window.dispatchEvent(new CustomEvent('nd-toast', { detail: { msg: `${def.emoji} Found a ${def.name}!`, color: RARITY_COLOR[def.rarity], open: 'inventory' } }));
          });
        }
      }
    });
    // A scavenge mint was denied (cooldown / hiccup): put the spot back instead of
    // losing it silently, and tell the active ScavengeSystem to re-show it.
    setScavengeErrorHandler((reason) => {
      import('../stores/tradeItemStore').then(({ restorePendingScavengeSpot }) => {
        if (!restorePendingScavengeSpot()) return;
        window.dispatchEvent(new CustomEvent('nd-scavenge-refresh'));
        if (reason === 'scavenge_cooldown') {
          window.dispatchEvent(new CustomEvent('nd-toast', { detail: { msg: 'Slow down — that spot’s still cooling off.', color: '#e0b060' } }));
        }
      });
    });
    setItemReceivedHandler((fromName, event) => {
      // Add the item to inventory immediately (no waiting for a relay refetch)
      if (event) receiveMintedEvent(event, true);
      this.snd.tradeSound();
      window.dispatchEvent(new CustomEvent('nd-toast', { detail: { msg: `You received an item${fromName ? ` from ${fromName}` : ''}!`, color: '#c0a8ff', open: 'inventory' } }));
    });
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
   * Dev-only: regenerate every avatar texture in this scene from the
   * current `imgCache` / `hubImgCache`. Used by the clothing hot-reload
   * helper (src/entities/avatar/devRefresh.ts) so saving a PNG under
   * `public/assets/{tops,bottoms,…}` live-updates instead of forcing a
   * full page reload. Iterates the local player + every otherPlayer in
   * the scene.
   */
  public _devRefreshAvatars(): void {
    // Local player — force a rebuild of the walk frames (the PNG bytes on disk changed
    // but the avatar config didn't, so reset the cache key first), then the standing
    // sprite via the scene-correct renderer.
    BaseScene._hubPlayerTexHash = '';
    this.ensureHubPlayerTextures(getAvatar());
    if (this.textures.exists('player')) this.textures.remove('player');
    this.textures.addCanvas('player', this.renderOtherAvatar(getAvatar()));
    this.playerSprite?.setTexture('player');

    // Other players — reuse the live-update path from onAvatarUpdate.
    const cfg = this.getOtherPlayerConfig();
    this.otherPlayers.forEach((o, pk) => {
      const av = o.avatar ? deserializeAvatar(o.avatar) : getDefaultAvatar();
      if (!av) return;
      const texKey = `${cfg.texKeyPrefix}${pk}`;
      if (this.textures.exists(texKey)) this.textures.remove(texKey);
      this.textures.addCanvas(texKey, this.renderOtherAvatar(av));
      o.sprite.setTexture(texKey);
    });
  }

  /**
   * Fade-out and destroy an other-player entry. Moves the entry to
   * dyingSprites during the tween so re-joins can cancel it cleanly.
   */
  protected removeOtherPlayer(pk: string): void {
    const o = this.otherPlayers.get(pk); if (!o) return;
    this.otherPlayers.delete(pk);
    const ae = this._otherAuraMap.get(pk);
    if (ae) { ae.emitter?.destroy(); ae.fw?.destroy(); this._otherAuraMap.delete(pk); }
    const hs = this._otherSparklerMap.get(pk);
    if (hs) { hs.destroy(); this._otherSparklerMap.delete(pk); }
    const op = this._otherOstrichMap.get(pk);
    if (op) { op.destroy(); this._otherOstrichMap.delete(pk); }
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
      // Free the per-player avatar texture — Phaser textures are GLOBAL and are NOT
      // released by sprite.destroy(), so every player who leaves would otherwise leak a
      // canvas forever. Guard against a quick re-join that already recreated it.
      if (!this.otherPlayers.has(pk)) {
        const texKey = `${this.getOtherPlayerConfig().texKeyPrefix}${pk}`;
        if (this.textures.exists(texKey)) this.textures.remove(texKey);
      }
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
      fontFamily: NAME_FONT, fontSize: cfg.nameFontSize,
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

    // Feed the global zap-toast subscription a name hint so an incoming zap
    // from this player renders as "Alice" instead of "5069ea44…".
    registerSenderNameHint(pk, name);
    addSeenPubkey(pk);

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
    if (!this.textures.exists('aura_dot')) {
      const g = this.make.graphics(undefined, false);
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 2, 2);
      g.generateTexture('aura_dot', 2, 2);
      g.destroy();
    }
    // Tiny bat silhouette for the bats aura — drawn white so the emitter tint colors it.
    if (!this.textures.exists('aura_bat')) {
      const b = this.make.graphics(undefined, false);
      b.fillStyle(0xffffff, 1);
      b.fillTriangle(0, 5, 5, 0, 5, 4);   // left wing
      b.fillTriangle(13, 5, 8, 0, 8, 4);  // right wing
      b.fillRect(5, 1, 3, 4);             // body
      b.fillRect(5, 0, 1, 1);             // ear
      b.fillRect(7, 0, 1, 1);             // ear
      b.generateTexture('aura_bat', 13, 6);
      b.destroy();
    }
    // Tiny fish silhouette for the school aura — drawn white so the emitter tint colors it.
    if (!this.textures.exists('aura_fish')) {
      const f = this.make.graphics(undefined, false);
      f.fillStyle(0xffffff, 1);
      f.fillEllipse(8, 4, 11, 7);          // body
      f.fillTriangle(0, 1, 0, 7, 5, 4);    // tail fin
      f.generateTexture('aura_fish', 14, 8);
      f.destroy();
    }
  }

  /** Create the local player's name-tag Text from a shared NameTagStyle. */
  protected makeNameText(x: number, y: number, name: string, style: NameTagStyle, depth: number): Phaser.GameObjects.Text {
    return this.add.text(x, y, name.slice(0, 14), {
      fontFamily: NAME_FONT, fontSize: style.fontSize,
      color: style.color, align: 'center', backgroundColor: style.bg, padding: style.padding,
    }).setOrigin(0.5).setDepth(depth);
  }

  private _buildWaveSet(text: string, ref: Phaser.GameObjects.Text, color: string): WaveCharSet {
    const fontSize = ref.style.fontSize as string;
    const tmp = this.add.text(0, -9999, 'W', { fontFamily: NAME_FONT, fontSize }).setVisible(false);
    const charW = tmp.width;
    tmp.destroy();

    // Background: same style as nameText but filled with spaces — renders the
    // exact same box (color, padding, corners) without showing any text.
    const pad = (ref.style as any).padding ?? { x: 4, y: 2 };
    const bg = this.add.text(0, 0, text.replace(/\S/g, ' '), {
      fontFamily: NAME_FONT, fontSize,
      backgroundColor: ref.style.backgroundColor as string,
      padding: pad,
    }).setOrigin(0.5, 0.5).setDepth(8);

    const chars = Array.from(text).map(ch =>
      this.add.text(0, 0, ch, { fontFamily: NAME_FONT, fontSize, color })
        .setOrigin(0.5, 0.5).setDepth(9)
    );
    return { chars, charW, text, bg };
  }

  /** Drives any per-character name anim (wave/glitch/decode/splitflap/shimmer) from its state set. */
  private _applyCharAnim(ws: WaveCharSet, cx: number, cy: number, time: number, color: string, type: string): void {
    const { chars, charW, bg } = ws;
    const states = charAnimStates(type, ws.text, time, color);
    const totalW = charW * chars.length;
    bg.setPosition(cx, cy);
    chars.forEach((c, i) => {
      const s = states[i];
      if (!s) return;
      if (c.text !== s.glyph) c.setText(s.glyph);
      c.setColor(s.color);
      c.setScale(s.sx, s.sy);
      c.setAlpha(s.alpha);
      if (s.glow > 0) c.setShadow(0, 0, s.glowColor ?? s.color, s.glow, false, true);
      else c.setShadow(0, 0, 'transparent', 0);
      c.x = cx - totalW / 2 + i * charW + charW / 2 + s.dx;
      c.y = cy + s.dy;
    });
  }

  private _clearWaveSet(ws: WaveCharSet): void {
    ws.bg.destroy();
    ws.chars.forEach(c => c.destroy());
  }

  private _makeAuraEmitter(type: string, x: number, y: number, spriteHeight: number): Phaser.GameObjects.Particles.ParticleEmitter {
    this._ensureAuraDotTexture();
    const s = Math.max(0.2, spriteHeight / 96); // 96 = room reference (32px texture × scale 3)
    const tex = type === 'bats' ? 'aura_bat' : type === 'school' ? 'aura_fish' : 'aura_dot'; // bats/school use real silhouettes
    return this.add.particles(x, y, tex, makeAuraConfig(type, s)).setDepth(13);
  }

  /** Eye pixel offsets as fractions of displayHeight.
   *  lx/rx = X offset from sprite.x; yFrac = distance above sprite.y (bottom anchor).
   *  Override in scenes that use the room canvas (48×76) instead of the hub canvas (37×56). */
  protected getEyePixelOffsets(): { lx: number; rx: number; yFrac: number } {
    // Hub canvas 37×56: cry eyes at canvas x=15.5/20.5 → offsets -3/+2 from center 18.5; y=23 top → 33px from bottom
    return { lx: -3 / 56, rx: 2 / 56, yFrac: 33 / 56 };
  }

  /** Where a held hand item (the sparkler) sits — matched to the 'watch' wrist,
   *  one pixel lower. xFrac/yFrac are fractions of displayHeight from sprite.x
   *  (centre) and sprite.y, mirrored with flipX. Hub canvas 56 tall; Room overrides. */
  protected getHandPixelOffsets(): { xFrac: number; yFrac: number } {
    return { xFrac: 5 / 56, yFrac: 16 / 56 };
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

  /** Parsed avatar for an other-player, cached on the record. Re-parses only when the
   *  serialized string actually changes — avoids a JSON.parse per player PER FRAME, the
   *  dominant cost in updateOtherPlayers when the room is busy. */
  protected otherAvatar(o: OtherPlayer): AvatarConfig | null {
    if (!o.avatar) { o._avatarParsed = null; o._avatarKey = undefined; return null; }
    if (o._avatarKey !== o.avatar) {
      o._avatarKey = o.avatar;
      o._avatarParsed = deserializeAvatar(o.avatar);
    }
    return o._avatarParsed ?? null;
  }

  // The hub-style player textures ('player' + 'player_walk0-3') are global and shared by
  // the hub/woods/alley/cabin scenes. Re-rendering all 5 avatar canvases on every scene
  // entry (via renderHubSprite) is the main re-entry CPU spike. Skip it when the avatar is
  // byte-identical to what's already baked; re-render when it actually changes (new hash)
  // or when item PNGs finish loading (hash includes that). Returns true if it rebuilt.
  private static _hubPlayerTexHash = '';
  protected ensureHubPlayerTextures(avatar: AvatarConfig): boolean {
    const hash = JSON.stringify(avatar) + (_hubItemsReady ? '|i' : '');
    if (hash === BaseScene._hubPlayerTexHash
      && this.textures.exists('player') && this.textures.exists('player_walk3')) {
      return false;
    }
    BaseScene._hubPlayerTexHash = hash;
    if (this.textures.exists('player')) this.textures.remove('player');
    this.textures.addCanvas('player', renderHubSprite(avatar));
    for (let i = 0; i < 4; i++) {
      const k = `player_walk${i}`;
      if (this.textures.exists(k)) this.textures.remove(k);
      this.textures.addCanvas(k, renderHubSprite(avatar, i));
    }
    return true;
  }

  protected updateOtherPlayers(time: number, delta: number): void {
    // Gate Phaser scene input while a full-screen DOM panel (bazaar/wallet/market)
    // is open. Phaser processes pointer events on the NEXT frame, but a DOM panel
    // closes synchronously on click — so a click that closes the panel would, a
    // frame later, fire an in-world prompt (e.g. a door) and act on it. Disabling
    // scene input means those clicks never reach the game while a panel is up.
    const block = this.shouldBlockPanelKeys();
    if (this.input.enabled === block) this.input.enabled = !block;

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

      // Visibility cull: animated name cosmetics (colors, gradients, name motion,
      // ostrich) are pointless for a player scrolled off-screen — freeze them. The
      // aura/sparkler/eye blocks below are already distance-gated (nearEnough).
      const wv = this.cameras.main.worldView;
      const onScreen = o.sprite.x >= wv.x - 90 && o.sprite.x <= wv.right + 90;

      if (o.avatar) {
        const oa = this.otherAvatar(o);
        if (oa) {
          // ₿ Bullion name wrap (before name-motion so a wave set rebuilds with it)
          const wantN = bullionName(o.nameText.text, oa.nameColor);
          if (o.nameText.text !== wantN) o.nameText.setText(wantN);

          if (onScreen) {
          // Color animation
          if (oa.nameColor && isGradientColor(oa.nameColor)) applyNameGradient(o.nameText, oa.nameColor, time);
          else if (oa.nameColor && isAnimatedColor(oa.nameColor)) o.nameText.setColor(getAnimatedColor(oa.nameColor, time));

          // 🦤 Nostrich — purple ostriches flanking this player's name tag.
          if (oa.nameColor === 'nostrich') {
            let op = this._otherOstrichMap.get(pk);
            if (!op) { op = new NameOstrichPair(this); this._otherOstrichMap.set(pk, op); }
            op.update(o.nameText, o.nameText.depth, time);
          } else {
            this._otherOstrichMap.get(pk)?.hide();
          }

          // Name tag motion
          if (oa.nameAnim) {
            if (!CHAR_ANIMS.has(oa.nameAnim)) {
              const ws = this._waveCharsMap.get(pk);
              if (ws) { this._clearWaveSet(ws); this._waveCharsMap.delete(pk); o.nameText.setVisible(true); }
            }
            if (CHAR_ANIMS.has(oa.nameAnim)) {
              const currentColor = o.nameText.style.color as string;
              let ws = this._waveCharsMap.get(pk);
              if (!ws || ws.text !== o.nameText.text) {
                if (ws) this._clearWaveSet(ws);
                o.nameText.setVisible(false);
                ws = this._buildWaveSet(o.nameText.text, o.nameText, currentColor);
                this._waveCharsMap.set(pk, ws);
              }
              this._applyCharAnim(ws, o.nameText.x, o.nameText.y, time, currentColor, oa.nameAnim);
            } else {
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
                case 'glow': {
                  const glowColor = o.nameText.style.color as string;
                  const flicker = Math.random() < 0.015 ? 0.25 : Math.random() < 0.04 ? 0.75 : 1;
                  const blur = 10 + Math.sin(time / 600) * 4;
                  o.nameText.setAlpha(flicker).setShadow(0, 0, glowColor, blur, false, true);
                  break;
                }
              }
              if (NEON_COLORS.has(oa.nameColor) && oa.nameAnim !== 'glow') {
                o.nameText.setShadow(0, 0, oa.nameColor, 8 + Math.sin(time / 600) * 3, false, true);
              }
            }
          } else {
            const ws = this._waveCharsMap.get(pk);
            if (ws) { this._clearWaveSet(ws); this._waveCharsMap.delete(pk); o.nameText.setVisible(true); }
            if (NEON_COLORS.has(oa.nameColor)) {
              o.nameText.setScale(1).setAngle(0).setAlpha(1).setShadow(0, 0, oa.nameColor, 8 + Math.sin(time / 600) * 3, false, true);
            } else {
              o.nameText.setScale(1).setAngle(0).setAlpha(1).setShadow(0, 0, 'transparent', 0);
            }
          }
          } else {
            // Off-screen: skip all animated name work above; clear transient visuals.
            this._otherOstrichMap.get(pk)?.hide();
            const ws = this._waveCharsMap.get(pk);
            if (ws) { this._clearWaveSet(ws); this._waveCharsMap.delete(pk); o.nameText.setVisible(true); }
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
            const depth = o.sprite.depth + 1; // track Y-sorted depth (room), not fixed
            let entry = this._otherAuraMap.get(pk);
            if (!entry || entry.type !== oa.aura) {
              entry?.emitter?.destroy();
              entry?.fw?.destroy();
              if (oa.aura === 'fireworks') {
                const sc = Math.max(0.2, o.sprite.displayHeight / 96);
                entry = { emitter: null, fw: new AuraFireworks(this, depth, sc), type: oa.aura };
              } else {
                entry = { emitter: this._makeAuraEmitter(oa.aura, nx, ny, o.sprite.displayHeight), fw: null, type: oa.aura };
              }
              this._otherAuraMap.set(pk, entry);
            }
            if (entry.fw) entry.fw.update(time, delta, nx, ny, depth);
            else if (entry.emitter) { entry.emitter.setPosition(nx, ny); entry.emitter.setDepth(depth); }
          } else if (!otherStill || !oa.aura || !nearEnough) {
            const entry = this._otherAuraMap.get(pk);
            if (entry) { entry.emitter?.destroy(); entry.fw?.destroy(); this._otherAuraMap.delete(pk); }
          }

          // Sparkler accessory — live hand particle, shown whenever equipped + nearby
          // (no stillness gate; you're holding it whether you move or not).
          if (oa.accessory === 'sparkler' && nearEnough) {
            const depth = o.sprite.depth + 1;
            const dH = o.sprite.displayHeight;
            const { xFrac, yFrac } = this.getHandPixelOffsets();
            // flipX === false means facing right → hold on the facing side.
            const side = o.sprite.flipX ? -1 : 1;
            const handX = o.sprite.x + side * xFrac * dH;
            const handY = o.sprite.y - yFrac * dH;
            const dir = side; // stick points outward in the facing direction
            let hs = this._otherSparklerMap.get(pk);
            if (!hs) { hs = new HandSparkler(this, depth, o.sprite.displayHeight / 96); this._otherSparklerMap.set(pk, hs); }
            hs.update(time, handX, handY, dir, depth);
          } else {
            const hs = this._otherSparklerMap.get(pk);
            if (hs) { hs.destroy(); this._otherSparklerMap.delete(pk); }
          }

          // Eye VFX — cry uses particles; color-cycle steps eyeColor; motion eyes
          // (shifty/dizzy/heart) re-render on a frame cadence (the draw self-animates).
          const otherEyeType = (EYE_VFX_TYPES.has(oa.eyes) || EYE_COLOR_TYPES.has(oa.eyes) || EYE_MOTION_TYPES.has(oa.eyes)) ? oa.eyes : '';
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
            } else if (EYE_MOTION_TYPES.has(otherEyeType)) {
              const step = eyeMotionStep(otherEyeType);
              const prev = this._otherEyeMotionStepMap.get(pk) ?? -1;
              if (step !== prev) {
                this._otherEyeMotionStepMap.set(pk, step);
                const cfg2 = this.getOtherPlayerConfig();
                const texKey = `${cfg2.texKeyPrefix}${pk}`;
                if (this.textures.exists(texKey)) this.textures.remove(texKey);
                this.textures.addCanvas(texKey, this.renderOtherAvatar(oa));
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
            this._otherEyeMotionStepMap.delete(pk);
          }
        }
      }

      this.updateOtherPlayerExtras(pk, o, dx, delta);
    });
  }

  /** Call once per frame in each scene's update() to animate name tag + aura. */
  protected updateLocalNameColor(time: number, delta = 16): void {
    const av = getAvatar();

    // ₿ Bullion name wrap (applied before name-motion so the wave set rebuilds with it)
    if (this.playerName) {
      const want = bullionName(this.playerName.text, av.nameColor);
      if (this.playerName.text !== want) this.playerName.setText(want);
    }

    // Color animation
    if (av.nameColor) {
      if (isGradientColor(av.nameColor) && this.playerName) {
        applyNameGradient(this.playerName, av.nameColor, time);
      } else if (isAnimatedColor(av.nameColor)) {
        this.playerName?.setColor(getAnimatedColor(av.nameColor, time));
      } else {
        const current = this.playerName?.style.color;
        if (current !== av.nameColor) this.playerName?.setColor(av.nameColor);
      }
    }

    // 🦤 Nostrich — purple ostriches flanking the name tag.
    if (av.nameColor === 'nostrich' && this.playerName) {
      (this._localOstrich ??= new NameOstrichPair(this)).update(this.playerName, this.playerName.depth, time);
    } else {
      this._localOstrich?.hide();
    }

    // Name tag motion
    if (this.playerName && av.nameAnim) {
      if (!CHAR_ANIMS.has(av.nameAnim)) {
        if (this._playerWaveSet) { this._clearWaveSet(this._playerWaveSet); this._playerWaveSet = null; this.playerName.setVisible(true); }
      }
      if (CHAR_ANIMS.has(av.nameAnim)) {
        const color = this.playerName.style.color as string;
        if (!this._playerWaveSet || this._playerWaveSet.text !== this.playerName.text) {
          if (this._playerWaveSet) this._clearWaveSet(this._playerWaveSet);
          this.playerName.setVisible(false);
          this._playerWaveSet = this._buildWaveSet(this.playerName.text, this.playerName, color);
        }
        this._applyCharAnim(this._playerWaveSet, this.playerName.x, this.playerName.y, time, color, av.nameAnim);
      } else {
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
          case 'glow': {
            const glowColor = this.playerName.style.color as string;
            const flicker = Math.random() < 0.015 ? 0.25 : Math.random() < 0.04 ? 0.75 : 1;
            const blur = 10 + Math.sin(time / 600) * 4;
            this.playerName.setAlpha(flicker).setShadow(0, 0, glowColor, blur, false, true);
            break;
          }
        }
        if (NEON_COLORS.has(av.nameColor) && av.nameAnim !== 'glow') {
          this.playerName.setShadow(0, 0, av.nameColor, 8 + Math.sin(time / 600) * 3, false, true);
        }
      }
    } else {
      if (this._playerWaveSet) { this._clearWaveSet(this._playerWaveSet); this._playerWaveSet = null; this.playerName?.setVisible(true); }
      if (NEON_COLORS.has(av.nameColor)) {
        this.playerName?.setScale(1).setAngle(0).setAlpha(1).setShadow(0, 0, av.nameColor, 8 + Math.sin(time / 600) * 3, false, true);
      } else {
        this.playerName?.setScale(1).setAngle(0).setAlpha(1).setShadow(0, 0, 'transparent', 0);
      }
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
        // Sit the aura just in front of the player. Scenes that depth-sort by Y (the
        // room) put the sprite at depth≈y (~hundreds); a fixed depth would bury the
        // aura behind the floor/furniture (smoke fogging the room, steam behind you).
        const depth = this.playerSprite.depth + 1;
        if (av.aura === 'fireworks') {
          if (this._localAuraType !== 'fireworks') {
            this._localAuraEmitter?.destroy(); this._localAuraEmitter = null;
            this._localAuraFw?.destroy();
            this._localAuraFw = new AuraFireworks(this, depth, Math.max(0.2, this.playerSprite.displayHeight / 96));
            this._localAuraType = 'fireworks';
          }
          this._localAuraFw!.update(time, delta, px, py, depth);
        } else {
          if (this._localAuraFw) { this._localAuraFw.destroy(); this._localAuraFw = null; }
          if (!this._localAuraEmitter || this._localAuraType !== av.aura) {
            this._localAuraEmitter?.destroy();
            this._localAuraEmitter = this._makeAuraEmitter(av.aura, px, py, this.playerSprite.displayHeight);
            this._localAuraType = av.aura;
          } else {
            this._localAuraEmitter.setPosition(px, py);
          }
          this._localAuraEmitter.setDepth(depth);
        }
      } else if (!localStill && (this._localAuraEmitter || this._localAuraFw)) {
        this._localAuraEmitter?.destroy(); this._localAuraEmitter = null;
        this._localAuraFw?.destroy(); this._localAuraFw = null;
        this._localAuraType = '';
      }
    } else if (this._localAuraEmitter || this._localAuraFw) {
      this._localAuraEmitter?.destroy(); this._localAuraEmitter = null;
      this._localAuraFw?.destroy(); this._localAuraFw = null;
      this._localAuraType = '';
      this._auraLastX = NaN;
    }

    // Sparkler accessory — live hand particle, shown whenever equipped (moving or not).
    if (av.accessory === 'sparkler' && this.playerSprite) {
      const depth = this.playerSprite.depth + 1;
      const dH = this.playerSprite.displayHeight;
      const { xFrac, yFrac } = this.getHandPixelOffsets();
      // flipX === false means facing right → hold the sparkler on the facing side.
      const side = this.playerSprite.flipX ? -1 : 1;
      const handX = this.playerSprite.x + side * xFrac * dH;
      const handY = this.playerSprite.y - yFrac * dH;
      const dir = side; // stick points outward in the facing direction
      if (!this._localHandSparkler) {
        this._localHandSparkler = new HandSparkler(this, depth, this.playerSprite.displayHeight / 96);
      }
      this._localHandSparkler.update(time, handX, handY, dir, depth);
    } else if (this._localHandSparkler) {
      this._localHandSparkler.destroy();
      this._localHandSparkler = null;
    }

    // Eye VFX — cry uses particles; color-cycle eyes step eyeColor; motion eyes
    // (shifty/dizzy/heart) re-render on a frame cadence (the draw self-animates).
    const eyeType = (EYE_VFX_TYPES.has(av.eyes) || EYE_COLOR_TYPES.has(av.eyes) || EYE_MOTION_TYPES.has(av.eyes)) ? av.eyes : '';
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
    } else if (EYE_MOTION_TYPES.has(eyeType) && this.playerSprite) {
      const step = eyeMotionStep(eyeType);
      if (step !== this._localEyeMotionStep) {
        this._localEyeMotionStep = step;
        const canvas = this.renderOtherAvatar(av); // draw computes the frame from the clock
        if (this.textures.exists(this._localPlayerTexKey)) this.textures.remove(this._localPlayerTexKey);
        this.textures.addCanvas(this._localPlayerTexKey, canvas);
        this.playerSprite.setTexture(this._localPlayerTexKey);
      }
    } else if (eyeType && EYE_VFX_TYPES.has(eyeType) && this.playerSprite) {
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
      this._localEyeMotionStep = -1;
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

    // Bazaar "CONTACT seller" → open a DM with that player
    const openDmHandler = (e: Event) => {
      const { pubkey: pk, draft } = (e as CustomEvent).detail ?? {};
      if (pk) { this.crewPanel.close(); this.dmPanel.toggle(pk, draft); }
    };
    window.addEventListener('nd-open-dm', openDmHandler);
    this.events.once('shutdown', () => window.removeEventListener('nd-open-dm', openDmHandler));
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

    // W — Wallet (allow W to close wallet even though it itself blocks panel keys).
    // If the WalletInfo modal is open on top of the wallet, close it first so W
    // dismisses one layer at a time instead of jumping past it to close the wallet.
    this.input.keyboard?.on('keydown-W', () => {
      if (ci()) return;
      if (document.getElementById('wallet-info')) {
        import('../ui/WalletInfo').then(m => m.WalletInfo.destroy()).catch(() => {});
        return;
      }
      if (WalletPanel.isOpen()) { WalletPanel.destroy(); return; }
      if (blk()) return;
      WalletPanel.open();
    });

    // ? — Hotkey modal (document-level listener so it works outside Phaser focus)
    const hotkeyHandler = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      if (ci() || blk()) return;
      this.hotkeyModal.toggle();
    };
    document.addEventListener('keydown', hotkeyHandler);
    this.events.once('shutdown', () => document.removeEventListener('keydown', hotkeyHandler));

    // Tab — World map (document-level so it works outside Phaser focus)
    const mapHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (ci() || blk()) return;
      e.preventDefault();
      this.worldMap.toggle();
    };
    document.addEventListener('keydown', mapHandler);
    this.events.once('shutdown', () => document.removeEventListener('keydown', mapHandler));

    // Stuck-key guard. If the window/tab loses focus mid-press (alt-tab, OS dialog,
    // clicking another app), the matching keyup is delivered elsewhere and Phaser
    // keeps the arrow flagged isDown — so the avatar "walks by himself". Clearing all
    // key state on any focus loss stops movement the instant focus returns.
    const resetKeys = () => this.input.keyboard?.resetKeys();
    window.addEventListener('blur', resetKeys);
    document.addEventListener('visibilitychange', resetKeys);
    this.events.once('shutdown', () => {
      window.removeEventListener('blur', resetKeys);
      document.removeEventListener('visibilitychange', resetKeys);
    });

    // Listen for wallet → "open profile editor" intent dispatched by WalletPanel.
    const openProfileHandler = () => { if (!blk() && !ci()) this.onTKey(); };
    window.addEventListener('nd-open-profile-tab', openProfileHandler);
    this.events.once('shutdown', () => window.removeEventListener('nd-open-profile-tab', openProfileHandler));
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
   * Return true to block all panel hotkeys (M, G, F, S, T, U, ENTER) and
   * scene-level interaction keys (E, Space). Globally blocks while any
   * full-screen DOM modal is open so clicks/keys don't pass through to the game.
   * Scenes can override to add their own scene-specific blockers.
   */
  protected shouldBlockPanelKeys(): boolean {
    return WalletPanel.isOpen() || MarketPanel.isOpen() || BazaarPanel.isOpen();
  }

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
    // Overlays stacked on the bazaar (offer picker, partner prompt) close first —
    // ESC peels one layer at a time instead of tearing down the whole panel.
    if (BazaarPanel.closeTopOverlay())  {                               return true; }
    if (BazaarPanel.isOpen())           { bazaarPanel.close();          return true; }
    if (BountyBoardPanel.closeTopModal()) {                             return true; }
    if (BountyBoardPanel.isOpen())      { BountyBoardPanel.destroy();   return true; }
    if (WalletPanel.isOpen())           { WalletPanel.destroy();        return true; }
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
      if (name === 'smoke') { this.snd.lighterFlick(); }
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
   * Chat-bubble font size, per scene — kept proportional to each scene's name tag
   * (and thus its avatar scale) so bubbles don't dwarf small-avatar scenes.
   * Overridden in each scene to match its name-tag size.
   */
  protected getBubbleFontSize(): string { return '12px'; }

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
            // Format: "/emote <name>_<on|off>" optionally followed by " sync".
            // The sync suffix is appended by scene-transition replays so receivers
            // can update the avatar emote without spamming the chat log with the
            // flavor text every time the player walks into a new room.
            let payload = text.slice(7);
            const isSync = payload.endsWith(' sync');
            if (isSync) payload = payload.slice(0, -5);
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
                if (flavor && !isSync) {
                  if (this.showEmoteAsBubble()) ChatUI.showBubble(this, o.sprite.x, o.sprite.y + this.getBubbleYOffset(), flavor, P.lpurp);
                  if (!mutedPlayers.has(pk)) this.chatUI.addMessage(name, flavor, P.lpurp, pk);
                }
              } else { o.emotes.stop(emoteName); }
            }
          }
          return;
        }
        if (this.handleRpsIncoming(pk, name, text)) return;
        // Drop any unhandled slash-prefixed control messages (e.g. /game:music:*
        // sent for myroom music sync). They're broadcast over chat but should
        // never display as a chat line — a user-typed slash command goes through
        // the local handler in ChatUI and never reaches the wire.
        if (text.startsWith('/')) return;
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
        let senderNameColor: string | undefined = myAvatar.nameColor; // mine; overwritten for others
        if (!isMe) {
          const o = this.otherPlayers.get(pk);
          if (o?.avatar) {
            const oa = deserializeAvatar(o.avatar);
            if (oa?.chatColor) senderChatColor = isAnimatedColor(oa.chatColor) ? getAnimatedColor(oa.chatColor, Date.now()) : oa.chatColor;
            senderNameColor = oa?.nameColor;
          }
        }
        // ₿ Bullion / 🦤 Nostrich holders get their chat name decorated too
        this.chatUI.addMessage(decorateChatName(name, senderNameColor), text, isMe ? myChatColor : senderChatColor, pk, emojis, isMe);
        if (!isMe && !this.chatUI.isFocused()) this.snd.chatPing();
        const by = this.getBubbleYOffset();
        if (isMe) {
          const sp = this.getPlayerSprite();
          ChatUI.showBubble(this, sp.x, sp.y + by, text, myChatColor, 4000, emojis, true);
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
          this.chatUI.addMessage('system', ti18n('sys.room.requesting'), ac);
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
  // /roam autopilot
  // ══════════════════════════════════════════════════════════════════════════
  /** Reset the per-scene roam state. Call when a roaming scene starts (the avatar
   *  explores fresh each time it enters a scene) and whenever /roam toggles. */
  protected resetRoam(): void {
    this.clearRoamEmote();
    this.roamPhase = 'explore'; this.roamWalking = false; this.roamUntil = 0;
  }

  /** Stop roaming and clear any roam emote (used when manual input takes over). */
  protected stopRoam(): void { setRoaming(false); this.clearRoamEmote(); }

  // Show / hide a roam emote, broadcasting it like a normal /emote so others see it.
  private triggerRoamEmote(name: string): void {
    if (this.roamEmote === name) return;
    this.clearRoamEmote();
    this.emoteSet.start(name);
    sendChat(`/emote ${name}_on`);
    this.roamEmote = name;
  }
  private clearRoamEmote(): void {
    if (!this.roamEmote) return;
    const name = this.roamEmote; this.roamEmote = null;
    this.emoteSet.stop(name);
    sendChat(`/emote ${name}_off`);
  }

  /** Autopilot horizontal velocity for the /roam easter egg this frame, or null when
   *  not roaming / scene doesn't participate. Strolls deep into the scene, rests there
   *  (with restEmote if set — e.g. 🤔 at the dock), turns back to the exit edge (which
   *  the scene's own edge check uses to transition), and naps (💤) on the odd pause. */
  protected roamVX(): number | null {
    if (!isRoaming() || !this.roamConfig) return null;
    const x = this.getPlayerSprite().x;
    const { deepX, exitX, restEmote } = this.roamConfig;
    const now = this.time.now;

    // Reached the far point → linger here (longer pause + rest emote) before heading back.
    if (this.roamPhase === 'explore' && Math.abs(x - deepX) <= 12) {
      this.roamPhase = 'exit';
      this.roamWalking = false;
      this.roamUntil = now + 2400 + Math.random() * 2600;
      if (restEmote && Math.random() < 0.4) this.triggerRoamEmote(restEmote); // 🤔 only sometimes
      return 0;
    }

    if (now >= this.roamUntil) { // alternate walk / brief pause for a natural stroll
      this.roamWalking = !this.roamWalking;
      if (this.roamWalking) {
        this.clearRoamEmote(); // moving again
        this.roamUntil = now + 2600 + Math.random() * 3400;
      } else {
        this.roamUntil = now + 600 + Math.random() * 1600;
        if (Math.random() < 0.18) this.triggerRoamEmote('zzz'); // occasional nap on a pause
      }
    }
    if (!this.roamWalking) return 0;
    const target = this.roamPhase === 'explore' ? deepX : exitX;
    return Math.sign(target - x) * PLAYER_SPEED;
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
          this.chatUI.addMessage('system', ti18n('sys.room.unknown', { name: arg }), P.amber);
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

      // ── Dev-only: mint a whole item set for testing (stripped from prod builds) ──
      // Usage: /devset            → list set ids + your progress
      //        /devset night_shift → mint every missing item of that set
      // Goes through the REAL pipeline (server mint → relay event → inventory →
      // entitlement recompute), so possession-based rewards are tested end-to-end.
      // NOTE: scene-drop room rules apply — mint fish sets while standing in the woods.
      case 'devset': {
        if (!import.meta.env.DEV) return false; // unknown command in production
        import('../stores/tradeItemStore').then(({ ITEM_SETS, getInventory, getSetProgress }) => {
          if (!arg) {
            const lines = ITEM_SETS.map(s => { const p = getSetProgress(s); return `${s.id.replace(/^set_/, '')} ${p.owned}/${p.total}`; });
            this.chatUI.addMessage('system', `devset: ${lines.join(' · ')}`, P.amber);
            return;
          }
          const set = ITEM_SETS.find(s => s.id === arg || s.id === `set_${arg}`);
          if (!set) { this.chatUI.addMessage('system', `devset: no set "${arg}"`, P.amber); return; }
          const owned = new Set(getInventory().map(i => i.itemId));
          const missing = set.itemIds.filter(id => !owned.has(id));
          if (!missing.length) { this.chatUI.addMessage('system', `devset: "${set.name}" already complete`, P.amber); return; }
          import('../nostr/presenceService').then(({ sendItemMintRequest }) => {
            missing.forEach((id, i) => setTimeout(() => sendItemMintRequest(id, 'caught'), i * 250));
          });
          this.chatUI.addMessage('system', `devset: minting ${missing.length} item(s) for "${set.name}"… (fish need the woods)`, P.amber);
        });
        return true;
      }

      // Usage: /devitem hol_black_cat     → mint 1 copy
      //        /devitem hol_black_cat 2   → mint 2 copies (e.g. bounty wants 2×)
      // Dev-only like devset; prod's server rejects raw mints regardless.
      case 'devitem': {
        if (!import.meta.env.DEV) return false; // unknown command in production
        const [itemId, countStr] = (arg ?? '').split(/\s+/);
        const count = Math.min(10, Math.max(1, parseInt(countStr) || 1));
        import('../stores/tradeItemStore').then(({ ITEM_CATALOG }) => {
          const def = ITEM_CATALOG.find(d => d.id === itemId);
          if (!def) { this.chatUI.addMessage('system', `devitem: no item "${itemId}" (use catalog ids, e.g. hol_black_cat)`, P.amber); return; }
          import('../nostr/presenceService').then(({ sendItemMintRequest }) => {
            for (let i = 0; i < count; i++) setTimeout(() => sendItemMintRequest(def.id, 'caught'), i * 250);
          });
          this.chatUI.addMessage('system', `devitem: minting ${count}× ${def.emoji} ${def.name}`, P.amber);
        });
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
        if (!canUseDMs()) { this.chatUI.addMessage('system', ti18n('sys.dm.need_key'), P.amber); return true; }
        if (!arg) { this.crewPanel.close(); this.dmPanel.toggle(); return true; }
        const openDM = (pk: string) => {
          this.crewPanel.close();
          this.dmPanel.open(pk);
          this.chatUI.addMessage('system', ti18n('sys.dm.opening'), ac);
        };
        // /dm <npub|nprofile> — open a conversation with anyone, even if they're
        // not in the room. Decoded via dynamic import (require() isn't available
        // in the ESM bundle).
        if (arg.startsWith('npub1') || arg.startsWith('nprofile1')) {
          import('nostr-tools').then(({ nip19 }) => {
            try {
              const d = nip19.decode(arg);
              const pk = d.type === 'npub' ? d.data as string
                       : d.type === 'nprofile' ? (d.data as { pubkey: string }).pubkey
                       : null;
              if (!pk) throw new Error('not a pubkey');
              openDM(pk);
            } catch { this.chatUI.addMessage('system', 'Invalid npub', P.amber); }
          });
          return true;
        }
        // /dm <name> — find matching player in scene and open conversation
        let target: string | null = null;
        this.otherPlayers.forEach((o, pk) => {
          const name = (o.name ?? o.nameText?.text ?? '').toLowerCase();
          if (name.includes(arg.toLowerCase())) target = pk;
        });
        if (target) openDM(target);
        else this.chatUI.addMessage('system', ti18n('sys.not_found', { name: arg }), P.amber);
        return true;
      }

      // ── Moderation ────────────────────────────────────────────────────────
      case 'mute': {
        const s = toggleMute();
        this.chatUI.addMessage('system', s ? ti18n('sys.muted') : ti18n('sys.unmuted'), s ? P.amber : ac);
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

      // ── /roam (easter egg) — auto-stroll the hub ↔ woods loop until you move ──
      case 'roam': {
        // Only scenes that set roamConfig (Hub, Woods) participate. Gating the toggle
        // here stops /roam arming the global flag in the cabin/alley and then kicking
        // in the moment you step back into the Hub or Woods.
        if (!this.roamConfig) {
          this.chatUI.addMessage('system', ti18n('sys.roam.here'), ac);
          return true;
        }
        const on = toggleRoaming();
        this.resetRoam();
        this.chatUI.addMessage('system', ti18n(on ? 'sys.roam.on' : 'sys.roam.off'), ac);
        return true;
      }

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

      // ── Bazaar (item trading market) ──────────────────────────────────────
      case 'bazaar': case 'bag': case 'items': case 'inv': case 'inventory':
        bazaarPanel.open();
        return true;

      // ── Wallet ───────────────────────────────────────────────────────────
      case 'wallet': case 'sats': case 'lightning':
        WalletPanel.toggle();
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
    // Free every per-player avatar texture (global — not released by sprite.destroy()),
    // otherwise each scene transition leaks one canvas per nearby player.
    const _texPrefix = this.getOtherPlayerConfig().texKeyPrefix;
    const _freeTex = (pk: string) => { const k = `${_texPrefix}${pk}`; if (this.textures.exists(k)) this.textures.remove(k); };
    // Cancel any in-flight fade-out tweens and destroy their objects
    this.dyingSprites.forEach((o, pk) => {
      this.tweens.killTweensOf([o.sprite, o.nameText, o.statusText]);
      o.sprite.destroy(); o.nameText.destroy(); o.statusText.destroy(); if (o.clickZone) o.clickZone.destroy();
      _freeTex(pk);
    });
    this.dyingSprites.clear();
    // Destroy all remaining live other-player objects
    this.otherPlayers.forEach((o, pk) => {
      o.sprite.destroy(); o.nameText.destroy(); o.statusText.destroy(); if (o.clickZone) o.clickZone.destroy();
      _freeTex(pk);
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
    this._localAuraFw?.destroy();
    this._localAuraFw = null;
    this._localAuraType = '';
    this._auraLastX = NaN;
    this._otherAuraMap.forEach(e => { e.emitter?.destroy(); e.fw?.destroy(); });
    this._otherAuraMap.clear();
    this._localHandSparkler?.destroy();
    this._localHandSparkler = null;
    this._otherSparklerMap.forEach(hs => hs.destroy());
    this._otherSparklerMap.clear();
    this._localOstrich?.destroy();
    this._localOstrich = null;
    this._otherOstrichMap.forEach(op => op.destroy());
    this._otherOstrichMap.clear();
    // Drop the cached cursor keys: Phaser reuses the scene instance across transitions
    // but rebuilds the keyboard plugin, so the cached objects become stale and can report
    // a held key forever (auto-walk after re-entering a scene). Recreated lazily next time.
    this._cursors = undefined;
    this._otherStillMap.clear();
    this._localEyeL?.destroy();
    this._localEyeR?.destroy();
    this._localEyeL = null;
    this._localEyeR = null;
    this._localEyeType = '';
    this._otherEyeMap.forEach(e => { e.left.destroy(); e.right.destroy(); });
    this._otherEyeMap.clear();
    this._otherEyeColorStepMap.clear();
    this._otherEyeMotionStepMap.clear();
    this._localEyeColorStep = -1;
    this._localEyeMotionStep = -1;
  }
}

/**
 * CabinScene.ts — Cozy log cabin interior
 *
 * Entered from WoodsScene by pressing [E] at the cabin door.
 * Press [E] near the left door to return to the woods.
 * Warm amber fireplace, bookshelves, table, and a window with moonlight.
 */

import Phaser from 'phaser';
import { GAME_HEIGHT, GROUND_Y, PLAYER_SPEED, P, hexToNum } from '../config/game.config';
import {
  setPresenceCallbacks, sendPosition, sendChat, sendRoomChange,
  setRoomRequestHandler, setRoomGrantedHandler, setRoomDeniedHandler, setRoomKickHandler,
  requestOnlinePlayers, setOnlinePlayersHandler, sendAvatarUpdate, sendNameUpdate,
} from '../nostr/presenceService';
import { shouldFilter, toggleMute, addBannedWord, removeBannedWord, getCustomBannedWords } from '../nostr/moderationService';
import { canUseDMs } from '../nostr/dmService';
import { DMPanel } from '../ui/DMPanel';
import { ChatUI } from '../ui/ChatUI';
import { FollowsPanel } from '../ui/FollowsPanel';
import { showPlayerMenu, destroyPlayerMenu, mutedPlayers } from '../ui/PlayerMenu';
import { ProfileModal } from '../ui/ProfileModal';
import { ZapModal } from '../ui/ZapModal';
import { SmokeEmote } from '../entities/SmokeEmote';
import { SettingsPanel } from '../ui/SettingsPanel';
import { renderHubSprite } from '../entities/AvatarRenderer';
import { deserializeAvatar, getDefaultAvatar, getAvatar } from '../stores/avatarStore';
import { authStore } from '../stores/authStore';
import { SoundEngine } from '../audio/SoundEngine';
import { ComputerUI } from '../ui/ComputerUI';
import { MuteList } from '../ui/MuteList';
import { PlayerPicker } from '../ui/PlayerPicker';

const CABIN_ACCENT = '#f0a030';
const W = 1000;             // cabin world width
const FLOOR_Y = GROUND_Y;  // 340
const DOOR_X  = 76;        // left exit door center x
const FP_X    = 870;       // fireplace center x
const FP_Y    = FLOOR_Y - 14;

interface Ember { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; }

interface OtherPlayer {
  sprite: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  targetX: number; targetY: number;
  name: string; avatar?: string; status?: string;
  clickZone?: Phaser.GameObjects.Zone;
  smoke?: SmokeEmote;
}

export class CabinScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Image;
  private playerName!: Phaser.GameObjects.Text;
  private playerStatusText!: Phaser.GameObjects.Text;
  private targetX: number | null = null;
  private isMoving = false;
  private isKeyboardMoving = false;
  private facingRight = true;
  private playerY = FLOOR_Y + 8;
  private walkTime = 0;
  private walkFrame = 0;
  private footTimer = 0;

  private otherPlayers = new Map<string, OtherPlayer>();
  private dyingSprites  = new Map<string, OtherPlayer>();

  private chatUI!: ChatUI;
  private dmPanel!: DMPanel;
  private followsPanel!: FollowsPanel;
  private settingsPanel = new SettingsPanel();
  private smokeGraphics!: Phaser.GameObjects.Graphics;
  private smokeEmote = new SmokeEmote();
  private snd = SoundEngine.get();
  private computerUI = new ComputerUI();
  private muteList = new MuteList();
  private playerPicker = new PlayerPicker();
  private isLeavingScene = false;

  private fireplaceGraphics!: Phaser.GameObjects.Graphics;
  private smokeLayerGraphics!: Phaser.GameObjects.Graphics;
  private embers: Ember[] = [];

  private nearDoor = false;
  private doorPromptBg!: Phaser.GameObjects.Graphics;
  private doorPromptText!: Phaser.GameObjects.Text;
  private doorPromptArrow!: Phaser.GameObjects.Text;

  constructor() { super({ key: 'CabinScene' }); }
  init(): void { this.smokeEmote.stop(); this.isLeavingScene = false; }

  // ══════════════════════════════════════════════════════════════════
  // CREATE
  // ══════════════════════════════════════════════════════════════════
  create(): void {
    this.renderBackground();
    this.add.image(W / 2, GAME_HEIGHT / 2, 'cabin_bg').setDepth(-1);

    this.fireplaceGraphics  = this.add.graphics().setDepth(3);
    this.smokeLayerGraphics = this.add.graphics().setDepth(15);
    this.smokeGraphics      = this.add.graphics().setDepth(15);

    this.createPlayer();
    this.cameras.main.setBounds(0, 0, W, GAME_HEIGHT);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setDeadzone(80, 50);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const wx = this.cameras.main.scrollX + p.x;
      if (p.y < FLOOR_Y - 10 || p.y > 455) return;
      this.targetX = Phaser.Math.Clamp(wx, DOOR_X + 10, W - 20);
      this.isMoving = true;
    });

    const myPubkey = this.registry.get('playerPubkey');
    this.snd.setRoom('cabin');
    this.chatUI = new ChatUI();
    const chatInput = this.chatUI.create('Chat in the cabin...', CABIN_ACCENT, (cmd) => this.handleCommand(cmd));
    this.chatUI.setNameClickHandler((pubkey, name) => { const op = this.otherPlayers.get(pubkey); ProfileModal.show(pubkey, name, op?.avatar, op?.status); });
    this.input.keyboard?.on('keydown-ENTER', () => { if (document.activeElement !== chatInput) chatInput.focus(); });

    this.dmPanel = this.registry.get('dmPanel') as DMPanel;
    if (!this.dmPanel) { this.dmPanel = new DMPanel(myPubkey); this.registry.set('dmPanel', this.dmPanel); }
    this.input.keyboard?.on('keydown-M', () => { if (document.activeElement === this.chatUI.getInput()) return; this.dmPanel.toggle(); });

    let rfp = this.registry.get('followsPanel') as FollowsPanel | undefined;
    if (!rfp) { rfp = new FollowsPanel(); this.registry.set('followsPanel', rfp); }
    this.followsPanel = rfp;
    this.input.keyboard?.on('keydown-G', () => { if (document.activeElement === this.chatUI.getInput()) return; this.followsPanel.toggle(); });
    this.input.keyboard?.on('keydown-S', () => { if (document.activeElement === this.chatUI.getInput()) return; this.settingsPanel.toggle(); });
    this.input.keyboard?.on('keydown-T', () => { if (document.activeElement === this.chatUI.getInput()) return; if (this.computerUI.isOpen()) { this.computerUI.close(); } else { this.computerUI.open(undefined, (newName) => { this.registry.set('playerName', newName); this.playerName?.setText(newName); sendNameUpdate(newName); }, undefined, undefined, undefined, undefined, ['profile']); } });
    this.input.keyboard?.on('keydown-U', () => { if (document.activeElement === this.chatUI.getInput()) return; this.muteList.toggle(); });

    // Door exit prompt
    this.doorPromptBg = this.add.graphics().setDepth(50).setVisible(false);
    this.doorPromptBg.fillStyle(0x080502, 0.9); this.doorPromptBg.fillRoundedRect(0, 0, 138, 28, 5);
    this.doorPromptBg.lineStyle(1, 0x6a3c10, 0.6); this.doorPromptBg.strokeRoundedRect(0, 0, 138, 28, 5);
    this.doorPromptText = this.add.text(0, 0, this.sys.game.device.input.touch ? '[TAP] Back to Woods' : '[E] Back to Woods', { fontFamily: '"Courier New", monospace', fontSize: '10px', color: CABIN_ACCENT, fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.doorPromptArrow = this.add.text(0, 0, '▼', { fontFamily: 'monospace', fontSize: '9px', color: CABIN_ACCENT }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.doorPromptBg.setInteractive(new Phaser.Geom.Rectangle(0, 0, 138, 28), Phaser.Geom.Rectangle.Contains);
    this.doorPromptBg.on('pointerdown', () => { if (this.nearDoor && !this.isLeavingScene) { this.isLeavingScene = true; this.leaveToWoods(); } });
    this.input.keyboard?.on('keydown-E', () => {
      if (document.activeElement === this.chatUI.getInput()) return;
      if (this.nearDoor && !this.isLeavingScene) { this.isLeavingScene = true; this.leaveToWoods(); }
    });
    this.input.keyboard?.on('keydown-ESC', () => {
      if (document.activeElement === this.chatUI.getInput()) return;
      if (this.playerPicker.isOpen()) { this.playerPicker.close(); return; }
      if (!this.isLeavingScene) { this.isLeavingScene = true; this.leaveToWoods(); }
    });

    setPresenceCallbacks({
      onPlayerJoin: (p) => { if (p.pubkey === myPubkey || this.otherPlayers.has(p.pubkey)) return; this.addOtherPlayer(p.pubkey, p.name, p.x, p.y, (p as any).avatar, (p as any).status); sendAvatarUpdate(); },
      onPlayerMove: (pk, x, y) => { const o = this.otherPlayers.get(pk); if (o) { o.targetX = x; o.targetY = y; } },
      onPlayerLeave: (pk) => this.removeOtherPlayer(pk),
      onCountUpdate: () => {},
      onChat: (pk, name, text) => {
        const isMe = pk === myPubkey;
        if (!isMe && text === '/emote smoke_on') { const o = this.otherPlayers.get(pk); if (o) { if (!o.smoke) o.smoke = new SmokeEmote(); o.smoke.start(); ChatUI.showBubble(this, o.sprite.x, o.sprite.y - 48, '*lights a cigarette*', P.dpurp); } if (!mutedPlayers.has(pk)) this.chatUI.addMessage(name, '*lights a cigarette*', P.dpurp, pk); return; }
        if (!isMe && text === '/emote smoke_off') { const o = this.otherPlayers.get(pk); if (o?.smoke) o.smoke.stop(); return; }
        if (isMe && text.startsWith('/emote ')) return;
        if (!isMe && mutedPlayers.has(pk)) return;
        if (!isMe && shouldFilter(text)) return;
        this.chatUI.addMessage(name, text, isMe ? CABIN_ACCENT : P.lpurp, pk);
        if (!isMe && !this.chatUI.isFocused()) this.snd.chatPing();
        if (isMe) ChatUI.showBubble(this, this.player.x, this.player.y - 48, text, CABIN_ACCENT);
        else { const o = this.otherPlayers.get(pk); if (o) ChatUI.showBubble(this, o.sprite.x, o.sprite.y - 48, text, P.lpurp); }
      },
      onAvatarUpdate: (pk, avatarStr) => { const o = this.otherPlayers.get(pk); if (!o) return; o.avatar = avatarStr; const cfg = deserializeAvatar(avatarStr) || getDefaultAvatar(); const texKey = `avatar_hub_${pk}`; if (this.textures.exists(texKey)) this.textures.remove(texKey); this.textures.addCanvas(texKey, renderHubSprite(cfg)); o.sprite.setTexture(texKey).setTint(0xffffff); },
      onNameUpdate: (pk, name) => { const o = this.otherPlayers.get(pk); if (o) { o.nameText.setText(name.slice(0, 14)); o.name = name; } },
      onStatusUpdate: (pk, status) => { const o = this.otherPlayers.get(pk); if (o) { o.status = status; o.statusText.setText(status.slice(0, 30)); o.statusText.setAlpha(status ? 1 : 0); } },
    });
    sendRoomChange('cabin', 140, this.playerY);
    requestOnlinePlayers();
    setOnlinePlayersHandler((players) => { players.forEach(p => { if (p.pubkey === myPubkey || this.otherPlayers.has(p.pubkey)) return; this.addOtherPlayer(p.pubkey, p.name, (p as any).x ?? 300, (p as any).y ?? this.playerY, (p as any).avatar, (p as any).status); }); });

    const unsubProfile = authStore.subscribe(() => { const n = authStore.getState().displayName; if (n && n !== this.registry.get('playerName')) { this.registry.set('playerName', n); this.playerName?.setText(n); sendNameUpdate(n); } });
    this.cameras.main.fadeIn(350, 4, 2, 0);
    this.settingsPanel.create();

    this.events.on('shutdown', () => {
      unsubProfile(); this.chatUI.destroy(); this.settingsPanel.destroy(); this.computerUI.close(); this.muteList.destroy(); this.playerPicker.close();
      if (this.dmPanel) this.dmPanel.close(); if (this.followsPanel) this.followsPanel.close();
      destroyPlayerMenu(); ProfileModal.destroy();
      this.doorPromptBg?.destroy(); this.doorPromptText?.destroy(); this.doorPromptArrow?.destroy();
      this.otherPlayers.forEach(o => { o.sprite.destroy(); o.nameText.destroy(); o.statusText.destroy(); if (o.clickZone) o.clickZone.destroy(); });
      this.otherPlayers.clear();
      setRoomRequestHandler(null); setRoomKickHandler(null); setRoomGrantedHandler(null); setRoomDeniedHandler(null);
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // BACKGROUND
  // ══════════════════════════════════════════════════════════════════
  private renderBackground(): void {
    const c = document.createElement('canvas'); c.width = W; c.height = GAME_HEIGHT;
    const x = c.getContext('2d')!; x.imageSmoothingEnabled = false;
    const r = (ax: number, ay: number, aw: number, ah: number, col: string) => { x.fillStyle = col; x.fillRect(ax, ay, aw, ah); };

    // Upper wall / back wall — warm dark wood
    const wg = x.createLinearGradient(0, 0, 0, FLOOR_Y);
    wg.addColorStop(0, '#0e0a04'); wg.addColorStop(0.35, '#141008'); wg.addColorStop(0.8, '#1c1610'); wg.addColorStop(1, '#221a12');
    x.fillStyle = wg; x.fillRect(0, 0, W, FLOOR_Y);

    // Log wall horizontal grain lines
    x.globalAlpha = 0.3;
    for (let ly = 14; ly < FLOOR_Y - 10; ly += 13) { r(0, ly, W, 2, '#1e1608'); r(0, ly + 2, W, 1, '#2c2210'); }
    x.globalAlpha = 1;

    // Ceiling beams
    for (let bx = 60; bx < W; bx += 180) {
      r(bx, 0, 22, Math.floor(FLOOR_Y * 0.45), '#0e0a04');
      r(bx + 1, 0, 3, Math.floor(FLOOR_Y * 0.45), '#161208');
      r(bx + 19, 0, 2, Math.floor(FLOOR_Y * 0.45), '#0a0804');
    }

    // ── Left wall (solid, to the left of the door) ──
    r(0, 0, DOOR_X - 20, GAME_HEIGHT, '#0e0a04');
    r(DOOR_X - 20, 0, 4, GAME_HEIGHT, '#181208');

    // ── Exit door (left side) ──
    const dW = 34, dH = 56;
    const dX = DOOR_X - dW / 2;
    r(dX - 3, FLOOR_Y - dH - 3, dW + 6, 3, '#2e2010'); // top frame
    r(dX - 3, FLOOR_Y - dH - 3, 3, dH + 3, '#2e2010'); // left frame
    r(dX + dW, FLOOR_Y - dH - 3, 3, dH + 3, '#2e2010'); // right frame
    r(dX, FLOOR_Y - dH, dW, dH, '#1a1008');
    r(dX + 1, FLOOR_Y - dH + 1, dW - 2, dH - 2, '#211608');
    r(dX + dW - 10, FLOOR_Y - dH / 2 - 2, 5, 5, '#4a3018'); // handle
    // Small window in door (hint of forest outside)
    r(dX + 7, FLOOR_Y - dH + 8, dW - 14, 18, '#040c14');
    r(dX + 7, FLOOR_Y - dH + 8, dW - 14, 1, '#0a1218');
    r(dX + 7 + (dW - 14) / 2 - 1, FLOOR_Y - dH + 8, 1, 18, '#0a1218');
    r(dX + 7, FLOOR_Y - dH + 17, dW - 14, 1, '#0a1218');
    // Faint green light hinting forest beyond
    x.globalAlpha = 0.12; r(dX + 7, FLOOR_Y - dH + 8, dW - 14, 18, '#1a4010'); x.globalAlpha = 1;

    // ── Wall lantern above door ──
    const lnX = DOOR_X, lnY = FLOOR_Y - dH - 28;
    // Glow
    x.globalAlpha = 0.18; x.fillStyle = '#f0a030';
    x.beginPath(); x.arc(lnX, lnY + 6, 22, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 0.09; x.beginPath(); x.arc(lnX, lnY + 6, 36, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;
    // Bracket arm
    r(lnX - 1, lnY - 10, 2, 10, '#2a1c0c');
    r(lnX - 4, lnY - 10, 8, 2, '#2a1c0c');
    // Lantern frame
    r(lnX - 5, lnY, 10, 14, '#1a1008');
    r(lnX - 4, lnY + 1, 8, 12, '#f0a030');   // amber glow pane
    r(lnX - 5, lnY - 1, 10, 2, '#2a1c0c');   // top cap
    r(lnX - 5, lnY + 13, 10, 2, '#2a1c0c');  // bottom cap
    r(lnX - 5, lnY, 2, 14, '#2a1c0c');       // left edge
    r(lnX + 3, lnY, 2, 14, '#2a1c0c');       // right edge

    // ── Bookshelves (left of center) ──
    const shX = 200, shW = 54, shRows = 3;
    r(shX - 3, FLOOR_Y - 82, shW + 6, 82, '#1a1208');
    r(shX - 3, FLOOR_Y - 84, shW + 6, 3, '#2e2010'); // top
    for (let row = 0; row < shRows; row++) {
      const shelfY = FLOOR_Y - 18 - row * 22;
      r(shX - 3, shelfY, shW + 6, 3, '#2e2010'); // shelf board
      // Books
      let bx2 = shX + 2;
      while (bx2 < shX + shW - 3) {
        const bkW = 4 + Math.floor(Math.random() * 5);
        const bkH = 11 + Math.floor(Math.random() * 7);
        const bkCol = ['#3a1808','#0a2030','#1a1030','#2a1a04','#183020','#300a20','#202818'][Math.floor(Math.random() * 7)];
        r(bx2, shelfY - bkH, bkW, bkH, bkCol);
        x.globalAlpha = 0.35; r(bx2, shelfY - bkH, bkW, 2, '#ffffff'); x.globalAlpha = 1;
        bx2 += bkW + 1;
      }
    }

    // ── Window (center, moonlight) ──
    const winX = 480, winY = FLOOR_Y - 78, winW = 48, winH = 52;
    r(winX, winY, winW, winH, '#040c14');
    r(winX - 3, winY - 3, winW + 6, 3, '#2e2010'); r(winX - 3, winY + winH, winW + 6, 3, '#2e2010');
    r(winX - 3, winY - 3, 3, winH + 6, '#2e2010'); r(winX + winW, winY - 3, 3, winH + 6, '#2e2010');
    r(winX + winW / 2 - 1, winY, 2, winH, '#2e2010'); r(winX, winY + winH / 2 - 1, winW, 2, '#2e2010');
    // Moonlight beam
    x.globalAlpha = 0.06; x.fillStyle = '#b0c8e0';
    x.beginPath(); x.moveTo(winX, winY); x.lineTo(winX + winW, winY); x.lineTo(winX + winW + 60, FLOOR_Y + 30); x.lineTo(winX - 60, FLOOR_Y + 30); x.closePath(); x.fill(); x.globalAlpha = 1;

    // ── Table & chairs ──
    const tabX = 620, tabY = FLOOR_Y;
    // Table — top raised to match chair seat height
    r(tabX - 36, tabY - 30, 72, 7, '#2e2010');
    r(tabX - 34, tabY - 23, 68, 3, '#3a2810');
    r(tabX - 30, tabY - 23, 7, 23, '#241808');
    r(tabX + 23, tabY - 23, 7, 23, '#241808');
    // Left chair
    r(tabX - 62, tabY - 16, 24, 5, '#2e2010');                          // seat
    r(tabX - 60, tabY - 11, 4, 11, '#241808'); r(tabX - 42, tabY - 11, 4, 11, '#241808'); // front legs to floor
    r(tabX - 62, tabY - 30, 24, 4, '#2e2010');                          // back rail
    r(tabX - 62, tabY - 30, 2, 14, '#241808'); r(tabX - 40, tabY - 30, 2, 14, '#241808'); // back uprights (rail to seat only)
    // Right chair
    r(tabX + 38, tabY - 16, 24, 5, '#2e2010');                          // seat
    r(tabX + 40, tabY - 11, 4, 11, '#241808'); r(tabX + 58, tabY - 11, 4, 11, '#241808'); // front legs to floor
    r(tabX + 38, tabY - 30, 24, 4, '#2e2010');                          // back rail
    r(tabX + 38, tabY - 30, 2, 14, '#241808'); r(tabX + 60, tabY - 30, 2, 14, '#241808'); // back uprights (rail to seat only)
    // Candle on table (raised with table)
    r(tabX - 4, tabY - 42, 7, 13, '#ddd0a0');
    r(tabX - 3, tabY - 31, 5, 2, '#a09060');
    x.globalAlpha = 0.12; x.fillStyle = '#f8c040';
    x.beginPath(); x.arc(tabX, tabY - 44, 22, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;

    // ── Fireplace (right side) ──
    const fpX = FP_X, fpW = 88, fpH = 90;
    // Stone surround
    r(fpX - fpW / 2, FLOOR_Y - fpH, fpW, fpH, '#1c1810');
    // Stone texture
    x.globalAlpha = 0.5;
    for (let sy = FLOOR_Y - fpH + 4; sy < FLOOR_Y - 12; sy += 9) {
      const off = Math.floor((sy - (FLOOR_Y - fpH)) / 9) % 2 === 0 ? 0 : 11;
      for (let sx = fpX - fpW / 2 + off; sx < fpX + fpW / 2; sx += 22) {
        r(sx, sy, 20, 7, ['#221c0e', '#1e180c', '#261e10'][Math.floor(Math.random() * 3)]);
        r(sx, sy + 7, 20, 1, '#0e0a06');
      }
    }
    x.globalAlpha = 1;
    // Mantel
    r(fpX - fpW / 2 - 6, FLOOR_Y - fpH - 6, fpW + 12, 8, '#2e2410');
    r(fpX - fpW / 2 - 8, FLOOR_Y - fpH - 8, fpW + 16, 4, '#3a2c14');
    // Firebox opening
    r(fpX - 26, FLOOR_Y - fpH + 14, 52, fpH - 16, '#08080a');
    // Ash tray
    r(fpX - 24, FLOOR_Y - 10, 48, 8, '#141210');
    // Warm glow cast on floor
    x.globalAlpha = 0.08; x.fillStyle = '#f08030';
    x.beginPath(); x.arc(fpX, FLOOR_Y + 20, 80, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;

    // ── Mantel decorations ──
    // Small bottle left of center
    r(fpX - 28, FLOOR_Y - fpH - 14, 6, 8, '#1a2830'); r(fpX - 27, FLOOR_Y - fpH - 16, 4, 3, '#141e24');
    // Tiny candle on mantel
    r(fpX - 8, FLOOR_Y - fpH - 12, 4, 6, '#d8c890'); r(fpX - 7, FLOOR_Y - fpH - 13, 2, 2, '#a09060');
    // Small trophy/skull on right of mantel
    r(fpX + 18, FLOOR_Y - fpH - 14, 8, 8, '#2a2018'); r(fpX + 20, FLOOR_Y - fpH - 13, 4, 4, '#1a1410');

    // ── Antler mount above fireplace ──
    const antY = FLOOR_Y - fpH - 24;
    r(fpX - 2, antY, 4, 10, '#2a1c0c');            // center post
    // Left antler
    r(fpX - 14, antY + 2, 12, 3, '#2a1c0c');
    r(fpX - 18, antY - 4, 4, 8, '#2a1c0c');
    r(fpX - 24, antY - 8, 3, 6, '#2a1c0c');
    // Right antler
    r(fpX + 2, antY + 2, 12, 3, '#2a1c0c');
    r(fpX + 14, antY - 4, 4, 8, '#2a1c0c');
    r(fpX + 21, antY - 8, 3, 6, '#2a1c0c');

    // ── Coat peg near door ──
    r(DOOR_X + 26, FLOOR_Y - 100, 3, 6, '#2a1c0c');   // peg
    // Hat on peg
    r(DOOR_X + 20, FLOOR_Y - 102, 16, 4, '#1a1008');  // brim
    r(DOOR_X + 23, FLOOR_Y - 110, 10, 9, '#1a1008');  // crown

    // ── Barrel in right corner ──
    const barX = W - 80, barY = FLOOR_Y;
    r(barX, barY - 30, 22, 30, '#2a1808');             // body
    r(barX - 1, barY - 32, 24, 4, '#1a1008');          // top ring
    r(barX - 1, barY - 18, 24, 3, '#1a1008');          // mid ring
    r(barX - 1, barY - 4, 24, 3, '#1a1008');           // bottom ring
    r(barX + 2, barY - 28, 18, 24, '#321e0c');         // lighter face

    // ── Right wall ──
    r(W - 50, 0, 50, GAME_HEIGHT, '#0e0a04');
    r(W - 54, 0, 4, GAME_HEIGHT, '#181208');

    // ── Floor ──
    const fg = x.createLinearGradient(0, FLOOR_Y, 0, GAME_HEIGHT);
    fg.addColorStop(0, '#2c1e0c'); fg.addColorStop(0.3, '#28190a'); fg.addColorStop(1, '#1e1408');
    x.fillStyle = fg; x.fillRect(0, FLOOR_Y, W, GAME_HEIGHT - FLOOR_Y);
    // Plank lines
    for (let fy2 = FLOOR_Y + 4; fy2 < GAME_HEIGHT; fy2 += 20) { r(0, fy2, W, 2, '#221608'); r(0, fy2 + 2, W, 1, '#332010'); }
    // Vertical seams
    x.globalAlpha = 0.18;
    for (let px2 = 55; px2 < W; px2 += 55 + Math.floor(Math.random() * 30)) { r(px2, FLOOR_Y, 1, GAME_HEIGHT - FLOOR_Y, '#141008'); }
    x.globalAlpha = 1;

    // Rug (center, from table to fireplace)
    const rugX = tabX - 80, rugW = 320;
    x.globalAlpha = 0.55; r(rugX, FLOOR_Y + 2, rugW, 24, '#280e0e'); r(rugX + 6, FLOOR_Y + 4, rugW - 12, 18, '#3c1616'); r(rugX + 12, FLOOR_Y + 6, rugW - 24, 12, '#280e0e');
    x.globalAlpha = 0.4;
    for (let ri = 0; ri < rugW; ri += 24) { r(rugX + ri, FLOOR_Y + 4, 2, 4, '#5a2020'); r(rugX + ri, FLOOR_Y + 20, 2, 4, '#5a2020'); }
    x.globalAlpha = 1;

    // Vignette
    const vg = x.createRadialGradient(W / 2, GAME_HEIGHT / 2, W * 0.1, W / 2, GAME_HEIGHT / 2, W * 0.55);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    x.fillStyle = vg; x.fillRect(0, 0, W, GAME_HEIGHT);

    if (this.textures.exists('cabin_bg')) this.textures.remove('cabin_bg');
    this.textures.addCanvas('cabin_bg', c);
  }

  // ══════════════════════════════════════════════════════════════════
  // UPDATE
  // ══════════════════════════════════════════════════════════════════
  update(time: number, delta: number): void {
    this.updateMovement();
    this.updateFireplace(time, delta);
    this.updateDoorProximity();

    const isWalking = this.isKeyboardMoving || this.isMoving || this.targetX !== null;
    if (isWalking) {
      this.footTimer += delta; if (this.footTimer >= 300) { this.footTimer = 0; this.snd.footstep(); }
      this.walkTime += delta;
      this.player.y = this.playerY + Math.abs(Math.sin(this.walkTime * Math.PI / 150)) * -2;
      const nf = Math.floor(this.walkTime / 150) % 2;
      if (nf !== this.walkFrame) { this.walkFrame = nf; this.player.setTexture(`player_walk${this.walkFrame}`); }
    } else { this.walkTime = 0; if (this.walkFrame !== 0) { this.walkFrame = 0; this.player.setTexture('player'); } this.player.y = this.playerY; }

    this.smokeGraphics.clear();
    if (this.smokeEmote.active) { if (isWalking) this.smokeEmote.stop(); else this.smokeEmote.update(this.smokeGraphics, delta, this.player.x, this.player.y, this.facingRight, 'hub'); }

    this.playerName.setPosition(this.player.x, this.player.y - 68);
    this.playerStatusText.setPosition(this.player.x, this.player.y - 80);
    sendPosition(this.player.x, this.player.y);

    this.otherPlayers.forEach(o => {
      if (Math.abs(o.targetX - o.sprite.x) > 1) o.sprite.x += (o.targetX - o.sprite.x) * 0.12;
      if (Math.abs(o.targetY - o.sprite.y) > 1) o.sprite.y += (o.targetY - o.sprite.y) * 0.12;
      o.nameText.setPosition(o.sprite.x, o.sprite.y - 44); o.statusText.setPosition(o.sprite.x, o.sprite.y - 59);
      if (o.clickZone) o.clickZone.setPosition(o.sprite.x, o.sprite.y - 20);
      if (o.smoke?.active) o.smoke.update(this.smokeGraphics, delta, o.sprite.x, o.sprite.y, true, 'hub');
      o.sprite.y = Math.abs(o.targetX - o.sprite.x) > 3 ? this.playerY + Math.abs(Math.sin(time * Math.PI / 150)) * -2 : this.playerY;
    });
  }

  private updateMovement(): void {
    const c = this.input.keyboard?.createCursorKeys(); let vx = 0;
    if (c) { if (c.left.isDown) vx = -PLAYER_SPEED; else if (c.right.isDown) vx = PLAYER_SPEED; }
    this.isKeyboardMoving = vx !== 0;
    if (vx !== 0) { this.targetX = null; this.isMoving = false; this.player.x += vx / 60; this.facingRight = vx > 0; }
    else if (this.isMoving && this.targetX !== null) { const dx = this.targetX - this.player.x; if (Math.abs(dx) < 3) { this.isMoving = false; this.targetX = null; } else { this.player.x += Math.sign(dx) * PLAYER_SPEED / 60; this.facingRight = dx > 0; } }
    this.player.x = Phaser.Math.Clamp(this.player.x, DOOR_X + 8, W - 52);
    this.player.setFlipX(!this.facingRight);
  }

  // ══════════════════════════════════════════════════════════════════
  // FIREPLACE
  // ══════════════════════════════════════════════════════════════════
  private updateFireplace(time: number, delta: number): void {
    this.fireplaceGraphics.clear();
    const fx = FP_X, fy = FP_Y;
    const gp = 0.05 + Math.sin(time * 0.003) * 0.012;
    this.fireplaceGraphics.fillStyle(0xf08030, gp * 1.4); this.fireplaceGraphics.fillCircle(fx, fy, 28);
    this.fireplaceGraphics.fillStyle(0xe85030, gp * 0.8); this.fireplaceGraphics.fillCircle(fx, fy, 16);
    const fc = [0xf0a040, 0xe87030, 0xe85030, 0xfac060, 0xffe040];
    for (let i = 0; i < 6; i++) { const ox = Math.sin(time * 0.005 + i * 1.3) * 4, fh = 8 + Math.sin(time * 0.008 + i * 0.9) * 4 + Math.random() * 3, fw = 2 + Math.random() * 2.5, bx = fx - 8 + i * 3 + ox, a = 0.4 + Math.sin(time * 0.006 + i * 1.4) * 0.2; this.fireplaceGraphics.fillStyle(fc[i % fc.length], a); this.fireplaceGraphics.fillRect(bx - fw / 2, fy - fh, fw, fh); this.fireplaceGraphics.fillStyle(0xfac060, a * 0.5); this.fireplaceGraphics.fillRect(bx - 1, fy - fh * 0.6, 2, fh * 0.45); }
    this.fireplaceGraphics.fillStyle(0xf0a040, 0.25 + Math.sin(time * 0.004) * 0.08); this.fireplaceGraphics.fillRect(fx - 9, fy - 2, 18, 4);
    if (Math.random() > 0.7) this.embers.push({ x: fx + (Math.random() - 0.5) * 10, y: fy - 6 - Math.random() * 4, vx: (Math.random() - 0.5) * 0.5, vy: -0.3 - Math.random() * 0.4, life: 0, maxLife: 500 + Math.random() * 700, size: 1 + Math.random() });
    const dt = delta / 16;
    for (let i = this.embers.length - 1; i >= 0; i--) { const e = this.embers[i]; e.x += e.vx * dt; e.y += e.vy * dt; e.vx += (Math.random() - 0.5) * 0.02; e.life += delta; const p = e.life / e.maxLife; if (p >= 1) { this.embers.splice(i, 1); continue; } const a = p < 0.2 ? p / 0.2 : (1 - p) / 0.8; this.fireplaceGraphics.fillStyle(p < 0.5 ? 0xfac060 : 0xf0a040, a * 0.65); this.fireplaceGraphics.fillRect(e.x, e.y, e.size, e.size); }
    if (this.embers.length > 25) this.embers = this.embers.slice(-18);
    // Smoke puffs rising up the chimney
    for (let s = 0; s < 3; s++) { const sx = fx + Math.sin(time * 0.002 + s * 2) * 6, sy = fy - 20 - s * 12 - Math.sin(time * 0.003 + s) * 4; this.smokeLayerGraphics.clear(); this.smokeLayerGraphics.fillStyle(0xaaaaaa, 0.025 - s * 0.007); this.smokeLayerGraphics.fillRect(sx - 3, sy - 2, 6, 4); }
  }

  // ══════════════════════════════════════════════════════════════════
  // DOOR PROXIMITY
  // ══════════════════════════════════════════════════════════════════
  private updateDoorProximity(): void {
    const near = Math.abs(this.player.x - DOOR_X) < 44;
    if (near !== this.nearDoor) {
      this.nearDoor = near;
      this.doorPromptBg.setVisible(near); this.doorPromptText.setVisible(near); this.doorPromptArrow.setVisible(near);
      if (!near) this.tweens.killTweensOf(this.doorPromptArrow);
    }
    if (near) {
      const px = DOOR_X, py = FLOOR_Y - 100;
      this.doorPromptBg.setPosition(px - 69, py - 2);
      this.doorPromptText.setPosition(px, py + 8);
      this.doorPromptArrow.setPosition(px, py + 22);
      if (!this.tweens.isTweening(this.doorPromptArrow)) {
        this.tweens.add({ targets: this.doorPromptArrow, y: py + 27, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // PLAYER
  // ══════════════════════════════════════════════════════════════════
  private createPlayer(): void {
    const avatar = getAvatar();
    if (this.textures.exists('player_walk0')) this.textures.remove('player_walk0');
    if (this.textures.exists('player_walk1')) this.textures.remove('player_walk1');
    this.textures.addCanvas('player_walk0', renderHubSprite(avatar, 0));
    this.textures.addCanvas('player_walk1', renderHubSprite(avatar, 1));
    this.player = this.add.image(140, this.playerY, 'player').setOrigin(0.5, 1).setScale(1.5).setDepth(10);
    const name = this.registry.get('playerName') || 'guest';
    this.playerName = this.add.text(this.player.x, this.playerY - 68, name, { fontFamily: '"Courier New", monospace', fontSize: '9px', color: CABIN_ACCENT, align: 'center', backgroundColor: '#04081088', padding: { x: 3, y: 1 } }).setOrigin(0.5).setDepth(11);
    const ms = localStorage.getItem('nd_status') || '';
    this.playerStatusText = this.add.text(this.player.x, this.playerY - 80, ms, { fontFamily: '"Courier New", monospace', fontSize: '8px', color: P.lpurp, align: 'center' }).setOrigin(0.5).setDepth(11).setAlpha(ms ? 1 : 0);
  }

  // ══════════════════════════════════════════════════════════════════
  // LEAVE
  // ══════════════════════════════════════════════════════════════════
  private leaveToWoods(): void {
    this.snd.roomLeave(); sendRoomChange('woods');
    this.chatUI.destroy();
    this.cameras.main.fadeOut(300, 4, 2, 0);
    this.time.delayedCall(300, () => { if (!this.scene.isActive()) return; this.scene.start('WoodsScene', { fromCabin: true }); });
  }

  // ══════════════════════════════════════════════════════════════════
  // OTHER PLAYERS
  // ══════════════════════════════════════════════════════════════════
  private addOtherPlayer(pk: string, name: string, px: number, py: number, avatarStr?: string, status?: string): void {
    const dying = this.dyingSprites.get(pk); if (dying) { this.tweens.killTweensOf([dying.sprite, dying.nameText, dying.statusText]); dying.sprite.destroy(); dying.nameText.destroy(); dying.statusText.destroy(); if (dying.clickZone) dying.clickZone.destroy(); this.dyingSprites.delete(pk); }
    const texKey = `avatar_hub_${pk}`; const cfg = avatarStr ? (deserializeAvatar(avatarStr) || getDefaultAvatar()) : getDefaultAvatar();
    if (this.textures.exists(texKey)) this.textures.remove(texKey); this.textures.addCanvas(texKey, renderHubSprite(cfg));
    const sp = this.add.image(px, py, texKey).setOrigin(0.5, 1).setScale(1.5).setDepth(8);
    if (!avatarStr) { const h = name.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0); sp.setTint([0xe87aab, 0x7b68ee, 0x5dcaa5, 0xfad480, 0xb8a8f8][h % 5]); }
    const nt = this.add.text(px, py - 68, name.slice(0, 14), { fontFamily: '"Courier New", monospace', fontSize: '9px', color: CABIN_ACCENT, align: 'center', backgroundColor: '#04081088', padding: { x: 3, y: 1 } }).setOrigin(0.5).setDepth(9);
    const ss = (status || '').slice(0, 30); const st = this.add.text(px, py - 80, ss, { fontFamily: '"Courier New", monospace', fontSize: '8px', color: P.lpurp, align: 'center' }).setOrigin(0.5).setDepth(9).setAlpha(ss ? 1 : 0);
    const cz = this.add.zone(px, py - 28, 40, 60).setInteractive({ useHandCursor: true }).setDepth(12);
    cz.on('pointerdown', (ptr: Phaser.Input.Pointer) => { ptr.event.stopPropagation(); const op2 = this.otherPlayers.get(pk); showPlayerMenu(pk, name.slice(0, 14), ptr.x, ptr.y, { onChat: (t, c) => this.chatUI.addMessage('system', t, c), getDMPanel: () => this.dmPanel }, op2?.avatar, op2?.status); });
    this.otherPlayers.set(pk, { sprite: sp, nameText: nt, statusText: st, targetX: px, targetY: py, name, avatar: avatarStr, status: status || '', clickZone: cz });
  }

  private removeOtherPlayer(pk: string): void {
    const o = this.otherPlayers.get(pk); if (!o) return; this.otherPlayers.delete(pk); this.dyingSprites.set(pk, o);
    this.tweens.add({ targets: [o.sprite, o.nameText, o.statusText], alpha: 0, duration: 300, onComplete: () => { o.sprite.destroy(); o.nameText.destroy(); o.statusText.destroy(); if (o.clickZone) o.clickZone.destroy(); this.dyingSprites.delete(pk); } });
  }

  // ══════════════════════════════════════════════════════════════════
  // COMMANDS
  // ══════════════════════════════════════════════════════════════════
  private handleCommand(text: string): void {
    const parts = text.slice(1).split(' '); const cmd = parts[0].toLowerCase(); const arg = parts.slice(1).join(' ').trim();
    switch (cmd) {
      case 'leave': case 'exit': case 'outside': { if (!this.isLeavingScene) { this.isLeavingScene = true; this.leaveToWoods(); } break; }
      case 'tp': case 'teleport': case 'go': { if (!arg) { this.chatUI.addMessage('system', 'Rooms: hub, woods, relay, feed, myroom, lounge, market, cabin', CABIN_ACCENT); return; } const al: Record<string, string> = { hub: 'hub', woods: 'woods', cabin: 'cabin', relay: 'relay', feed: 'feed', thefeed: 'feed', myroom: 'myroom', room: 'picker', lounge: 'lounge', rooftop: 'lounge', market: 'market', shop: 'market', store: 'market' }; const rid = al[arg.toLowerCase().replace(/\s+/g, '')]; if (rid === 'woods') { if (!this.isLeavingScene) { this.isLeavingScene = true; this.leaveToWoods(); } return; } if (rid === 'cabin') { this.chatUI.addMessage('system', 'Already in the cabin!', CABIN_ACCENT); return; } if (rid === 'hub') { if (!this.isLeavingScene) { this.isLeavingScene = true; sendRoomChange('hub'); this.chatUI.destroy(); this.cameras.main.fadeOut(300, 10, 0, 20); this.time.delayedCall(300, () => { if (!this.scene.isActive()) return; this.scene.start('HubScene', { _returning: true }); }); } return; } if (rid === 'myroom') { const pk = this.registry.get('playerPubkey'); const n = this.registry.get('playerName') || 'My Room'; sendRoomChange('hub'); this.chatUI.destroy(); this.scene.start('RoomScene', { id: `myroom:${pk}`, name: `${n}'s Room`, neonColor: P.teal, ownerPubkey: pk }); return; } if (rid === 'picker') { const pk = this.registry.get('playerPubkey'); const n = this.registry.get('playerName') || 'My Room'; this.playerPicker.open(pk, n, () => { sendRoomChange('hub'); this.chatUI.destroy(); this.scene.start('RoomScene', { id: `myroom:${pk}`, name: `${n}'s Room`, neonColor: P.teal, ownerPubkey: pk }); }, (opk) => { sendRoomChange(opk); this.chatUI.addMessage('system', 'Requesting access...', CABIN_ACCENT); }); return; } if (rid) { sendRoomChange('hub'); this.chatUI.destroy(); this.scene.start('RoomScene', { id: rid, name: rid.charAt(0).toUpperCase() + rid.slice(1), neonColor: P.teal }); return; } this.chatUI.addMessage('system', `Unknown room "${arg}"`, P.amber); break; }
      case 'dm': { if (!canUseDMs()) { this.chatUI.addMessage('system', 'DMs need a key', P.amber); return; } if (!arg) { const ps: string[] = []; this.otherPlayers.forEach(o => ps.push(o.name)); this.chatUI.addMessage('system', ps.length ? `Online: ${ps.join(', ')}` : 'No players here', CABIN_ACCENT); return; } let tp: string | null = null; this.otherPlayers.forEach((o, pk) => { if (o.name?.toLowerCase().includes(arg.toLowerCase())) tp = pk; }); if (tp) { this.dmPanel.open(tp); this.chatUI.addMessage('system', 'Opening DM...', CABIN_ACCENT); } else this.chatUI.addMessage('system', `"${arg}" not found`, P.amber); break; }
      case 'zap': { if (!arg) { this.chatUI.addMessage('system', 'Usage: /zap <name>', CABIN_ACCENT); return; } const za = authStore.getState(); if (!za.pubkey || za.isGuest) { this.chatUI.addMessage('system', 'Login to zap', P.amber); return; } let zt: string | null = null; let zn = arg; this.otherPlayers.forEach((o, pk) => { if (o.name?.toLowerCase().includes(arg.toLowerCase())) { zt = pk; zn = o.name; } }); if (!zt) { this.chatUI.addMessage('system', `"${arg}" not found`, P.amber); return; } ZapModal.show(zt, zn); break; }
      case 'smoke': { if (this.smokeEmote.active) { this.smokeEmote.stop(); this.chatUI.addMessage('system', 'Put it out', P.dpurp); sendChat('/emote smoke_off'); } else { this.smokeEmote.start(); this.snd.lighterFlick(); ChatUI.showBubble(this, this.player.x, this.player.y - 48, '*lights a cigarette*', P.dpurp); sendChat('/emote smoke_on'); } break; }
      case 'players': case 'who': case 'online': { const ps: string[] = []; this.otherPlayers.forEach(o => ps.push(o.name)); this.chatUI.addMessage('system', ps.length ? `${ps.length} here: ${ps.join(', ')}` : 'No other players', CABIN_ACCENT); break; }
      case 'follows': case 'following': case 'friends': { this.followsPanel.toggle(); break; }
      case 'mute': { const s = toggleMute(); this.chatUI.addMessage('system', s ? 'Muted' : 'Unmuted', s ? P.amber : CABIN_ACCENT); break; }
      case 'filter': { if (!arg) { const w = getCustomBannedWords(); this.chatUI.addMessage('system', w.length ? `Filtered: ${w.join(', ')}` : 'No filters', CABIN_ACCENT); return; } addBannedWord(arg); this.chatUI.addMessage('system', `Added "${arg}"`, CABIN_ACCENT); break; }
      case 'unfilter': { if (!arg) return; removeBannedWord(arg); this.chatUI.addMessage('system', `Removed "${arg}"`, CABIN_ACCENT); break; }
      case 'terminal': case 'wardrobe': case 'avatar': { if (this.computerUI.isOpen()) { this.computerUI.close(); return; } this.computerUI.open(undefined, (newName) => { this.registry.set('playerName', newName); this.playerName?.setText(newName); sendNameUpdate(newName); }, undefined, undefined, undefined, undefined, ['profile']); break; }
      case 'help': case '?': { this.chatUI.addMessage('system', 'Commands:', CABIN_ACCENT); ['/tp <room>', '/leave', '/dm <n>', '/zap <name>', '/smoke', '/terminal', '/players', '/follows', '/mute', '/filter <w>'].forEach(h => this.chatUI.addMessage('system', h, P.lpurp)); break; }
      default: this.chatUI.addMessage('system', `Unknown: /${cmd}`, P.amber);
    }
    this.chatUI.flashLog();
  }
}

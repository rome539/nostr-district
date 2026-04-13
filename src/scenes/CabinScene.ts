/**
 * CabinScene.ts — Cozy log cabin interior
 *
 * Entered from WoodsScene by pressing [E] at the cabin door.
 * Press [E] near the left door to return to the woods.
 * Warm amber fireplace, bookshelves, table, and a window with moonlight.
 */

import Phaser from 'phaser';
import { BaseScene } from './BaseScene';
import { getStatus } from '../stores/statusStore';
import { onNextAvatarSync } from '../nostr/nostrService';
import { GAME_HEIGHT, GROUND_Y, PLAYER_SPEED, P, hexToNum } from '../config/game.config';
import {
  sendPosition, sendChat, sendRoomChange,
} from '../nostr/presenceService';
import { canUseDMs } from '../nostr/dmService';
import { ChatUI } from '../ui/ChatUI';
import { ProfileModal } from '../ui/ProfileModal';
import { ZapModal } from '../ui/ZapModal';
import { renderHubSprite } from '../entities/AvatarRenderer';
import { getAvatar } from '../stores/avatarStore';
import { authStore } from '../stores/authStore';

const CABIN_ACCENT = '#f0a030';
const W = 1000;             // cabin world width
const FLOOR_Y = GROUND_Y;  // 340
const DOOR_X  = 76;        // left exit door center x
const FP_X    = 870;       // fireplace center x
const FP_Y    = FLOOR_Y - 14;

interface Ember { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; }

export class CabinScene extends BaseScene {
  private player!: Phaser.GameObjects.Image;

  private fireplaceGraphics!: Phaser.GameObjects.Graphics;
  private smokeLayerGraphics!: Phaser.GameObjects.Graphics;
  private embers: Ember[] = [];

  private nearDoor = false;
  private doorPromptBg!: Phaser.GameObjects.Graphics;
  private doorPromptText!: Phaser.GameObjects.Text;
  private doorPromptArrow!: Phaser.GameObjects.Text;

  private nearFireplace = false;
  private stokedTimer = 0;
  private fireplacePromptBg!: Phaser.GameObjects.Graphics;
  private fireplacePromptText!: Phaser.GameObjects.Text;
  private fireplacePromptArrow!: Phaser.GameObjects.Text;

  private nearBookshelf = false;
  private bookshelfPromptBg!: Phaser.GameObjects.Graphics;
  private bookshelfPromptText!: Phaser.GameObjects.Text;
  private bookshelfPromptArrow!: Phaser.GameObjects.Text;
  private bookOverlay: HTMLElement | null = null;

  constructor() { super({ key: 'CabinScene' }); }
  init(): void { super.init(); }

  // ══════════════════════════════════════════════════════════════════
  // CREATE
  // ══════════════════════════════════════════════════════════════════
  create(): void {
    this.renderBackground();
    this.add.image(W / 2, GAME_HEIGHT / 2, 'cabin_bg').setDepth(-1);

    this.fireplaceGraphics  = this.add.graphics().setDepth(3);
    this.smokeLayerGraphics = this.add.graphics().setDepth(15);
    this.emoteGraphics      = this.add.graphics().setDepth(15);

    this.createPlayer();
    onNextAvatarSync(() => {
      const av = getAvatar();
      if (this.textures.exists('player_walk0')) this.textures.remove('player_walk0');
      if (this.textures.exists('player_walk1')) this.textures.remove('player_walk1');
      this.textures.addCanvas('player_walk0', renderHubSprite(av, 0));
      this.textures.addCanvas('player_walk1', renderHubSprite(av, 1));
      if (this.textures.exists('player')) this.textures.remove('player');
      this.textures.addCanvas('player', renderHubSprite(av));
      this.player?.setTexture('player');
    });
    this.cameras.main.setBounds(0, 0, W, GAME_HEIGHT);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setDeadzone(80, 50);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if ((p.event.target as HTMLElement)?.tagName !== 'CANVAS') return;
      const wx = this.cameras.main.scrollX + p.x;
      if (p.y < FLOOR_Y - 10 || p.y > 455) return;
      this.targetX = Phaser.Math.Clamp(wx, 20, W - 20);
      this.isMoving = true;
    });

    const myPubkey = this.registry.get('playerPubkey');
    this.snd.setRoom('cabin');
    this.chatUI = new ChatUI();
    this.chatInput = this.chatUI.create('Chat in the cabin...', CABIN_ACCENT, (cmd) => this.handleCommand(cmd));
    this.chatUI.setNameClickHandler((pubkey, name) => { const op = this.otherPlayers.get(pubkey); ProfileModal.show(pubkey, name, op?.avatar, op?.status); });

    this.setupRegistryPanels(myPubkey);
    this.setupCommonKeyboardHandlers();

    // Door exit prompt
    this.doorPromptBg = this.add.graphics().setDepth(50).setVisible(false);
    this.doorPromptBg.fillStyle(0x080502, 0.9); this.doorPromptBg.fillRoundedRect(0, 0, 138, 28, 5);
    this.doorPromptBg.lineStyle(1, 0x6a3c10, 0.6); this.doorPromptBg.strokeRoundedRect(0, 0, 138, 28, 5);
    this.doorPromptText = this.add.text(0, 0, this.sys.game.device.input.touch ? '[TAP] Back to Woods' : '[E] Back to Woods', { fontFamily: '"Courier New", monospace', fontSize: '10px', color: CABIN_ACCENT, fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.doorPromptArrow = this.add.text(0, 0, '▼', { fontFamily: 'monospace', fontSize: '9px', color: CABIN_ACCENT }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.doorPromptBg.setInteractive(new Phaser.Geom.Rectangle(0, 0, 138, 28), Phaser.Geom.Rectangle.Contains);
    this.doorPromptBg.on('pointerdown', () => {
      if (document.querySelector('.dm-panel.dm-open, .cp-panel.cp-open, .cp-modal-overlay')) return;
      if (this.nearDoor && !this.isLeavingScene) { this.isLeavingScene = true; this.leaveToWoods(); }
    });

    // Fireplace prompt
    this.fireplacePromptBg = this.add.graphics().setDepth(50).setVisible(false);
    this.fireplacePromptBg.fillStyle(0x080302, 0.9); this.fireplacePromptBg.fillRoundedRect(0, 0, 138, 28, 5);
    this.fireplacePromptBg.lineStyle(1, 0x6a3010, 0.6); this.fireplacePromptBg.strokeRoundedRect(0, 0, 138, 28, 5);
    this.fireplacePromptText = this.add.text(0, 0, '[E] Stoke the fire', { fontFamily: '"Courier New", monospace', fontSize: '10px', color: CABIN_ACCENT, fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.fireplacePromptArrow = this.add.text(0, 0, '▼', { fontFamily: 'monospace', fontSize: '9px', color: CABIN_ACCENT }).setOrigin(0.5).setDepth(51).setVisible(false);

    // Bookshelf prompt
    this.bookshelfPromptBg = this.add.graphics().setDepth(50).setVisible(false);
    this.bookshelfPromptBg.fillStyle(0x080302, 0.9); this.bookshelfPromptBg.fillRoundedRect(0, 0, 138, 28, 5);
    this.bookshelfPromptBg.lineStyle(1, 0x3a2010, 0.6); this.bookshelfPromptBg.strokeRoundedRect(0, 0, 138, 28, 5);
    this.bookshelfPromptText = this.add.text(0, 0, '[E] Read a book', { fontFamily: '"Courier New", monospace', fontSize: '10px', color: CABIN_ACCENT, fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.bookshelfPromptArrow = this.add.text(0, 0, '▼', { fontFamily: 'monospace', fontSize: '9px', color: CABIN_ACCENT }).setOrigin(0.5).setDepth(51).setVisible(false);

    this.input.keyboard?.on('keydown-E', () => {
      if (document.activeElement === this.chatInput) return;
      if (document.querySelector('.dm-panel.dm-open, .cp-panel.cp-open, .cp-modal-overlay')) return;
      if (this.bookOverlay) { this.closeBookOverlay(); return; }
      if (this.nearDoor && !this.isLeavingScene) { this.isLeavingScene = true; this.leaveToWoods(); return; }
      if (this.nearFireplace && this.stokedTimer <= 0) { this.stokedTimer = 5000; this.snd.stokeFireplace(); sendChat('/stoke'); return; }
      if (this.nearBookshelf) { this.showBookQuote(); return; }
    });
    this.setupEscHandler();
    this.setupPresenceCallbacks(myPubkey);
    sendRoomChange('cabin', 140, this.playerY);
    this.setupRoomRequestHandlers();
    // Room-scoped player list arrives via the server's 'players' response to sendRoomChange.
    // Do NOT call requestOnlinePlayers() here — it returns all rooms and would ghost-populate the cabin.

    this.setupProfileSubscription();
    this.cameras.main.fadeIn(350, 4, 2, 0);
    this.settingsPanel.create();

    this.events.on('shutdown', () => {
      this.shutdownCommonPanels();
      this.doorPromptBg?.destroy(); this.doorPromptText?.destroy(); this.doorPromptArrow?.destroy();
      this.fireplacePromptBg?.destroy(); this.fireplacePromptText?.destroy(); this.fireplacePromptArrow?.destroy();
      this.bookshelfPromptBg?.destroy(); this.bookshelfPromptText?.destroy(); this.bookshelfPromptArrow?.destroy();
      if (this.bookOverlay) { this.bookOverlay.remove(); this.bookOverlay = null; }
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
    const dW = 46, dH = 75;
    const dX = DOOR_X - dW / 2;
    r(dX - 3, FLOOR_Y - dH - 3, dW + 6, 3, '#2e2010'); // top frame
    r(dX - 3, FLOOR_Y - dH - 3, 3, dH + 3, '#2e2010'); // left frame
    r(dX + dW, FLOOR_Y - dH - 3, 3, dH + 3, '#2e2010'); // right frame
    r(dX, FLOOR_Y - dH, dW, dH, '#1a1008');
    r(dX + 1, FLOOR_Y - dH + 1, dW - 2, dH - 2, '#211608');
    r(dX + dW - 13, FLOOR_Y - dH / 2 - 3, 7, 7, '#4a3018'); // handle
    // Small window in door (hint of forest outside)
    r(dX + 9, FLOOR_Y - dH + 11, dW - 18, 24, '#040c14');
    r(dX + 9, FLOOR_Y - dH + 11, dW - 18, 1, '#0a1218');
    r(dX + 9 + (dW - 18) / 2 - 1, FLOOR_Y - dH + 11, 1, 24, '#0a1218');
    r(dX + 9, FLOOR_Y - dH + 23, dW - 18, 1, '#0a1218');
    // Faint green light hinting forest beyond
    x.globalAlpha = 0.12; r(dX + 9, FLOOR_Y - dH + 11, dW - 18, 24, '#1a4010'); x.globalAlpha = 1;

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
    const winX = 480, winY = FLOOR_Y - 96, winW = 64, winH = 70;
    r(winX, winY, winW, winH, '#040c14');
    r(winX - 3, winY - 3, winW + 6, 3, '#2e2010'); r(winX - 3, winY + winH, winW + 6, 3, '#2e2010');
    r(winX - 3, winY - 3, 3, winH + 6, '#2e2010'); r(winX + winW, winY - 3, 3, winH + 6, '#2e2010');
    r(winX + winW / 2 - 1, winY, 2, winH, '#2e2010'); r(winX, winY + winH / 2 - 1, winW, 2, '#2e2010');
    // Moonlight beam
    x.globalAlpha = 0.06; x.fillStyle = '#b0c8e0';
    x.beginPath(); x.moveTo(winX, winY); x.lineTo(winX + winW, winY); x.lineTo(winX + winW + 80, FLOOR_Y + 30); x.lineTo(winX - 80, FLOOR_Y + 30); x.closePath(); x.fill(); x.globalAlpha = 1;

    // ── Table & chairs ──
    const tabX = 620, tabY = FLOOR_Y;
    // Table — top raised to match chair seat height
    r(tabX - 48, tabY - 40, 96, 9, '#2e2010');
    r(tabX - 46, tabY - 31, 92, 4, '#3a2810');
    r(tabX - 40, tabY - 31, 9, 31, '#241808');
    r(tabX + 31, tabY - 31, 9, 31, '#241808');
    // Left chair
    r(tabX - 82, tabY - 21, 32, 7, '#2e2010');                          // seat
    r(tabX - 80, tabY - 14, 5, 14, '#241808'); r(tabX - 56, tabY - 14, 5, 14, '#241808'); // front legs to floor
    r(tabX - 82, tabY - 40, 32, 5, '#2e2010');                          // back rail
    r(tabX - 82, tabY - 40, 3, 19, '#241808'); r(tabX - 54, tabY - 40, 3, 19, '#241808'); // back uprights (rail to seat only)
    // Right chair
    r(tabX + 50, tabY - 21, 32, 7, '#2e2010');                          // seat
    r(tabX + 53, tabY - 14, 5, 14, '#241808'); r(tabX + 75, tabY - 14, 5, 14, '#241808'); // front legs to floor
    r(tabX + 50, tabY - 40, 32, 5, '#2e2010');                          // back rail
    r(tabX + 50, tabY - 40, 3, 19, '#241808'); r(tabX + 79, tabY - 40, 3, 19, '#241808'); // back uprights (rail to seat only)
    // Candle on table (raised with table)
    r(tabX - 5, tabY - 56, 9, 17, '#ddd0a0');
    r(tabX - 4, tabY - 39, 7, 3, '#a09060');
    x.globalAlpha = 0.12; x.fillStyle = '#f8c040';
    x.beginPath(); x.arc(tabX, tabY - 59, 29, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;

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
    r(DOOR_X + 35, FLOOR_Y - 130, 4, 8, '#2a1c0c');   // peg
    // Hat on peg
    r(DOOR_X + 27, FLOOR_Y - 133, 21, 5, '#1a1008');  // brim
    r(DOOR_X + 31, FLOOR_Y - 146, 13, 12, '#1a1008'); // crown

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
    if (this.stokedTimer > 0) this.stokedTimer = Math.max(0, this.stokedTimer - delta);
    this.updateFireplace(time, delta);
    this.updateDoorProximity();
    this.updateFireplaceProximity();
    this.updateBookshelfProximity();

    const isWalking = this.isKeyboardMoving || this.isMoving || this.targetX !== null;
    if (isWalking) {
      this.footTimer += delta; if (this.footTimer >= 300) { this.footTimer = 0; this.snd.footstep(); }
      this.walkTime += delta;
      this.player.y = this.playerY + Math.abs(Math.sin(this.walkTime * Math.PI / 150)) * -2;
      const nf = Math.floor(this.walkTime / 150) % 2;
      if (nf !== this.walkFrame) { this.walkFrame = nf; this.player.setTexture(`player_walk${this.walkFrame}`); }
    } else { this.walkTime = 0; if (this.walkFrame !== 0) { this.walkFrame = 0; this.player.setTexture('player'); } this.player.y = this.playerY; }

    this.emoteGraphics.clear();
    this.emoteSet.updateAll(this.emoteGraphics, delta, this.player.x, this.player.y, this.facingRight, 'cabin', isWalking);
    this.player.setAlpha(this.emoteSet.isActive('ghost') ? 0.3 : 1);

    this.playerName.setPosition(this.player.x, this.player.y - 90);
    this.playerStatusText.setPosition(this.player.x, this.player.y - 102);
    sendPosition(this.player.x, this.player.y, this.facingRight);

    this.updateOtherPlayers(time, delta);
  }

  private updateMovement(): void {
    const CABIN_SPEED = PLAYER_SPEED * 1.5;
    const c = this.input.keyboard?.createCursorKeys(); let vx = 0;
    if (c) { if (c.left.isDown) vx = -CABIN_SPEED; else if (c.right.isDown) vx = CABIN_SPEED; }
    this.isKeyboardMoving = vx !== 0;
    if (vx !== 0) { this.targetX = null; this.isMoving = false; this.player.x += vx / 60; this.facingRight = vx > 0; }
    else if (this.isMoving && this.targetX !== null) { const dx = this.targetX - this.player.x; if (Math.abs(dx) < 3) { this.isMoving = false; this.targetX = null; } else { this.player.x += Math.sign(dx) * CABIN_SPEED / 60; this.facingRight = dx > 0; } }
    this.player.x = Phaser.Math.Clamp(this.player.x, 20, W - 52);
    this.player.setFlipX(!this.facingRight);
  }

  // ══════════════════════════════════════════════════════════════════
  // FIREPLACE
  // ══════════════════════════════════════════════════════════════════
  private updateFireplace(time: number, delta: number): void {
    this.fireplaceGraphics.clear();
    const fx = FP_X, fy = FP_Y;
    const stoked = this.stokedTimer > 0;
    const stokeT = stoked ? Math.min(1, this.stokedTimer / 800) : 0; // 0–1 fade in/out
    const gp = 0.05 + Math.sin(time * 0.003) * 0.012;
    const gpS = stoked ? gp * (2.8 + stokeT * 1.2) : gp;
    const glowR = stoked ? 42 + stokeT * 16 : 28;
    this.fireplaceGraphics.fillStyle(0xf08030, gpS * 1.4); this.fireplaceGraphics.fillCircle(fx, fy, glowR);
    this.fireplaceGraphics.fillStyle(0xe85030, gpS * 0.8); this.fireplaceGraphics.fillCircle(fx, fy, glowR * 0.58);
    const fc = [0xf0a040, 0xe87030, 0xe85030, 0xfac060, 0xffe040];
    const flameCount = stoked ? 10 : 6;
    const flameH = stoked ? 16 + stokeT * 10 : 0;
    for (let i = 0; i < flameCount; i++) { const ox = Math.sin(time * 0.005 + i * 1.3) * (stoked ? 7 : 4), fh = (stoked ? flameH : 8) + Math.sin(time * 0.008 + i * 0.9) * 4 + Math.random() * 3, fw = 2 + Math.random() * 2.5, bx = fx - (stoked ? 14 : 8) + i * (stoked ? 3 : 3) + ox, a = 0.4 + Math.sin(time * 0.006 + i * 1.4) * 0.2; this.fireplaceGraphics.fillStyle(fc[i % fc.length], a); this.fireplaceGraphics.fillRect(bx - fw / 2, fy - fh, fw, fh); this.fireplaceGraphics.fillStyle(0xfac060, a * 0.5); this.fireplaceGraphics.fillRect(bx - 1, fy - fh * 0.6, 2, fh * 0.45); }
    this.fireplaceGraphics.fillStyle(0xf0a040, 0.25 + Math.sin(time * 0.004) * 0.08); this.fireplaceGraphics.fillRect(fx - 9, fy - 2, 18, 4);
    const emberThresh = stoked ? 0.3 : 0.7;
    if (Math.random() > emberThresh) this.embers.push({ x: fx + (Math.random() - 0.5) * (stoked ? 18 : 10), y: fy - 6 - Math.random() * 4, vx: (Math.random() - 0.5) * (stoked ? 1.2 : 0.5), vy: -0.3 - Math.random() * (stoked ? 1.0 : 0.4), life: 0, maxLife: 500 + Math.random() * 700, size: 1 + Math.random() });
    const dt = delta / 16;
    for (let i = this.embers.length - 1; i >= 0; i--) { const e = this.embers[i]; e.x += e.vx * dt; e.y += e.vy * dt; e.vx += (Math.random() - 0.5) * 0.02; e.life += delta; const p = e.life / e.maxLife; if (p >= 1) { this.embers.splice(i, 1); continue; } const a = p < 0.2 ? p / 0.2 : (1 - p) / 0.8; this.fireplaceGraphics.fillStyle(p < 0.5 ? 0xfac060 : 0xf0a040, a * 0.65); this.fireplaceGraphics.fillRect(e.x, e.y, e.size, e.size); }
    if (this.embers.length > (stoked ? 60 : 25)) this.embers = this.embers.slice(stoked ? -50 : -18);
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
      const px = DOOR_X, py = FLOOR_Y - 120;
      this.doorPromptBg.setPosition(px - 69, py - 2);
      this.doorPromptText.setPosition(px, py + 8);
      this.doorPromptArrow.setPosition(px, py + 22);
      if (!this.tweens.isTweening(this.doorPromptArrow)) {
        this.tweens.add({ targets: this.doorPromptArrow, y: py + 27, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // FIREPLACE PROXIMITY
  // ══════════════════════════════════════════════════════════════════
  private updateFireplaceProximity(): void {
    const near = Math.abs(this.player.x - FP_X) < 62;
    if (near !== this.nearFireplace) {
      this.nearFireplace = near;
      const vis = near && this.stokedTimer <= 0;
      this.fireplacePromptBg.setVisible(vis); this.fireplacePromptText.setVisible(vis); this.fireplacePromptArrow.setVisible(vis);
      if (!near) this.tweens.killTweensOf(this.fireplacePromptArrow);
    }
    // Hide prompt while stoked
    const showPrompt = near && this.stokedTimer <= 0;
    if (this.fireplacePromptBg.visible !== showPrompt) {
      this.fireplacePromptBg.setVisible(showPrompt); this.fireplacePromptText.setVisible(showPrompt); this.fireplacePromptArrow.setVisible(showPrompt);
      if (!showPrompt) this.tweens.killTweensOf(this.fireplacePromptArrow);
    }
    if (showPrompt) {
      const px = FP_X, py = FLOOR_Y - 120;
      this.fireplacePromptBg.setPosition(px - 69, py - 2);
      this.fireplacePromptText.setPosition(px, py + 8);
      this.fireplacePromptArrow.setPosition(px, py + 22);
      if (!this.tweens.isTweening(this.fireplacePromptArrow)) {
        this.tweens.add({ targets: this.fireplacePromptArrow, y: py + 27, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // BOOKSHELF PROXIMITY
  // ══════════════════════════════════════════════════════════════════
  private updateBookshelfProximity(): void {
    const shCX = 227; // center of shelf (shX=200, shW=54)
    const near = Math.abs(this.player.x - shCX) < 56;
    if (near !== this.nearBookshelf) {
      this.nearBookshelf = near;
      this.bookshelfPromptBg.setVisible(near); this.bookshelfPromptText.setVisible(near); this.bookshelfPromptArrow.setVisible(near);
      if (!near) this.tweens.killTweensOf(this.bookshelfPromptArrow);
    }
    if (near) {
      const px = shCX, py = FLOOR_Y - 120;
      this.bookshelfPromptBg.setPosition(px - 69, py - 2);
      this.bookshelfPromptText.setPosition(px, py + 8);
      this.bookshelfPromptArrow.setPosition(px, py + 22);
      if (!this.tweens.isTweening(this.bookshelfPromptArrow)) {
        this.tweens.add({ targets: this.bookshelfPromptArrow, y: py + 27, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // BOOK QUOTE OVERLAY
  // ══════════════════════════════════════════════════════════════════
  private showBookQuote(): void {
    if (this.bookOverlay) return;
    const QUOTES = [
      { text: "A reader lives a thousand lives before he dies. The man who never reads lives only one.", author: "George R.R. Martin" },
      { text: "Not all those who wander are lost.", author: "J.R.R. Tolkien" },
      { text: "There is no friend as loyal as a book.", author: "Ernest Hemingway" },
      { text: "A book is a dream that you hold in your hands.", author: "Neil Gaiman" },
      { text: "The world is a book, and those who do not travel read only one page.", author: "Augustine of Hippo" },
      { text: "To live is the rarest thing in the world. Most people exist, that is all.", author: "Oscar Wilde" },
      { text: "I am not afraid of storms, for I am learning how to sail my ship.", author: "Louisa May Alcott" },
      { text: "The cave you fear to enter holds the treasure you seek.", author: "Joseph Campbell" },
      { text: "We are all just walking each other home.", author: "Ram Dass" },
      { text: "One must always be careful of books, and what is inside them, for words have the power to change us.", author: "Cassandra Clare" },
      { text: "If you only read the books that everyone else is reading, you can only think what everyone else is thinking.", author: "Haruki Murakami" },
      { text: "It does not do to dwell on dreams and forget to live.", author: "J.K. Rowling" },
      { text: "In the beginning was the Word.", author: "John 1:1" },
      { text: "It matters not what someone is born, but what they grow to be.", author: "J.K. Rowling" },
      { text: "I have always imagined that Paradise will be a kind of library.", author: "Jorge Luis Borges" },
      { text: "Until I feared I would lose it, I never loved to read. One does not love breathing.", author: "Harper Lee" },
      { text: "A room without books is like a body without a soul.", author: "Marcus Tullius Cicero" },
      { text: "Outside of a dog, a book is man's best friend. Inside of a dog it's too dark to read.", author: "Groucho Marx" },
      { text: "It is what you read when you don't have to that determines what you will be when you can't help it.", author: "Oscar Wilde" },
      { text: "So it goes.", author: "Kurt Vonnegut" },
      { text: "All we have to decide is what to do with the time that is given us.", author: "J.R.R. Tolkien" },
      { text: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.", author: "Jane Austen" },
      { text: "Call me Ishmael.", author: "Herman Melville" },
      { text: "It was the best of times, it was the worst of times.", author: "Charles Dickens" },
      { text: "The only way out of the labyrinth of suffering is to forgive.", author: "John Green" },
      { text: "Not all treasure is silver and gold.", author: "Robert Louis Stevenson" },
      { text: "We accept the love we think we deserve.", author: "Stephen Chbosky" },
      { text: "It's the possibility of having a dream come true that makes life interesting.", author: "Paulo Coelho" },
      { text: "There are years that ask questions and years that answer.", author: "Zora Neale Hurston" },
      { text: "The more that you read, the more things you will know.", author: "Dr. Seuss" },
      { text: "One must always be careful of books.", author: "Cassandra Clare" },
      { text: "To infinity and beyond.", author: "Buzz Lightyear" },
      { text: "I took a deep breath and listened to the old brag of my heart: I am, I am, I am.", author: "Sylvia Plath" },
      { text: "It does not do to dwell on dreams and forget to live.", author: "J.K. Rowling" },
      { text: "We are all alone, born alone, die alone, and in spite of True Romance magazines, we shall all someday look back on our lives and see that, in spite of our company, we were alone the whole way.", author: "Hunter S. Thompson" },
      { text: "Wherever you go, go with all your heart.", author: "Confucius" },
      { text: "There is no greater agony than bearing an untold story inside you.", author: "Maya Angelou" },
      { text: "You don't have to burn books to destroy a culture. Just get people to stop reading them.", author: "Ray Bradbury" },
      { text: "The books that the world calls immoral are books that show the world its own shame.", author: "Oscar Wilde" },
      { text: "A word after a word after a word is power.", author: "Margaret Atwood" },
      { text: "Books are a uniquely portable magic.", author: "Stephen King" },
      { text: "If you want to know what a man's like, take a good look at how he treats his inferiors, not his equals.", author: "J.K. Rowling" },
      { text: "The man who does not read has no advantage over the man who cannot read.", author: "Mark Twain" },
      { text: "I am not afraid of storms, for I am learning how to sail my ship.", author: "Louisa May Alcott" },
      { text: "Good friends, good books, and a sleepy conscience: this is the ideal life.", author: "Mark Twain" },
      { text: "Sleep is good, he said, and books are better.", author: "George R.R. Martin" },
      { text: "One must always be careful of books.", author: "Cassandra Clare" },
      { text: "Classic — a book which people praise and don't read.", author: "Mark Twain" },
      { text: "Never trust anyone who has not brought a book with them.", author: "Lemony Snicket" },
      { text: "Think before you speak. Read before you think.", author: "Fran Lebowitz" },
      { text: "I find television very educational. Every time someone turns it on, I go in the other room and read a book.", author: "Groucho Marx" },
      { text: "A book must be the axe for the frozen sea within us.", author: "Franz Kafka" },
      { text: "There is no friend as loyal as a book.", author: "Ernest Hemingway" },
      { text: "Show me a family of readers, and I will show you the people who move the world.", author: "Napoléon Bonaparte" },
      { text: "Reading is to the mind what exercise is to the body.", author: "Joseph Addison" },
      { text: "I cannot live without books.", author: "Thomas Jefferson" },
      { text: "Reading gives us someplace to go when we have to stay where we are.", author: "Mason Cooley" },
      { text: "The reading of all good books is like a conversation with the finest minds of past centuries.", author: "René Descartes" },
      { text: "When I have a little money, I buy books; and if I have any left, I buy food and clothes.", author: "Erasmus" },
      { text: "A house without books is like a room without windows.", author: "Horace Mann" },
      { text: "Literature is the most agreeable way of ignoring life.", author: "Fernando Pessoa" },
      { text: "There is no such thing as a child who hates to read; there are only children who have not found the right book.", author: "Frank Serafini" },
      { text: "Once you learn to read, you will be forever free.", author: "Frederick Douglass" },
      { text: "You can never get a cup of tea large enough or a book long enough to suit me.", author: "C.S. Lewis" },
      { text: "I would be most content if my children grew up to be the kind of people who think decorating consists mostly of building enough bookshelves.", author: "Anna Quindlen" },
      { text: "To read without reflecting is like eating without digesting.", author: "Edmund Burke" },
      { text: "Today a reader, tomorrow a leader.", author: "Margaret Fuller" },
      { text: "Perhaps one did not want to be loved so much as to be understood.", author: "George Orwell" },
      { text: "War is peace. Freedom is slavery. Ignorance is strength.", author: "George Orwell" },
      { text: "All animals are equal, but some animals are more equal than others.", author: "George Orwell" },
      { text: "It was a bright cold day in April, and the clocks were striking thirteen.", author: "George Orwell" },
      { text: "It is better to remain silent at the risk of being thought a fool, than to talk and remove all doubt.", author: "Abraham Lincoln" },
      { text: "In the end, it's not the years in your life that count. It's the life in your years.", author: "Abraham Lincoln" },
      { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
      { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
      { text: "Do not go where the path may lead, go instead where there is no path and leave a trail.", author: "Ralph Waldo Emerson" },
      { text: "That which does not kill us makes us stronger.", author: "Friedrich Nietzsche" },
      { text: "Life is what happens when you're busy making other plans.", author: "John Lennon" },
      { text: "The unexamined life is not worth living.", author: "Socrates" },
      { text: "In the middle of difficulty lies opportunity.", author: "Albert Einstein" },
      { text: "The only thing necessary for the triumph of evil is for good men to do nothing.", author: "Edmund Burke" },
      { text: "Darkness cannot drive out darkness; only light can do that.", author: "Martin Luther King Jr." },
      { text: "Be yourself; everyone else is already taken.", author: "Oscar Wilde" },
      { text: "Two things are infinite: the universe and human stupidity; and I'm not sure about the universe.", author: "Albert Einstein" },
      { text: "You've gotta dance like there's nobody watching.", author: "William W. Purkey" },
      { text: "You only live once, but if you do it right, once is enough.", author: "Mae West" },
      { text: "No one can make you feel inferior without your consent.", author: "Eleanor Roosevelt" },
      { text: "I've learned that people will forget what you said, people will forget what you did, but people will never forget how you made them feel.", author: "Maya Angelou" },
      { text: "A woman is like a tea bag — you can't tell how strong she is until you put her in hot water.", author: "Eleanor Roosevelt" },
      { text: "If you judge people, you have no time to love them.", author: "Mother Teresa" },
      { text: "If you want to live a happy life, tie it to a goal, not to people or things.", author: "Albert Einstein" },
      { text: "Never let the fear of striking out keep you from playing the game.", author: "Babe Ruth" },
      { text: "It is never too late to be what you might have been.", author: "George Eliot" },
      { text: "You must be the change you wish to see in the world.", author: "Mahatma Gandhi" },
      { text: "Spread love everywhere you go. Let no one ever come to you without leaving happier.", author: "Mother Teresa" },
      { text: "When you reach the end of your rope, tie a knot in it and hang on.", author: "Franklin D. Roosevelt" },
      { text: "Always remember that you are absolutely unique. Just like everyone else.", author: "Margaret Mead" },
      { text: "Don't judge each day by the harvest you reap but by the seeds that you plant.", author: "Robert Louis Stevenson" },
      { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
      { text: "Tell me and I forget. Teach me and I remember. Involve me and I learn.", author: "Benjamin Franklin" },
      { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb" },
      { text: "An unexamined life is not worth living.", author: "Socrates" },
      { text: "Spread love everywhere you go.", author: "Mother Teresa" },
      { text: "When you reach the end of your rope, tie a knot and hang on.", author: "Abraham Lincoln" },
      { text: "The only impossible journey is the one you never begin.", author: "Tony Robbins" },
      { text: "In this world nothing can be said to be certain, except death and taxes.", author: "Benjamin Franklin" },
      { text: "It is during our darkest moments that we must focus to see the light.", author: "Aristotle" },
      { text: "Do not go gentle into that good night.", author: "Dylan Thomas" },
      { text: "Rage, rage against the dying of the light.", author: "Dylan Thomas" },
      { text: "We shall not cease from exploration, and the end of all our exploring will be to arrive where we started and know the place for the first time.", author: "T.S. Eliot" },
      { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
      { text: "The journey of a thousand miles begins with one step.", author: "Lao Tzu" },
      { text: "Life is either a daring adventure or nothing at all.", author: "Helen Keller" },
      { text: "What lies behind us and what lies before us are tiny matters compared to what lies within us.", author: "Ralph Waldo Emerson" },
      { text: "I have not failed. I've just found 10,000 ways that won't work.", author: "Thomas Edison" },
      { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
      { text: "Our greatest glory is not in never falling, but in rising every time we fall.", author: "Confucius" },
      { text: "Everything you've ever wanted is on the other side of fear.", author: "George Addair" },
      { text: "Dream big and dare to fail.", author: "Norman Vaughan" },
      { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
      { text: "Whether you think you can or you think you can't, you're right.", author: "Henry Ford" },
      { text: "I am not a product of my circumstances. I am a product of my decisions.", author: "Stephen Covey" },
      { text: "Every child is an artist. The problem is how to remain an artist once he grows up.", author: "Pablo Picasso" },
      { text: "You can't use up creativity. The more you use, the more you have.", author: "Maya Angelou" },
      { text: "I've learned that making a living is not the same thing as making a life.", author: "Maya Angelou" },
      { text: "If you hear a voice within you say you cannot paint, then by all means paint and that voice will be silenced.", author: "Vincent Van Gogh" },
      { text: "There is only one way to avoid criticism: do nothing, say nothing, and be nothing.", author: "Aristotle" },
      { text: "The mind is everything. What you think you become.", author: "Buddha" },
      { text: "An eye for an eye only ends up making the whole world blind.", author: "Mahatma Gandhi" },
      { text: "The weak can never forgive. Forgiveness is the attribute of the strong.", author: "Mahatma Gandhi" },
      { text: "It is not the strongest of the species that survive, nor the most intelligent, but the one most responsive to change.", author: "Charles Darwin" },
      { text: "Don't walk in front of me — I may not follow. Don't walk behind me — I may not lead. Walk beside me — just be my friend.", author: "Albert Camus" },
      { text: "No act of kindness, no matter how small, is ever wasted.", author: "Aesop" },
      { text: "We know what we are, but know not what we may be.", author: "William Shakespeare" },
      { text: "To thine own self be true.", author: "William Shakespeare" },
      { text: "All the world's a stage, and all the men and women merely players.", author: "William Shakespeare" },
      { text: "What's in a name? That which we call a rose by any other name would smell as sweet.", author: "William Shakespeare" },
      { text: "The lady doth protest too much, methinks.", author: "William Shakespeare" },
      { text: "Brevity is the soul of wit.", author: "William Shakespeare" },
      { text: "To be, or not to be, that is the question.", author: "William Shakespeare" },
      { text: "How sharper than a serpent's tooth it is to have a thankless child.", author: "William Shakespeare" },
      { text: "Something is rotten in the state of Denmark.", author: "William Shakespeare" },
      { text: "Hell is empty and all the devils are here.", author: "William Shakespeare" },
      { text: "We are such stuff as dreams are made on, and our little life is rounded with a sleep.", author: "William Shakespeare" },
      { text: "Not all those who wander are lost.", author: "J.R.R. Tolkien" },
      { text: "Even the smallest person can change the course of the future.", author: "J.R.R. Tolkien" },
      { text: "Courage is found in unlikely places.", author: "J.R.R. Tolkien" },
      { text: "A single dream is more powerful than a thousand realities.", author: "J.R.R. Tolkien" },
      { text: "Where there's life there's hope.", author: "J.R.R. Tolkien" },
      { text: "It is not our abilities that show what we truly are — it is our choices.", author: "J.K. Rowling" },
      { text: "Happiness can be found even in the darkest of times, if one only remembers to turn on the light.", author: "J.K. Rowling" },
      { text: "Words are, in my not-so-humble opinion, our most inexhaustible source of magic.", author: "J.K. Rowling" },
      { text: "We've all got both light and dark inside us. What matters is the part we choose to act on.", author: "J.K. Rowling" },
      { text: "It takes a great deal of bravery to stand up to our enemies, but just as much to stand up to our friends.", author: "J.K. Rowling" },
      { text: "The ones that love us never really leave us.", author: "J.K. Rowling" },
      { text: "Of course it is happening inside your head, Harry, but why on earth should that mean that it is not real?", author: "J.K. Rowling" },
      { text: "I am no bird; and no net ensnares me.", author: "Charlotte Brontë" },
      { text: "Whatever our souls are made of, his and mine are the same.", author: "Emily Brontë" },
      { text: "I am not afraid of storms, for I am learning how to sail my ship.", author: "Louisa May Alcott" },
      { text: "She is too fond of books, and it has turned her brain.", author: "Louisa May Alcott" },
      { text: "I am not what happened to me. I am what I choose to become.", author: "Carl Jung" },
      { text: "Your task is not to seek for love, but merely to seek and find all the barriers within yourself that you have built against it.", author: "Rumi" },
      { text: "Out beyond ideas of wrongdoing and rightdoing, there is a field. I'll meet you there.", author: "Rumi" },
      { text: "The wound is the place where the Light enters you.", author: "Rumi" },
      { text: "You were born with wings, why prefer to crawl through life?", author: "Rumi" },
      { text: "Yesterday I was clever, so I wanted to change the world. Today I am wise, so I am changing myself.", author: "Rumi" },
      { text: "Sell your cleverness and buy bewilderment.", author: "Rumi" },
      { text: "Live in each season as it passes; breathe the air, drink the drink, taste the fruit.", author: "Henry David Thoreau" },
      { text: "Go confidently in the direction of your dreams. Live the life you have imagined.", author: "Henry David Thoreau" },
      { text: "Not all those who wander are lost.", author: "J.R.R. Tolkien" },
      { text: "If I have seen further it is by standing on the shoulders of giants.", author: "Isaac Newton" },
      { text: "Two roads diverged in a wood, and I took the one less traveled by, and that has made all the difference.", author: "Robert Frost" },
      { text: "In three words I can sum up everything I've learned about life: it goes on.", author: "Robert Frost" },
      { text: "Education is the most powerful weapon which you can use to change the world.", author: "Nelson Mandela" },
      { text: "For to be free is not merely to cast off one's chains, but to live in a way that respects and enhances the freedom of others.", author: "Nelson Mandela" },
      { text: "I have a dream that my four little children will one day live in a nation where they will not be judged by the color of their skin but by the content of their character.", author: "Martin Luther King Jr." },
      { text: "Faith is taking the first step even when you don't see the whole staircase.", author: "Martin Luther King Jr." },
      { text: "The time is always right to do what is right.", author: "Martin Luther King Jr." },
      { text: "Science without religion is lame, religion without science is blind.", author: "Albert Einstein" },
      { text: "Imagination is more important than knowledge.", author: "Albert Einstein" },
      { text: "A person who never made a mistake never tried anything new.", author: "Albert Einstein" },
      { text: "Logic will get you from A to B. Imagination will take you everywhere.", author: "Albert Einstein" },
      { text: "The measure of intelligence is the ability to change.", author: "Albert Einstein" },
      { text: "Life is like riding a bicycle. To keep your balance, you must keep moving.", author: "Albert Einstein" },
      { text: "I am not what happened to me. I am what I choose to become.", author: "Carl Jung" },
      { text: "The privilege of a lifetime is to become who you truly are.", author: "Carl Jung" },
      { text: "Your visions will become clear only when you can look into your own heart. Who looks outside, dreams; who looks inside, awakes.", author: "Carl Jung" },
      { text: "Everything that irritates us about others can lead us to an understanding of ourselves.", author: "Carl Jung" },
      { text: "The most terrifying thing is to accept oneself completely.", author: "Carl Jung" },
      { text: "Until you make the unconscious conscious, it will direct your life and you will call it fate.", author: "Carl Jung" },
      { text: "Knowing your own darkness is the best method for dealing with the darknesses of other people.", author: "Carl Jung" },
      { text: "We cannot change anything unless we accept it.", author: "Carl Jung" },
      { text: "The shoe that fits one person pinches another; there is no recipe for living that suits all cases.", author: "Carl Jung" },
      { text: "Show me a sane man and I will cure him for you.", author: "Carl Jung" },
      { text: "Loneliness does not come from having no people around, but from being unable to communicate the things that seem important to oneself.", author: "Carl Jung" },
      { text: "The pendulum of the mind alternates between sense and nonsense, not between right and wrong.", author: "Carl Jung" },
      { text: "I came, I saw, I conquered.", author: "Julius Caesar" },
      { text: "Men willingly believe what they wish.", author: "Julius Caesar" },
      { text: "It is easier to find men who will volunteer to die, than to find those who are willing to endure pain with patience.", author: "Julius Caesar" },
      { text: "Cowards die many times before their actual deaths.", author: "Julius Caesar" },
      { text: "No one is so brave that he is not disturbed by something unexpected.", author: "Julius Caesar" },
      { text: "Experience is the teacher of all things.", author: "Julius Caesar" },
      { text: "In war, events of importance are the result of trivial causes.", author: "Julius Caesar" },
      { text: "Which death is preferable to every other? The unexpected.", author: "Julius Caesar" },
      { text: "As a rule, men worry more about what they can't see than about what they can.", author: "Julius Caesar" },
      { text: "You have to begin to lose your memory, if only in bits and pieces, to realize that memory is what makes our lives.", author: "Julius Caesar" },
      { text: "You could leave life right now. Let that determine what you do and say and think.", author: "Marcus Aurelius" },
      { text: "The happiness of your life depends upon the quality of your thoughts.", author: "Marcus Aurelius" },
      { text: "Waste no more time arguing about what a good man should be. Be one.", author: "Marcus Aurelius" },
      { text: "If it is not right, do not do it; if it is not true, do not say it.", author: "Marcus Aurelius" },
      { text: "The best revenge is to be unlike him who performed the injury.", author: "Marcus Aurelius" },
      { text: "Accept the things to which fate binds you, and love the people with whom fate brings you together.", author: "Marcus Aurelius" },
      { text: "Very little is needed to make a happy life; it is all within yourself, in your way of thinking.", author: "Marcus Aurelius" },
      { text: "When you wake up in the morning, tell yourself: the people I deal with today will be meddling, ungrateful, arrogant, dishonest, jealous and surly.", author: "Marcus Aurelius" },
      { text: "Never esteem anything as of advantage to you that will make you break your word or lose your self-respect.", author: "Marcus Aurelius" },
      { text: "The object of life is not to be on the side of the majority, but to escape finding oneself in the ranks of the insane.", author: "Marcus Aurelius" },
      { text: "If someone is able to show me that what I think or do is not right, I will happily change.", author: "Marcus Aurelius" },
      { text: "Confine yourself to the present.", author: "Marcus Aurelius" },
      { text: "It is not death that a man should fear, but he should fear never beginning to live.", author: "Marcus Aurelius" },
      { text: "Dwell on the beauty of life. Watch the stars, and see yourself running with them.", author: "Marcus Aurelius" },
      { text: "Veni, vidi, vici. — I came, I saw, I conquered.", author: "Julius Caesar (Latin)" },
      { text: "Carpe diem, quam minimum credula postero. — Seize the day, put very little trust in tomorrow.", author: "Horace (Latin)" },
      { text: "Dum spiro, spero. — While I breathe, I hope.", author: "Cicero (Latin)" },
      { text: "Alea iacta est. — The die is cast.", author: "Julius Caesar (Latin)" },
      { text: "Amor vincit omnia. — Love conquers all.", author: "Virgil (Latin)" },
      { text: "Ars longa, vita brevis. — Art is long, life is short.", author: "Hippocrates via Seneca (Latin)" },
      { text: "Audentes fortuna iuvat. — Fortune favours the bold.", author: "Virgil (Latin)" },
      { text: "Cogito, ergo sum. — I think, therefore I am.", author: "Descartes (Latin)" },
      { text: "Disce aut discede. — Learn or depart.", author: "Latin Proverb" },
      { text: "Errare humanum est. — To err is human.", author: "Seneca (Latin)" },
      { text: "Et tu, Brute? — And you, Brutus?", author: "Julius Caesar (Latin)" },
      { text: "Felix qui potuit rerum cognoscere causas. — Happy is he who could know the causes of things.", author: "Virgil (Latin)" },
      { text: "Fortes fortuna adiuvat. — Fortune helps the brave.", author: "Terence (Latin)" },
      { text: "Historia magistra vitae est. — History is the teacher of life.", author: "Cicero (Latin)" },
      { text: "Homo sum, humani nihil a me alienum puto. — I am human, and I think nothing human is alien to me.", author: "Terence (Latin)" },
      { text: "Ignorantia legis neminem excusat. — Ignorance of the law excuses no one.", author: "Latin Legal Maxim" },
      { text: "In vino veritas. — In wine there is truth.", author: "Pliny the Elder (Latin)" },
      { text: "Lux et veritas. — Light and truth.", author: "Latin Motto" },
      { text: "Memento mori. — Remember that you will die.", author: "Latin Proverb" },
      { text: "Mens sana in corpore sano. — A healthy mind in a healthy body.", author: "Juvenal (Latin)" },
      { text: "Nihil sub sole novum. — There is nothing new under the sun.", author: "Ecclesiastes (Latin Vulgate)" },
      { text: "Non ducor, duco. — I am not led, I lead.", author: "Latin Motto" },
      { text: "Omnia mea mecum porto. — All that is mine I carry with me.", author: "Cicero (Latin)" },
      { text: "Omnia vincit amor. — Love conquers all things.", author: "Virgil (Latin)" },
      { text: "Per aspera ad astra. — Through hardship to the stars.", author: "Seneca (Latin)" },
      { text: "Primum non nocere. — First, do no harm.", author: "Hippocratic Oath (Latin)" },
      { text: "Qui tacet consentire videtur. — He who is silent seems to consent.", author: "Latin Legal Maxim" },
      { text: "Quid pro quo. — Something for something.", author: "Latin Proverb" },
      { text: "Scientia potentia est. — Knowledge is power.", author: "Francis Bacon (Latin)" },
      { text: "Si vis pacem, para bellum. — If you want peace, prepare for war.", author: "Vegetius (Latin)" },
      { text: "Sic transit gloria mundi. — Thus passes the glory of the world.", author: "Thomas à Kempis (Latin)" },
      { text: "Sine qua non. — Without which, nothing.", author: "Latin Legal Term" },
      { text: "Tempus fugit. — Time flies.", author: "Virgil (Latin)" },
      { text: "Veritas vos liberabit. — The truth will set you free.", author: "John 8:32 (Latin Vulgate)" },
      { text: "Vincit qui se vincit. — He conquers who conquers himself.", author: "Latin Proverb" },
      { text: "Vita brevis, ars longa, occasio praeceps. — Life is short, art is long, opportunity fleeting.", author: "Seneca (Latin)" },
      { text: "Vivere est cogitare. — To live is to think.", author: "Cicero (Latin)" },
      { text: "Nusquam est qui ubique est. — One who is everywhere is nowhere.", author: "Seneca (Latin)" },
      { text: "Faber est suae quisque fortunae. — Every man is the architect of his own fortune.", author: "Appius Claudius Caecus (Latin)" },
      { text: "Acta non verba. — Deeds, not words.", author: "Latin Proverb" },
      { text: "Aut viam inveniam aut faciam. — I will either find a way or make one.", author: "Hannibal (Latin)" },
      { text: "Barba non facit philosophum. — A beard does not make a philosopher.", author: "Latin Proverb" },
      { text: "Divide et impera. — Divide and conquer.", author: "Philip II of Macedon (Latin)" },
      { text: "Dulce et decorum est pro patria mori. — It is sweet and fitting to die for one's country.", author: "Horace (Latin)" },
      { text: "Festina lente. — Make haste slowly.", author: "Augustus Caesar (Latin)" },
      { text: "Fluctuat nec mergitur. — She is tossed by the waves but does not sink.", author: "Motto of Paris (Latin)" },
      { text: "Nemo me impune lacessit. — No one provokes me with impunity.", author: "Motto of Scotland (Latin)" },
      { text: "Non omnia possumus omnes. — We cannot all do everything.", author: "Virgil (Latin)" },
      { text: "Nunc aut nunquam. — Now or never.", author: "Latin Proverb" },
      { text: "O tempora! O mores! — Oh the times! Oh the customs!", author: "Cicero (Latin)" },
      { text: "Omnia mutantur, nihil interit. — Everything changes, nothing perishes.", author: "Ovid (Latin)" },
      { text: "Sic parvis magna. — Greatness from small beginnings.", author: "Sir Francis Drake (Latin)" },
      { text: "Timendi causa est nescire. — The cause of fear is ignorance.", author: "Seneca (Latin)" },
    ];
    const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:9000;
      background:rgba(2,1,0,0.88);
      display:flex; align-items:center; justify-content:center;
      font-family:"Courier New",monospace;
      animation: bkFadeIn 0.3s ease;
    `;
    const style = document.createElement('style');
    style.textContent = `
      @keyframes bkFadeIn { from{opacity:0} to{opacity:1} }
      @keyframes bkFlicker { 0%,100%{opacity:0.85} 50%{opacity:1} }
    `;
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.style.cssText = `
      width:320px; max-width:90vw;
      background:linear-gradient(160deg,#100a04 0%,#180e06 60%,#0e0804 100%);
      border:1px solid #3a2a1466;
      border-radius:4px; padding:28px 24px 22px;
      text-align:center; position:relative;
    `;

    const title = document.createElement('div');
    title.textContent = '— from the shelf —';
    title.style.cssText = 'color:#6a4a20;font-size:9px;letter-spacing:2px;margin-bottom:20px;opacity:0.7;';
    box.appendChild(title);

    const quoteEl = document.createElement('div');
    quoteEl.style.cssText = `
      color:#d4b88a; font-size:11px; line-height:1.8;
      font-style:italic; padding:0 4px; min-height:60px;
      animation: bkFlicker 3s ease-in-out infinite;
    `;
    quoteEl.textContent = `"${q.text}"`;
    box.appendChild(quoteEl);

    const authorEl = document.createElement('div');
    authorEl.style.cssText = 'color:#6a4a20;font-size:9px;letter-spacing:1px;margin-top:14px;';
    authorEl.textContent = `— ${q.author}`;
    box.appendChild(authorEl);

    const divEl = document.createElement('div');
    divEl.style.cssText = 'border-top:1px solid #3a2a1440;margin:16px 0 12px;';
    box.appendChild(divEl);

    const hint = document.createElement('div');
    hint.textContent = '[ESC] or click to close';
    hint.style.cssText = 'color:#3a2a1466;font-size:9px;letter-spacing:1px;cursor:pointer;';
    hint.onclick = () => this.closeBookOverlay();
    box.appendChild(hint);

    overlay.appendChild(box);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.closeBookOverlay(); });
    document.body.appendChild(overlay);

    this.bookOverlay = overlay;
  }

  private closeBookOverlay(): void {
    if (!this.bookOverlay) return;
    this.bookOverlay.style.transition = 'opacity 0.25s';
    this.bookOverlay.style.opacity = '0';
    const el = this.bookOverlay;
    this.bookOverlay = null;
    setTimeout(() => el.remove(), 260);
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
    this.player = this.add.image(140, this.playerY, 'player').setOrigin(0.5, 1).setScale(2).setDepth(10);
    const name = this.registry.get('playerName') || 'guest';
    this.playerName = this.add.text(this.player.x, this.playerY - 90, name.slice(0, 14), { fontFamily: '"Courier New", monospace', fontSize: '9px', color: CABIN_ACCENT, align: 'center', backgroundColor: '#04081088', padding: { x: 3, y: 1 } }).setOrigin(0.5).setDepth(11);
    const ms = getStatus();
    this.playerStatusText = this.add.text(this.player.x, this.playerY - 102, ms, { fontFamily: '"Courier New", monospace', fontSize: '8px', color: P.lpurp, align: 'center' }).setOrigin(0.5).setDepth(11).setAlpha(ms ? 1 : 0);
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
  protected override getPlayerSprite(): Phaser.GameObjects.Image { return this.player; }
  protected override getBubbleYOffset(): number { return -94; }
  protected override onPlayerJoinGuard(_p: { pubkey: string }): boolean { return !this.isLeavingScene; }
  protected override handleSceneChatCommand(_pk: string, _name: string, text: string, isMe: boolean): boolean {
    if (text === '/stoke') {
      if (!isMe && this.stokedTimer <= 0) { this.stokedTimer = 5000; this.snd.stokeFireplace(); }
      return true;
    }
    return false;
  }
  protected override handleSceneEsc(): boolean {
    if (this.bookOverlay) { this.closeBookOverlay(); return true; }
    return false;
  }
  protected override onEscFallthrough(): void {
    if (!this.isLeavingScene) { this.isLeavingScene = true; this.leaveToWoods(); }
  }

  protected override getOtherPlayerConfig(): import('./BaseScene').OtherPlayerConfig {
    return {
      texKeyPrefix: 'avatar_hub_', scale: 2,
      nameYOffset: -90, statusYOffset: -102,
      nameColor: CABIN_ACCENT, nameFontSize: '9px', statusFontSize: '8px',
      nameBg: '#04081088', namePadding: { x: 3, y: 1 },
      czW: 40, czH: 60, czYOffset: -50,
      tintPalette: [0xe87aab, 0x7b68ee, 0x5dcaa5, 0xfad480, 0xb8a8f8],
      useFadeIn: true, interpolateY: false, emoteContext: 'cabin',
    };
  }
  protected override renderOtherAvatar(cfg: import('../stores/avatarStore').AvatarConfig): HTMLCanvasElement {
    return renderHubSprite(cfg);
  }

  // ══════════════════════════════════════════════════════════════════
  // COMMANDS
  // ══════════════════════════════════════════════════════════════════
  protected override getSceneAccent(): string { return CABIN_ACCENT; }

  private handleCommand(text: string): void {
    const parts = text.slice(1).split(' '); const cmd = parts[0].toLowerCase(); const arg = parts.slice(1).join(' ').trim();
    switch (cmd) {
      case 'leave': case 'exit': case 'outside': { if (!this.isLeavingScene) { this.isLeavingScene = true; this.leaveToWoods(); } break; }
      case 'tp': case 'teleport': case 'go': { if (!arg) { this.chatUI.addMessage('system', 'Rooms: hub, woods, relay, feed, myroom, lounge, market, cabin', CABIN_ACCENT); return; } const al: Record<string, string> = { hub: 'hub', woods: 'woods', cabin: 'cabin', relay: 'relay', feed: 'feed', thefeed: 'feed', myroom: 'myroom', room: 'picker', lounge: 'lounge', rooftop: 'lounge', market: 'market', shop: 'market', store: 'market' }; const rid = al[arg.toLowerCase().replace(/\s+/g, '')]; if (rid === 'woods') { if (!this.isLeavingScene) { this.isLeavingScene = true; this.leaveToWoods(); } return; } if (rid === 'cabin') { this.chatUI.addMessage('system', 'Already in the cabin!', CABIN_ACCENT); return; } if (rid === 'hub') { if (!this.isLeavingScene) { this.isLeavingScene = true; sendRoomChange('hub'); this.chatUI.destroy(); this.cameras.main.fadeOut(300, 10, 0, 20); this.time.delayedCall(300, () => { if (!this.scene.isActive()) return; this.scene.start('HubScene', { _returning: true }); }); } return; } if (rid === 'myroom') { const pk = this.registry.get('playerPubkey'); const n = this.registry.get('playerName') || 'My Room'; sendRoomChange('hub'); this.chatUI.destroy(); this.scene.start('RoomScene', { id: `myroom:${pk}`, name: `${n}'s Room`, neonColor: P.teal, ownerPubkey: pk }); return; } if (rid === 'picker') { const pk = this.registry.get('playerPubkey'); const n = this.registry.get('playerName') || 'My Room'; this.playerPicker.open(pk, n, () => { sendRoomChange('hub'); this.chatUI.destroy(); this.scene.start('RoomScene', { id: `myroom:${pk}`, name: `${n}'s Room`, neonColor: P.teal, ownerPubkey: pk }); }, (opk) => { sendRoomChange(opk); this.chatUI.addMessage('system', 'Requesting access...', CABIN_ACCENT); }); return; } if (rid) { sendRoomChange('hub'); this.chatUI.destroy(); this.scene.start('RoomScene', { id: rid, name: rid.charAt(0).toUpperCase() + rid.slice(1), neonColor: P.teal }); return; } this.chatUI.addMessage('system', `Unknown room "${arg}"`, P.amber); break; }
      case 'dm': { if (!canUseDMs()) { this.chatUI.addMessage('system', 'DMs need a key', P.amber); return; } if (!arg) { const ps: string[] = []; this.otherPlayers.forEach(o => ps.push(o.name)); this.chatUI.addMessage('system', ps.length ? `Online: ${ps.join(', ')}` : 'No players here', CABIN_ACCENT); return; } let tp: string | null = null; this.otherPlayers.forEach((o, pk) => { if (o.name?.toLowerCase().includes(arg.toLowerCase())) tp = pk; }); if (tp) { this.dmPanel.open(tp); this.chatUI.addMessage('system', 'Opening DM...', CABIN_ACCENT); } else this.chatUI.addMessage('system', `"${arg}" not found`, P.amber); break; }
      case 'zap': { if (!arg) { this.chatUI.addMessage('system', 'Usage: /zap <name>', CABIN_ACCENT); return; } const za = authStore.getState(); if (!za.pubkey || za.isGuest) { this.chatUI.addMessage('system', 'Login to zap', P.amber); return; } let zt: string | null = null; let zn = arg; this.otherPlayers.forEach((o, pk) => { if (o.name?.toLowerCase().includes(arg.toLowerCase())) { zt = pk; zn = o.name; } }); if (!zt) { this.chatUI.addMessage('system', `"${arg}" not found`, P.amber); return; } ZapModal.show(zt, zn); break; }
      case 'players': case 'who': case 'online': { const ps: string[] = []; this.otherPlayers.forEach(o => ps.push(o.name)); this.chatUI.addMessage('system', ps.length ? `${ps.length} here: ${ps.join(', ')}` : 'No other players', CABIN_ACCENT); break; }
      default: { if (!this.handleCommonCommand(cmd, arg)) this.chatUI.addMessage('system', `Unknown: /${cmd}`, P.amber); break; }
    }
    this.chatUI.flashLog();
  }

}

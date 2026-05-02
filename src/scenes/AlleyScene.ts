/**
 * AlleyScene.ts — Dark alleyway between the Relay and The Feed.
 *
 * Enter: press [E] at the alley gap in HubScene.
 * Exit:  press [E] near the left opening → back to HubScene.
 *        right end: subway arch (closed — coming soon).
 *
 * World width: 1000px — matches CabinScene length.
 * Full presence, chat, DMs, crews.
 */

import Phaser from 'phaser';
import { BaseScene } from './BaseScene';
import { captureThumb } from '../stores/sceneThumbs';
import { GAME_HEIGHT, GROUND_Y, PLAYER_SPEED, P, hexToNum } from '../config/game.config';
import {
  sendPosition, sendChat, sendRoomChange, isPresenceReady,
} from '../nostr/presenceService';

import { ChatUI } from '../ui/ChatUI';
import { ProfileModal } from '../ui/ProfileModal';
import { renderHubSprite, itemImagesReady } from '../entities/AvatarRenderer';
import { getAvatar } from '../stores/avatarStore';
import { onNextAvatarSync } from '../nostr/nostrService';
import { getStatus } from '../stores/statusStore';
import { FortuneTellerModal } from '../ui/FortuneTellerModal';
import { TarotModal } from '../ui/TarotModal';

const ALLEY_ACCENT   = P.dpurp;
const W              = 1000;
const FLOOR_Y        = GROUND_Y;
const EXIT_X         = 44;   // left opening — back to Hub
const SUBWAY_X       = 930;  // right subway entrance (closed)
const ALLEY_SPEED    = PLAYER_SPEED * 1.4;
const FORTUNE_X      = 319;  // center of fortune teller cabinet (mx=302 + 17)
const FORTUNE_RANGE  = 36;
const TAROT_X        = 422;  // center of tarot machine (mx=408 + 14)
const TAROT_RANGE    = 36;

export class AlleyScene extends BaseScene {
  private player!: Phaser.GameObjects.Image;

  private fxGraphics!: Phaser.GameObjects.Graphics;
  private neonGraphics!: Phaser.GameObjects.Graphics;

  // Water drip particles
  private drips: { x: number; y: number; vy: number; len: number; alpha: number }[] = [];
  // Steam particles
  private steams: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number }[] = [];
  // Neon flicker state
  private neonFlicker = 0;
  private neonOn = true;
  private flickerTimer = 0;

  // Fortune teller proximity
  private nearFortune = false;
  private fortunePromptBg!: Phaser.GameObjects.Graphics;
  private fortunePromptText!: Phaser.GameObjects.Text;
  private fortunePromptArrow!: Phaser.GameObjects.Text;

  // Tarot machine proximity
  private nearTarot = false;
  private tarotPromptBg!: Phaser.GameObjects.Graphics;
  private tarotPromptText!: Phaser.GameObjects.Text;
  private tarotPromptArrow!: Phaser.GameObjects.Text;

  // Exit door prompt

  // Subway prompt
  private nearSubway = false;
  private subwayPromptBg!: Phaser.GameObjects.Graphics;
  private subwayPromptText!: Phaser.GameObjects.Text;
  private subwayPromptArrow!: Phaser.GameObjects.Text;

  constructor() { super({ key: 'AlleyScene' }); }
  init(): void { super.init(); }

  // ══════════════════════════════════════════════════════════════════
  // CREATE
  // ══════════════════════════════════════════════════════════════════
  create(): void {
    this.renderBackground();
    this.add.image(W / 2, GAME_HEIGHT / 2, 'alley_bg').setDepth(-1);

    this.fxGraphics    = this.add.graphics().setDepth(3);
    this.neonGraphics  = this.add.graphics().setDepth(5);
    this.emoteGraphics = this.add.graphics().setDepth(15);

    this.spawnParticles();
    this.createPlayer();
    onNextAvatarSync(() => {
      const av = getAvatar();
      for (let i = 0; i < 4; i++) { if (this.textures.exists(`player_walk${i}`)) this.textures.remove(`player_walk${i}`); this.textures.addCanvas(`player_walk${i}`, renderHubSprite(av, i)); }
      if (this.textures.exists('player')) this.textures.remove('player');
      this.textures.addCanvas('player', renderHubSprite(av));
      this.player?.setTexture('player');
    });


    this.cameras.main.setBounds(0, 0, W, GAME_HEIGHT);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setDeadzone(80, 50);
    this.setupMobileCamera(1.6);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
      if ((p.event.target as HTMLElement)?.tagName !== 'CANVAS') return;
      if (currentlyOver.length > 0) return;
      if (p.worldY < FLOOR_Y - 10 || p.worldY > 460) return;
      this.targetX = Phaser.Math.Clamp(p.worldX, 20, W - 28);
      this.isMoving = true;
    });

    const myPubkey = this.registry.get('playerPubkey');
    this.snd.setRoom('alley');

    this.chatUI = new ChatUI();
    this.chatInput = this.chatUI.create('Chat in the alley...', ALLEY_ACCENT, (cmd) => this.handleCommand(cmd));
    this.createMobileControls();
    this.chatUI.setNameClickHandler((pubkey, name) => {
      const op = this.otherPlayers.get(pubkey);
      ProfileModal.show(pubkey, name, op?.avatar, op?.status);
    });

    this.setupRegistryPanels(myPubkey);
    this.setupCommonKeyboardHandlers();

    // Tarot machine prompt
    const isTouch = this.sys.game.device.input.touch;
    this.tarotPromptBg = this.add.graphics().setDepth(50).setScrollFactor(0).setVisible(false);
    this.tarotPromptBg.fillStyle(hexToNum(P.bg), 0.9);
    this.tarotPromptBg.fillRoundedRect(0, 0, 148, 28, 5);
    this.tarotPromptBg.lineStyle(1, 0x4488cc, 0.6);
    this.tarotPromptBg.strokeRoundedRect(0, 0, 148, 28, 5);
    this.tarotPromptText = this.add.text(0, 0, isTouch ? '[TAP] Draw a Card' : '[E] Draw a Card',
      { fontFamily: '"Courier New", monospace', fontSize: '10px', color: '#70b8ee', fontStyle: 'bold', align: 'center' }
    ).setOrigin(0.5).setDepth(51).setScrollFactor(0).setVisible(false);
    this.tarotPromptArrow = this.add.text(0, 0, '▼',
      { fontFamily: 'monospace', fontSize: '9px', color: '#4488cc' }
    ).setOrigin(0.5).setDepth(51).setScrollFactor(0).setVisible(false);
    this.tarotPromptBg.setInteractive(new Phaser.Geom.Rectangle(0, 0, 148, 28), Phaser.Geom.Rectangle.Contains);
    this.tarotPromptBg.on('pointerdown', () => { if (this.nearTarot && !TarotModal.isOpen()) TarotModal.show(); });

    // Fortune teller prompt
    this.fortunePromptBg = this.add.graphics().setDepth(50).setScrollFactor(0).setVisible(false);
    this.fortunePromptBg.fillStyle(hexToNum(P.bg), 0.9);
    this.fortunePromptBg.fillRoundedRect(0, 0, 148, 28, 5);
    this.fortunePromptBg.lineStyle(1, 0x9966cc, 0.6);
    this.fortunePromptBg.strokeRoundedRect(0, 0, 148, 28, 5);
    this.fortunePromptText = this.add.text(0, 0, isTouch ? '[TAP] Ask Your Fortune' : '[E] Ask Your Fortune',
      { fontFamily: '"Courier New", monospace', fontSize: '10px', color: '#c0a0ff', fontStyle: 'bold', align: 'center' }
    ).setOrigin(0.5).setDepth(51).setScrollFactor(0).setVisible(false);
    this.fortunePromptArrow = this.add.text(0, 0, '▼',
      { fontFamily: 'monospace', fontSize: '9px', color: '#9966cc' }
    ).setOrigin(0.5).setDepth(51).setScrollFactor(0).setVisible(false);
    this.fortunePromptBg.setInteractive(new Phaser.Geom.Rectangle(0, 0, 148, 28), Phaser.Geom.Rectangle.Contains);
    this.fortunePromptBg.on('pointerdown', () => { if (this.nearFortune && !FortuneTellerModal.isOpen()) FortuneTellerModal.show(); });

    // Subway prompt (right end — closed)
    this.subwayPromptBg = this.add.graphics().setDepth(50).setVisible(false);
    this.subwayPromptBg.fillStyle(hexToNum(P.bg), 0.9);
    this.subwayPromptBg.fillRoundedRect(0, 0, 168, 28, 5);
    this.subwayPromptBg.lineStyle(1, hexToNum(P.dpurp), 0.4);
    this.subwayPromptBg.strokeRoundedRect(0, 0, 168, 28, 5);
    this.subwayPromptText = this.add.text(0, 0, 'COMING SOON',
      { fontFamily: '"Courier New", monospace', fontSize: '10px', color: P.dpurp, align: 'center' }
    ).setOrigin(0.5).setDepth(51).setVisible(false);
    this.subwayPromptArrow = this.add.text(0, 0, '▼',
      { fontFamily: 'monospace', fontSize: '9px', color: P.dpurp }
    ).setOrigin(0.5).setDepth(51).setVisible(false);

    this.input.keyboard?.on('keydown-E', () => {
      if (document.activeElement === this.chatInput) return;
      if (document.querySelector('.dm-panel.dm-open, .cp-panel.cp-open, .cp-modal-overlay')) return;
      if (FortuneTellerModal.isOpen()) { FortuneTellerModal.destroy(); return; }
      if (TarotModal.isOpen()) { TarotModal.destroy(); return; }
      if (this.nearFortune) { FortuneTellerModal.show(); return; }
      if (this.nearTarot) { TarotModal.show(); return; }
    });
    this.setupEscHandler();
    this.setupPresenceCallbacks(myPubkey);

    this.setupRoomRequestHandlers();

    sendRoomChange('alley', EXIT_X + 60, this.playerY);

    this.setupProfileSubscription();
    this.cameras.main.fadeIn(350, 0, 0, 0);
    this.settingsPanel.create();

    this.events.on('shutdown', () => {
      this.shutdownCommonPanels();
      FortuneTellerModal.destroy();
      TarotModal.destroy();
      this.fortunePromptBg?.destroy(); this.fortunePromptText?.destroy(); this.fortunePromptArrow?.destroy();
      this.tarotPromptBg?.destroy(); this.tarotPromptText?.destroy(); this.tarotPromptArrow?.destroy();
      this.subwayPromptBg?.destroy(); this.subwayPromptText?.destroy(); this.subwayPromptArrow?.destroy();
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // BACKGROUND (canvas-based, like CabinScene)
  // ══════════════════════════════════════════════════════════════════
  private renderBackground(): void {
    const c = AlleyScene.generateBg();
    if (this.textures.exists('alley_bg')) this.textures.remove('alley_bg');
    this.textures.addCanvas('alley_bg', c);
    captureThumb('alley', c);
  }

  static generateBg(): HTMLCanvasElement {
    const c = document.createElement('canvas'); c.width = W; c.height = GAME_HEIGHT;
    const x = c.getContext('2d')!; x.imageSmoothingEnabled = false;
    const r = (ax: number, ay: number, aw: number, ah: number, col: string) => { x.fillStyle = col; x.fillRect(ax, ay, aw, ah); };

    // ══════════════════════════════════════════════════════
    // FULL BUILDING WALL — runs the entire width & height
    // The player is inside an alley corridor. These are the
    // brick building faces they walk between.
    // ══════════════════════════════════════════════════════

    // Base sky (visible at the very top, narrow strip between rooftops)
    const skyGrad = x.createLinearGradient(0, 0, 0, GAME_HEIGHT * 0.18);
    skyGrad.addColorStop(0, '#060118'); skyGrad.addColorStop(1, '#0a0228');
    x.fillStyle = skyGrad; x.fillRect(0, 0, W, GAME_HEIGHT * 0.18);

    // ══════════════════════════════════════════════════════
    // BACK WALL — the building face you see at the back of
    // the alley. Spans the full width, fills upper portion.
    // ══════════════════════════════════════════════════════
    const wallTop = Math.floor(GAME_HEIGHT * 0.12); // where bricks start (below sky strip)
    const wallBot = FLOOR_Y;

    // Main brick wall — left building (darker, older)
    const leftWallW = Math.floor(W * 0.48);
    r(0, wallTop, leftWallW, wallBot - wallTop, '#1e1a38');

    // Main brick wall — right building (slightly different tone)
    r(leftWallW, wallTop, W - leftWallW, wallBot - wallTop, '#1a1630');

    // Subtle dividing line / alley crack between buildings
    r(leftWallW - 1, wallTop, 3, wallBot - wallTop, '#0c0820');

    // ── Brick rows across full wall ──
    x.globalAlpha = 1;
    for (let ly = wallTop + 2; ly < wallBot; ly += 11) {
      // mortar line
      r(0, ly, W, 2, '#150f2c');
    }
    // Brick column offsets (alternating)
    for (let ly = wallTop + 2; ly < wallBot; ly += 22) {
      const isEven = (((ly - wallTop) / 11) % 2) < 1;
      const offset = isEven ? 0 : 28;
      for (let bx2 = offset; bx2 < W; bx2 += 56) {
        r(bx2, ly, 1, 9, '#150f2c'); // vertical mortar
      }
    }

    // Subtle wall shading — left wall slightly lighter near bottom
    const wallShade = x.createLinearGradient(0, wallTop, 0, wallBot);
    wallShade.addColorStop(0, 'rgba(0,0,0,0.3)');
    wallShade.addColorStop(0.6, 'rgba(0,0,0,0)');
    wallShade.addColorStop(1, 'rgba(10,5,30,0.2)');
    x.fillStyle = wallShade; x.fillRect(0, wallTop, W, wallBot - wallTop);

    // ── Left building: windows ──
    const winData = [
      { x: 60,  y: wallTop + 10, w: 38, h: 52, lit: true,  litCol: '#ffe8a0' },
      { x: 140, y: wallTop + 10, w: 32, h: 48, lit: false, litCol: '' },
      { x: 60,  y: wallTop + 110, w: 38, h: 52, lit: false, litCol: '' },
      { x: 140, y: wallTop + 110, w: 32, h: 48, lit: true,  litCol: '#c0a0ff' },
      { x: 220, y: wallTop + 10, w: 36, h: 50, lit: true,  litCol: '#a0d8ff' },
      { x: 310, y: wallTop + 10, w: 32, h: 48, lit: false, litCol: '' },
      { x: 220, y: wallTop + 110, w: 36, h: 50, lit: false, litCol: '' },
      { x: 310, y: wallTop + 110, w: 32, h: 48, lit: true,  litCol: '#ffe8a0' },
    ];
    winData.forEach(w2 => {
      r(w2.x, w2.y, w2.w, w2.h, '#0d0a22');           // dark glass
      if (w2.lit) {
        x.globalAlpha = 0.22; r(w2.x, w2.y, w2.w, w2.h, w2.litCol); x.globalAlpha = 1;
      }
      // window frame
      r(w2.x - 2, w2.y - 2, w2.w + 4, 2, '#2a244c');
      r(w2.x - 2, w2.y + w2.h, w2.w + 4, 2, '#2a244c');
      r(w2.x - 2, w2.y - 2, 2, w2.h + 4, '#2a244c');
      r(w2.x + w2.w, w2.y - 2, 2, w2.h + 4, '#2a244c');
      // cross bar
      r(w2.x, w2.y + Math.floor(w2.h / 2), w2.w, 1, '#222040');
      r(w2.x + Math.floor(w2.w / 2), w2.y, 1, w2.h, '#222040');
    });

    // ── Right building: windows ──
    const rwinData = [
      { x: W - 100, y: wallTop + 10, w: 36, h: 52, lit: true,  litCol: '#ffd080' },
      { x: W - 180, y: wallTop + 10, w: 32, h: 48, lit: false, litCol: '' },
      { x: W - 260, y: wallTop + 10, w: 36, h: 52, lit: true,  litCol: '#c0ffcc' },
      { x: W - 100, y: wallTop + 110, w: 36, h: 52, lit: false, litCol: '' },
      { x: W - 180, y: wallTop + 110, w: 32, h: 48, lit: true,  litCol: '#a080ff' },
      { x: W - 340, y: wallTop + 10, w: 34, h: 50, lit: false, litCol: '' },
      { x: W - 340, y: wallTop + 110, w: 34, h: 50, lit: true,  litCol: '#ffd080' },
    ];
    rwinData.forEach(w2 => {
      r(w2.x, w2.y, w2.w, w2.h, '#0d0a22');
      if (w2.lit) {
        x.globalAlpha = 0.22; r(w2.x, w2.y, w2.w, w2.h, w2.litCol); x.globalAlpha = 1;
      }
      r(w2.x - 2, w2.y - 2, w2.w + 4, 2, '#2a244c');
      r(w2.x - 2, w2.y + w2.h, w2.w + 4, 2, '#2a244c');
      r(w2.x - 2, w2.y - 2, 2, w2.h + 4, '#2a244c');
      r(w2.x + w2.w, w2.y - 2, 2, w2.h + 4, '#2a244c');
      r(w2.x, w2.y + Math.floor(w2.h / 2), w2.w, 1, '#222040');
      r(w2.x + Math.floor(w2.w / 2), w2.y, 1, w2.h, '#222040');
    });

    // ── Left building: graffiti ──
    x.globalAlpha = 0.55; x.strokeStyle = P.pink; x.lineWidth = 2;
    x.beginPath(); x.moveTo(180, FLOOR_Y - 55); x.lineTo(198, FLOOR_Y - 68); x.lineTo(204, FLOOR_Y - 50); x.lineTo(184, FLOOR_Y - 40); x.closePath(); x.stroke();
    x.globalAlpha = 0.4; x.strokeStyle = P.purp; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(210, FLOOR_Y - 60); x.lineTo(230, FLOOR_Y - 68); x.lineTo(232, FLOOR_Y - 48); x.stroke();
    x.globalAlpha = 0.35; x.strokeStyle = P.teal; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(105, FLOOR_Y - 45); x.lineTo(130, FLOOR_Y - 52); x.stroke();
    x.beginPath(); x.moveTo(108, FLOOR_Y - 38); x.lineTo(128, FLOOR_Y - 42); x.stroke();
    x.globalAlpha = 1;

    // ── Right building: graffiti ──
    x.globalAlpha = 0.5; x.strokeStyle = P.teal; x.lineWidth = 2;
    x.beginPath(); x.moveTo(W - 200, FLOOR_Y - 58); x.lineTo(W - 178, FLOOR_Y - 70); x.lineTo(W - 172, FLOOR_Y - 48); x.lineTo(W - 196, FLOOR_Y - 40); x.closePath(); x.stroke();
    x.globalAlpha = 0.4; x.strokeStyle = P.pink; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(W - 130, FLOOR_Y - 62); x.lineTo(W - 108, FLOOR_Y - 55); x.stroke();
    x.beginPath(); x.moveTo(W - 128, FLOOR_Y - 50); x.lineTo(W - 112, FLOOR_Y - 45); x.stroke();
    x.globalAlpha = 1;

    // ── Fire escape — left side ──
    x.globalAlpha = 0.7; x.strokeStyle = '#3a3060'; x.lineWidth = 2;
    // Vertical rails
    x.beginPath(); x.moveTo(80, wallTop + 110); x.lineTo(80, FLOOR_Y); x.stroke();
    x.beginPath(); x.moveTo(96, wallTop + 110); x.lineTo(96, FLOOR_Y); x.stroke();
    // Rungs
    x.lineWidth = 1.5;
    for (let fy = wallTop + 120; fy < FLOOR_Y; fy += 18) {
      x.beginPath(); x.moveTo(60, fy); x.lineTo(110, fy); x.stroke();
    }
    // Platform
    r(58, wallTop + 108, 54, 4, '#302858');
    x.globalAlpha = 1;

    // ── Fire escape — mid right ──
    x.globalAlpha = 0.65; x.strokeStyle = '#3a3060'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(W - 90, wallTop + 100); x.lineTo(W - 90, FLOOR_Y); x.stroke();
    x.beginPath(); x.moveTo(W - 74, wallTop + 100); x.lineTo(W - 74, FLOOR_Y); x.stroke();
    x.lineWidth = 1.5;
    for (let fy = wallTop + 110; fy < FLOOR_Y; fy += 18) {
      x.beginPath(); x.moveTo(W - 112, fy); x.lineTo(W - 52, fy); x.stroke();
    }
    r(W - 114, wallTop + 98, 62, 4, '#302858');
    x.globalAlpha = 1;

    // ── Overhead pipes (run along full width near ceiling) ──
    r(0, wallTop + 4, W, 6, '#28224a');   // main fat pipe
    r(0, wallTop + 14, W, 3, '#221e42');  // secondary
    // Brackets
    [80, 200, 340, 480, 620, 760, 900].forEach(px => {
      r(px, wallTop, 8, 20, '#201c3c');
      r(px + 1, wallTop + 18, 6, 4, '#2c2850');
    });
    // Drip spots
    [130, 270, 420, 560, 700, 840].forEach(px => {
      r(px, wallTop + 4, 2, 14, '#201c3c');
    });

    // ── Dumpster (left third) ──
    const dumpX = 155, dumpY = FLOOR_Y - 44;
    r(dumpX, dumpY, 64, 44, '#241e48');        // body
    r(dumpX, dumpY, 64, 8, '#1c1840');         // lid
    r(dumpX - 2, dumpY - 3, 68, 3, '#342e5c'); // lid rim
    r(dumpX, dumpY, 1, 44, '#1e1840');
    r(dumpX + 63, dumpY, 1, 44, '#1e1840');
    r(dumpX, dumpY + 43, 64, 1, '#1e1840');
    r(dumpX + 22, dumpY + 8, 1, 36, '#1e1840');
    r(dumpX + 43, dumpY + 8, 1, 36, '#1e1840');
    // Graffiti on dumpster
    x.globalAlpha = 0.5; x.strokeStyle = P.pink; x.lineWidth = 2;
    x.beginPath(); x.moveTo(dumpX + 6, dumpY + 24); x.lineTo(dumpX + 17, dumpY + 16); x.lineTo(dumpX + 19, dumpY + 28); x.stroke();
    x.globalAlpha = 1;

    // ── Fortune Teller Machine (under the sconce, left of crates) ──
    {
      const mx = 302, my = FLOOR_Y - 68;
      // Cabinet body — mystic purple
      r(mx, my, 34, 68, '#26164e');
      r(mx + 2, my, 30, 68, '#322060');      // lighter face grain
      r(mx, my, 34, 3, '#5f42b6');           // top trim
      r(mx, my + 65, 34, 3, '#5f42b6');      // base trim
      r(mx, my, 2, 68, '#4b3390');           // left highlight edge
      r(mx + 32, my, 2, 68, '#140a32');      // right shadow
      // Wood grain lines
      r(mx + 8,  my + 10, 1, 50, '#281850');
      r(mx + 16, my + 5,  1, 58, '#2d1b5a');
      r(mx + 24, my + 12, 1, 45, '#281850');
      // Arch top
      r(mx + 4, my - 8, 26, 10, '#38225e');
      r(mx + 8, my - 14, 18, 8, '#3e2868');
      r(mx + 11, my - 18, 12, 6, '#443074');
      // Crystal ball window recess
      r(mx + 5, my + 6, 24, 24, '#120926');
      r(mx + 6, my + 7, 22, 22, '#181032');
      // Crystal ball
      x.globalAlpha = 0.85;
      x.fillStyle = '#6644cc';
      x.beginPath(); x.arc(mx + 17, my + 18, 9, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 0.5;
      x.fillStyle = '#aa88ff';
      x.beginPath(); x.arc(mx + 14, my + 15, 4, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 0.25;
      x.fillStyle = '#ffffff';
      x.beginPath(); x.arc(mx + 13, my + 14, 2, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
      // Ball pedestal
      r(mx + 13, my + 27, 8, 3, '#4b3390'); r(mx + 11, my + 29, 12, 2, '#4b3390');
      // Label panel
      r(mx + 4, my + 34, 26, 10, '#1a0f38'); r(mx + 5, my + 35, 24, 8, '#140b2c');
      // Stars on panel
      x.globalAlpha = 0.6; x.fillStyle = '#c0a0ff';
      x.fillRect(mx + 6, my + 37, 2, 2); x.fillRect(mx + 12, my + 36, 2, 2);
      x.fillRect(mx + 18, my + 38, 1, 1); x.fillRect(mx + 24, my + 36, 2, 2);
      x.globalAlpha = 1;
      // Coin slot
      r(mx + 11, my + 48, 12, 3, '#120926'); r(mx + 14, my + 49, 6, 1, '#0a0616');
      // Card slot
      r(mx + 8, my + 56, 18, 4, '#120926'); r(mx + 9, my + 57, 16, 2, '#0a0616');
      // Moon symbol
      x.globalAlpha = 0.4; x.fillStyle = '#9977ee';
      x.beginPath(); x.arc(mx + 3, my + 52, 5, 0.4, Math.PI * 2 - 0.4); x.fill();
      x.globalAlpha = 1;
    }

    // ── Tarot Card Machine (left of crates at x≈450) ──
    {
      const mx = 408, my = FLOOR_Y - 80;
      // Tall slim cabinet — mystic purple
      r(mx, my, 28, 80, '#22144a');
      r(mx + 2, my, 24, 80, '#2e1d5c');      // face grain
      r(mx, my, 28, 3, '#5f42b6');           // top trim
      r(mx, my + 77, 28, 3, '#5f42b6');      // base
      r(mx, my, 2, 80, '#4a3390');           // left edge highlight
      r(mx + 26, my, 2, 80, '#140a32');      // right shadow
      // Wood grain lines
      r(mx + 7,  my + 8,  1, 65, '#26164c');
      r(mx + 14, my + 4,  1, 72, '#2c1a58');
      r(mx + 21, my + 10, 1, 62, '#26164c');
      // Pointed top
      r(mx + 4, my - 6, 20, 8, '#34205e');
      r(mx + 8, my - 11, 12, 6, '#3a2668');
      r(mx + 11, my - 14, 6, 4, '#403072');
      // Card display window
      r(mx + 3, my + 6, 22, 32, '#120926');
      r(mx + 4, my + 7, 20, 30, '#181032');
      // Three fanned tarot cards
      x.globalAlpha = 0.9;
      x.fillStyle = '#2a2060'; x.fillRect(mx + 5, my + 9, 8, 14);
      x.fillStyle = '#3a3070'; x.fillRect(mx + 6, my + 11, 6, 10);
      x.globalAlpha = 0.4; x.strokeStyle = '#6655aa'; x.lineWidth = 0.5;
      x.strokeRect(mx + 6, my + 11, 6, 10);
      x.beginPath(); x.moveTo(mx + 6, my + 11); x.lineTo(mx + 12, my + 21); x.stroke();
      x.beginPath(); x.moveTo(mx + 12, my + 11); x.lineTo(mx + 6, my + 21); x.stroke();
      x.globalAlpha = 0.95; x.fillStyle = '#322870';
      x.fillRect(mx + 10, my + 8, 8, 15);
      x.fillStyle = '#221e56'; x.fillRect(mx + 11, my + 9, 6, 13);
      x.globalAlpha = 0.5; x.strokeStyle = '#8877cc'; x.lineWidth = 0.5;
      x.strokeRect(mx + 11, my + 9, 6, 13);
      x.beginPath(); x.moveTo(mx + 11, my + 9); x.lineTo(mx + 17, my + 22); x.stroke();
      x.beginPath(); x.moveTo(mx + 17, my + 9); x.lineTo(mx + 11, my + 22); x.stroke();
      x.globalAlpha = 0.9; x.fillStyle = '#2a2060';
      x.fillRect(mx + 15, my + 9, 8, 14);
      x.fillStyle = '#1e1a4e'; x.fillRect(mx + 16, my + 10, 6, 12);
      x.globalAlpha = 0.4; x.strokeStyle = '#6655aa'; x.lineWidth = 0.5;
      x.strokeRect(mx + 16, my + 10, 6, 12);
      x.beginPath(); x.moveTo(mx + 16, my + 10); x.lineTo(mx + 22, my + 22); x.stroke();
      x.beginPath(); x.moveTo(mx + 22, my + 10); x.lineTo(mx + 16, my + 22); x.stroke();
      x.globalAlpha = 1;
      // Label strip
      r(mx + 3, my + 42, 22, 8, '#1a0f38'); r(mx + 4, my + 43, 20, 6, '#140b2c');
      // Eye symbol
      x.globalAlpha = 0.55; x.strokeStyle = '#9977ee'; x.lineWidth = 1;
      x.beginPath(); x.ellipse(mx + 14, my + 46, 5, 3, 0, 0, Math.PI * 2); x.stroke();
      x.globalAlpha = 0.7; x.fillStyle = '#7755cc';
      x.beginPath(); x.arc(mx + 14, my + 46, 1.5, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
      // Coin slot
      r(mx + 9, my + 54, 10, 3, '#120926'); r(mx + 11, my + 55, 6, 1, '#0a0616');
      // Card output slot
      r(mx + 6, my + 62, 16, 4, '#120926'); r(mx + 7, my + 63, 14, 2, '#0a0616');
    }

    // ── Stacked crates (mid) ──
    const cX = 490, cY = FLOOR_Y;
    r(cX, cY - 30, 40, 30, '#1c1840');
    r(cX - 6, cY - 58, 44, 28, '#201c44');
    r(cX - 6, cY - 58, 44, 1, '#302c58');
    r(cX, cY - 30, 40, 1, '#302c58');
    // slats
    r(cX + 13, cY - 58, 1, 28, '#181440'); r(cX + 27, cY - 58, 1, 28, '#181440');
    r(cX + 14, cY - 30, 1, 30, '#181440'); r(cX + 27, cY - 30, 1, 30, '#181440');

    // ── Barrel cluster (right third) ──
    const bX = 700, bY = FLOOR_Y;
    r(bX, bY - 34, 22, 34, '#1e1844');
    r(bX - 1, bY - 36, 24, 4, '#16123a'); r(bX - 1, bY - 22, 24, 3, '#16123a'); r(bX - 1, bY - 6, 24, 3, '#16123a');
    r(bX + 24, bY - 28, 20, 28, '#1c1640');
    r(bX + 23, bY - 30, 22, 4, '#141038'); r(bX + 23, bY - 16, 22, 3, '#141038');

    // ── Subway entrance (far right) ──
    const sx = SUBWAY_X;
    // Arch body — darker than wall
    r(sx - 32, FLOOR_Y - 80, 64, 80, '#100c28');
    r(sx - 26, FLOOR_Y - 94, 52, 16, '#100c28');
    r(sx - 18, FLOOR_Y - 102, 36, 10, '#100c28');
    // Frame
    r(sx - 34, FLOOR_Y - 82, 3, 82, '#3a3068'); r(sx + 31, FLOOR_Y - 82, 3, 82, '#3a3068');
    r(sx - 34, FLOOR_Y - 82, 68, 3, '#3a3068');
    x.globalAlpha = 0.7; x.strokeStyle = '#4a4080'; x.lineWidth = 2;
    x.beginPath(); x.arc(sx, FLOOR_Y - 82, 32, Math.PI, 0); x.stroke();
    x.globalAlpha = 1;
    // Grate
    x.globalAlpha = 0.7; x.strokeStyle = '#2e2860'; x.lineWidth = 1.5;
    for (let gx2 = sx - 30; gx2 <= sx + 30; gx2 += 10) {
      x.beginPath(); x.moveTo(gx2, FLOOR_Y - 78); x.lineTo(gx2, FLOOR_Y - 2); x.stroke();
    }
    x.lineWidth = 1;
    for (let gy2 = FLOOR_Y - 76; gy2 < FLOOR_Y; gy2 += 14) {
      x.beginPath(); x.moveTo(sx - 30, gy2); x.lineTo(sx + 30, gy2); x.stroke();
    }
    x.globalAlpha = 1;
    // Purple glow from below
    const gGrad = x.createLinearGradient(sx, FLOOR_Y - 80, sx, FLOOR_Y);
    gGrad.addColorStop(0, 'rgba(80,40,180,0.08)'); gGrad.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gGrad; x.fillRect(sx - 30, FLOOR_Y - 80, 60, 80);
    // Sign bar above arch
    r(sx - 38, FLOOR_Y - 118, 76, 18, '#100e28');
    r(sx - 38, FLOOR_Y - 118, 76, 2, '#3a3068'); r(sx - 38, FLOOR_Y - 100, 76, 2, '#3a3068');
    r(sx - 38, FLOOR_Y - 118, 2, 18, '#3a3068'); r(sx + 38, FLOOR_Y - 118, 2, 18, '#3a3068');
    // CLOSED indicator — red glow dot + text
    x.save();
    x.shadowColor = '#ff2222'; x.shadowBlur = 8;
    x.fillStyle = '#ff3333'; x.beginPath(); x.arc(sx - 22, FLOOR_Y - 109, 3, 0, Math.PI * 2); x.fill();
    x.shadowBlur = 0;
    x.font = 'bold 10px "Courier New"'; x.fillStyle = '#ff4444'; x.textAlign = 'left';
    x.fillText('CLOSED', sx - 14, FLOOR_Y - 104);
    x.restore();
    // Steps
    r(sx - 28, FLOOR_Y - 10, 56, 10, '#0e0c26');
    r(sx - 22, FLOOR_Y - 2, 44, 6, '#0c0a22');

    // ── Alley floor ──
    const flGrad = x.createLinearGradient(0, FLOOR_Y, 0, GAME_HEIGHT);
    flGrad.addColorStop(0, '#181438'); flGrad.addColorStop(0.4, '#12102e'); flGrad.addColorStop(1, '#0e0c28');
    x.fillStyle = flGrad; x.fillRect(0, FLOOR_Y, W, GAME_HEIGHT - FLOOR_Y);
    // Floor tile seams
    x.globalAlpha = 0.35;
    for (let fx = 48; fx < W; fx += 48) { r(fx, FLOOR_Y, 1, GAME_HEIGHT - FLOOR_Y, '#0c0a20'); }
    for (let fy2 = FLOOR_Y + 18; fy2 < GAME_HEIGHT; fy2 += 20) { r(0, fy2, W, 1, '#0a0820'); }
    x.globalAlpha = 1;

    // Puddles
    x.globalAlpha = 0.18; x.fillStyle = P.dpurp;
    x.beginPath(); x.ellipse(240, FLOOR_Y + 10, 100, 10, 0, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 0.15; x.fillStyle = '#5566ff';
    x.beginPath(); x.ellipse(630, FLOOR_Y + 10, 80, 8, 0, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;

    // ── Rooftop silhouettes at top (building outlines against sky) ──
    x.fillStyle = '#0e0c24';
    x.fillRect(0, 0, 55, wallTop + 4);
    x.fillRect(100, 0, 18, wallTop - 6);
    x.fillRect(200, 0, 24, wallTop - 2);
    x.fillRect(280, 0, 14, wallTop - 8);
    x.fillRect(360, 0, 20, wallTop - 4);
    x.fillRect(480, 0, 16, wallTop - 10);
    x.fillRect(580, 0, 22, wallTop - 6);
    x.fillRect(700, 0, 12, wallTop - 3);
    x.fillRect(800, 0, 18, wallTop - 7);
    x.fillRect(900, 0, 24, wallTop - 5);
    x.fillRect(W - 40, 0, 40, wallTop + 4);

    // ── Vignette (darken corners) ──
    const vg = x.createRadialGradient(W / 2, GAME_HEIGHT / 2, W * 0.1, W / 2, GAME_HEIGHT / 2, W * 0.65);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,15,0.55)');
    x.fillStyle = vg; x.fillRect(0, 0, W, GAME_HEIGHT);

    return c;
  }

  // ══════════════════════════════════════════════════════════════════
  // PARTICLES
  // ══════════════════════════════════════════════════════════════════
  private spawnParticles(): void {
    // Water drips from pipe joints
    [200, 680].forEach(px => {
      for (let i = 0; i < 2; i++) {
        this.drips.push({
          x: px + (Math.random() - 0.5) * 4,
          y: 88 + Math.random() * 30,
          vy: 3.5 + Math.random() * 2.0,
          len: 5 + Math.random() * 6,
          alpha: 0.3 + Math.random() * 0.35,
        });
      }
    });
    // Steam from floor grate near dumpster
    for (let i = 0; i < 5; i++) {
      this.steams.push(this.newSteam(210 + Math.random() * 10));
    }
  }

  private newSteam(px: number): { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number } {
    return {
      x: px, y: FLOOR_Y,
      vx: (Math.random() - 0.5) * 0.25,
      vy: -(0.3 + Math.random() * 0.45),
      life: 0,
      maxLife: 90 + Math.random() * 70,
      size: 2 + Math.random() * 3,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // PLAYER
  // ══════════════════════════════════════════════════════════════════
  private createPlayer(): void {
    const avatar = getAvatar();
    for (let i = 0; i < 4; i++) { if (this.textures.exists(`player_walk${i}`)) this.textures.remove(`player_walk${i}`); this.textures.addCanvas(`player_walk${i}`, renderHubSprite(avatar, i)); }
    itemImagesReady.then(() => {
      const av = getAvatar();
      for (let i = 0; i < 4; i++) { if (this.textures.exists(`player_walk${i}`)) this.textures.remove(`player_walk${i}`); this.textures.addCanvas(`player_walk${i}`, renderHubSprite(av, i)); }
      if (this.textures.exists('player')) this.textures.remove('player');
      this.textures.addCanvas('player', renderHubSprite(av));
      this.player?.setTexture('player');
    });

    const spawnX = EXIT_X + 80;
    this.player = this.add.image(spawnX, this.playerY, 'player').setOrigin(0.5, 1).setScale(2).setDepth(10);
    this.playerSprite = this.player;
    this.player.setFlipX(true);

    const name = this.registry.get('playerName') || 'guest';
    const status = getStatus();

    this.playerName = this.add.text(spawnX, this.playerY + 14, name.slice(0, 14), {
      fontFamily: '"Courier New", monospace', fontSize: '9px',
      color: P.lpurp, align: 'center',
      backgroundColor: '#04081088', padding: { x: 3, y: 1 },
    }).setOrigin(0.5).setDepth(11);

    this.playerStatusText = this.add.text(spawnX, this.playerY + 26, status.slice(0, 30), {
      fontFamily: '"Courier New", monospace', fontSize: '8px',
      color: P.lpurp, align: 'center',
    }).setOrigin(0.5).setDepth(11).setAlpha(status ? 1 : 0);
  }

  // ══════════════════════════════════════════════════════════════════
  // OTHER PLAYERS
  // ══════════════════════════════════════════════════════════════════
  protected override getPlayerSprite(): Phaser.GameObjects.Image { return this.player; }
  protected override getBubbleYOffset(): number { return -72; }
  protected override onPlayerJoinGuard(_p: { pubkey: string }): boolean { return !this.isLeavingScene; }
  protected override handleSceneEsc(): boolean {
    if (FortuneTellerModal.isOpen()) { FortuneTellerModal.destroy(); return true; }
    if (TarotModal.isOpen()) { TarotModal.destroy(); return true; }
    return false;
  }

  protected override getOtherPlayerConfig(): import('./BaseScene').OtherPlayerConfig {
    return {
      texKeyPrefix: 'avatar_hub_', scale: 2,
      nameYOffset: +14, statusYOffset: +26,
      nameColor: P.lpurp, nameFontSize: '9px', statusFontSize: '8px',
      nameBg: '#04081088', namePadding: { x: 3, y: 1 },
      czW: 40, czH: 60, czYOffset: -50,
      tintPalette: [0xe87aab, 0x7b68ee, 0x5dcaa5, 0xfad480, 0xb8a8f8],
      useFadeIn: false, interpolateY: false, emoteContext: 'cabin',
    };
  }
  protected override renderOtherAvatar(cfg: import('../stores/avatarStore').AvatarConfig): HTMLCanvasElement {
    return renderHubSprite(cfg);
  }

  // ══════════════════════════════════════════════════════════════════
  // UPDATE
  // ══════════════════════════════════════════════════════════════════
  update(time: number, delta: number): void {
    this.updateMovement();
    if (this.player.x <= EXIT_X + 10 && !this.isLeavingScene) {
      this.isLeavingScene = true;
      this.leaveToHub();
      return;
    }
    this.updateParticles(delta);
    this.updateNeon(delta);
    this.updateFortuneProximity();
    this.updateTarotProximity();
    this.updateSubwayProximity();

    const isWalking = this.isKeyboardMoving || this.isMoving || this.targetX !== null;
    if (isWalking) {
      this.footTimer += delta; if (this.footTimer >= 300) { this.footTimer = 0; this.snd.footstep(); }
      this.walkTime += delta;
      const bobOffset = Math.abs(Math.sin(this.walkTime * Math.PI / 150)) * -2;
      this.player.y = this.playerY + bobOffset;
      const nf = Math.floor(this.walkTime / 150) % 4;
      if (nf !== this.walkFrame) { this.walkFrame = nf; this.player.setTexture(`player_walk${this.walkFrame}`); }
    } else {
      this.walkTime = 0;
      if (this.walkFrame >= 0) { this.walkFrame = -1; this.player.setTexture('player'); }
      this.player.y = this.playerY;
    }

    this.emoteGraphics.clear();
    this.emoteSet.updateAll(this.emoteGraphics, delta, this.player.x, this.player.y, this.facingRight, 'cabin', isWalking);
    this.player.setAlpha(this.emoteSet.isActive('ghost') ? 0.3 : 1);

    this.playerName.setPosition(this.player.x, this.player.y + 14);
    this.playerStatusText.setPosition(this.player.x, this.player.y + 26);
    sendPosition(this.player.x, this.player.y, this.facingRight);

    this.updateOtherPlayers(time, delta);
    this.updateLocalNameColor(time, delta);
  }

  private updateMovement(): void {
    if (!isPresenceReady()) return;
    const c = this.input.keyboard?.createCursorKeys();
    let vx = 0;
    if (c) {
      if (c.left.isDown) vx = -ALLEY_SPEED;
      else if (c.right.isDown) vx = ALLEY_SPEED;
    }
    if (vx === 0) {
      if (this.mobileLeft) vx = -ALLEY_SPEED;
      else if (this.mobileRight) vx = ALLEY_SPEED;
    }
    this.isKeyboardMoving = vx !== 0;

    if (vx !== 0) {
      this.targetX = null;
      this.isMoving = false;
      this.player.x += vx / 60;
      this.facingRight = vx > 0;
    } else if (this.isMoving && this.targetX !== null) {
      const dx = this.targetX - this.player.x;
      if (Math.abs(dx) < 3) {
        this.isMoving = false;
        this.targetX = null;
      } else {
        this.player.x += Math.sign(dx) * ALLEY_SPEED / 60;
        this.facingRight = dx > 0;
      }
    }

    this.player.x = Phaser.Math.Clamp(this.player.x, 20, W - 28);
    this.player.setFlipX(!this.facingRight);
  }

  // ══════════════════════════════════════════════════════════════════
  // PARTICLES
  // ══════════════════════════════════════════════════════════════════
  private updateParticles(delta: number): void {
    const g = this.fxGraphics;
    g.clear();

    // Water drips from pipes
    this.drips.forEach(d => {
      d.y += d.vy * (delta / 16);
      if (d.y > FLOOR_Y + 5) { d.y = 88 + Math.random() * 12; d.vy = 5.0 + Math.random() * 2.0; d.alpha = 0.3 + Math.random() * 0.35; }
      g.lineStyle(1, 0x6688bb, d.alpha);
      g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x, d.y + d.len); g.strokePath();
    });

    // Steam from grate
    this.steams.forEach((s, i) => {
      s.life += delta / 16;
      s.x += s.vx; s.y += s.vy;
      if (s.life >= s.maxLife) { this.steams[i] = this.newSteam(210 + Math.random() * 10); return; }
      const progress = s.life / s.maxLife;
      const alpha = progress < 0.3 ? (progress / 0.3) * 0.12 : (1 - progress) * 0.12;
      g.fillStyle(0x9999bb, alpha);
      g.fillCircle(s.x, s.y, s.size * (1 + progress * 0.8));
    });

    // Overhead dark gradient
    const camX = this.cameras.main.scrollX;
    const GAME_WIDTH = this.sys.scale.width;
    g.fillGradientStyle(0x010006, 0x010006, 0x060010, 0x060010, 0.9, 0.9, 0, 0);
    g.fillRect(camX, 0, GAME_WIDTH, 48);
  }

  private updateNeon(delta: number): void {
    this.flickerTimer += delta;
    if (this.flickerTimer > 220) {
      this.flickerTimer = 0;
      this.neonFlicker++;
      this.neonOn = !(this.neonFlicker % 61 === 0 || this.neonFlicker % 97 === 0);
    }

    const g = this.neonGraphics;
    g.clear();

    // ── Wall sconce hardware — always visible, never affected by neonOn ──
    const sconceX = 370;
    const sconceY = FLOOR_Y - 110;
    g.lineStyle(2, 0x3a3060, 1);
    g.beginPath(); g.moveTo(sconceX - 14, sconceY - 4); g.lineTo(sconceX, sconceY - 4); g.strokePath();
    g.beginPath(); g.moveTo(sconceX, sconceY - 4); g.lineTo(sconceX, sconceY + 6); g.strokePath();
    g.lineStyle(1.5, 0x4a4080, 1);
    g.strokeRect(sconceX - 5, sconceY + 5, 10, 9);

    if (!this.neonOn) return;

    const t = Date.now();
    const pulse = 0.5 + Math.sin(t * 0.003) * 0.28;
    const flicker = 0.72 + Math.sin(t * 0.0031) * 0.16 + Math.sin(t * 0.0089) * 0.06;

    // Only the emitted light flickers
    g.fillStyle(0xffe8a0, flicker * 0.95);
    g.fillRect(sconceX - 3, sconceY + 7, 6, 5);   // bulb inside cage

    g.fillStyle(0xffe8a0, flicker * 0.55);
    g.fillCircle(sconceX, sconceY + 10, 7);
    g.fillStyle(0xfff0c0, flicker * 0.18);
    g.fillCircle(sconceX, sconceY + 10, 16);

    // Light cone downward
    g.fillStyle(0xffe8a0, flicker * 0.055);
    g.fillTriangle(sconceX - 4, sconceY + 14, sconceX + 4, sconceY + 14, sconceX + 70, FLOOR_Y);
    g.fillTriangle(sconceX - 4, sconceY + 14, sconceX + 4, sconceY + 14, sconceX - 70, FLOOR_Y);

    // Floor pool
    g.fillStyle(0xffe8a0, flicker * 0.10);
    g.fillEllipse(sconceX, FLOOR_Y + 7, 140, 16);
    g.fillStyle(0xfff0c0, flicker * 0.07);
    g.fillEllipse(sconceX, FLOOR_Y + 5, 60, 8);

    // Neon arrow on left wall
    const nx = 44, ny = 130;
    g.lineStyle(2, hexToNum(P.pink), pulse * 0.85);
    g.beginPath();
    g.moveTo(nx, ny); g.lineTo(nx + 16, ny);
    g.moveTo(nx + 12, ny - 4); g.lineTo(nx + 16, ny); g.lineTo(nx + 12, ny + 4);
    g.strokePath();
    g.lineStyle(7, hexToNum(P.pink), pulse * 0.1);
    g.beginPath(); g.moveTo(nx, ny); g.lineTo(nx + 16, ny); g.strokePath();

    // Puddle reflections — only for the two puddles that still exist
    if (this.cameras.main.scrollX < 300) {
      g.fillStyle(hexToNum(P.dpurp), 0.04 + Math.sin(t * 0.002) * 0.02);
      g.fillEllipse(220, FLOOR_Y + 12, 90, 10);
    }
    if (this.cameras.main.scrollX > 400) {
      g.fillStyle(0x4466ff, 0.04 + Math.sin(t * 0.002 + 1) * 0.015);
      g.fillEllipse(600, FLOOR_Y + 10, 70, 7);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // EXIT & SUBWAY PROXIMITY
  // ══════════════════════════════════════════════════════════════════
  private updateTarotProximity(): void {
    if (TarotModal.isOpen()) return;
    const near = Math.abs(this.player.x - TAROT_X) <= TAROT_RANGE;
    if (near !== this.nearTarot) {
      this.nearTarot = near;
      this.tarotPromptBg.setVisible(near);
      this.tarotPromptText.setVisible(near);
      this.tarotPromptArrow.setVisible(near);
      if (!near) this.tweens.killTweensOf(this.tarotPromptArrow);
    }
    if (near) {
      const zoom = this.cameras.main.zoom;
      const sx = TAROT_X - this.cameras.main.scrollX;
      const sy = this.player.y - this.cameras.main.scrollY - 130 / zoom;
      this.tarotPromptBg.setPosition(sx - 74, sy - 2);
      this.tarotPromptText.setPosition(sx, sy + 12);
      this.tarotPromptArrow.setPosition(sx, sy + 24);
      if (!this.tweens.isTweening(this.tarotPromptArrow)) {
        this.tweens.add({ targets: this.tarotPromptArrow, y: sy + 28, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
  }

  private updateFortuneProximity(): void {
    if (FortuneTellerModal.isOpen()) return;
    const near = Math.abs(this.player.x - FORTUNE_X) <= FORTUNE_RANGE;
    if (near !== this.nearFortune) {
      this.nearFortune = near;
      this.fortunePromptBg.setVisible(near);
      this.fortunePromptText.setVisible(near);
      this.fortunePromptArrow.setVisible(near);
      if (!near) this.tweens.killTweensOf(this.fortunePromptArrow);
    }
    if (near) {
      const zoom = this.cameras.main.zoom;
      const sx = FORTUNE_X - this.cameras.main.scrollX;
      const sy = this.player.y - this.cameras.main.scrollY - 130 / zoom;
      this.fortunePromptBg.setPosition(sx - 74, sy - 2);
      this.fortunePromptText.setPosition(sx, sy + 12);
      this.fortunePromptArrow.setPosition(sx, sy + 24);
      if (!this.tweens.isTweening(this.fortunePromptArrow)) {
        this.tweens.add({ targets: this.fortunePromptArrow, y: sy + 28, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
  }



  private updateSubwayProximity(): void {
    const near = Math.abs(this.player.x - SUBWAY_X) < 60;
    if (near !== this.nearSubway) {
      this.nearSubway = near;
      this.subwayPromptBg.setVisible(near);
      this.subwayPromptText.setVisible(near);
      this.subwayPromptArrow.setVisible(near);
      if (!near) this.tweens.killTweensOf(this.subwayPromptArrow);
    }
    if (near) {
      const px = SUBWAY_X, py = this.player.y - 130;
      this.subwayPromptBg.setPosition(px - 84, py - 2);
      this.subwayPromptText.setPosition(px, py + 8);
      this.subwayPromptArrow.setPosition(px, py + 22);
      if (!this.tweens.isTweening(this.subwayPromptArrow)) {
        this.tweens.add({ targets: this.subwayPromptArrow, y: py + 26, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // LEAVE
  // ══════════════════════════════════════════════════════════════════
  private leaveToHub(): void {
    this.snd.roomLeave();
    sendRoomChange('hub');
    this.chatUI.destroy();
    this.cameras.main.fadeOut(320, 0, 0, 0);
    this.time.delayedCall(320, () => {
      this.scene.start('HubScene', { _returning: true, fromRoom: 'alley' });
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // COMMANDS
  // ══════════════════════════════════════════════════════════════════
  protected override getSceneAccent(): string { return P.lpurp; }

  private handleCommand(text: string): void {
    const parts = text.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ').trim();

    switch (cmd) {
      case 'leave': case 'exit': case 'out': {
        if (!this.isLeavingScene) {
          this.isLeavingScene = true;
          this.leaveToHub();
        }
        break;
      }
      default: {
        if (!this.handleCommonCommand(cmd, arg))
          this.chatUI.addMessage('system', `Unknown: /${cmd}`, P.amber);
        break;
      }
    }
    this.chatUI.flashLog();
  }

}

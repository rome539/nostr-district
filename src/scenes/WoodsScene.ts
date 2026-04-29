/**
 * WoodsScene.ts — Standalone scrolling outdoor scene
 *
 * A wide (1600px) moonlit forest with a campfire clearing, dense trees,
 * a lake with a walkable dock, fireflies, and ambient particle effects.
 * Player walks right to return to the district hub.
 *
 * Follows HubScene's scrolling-world pattern with camera follow + parallax.
 * Uses hub-scale sprites (20×40) like HubScene.
 */

import Phaser from 'phaser';
import { BaseScene } from './BaseScene';
import { captureThumb } from '../stores/sceneThumbs';
import { getStatus } from '../stores/statusStore';
import { onNextAvatarSync, signEvent, publishEvent } from '../nostr/nostrService';
import { authStore } from '../stores/authStore';
import { GAME_WIDTH, GAME_HEIGHT, WORLD_WIDTH, GROUND_Y, PLAYER_SPEED, P, ANIM, hexToNum, hexToRgb } from '../config/game.config';
import {
  sendPosition, sendChat, sendRoomChange,
  requestOnlinePlayers, setOnlinePlayersHandler,
  isPresenceReady,
} from '../nostr/presenceService';

import { ChatUI } from '../ui/ChatUI';
import { ProfileModal } from '../ui/ProfileModal';
import { EMOTE_FLAVORS, EMOTE_OFF_MSGS } from '../entities/EmoteSet';
import { renderHubSprite, itemImagesReady } from '../entities/AvatarRenderer';
import { getAvatar } from '../stores/avatarStore';
import { ROD_SKINS } from '../stores/marketStore';

const WOODS_ACCENT = '#aaff44';

// ── Legendary fish image map ──
const LEGENDARY_FISH_IMAGES: Record<string, string> = {
  'ostrich':               '/assets/fish/fish_ostrich.png',
  'golden satoshi coin':   '/assets/fish/fish_coin.png',
  'enchanted trident':     '/assets/fish/fish_trident.png',
  'leviathan coelacanth':  '/assets/fish/fish_coelacanth.png',
  'meteor from Andromeda': '/assets/fish/fish_meteor.png',
};

const NIP96_HOSTS = [
  'https://nostr.build/api/v2/upload/files',
  'https://nostrcheck.me/api/v2/media',
];

async function tryNip96Upload(uploadUrl: string, blob: Blob): Promise<string | null> {
  try {
    const authEvent = await signEvent({
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['u', uploadUrl], ['method', 'POST']],
      content: '',
    });
    const form = new FormData();
    form.append('file', blob, 'fish.png');
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: { Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}` },
      body: form,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (
      json?.data?.[0]?.url ??
      json?.data?.url ??
      json?.nip94_event?.tags?.find((t: string[]) => t[0] === 'url')?.[1] ??
      null
    );
  } catch { return null; }
}

async function uploadFishImage(fishName: string): Promise<string | null> {
  const src = LEGENDARY_FISH_IMAGES[fishName];
  if (!src) return null;
  const fallback = `${window.location.origin}${src}`;
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      const scale = 4;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth * scale;
      canvas.height = img.naturalHeight * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async blob => {
        if (!blob) { resolve(fallback); return; }
        for (const host of NIP96_HOSTS) {
          const url = await tryNip96Upload(host, blob);
          if (url) { resolve(url); return; }
        }
        resolve(fallback);
      }, 'image/png');
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
const W = WORLD_WIDTH; // 1600

// ── Layout constants ──
const FLOOR_Y     = GROUND_Y;       // ground level (340)
const LAKE_LEFT   = 0;
const LAKE_RIGHT  = 600;
const DOCK_X      = 380;
const DOCK_END_X  = LAKE_RIGHT; // dock right end connects to shore
const FIRE_X      = 720;
const FIRE_Y      = FLOOR_Y + 12;
const CABIN_X     = 900;   // cabin left wall
const CABIN_W     = 116;   // cabin body width
const CABIN_DOOR_X = CABIN_X + 78; // door center x (978)
const TELESCOPE_X  = 1170;         // telescope center x

// ── Particles ──
interface Firefly { x: number; y: number; vx: number; vy: number; phase: number; size: number; }
interface Ember { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; }
interface Ripple { x: number; y: number; radius: number; maxRadius: number; alpha: number; }
interface ChimneyPuff { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; }

export class WoodsScene extends BaseScene {
  private player!: Phaser.GameObjects.Image;
  private playerGlow!: Phaser.GameObjects.Graphics;

  private parallaxBg!: Phaser.GameObjects.Image;
  private fireflyGraphics!: Phaser.GameObjects.Graphics;
  private campfireGraphics!: Phaser.GameObjects.Graphics;
  private waterGraphics!: Phaser.GameObjects.Graphics;

  private fireflies: Firefly[] = [];
  private embers: Ember[] = [];
  private ripples: Ripple[] = [];
  private rippleTimer = 0;
  private chimneyPuffs: ChimneyPuff[] = [];
  private chimneyGraphics!: Phaser.GameObjects.Graphics;
  private shootingStar: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number } | null = null;
  private shootingStarTimer = 0;
  private shootingStarGraphics!: Phaser.GameObjects.Graphics;
  private spawnX = 1400;
  private nearCabin = false;
  private cabinPromptBg!: Phaser.GameObjects.Graphics;
  private cabinPromptText!: Phaser.GameObjects.Text;
  private cabinPromptArrow!: Phaser.GameObjects.Text;
  private nearTelescope = false;
  private telescopePromptBg!: Phaser.GameObjects.Graphics;
  private telescopePromptText!: Phaser.GameObjects.Text;
  private telescopePromptArrow!: Phaser.GameObjects.Text;
  private telescopeOverlay: HTMLElement | null = null;

  private boatGraphics!: Phaser.GameObjects.Graphics;

  // boat prompt
  private nearBoat = false;
  private boatPromptBg!: Phaser.GameObjects.Graphics;
  private boatPromptText!: Phaser.GameObjects.Text;
  private boatPromptArrow!: Phaser.GameObjects.Text;

  // fishing
  private nearDockTip = false;
  private fishingState: 'idle' | 'waiting' | 'bite' = 'idle';
  private fishingLineGraphics!: Phaser.GameObjects.Graphics;
  private fishingTimer = 0;
  private fishingBiteMs = 0;
  private fishingBobPhase = 0;
  private fishingCastDist = 0;   // random offset for bobber X each cast
  private dockPromptBg!: Phaser.GameObjects.Graphics;
  private dockPromptText!: Phaser.GameObjects.Text;
  private dockPromptArrow!: Phaser.GameObjects.Text;

  constructor() { super({ key: 'WoodsScene' }); }
  init(data?: { fromCabin?: boolean }): void { super.init(data); this.spawnX = data?.fromCabin ? CABIN_DOOR_X - 10 : 1400; }

  create(): void {
    this.renderParallaxLayer();
    this.renderMainBackground();
    this.parallaxBg = this.add.image(W / 2, GAME_HEIGHT / 2, 'woods_parallax').setDepth(-2).setAlpha(0.6);
    this.add.image(W / 2, GAME_HEIGHT / 2, 'woods_bg').setDepth(-1);

    this.shootingStarGraphics = this.add.graphics().setDepth(-1);
    this.waterGraphics = this.add.graphics().setDepth(1);
    this.boatGraphics = this.add.graphics().setDepth(2);
    this.drawBoat();
    this.campfireGraphics = this.add.graphics().setDepth(3);
    this.chimneyGraphics = this.add.graphics().setDepth(4);
    this.fireflyGraphics = this.add.graphics().setDepth(12);
    this.emoteGraphics = this.add.graphics().setDepth(15);

    this.fireflies = [];
    for (let i = 0; i < 50; i++) {
      this.fireflies.push({
        x: 40 + Math.random() * (W - 80), y: 40 + Math.random() * (FLOOR_Y - 60),
        vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.3,
        phase: Math.random() * Math.PI * 2, size: 1.5 + Math.random() * 1.5,
      });
    }

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
    this.setupMobileCamera();

    this.input.on('pointerdown', (p: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
      if ((p.event.target as HTMLElement)?.tagName !== 'CANVAS') return;
      if (currentlyOver.length > 0) return;
      if (p.worldY < FLOOR_Y - 10 || p.worldY > 460) return;
      if (p.worldX < DOCK_X) return;
      this.targetX = Phaser.Math.Clamp(p.worldX, DOCK_X, W - 20);
      this.isMoving = true;
    });

    const myPubkey = this.registry.get('playerPubkey');
    this.snd.setRoom('woods');
    this.chatUI = new ChatUI();
    this.chatInput = this.chatUI.create('Chat in the woods...', WOODS_ACCENT, (cmd) => this.handleCommand(cmd));
    this.createMobileControls();
    this.chatUI.setNameClickHandler((pubkey, name) => { const op = this.otherPlayers.get(pubkey); ProfileModal.show(pubkey, name, op?.avatar, op?.status); });

    this.setupRegistryPanels(myPubkey);
    this.setupCommonKeyboardHandlers();

    this.setupEscHandler();

    // Cabin door prompt
    this.cabinPromptBg = this.add.graphics().setDepth(50).setVisible(false);
    this.cabinPromptBg.fillStyle(0x080502, 0.9); this.cabinPromptBg.fillRoundedRect(0, 0, 128, 28, 5);
    this.cabinPromptBg.lineStyle(1, 0x6a3c10, 0.6); this.cabinPromptBg.strokeRoundedRect(0, 0, 128, 28, 5);
    this.cabinPromptText = this.add.text(0, 0, this.sys.game.device.input.touch ? '[TAP] Enter CABIN' : '[E] Enter CABIN', { fontFamily: '"Courier New", monospace', fontSize: '10px', color: '#f0a030', fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.cabinPromptArrow = this.add.text(0, 0, '▼', { fontFamily: 'monospace', fontSize: '9px', color: '#f0a030' }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.cabinPromptBg.setInteractive(new Phaser.Geom.Rectangle(0, 0, 128, 28), Phaser.Geom.Rectangle.Contains);
    this.cabinPromptBg.on('pointerdown', () => {
      if (document.querySelector('.dm-panel.dm-open, .cp-panel.cp-open, .cp-modal-overlay')) return;
      if (this.nearCabin && !this.isLeavingScene) { this.isLeavingScene = true; this.enterCabin(); }
    });
    this.input.keyboard?.on('keydown-E', () => {
      if (document.activeElement === this.chatInput) return;
      if (document.querySelector('.dm-panel.dm-open, .cp-panel.cp-open, .cp-modal-overlay')) return;
      if (this.nearCabin && !this.isLeavingScene) { this.isLeavingScene = true; this.enterCabin(); return; }
      if (this.nearTelescope) { this.openTelescopeView(); return; }
      if (this.nearDockTip) { this.handleFishingPress(); }
    });

    // Telescope prompt
    this.telescopePromptBg = this.add.graphics().setDepth(50).setVisible(false);
    this.telescopePromptBg.fillStyle(0x050510, 0.92); this.telescopePromptBg.fillRoundedRect(0, 0, 120, 28, 5);
    this.telescopePromptBg.lineStyle(1, 0x334488, 0.7); this.telescopePromptBg.strokeRoundedRect(0, 0, 120, 28, 5);
    this.telescopePromptText = this.add.text(0, 0, '[E] Look Up', { fontFamily: '"Courier New", monospace', fontSize: '10px', color: '#8ab4ff', fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.telescopePromptArrow = this.add.text(0, 0, '▼', { fontFamily: 'monospace', fontSize: '9px', color: '#8ab4ff' }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.telescopePromptBg.setInteractive(new Phaser.Geom.Rectangle(0, 0, 120, 28), Phaser.Geom.Rectangle.Contains);
    this.telescopePromptBg.on('pointerdown', () => {
      if (document.querySelector('.dm-panel.dm-open, .cp-panel.cp-open, .cp-modal-overlay')) return;
      if (this.nearTelescope) this.openTelescopeView();
    });

    // Dock / fishing prompt
    this.fishingLineGraphics = this.add.graphics().setDepth(2);
    this.dockPromptBg = this.add.graphics().setDepth(50).setVisible(false);
    this.dockPromptBg.fillStyle(0x020c0a, 0.92); this.dockPromptBg.fillRoundedRect(0, 0, 116, 28, 5);
    this.dockPromptBg.lineStyle(1, 0x1a5040, 0.7); this.dockPromptBg.strokeRoundedRect(0, 0, 116, 28, 5);
    this.dockPromptText = this.add.text(0, 0, this.sys.game.device.input.touch ? '[TAP] Cast Line' : '[E] Cast Line', {
      fontFamily: '"Courier New", monospace', fontSize: '10px', color: '#5dcaa5', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.dockPromptArrow = this.add.text(0, 0, '▼', { fontFamily: 'monospace', fontSize: '9px', color: '#5dcaa5' }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.dockPromptBg.setInteractive(new Phaser.Geom.Rectangle(0, 0, 116, 28), Phaser.Geom.Rectangle.Contains);
    this.dockPromptBg.on('pointerdown', () => {
      if (document.querySelector('.dm-panel.dm-open, .cp-panel.cp-open, .cp-modal-overlay')) return;
      if (this.nearDockTip) this.handleFishingPress();
    });

    // Boat prompt
    this.boatPromptBg = this.add.graphics().setDepth(50).setVisible(false);
    this.boatPromptBg.fillStyle(0x020c0a, 0.92); this.boatPromptBg.fillRoundedRect(0, 0, 148, 28, 5);
    this.boatPromptBg.lineStyle(1, 0x2a5040, 0.7); this.boatPromptBg.strokeRoundedRect(0, 0, 148, 28, 5);
    this.boatPromptText = this.add.text(0, 0, 'COMING SOON', {
      fontFamily: '"Courier New", monospace', fontSize: '10px', color: '#5dcaa5', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.boatPromptArrow = this.add.text(0, 0, '▼', { fontFamily: 'monospace', fontSize: '9px', color: '#5dcaa5' }).setOrigin(0.5).setDepth(51).setVisible(false);

    this.setupPresenceCallbacks(myPubkey);
    sendRoomChange('woods', this.spawnX, this.playerY);
    this.setupRoomRequestHandlers();

    this.setupProfileSubscription();
    this.cameras.main.fadeIn(400, 4, 8, 10);
    this.settingsPanel.create();

    this.events.on('shutdown', () => {
      this.shutdownCommonPanels();
      this.cabinPromptBg?.destroy(); this.cabinPromptText?.destroy(); this.cabinPromptArrow?.destroy();
      this.telescopePromptBg?.destroy(); this.telescopePromptText?.destroy(); this.telescopePromptArrow?.destroy();
      this.telescopeOverlay?.remove(); this.telescopeOverlay = null;
      this.dockPromptBg?.destroy(); this.dockPromptText?.destroy(); this.dockPromptArrow?.destroy();
      this.boatPromptBg?.destroy(); this.boatPromptText?.destroy(); this.boatPromptArrow?.destroy();
      this.fishingLineGraphics?.destroy();
      this.boatGraphics?.destroy();
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // PARALLAX
  // ══════════════════════════════════════════════════════════════════
  private renderParallaxLayer(): void {
    const c = document.createElement('canvas'); c.width = W; c.height = GAME_HEIGHT;
    const x = c.getContext('2d')!; x.imageSmoothingEnabled = false;
    x.fillStyle = '#010008'; x.fillRect(0, 0, W, GAME_HEIGHT);
    x.fillStyle = '#030608';
    for (let tx = -20; tx < W + 40; tx += 12 + Math.random() * 20) {
      const th = 40 + Math.random() * 120; const tw = 10 + Math.random() * 22;
      x.beginPath(); x.moveTo(tx + tw / 2, FLOOR_Y - th); x.lineTo(tx + tw, FLOOR_Y - 10); x.lineTo(tx, FLOOR_Y - 10); x.closePath(); x.fill();
    }
    const hg = x.createLinearGradient(0, FLOOR_Y - 60, 0, FLOOR_Y);
    hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(1, 'rgba(8,16,12,0.2)');
    x.fillStyle = hg; x.fillRect(0, FLOOR_Y - 60, W, 60);
    if (this.textures.exists('woods_parallax')) this.textures.remove('woods_parallax');
    this.textures.addCanvas('woods_parallax', c);
  }

  // ══════════════════════════════════════════════════════════════════
  // MAIN BACKGROUND
  // ══════════════════════════════════════════════════════════════════
  private renderMainBackground(): void {
    const c = WoodsScene.generateBg();
    if (this.textures.exists('woods_bg')) this.textures.remove('woods_bg');
    this.textures.addCanvas('woods_bg', c);
    captureThumb('woods', c);
  }

  static generateBg(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = W; c.height = GAME_HEIGHT;
    const x = c.getContext('2d')!;
    x.imageSmoothingEnabled = false;
    const r = (ax: number, ay: number, aw: number, ah: number, col: string) => {
      x.fillStyle = col; x.fillRect(ax, ay, aw, ah);
    };

    // Sky
    const sg = x.createLinearGradient(0, 0, 0, FLOOR_Y);
    sg.addColorStop(0, '#010008');
    sg.addColorStop(0.2, '#020012');
    sg.addColorStop(0.5, '#04081a');
    sg.addColorStop(0.8, '#061020');
    sg.addColorStop(1, '#081420');
    x.fillStyle = sg;
    x.fillRect(0, 0, W, FLOOR_Y);

    // Stars
    const starColors = ['#fad480', '#fff', '#fff', '#fff', '#b8a8f8', '#8aecd0'];
    for (let i = 0; i < 300; i++) {
      x.fillStyle = starColors[Math.floor(Math.random() * 6)];
      x.globalAlpha = 0.15 + Math.random() * 0.6;
      x.fillRect(Math.random() * W, Math.random() * (FLOOR_Y - 80), Math.random() > 0.92 ? 2 : 1, 1);
    }
    for (let i = 0; i < 8; i++) {
      const sx = Math.random() * W, sy = 10 + Math.random() * 150;
      x.fillStyle = '#fff';
      x.globalAlpha = 0.4 + Math.random() * 0.3;
      x.fillRect(sx, sy, 2, 2);
      x.globalAlpha = 0.08;
      x.fillRect(sx - 2, sy, 6, 1);
      x.fillRect(sx, sy - 2, 1, 6);
    }
    x.globalAlpha = 1;

    // Moon
    const moonX = 1100;
    x.fillStyle = '#f5e8d0';
    [0.04, 0.08, 0.2, 0.45, 0.7].forEach((a, i) => {
      x.globalAlpha = a;
      x.beginPath(); x.arc(moonX, 55, 40 - i * 7, 0, Math.PI * 2); x.fill();
    });
    x.globalAlpha = 1;

    // Mid treeline
    x.fillStyle = '#050c08';
    for (let tx = -20; tx < W + 30; tx += 16 + Math.random() * 25) {
      const th = 50 + Math.random() * 110, tw = 14 + Math.random() * 26;
      x.beginPath();
      x.moveTo(tx + tw / 2, FLOOR_Y - 40 - th);
      x.lineTo(tx + tw + 3, FLOOR_Y - 35);
      x.lineTo(tx - 3, FLOOR_Y - 35);
      x.closePath(); x.fill();
    }

    // Near silhouette trees — front layer (closest, darkest)
    { let ntx = -40;
      while (ntx < W + 60) {
        if (ntx >= LAKE_LEFT - 60 && ntx < LAKE_RIGHT + 60) { ntx = LAKE_RIGHT + 60; continue; }
        if (ntx > FIRE_X - 110 && ntx < FIRE_X + 110) { ntx = FIRE_X + 110; continue; }
        const nth = 120 + Math.random() * 200;
        const ntw = 26 + Math.random() * 50;
        x.fillStyle = ['#020a04','#010804','#030c05'][Math.floor(Math.random() * 3)];
        x.beginPath();
        x.moveTo(ntx + ntw / 2, FLOOR_Y - nth);
        x.lineTo(ntx + ntw + 7, FLOOR_Y + 2);
        x.lineTo(ntx - 7, FLOOR_Y + 2);
        x.closePath();
        x.fill();
        ntx += 14 + Math.random() * 22;
      }
    }
    // Near silhouette trees — second denser layer (fills gaps, slightly behind)
    { let ntx = -30;
      while (ntx < W + 50) {
        if (ntx >= LAKE_LEFT - 50 && ntx < LAKE_RIGHT + 50) { ntx = LAKE_RIGHT + 50; continue; }
        if (ntx > FIRE_X - 90 && ntx < FIRE_X + 90) { ntx = FIRE_X + 90; continue; }
        const nth = 90 + Math.random() * 160;
        const ntw = 20 + Math.random() * 38;
        x.fillStyle = ['#040e07','#050f08','#030d06'][Math.floor(Math.random() * 3)];
        x.beginPath();
        x.moveTo(ntx + ntw / 2, FLOOR_Y - nth);
        x.lineTo(ntx + ntw + 5, FLOOR_Y + 2);
        x.lineTo(ntx - 5, FLOOR_Y + 2);
        x.closePath();
        x.fill();
        ntx += 11 + Math.random() * 18;
      }
    }

    // Ground
    const gg = x.createLinearGradient(0,FLOOR_Y,0,GAME_HEIGHT);
    gg.addColorStop(0,'#0c1a10'); gg.addColorStop(0.3,'#0e1c12'); gg.addColorStop(1,'#081408');
    x.fillStyle = gg; x.fillRect(0, FLOOR_Y, W, GAME_HEIGHT-FLOOR_Y);

    // Grass texture
    for (let gy=FLOOR_Y+2;gy<GAME_HEIGHT;gy+=3) for (let gx=0;gx<W;gx+=4) {
      if (gx>LAKE_LEFT&&gx<LAKE_RIGHT&&gy<FLOOR_Y+60) continue;
      if (Math.random()<0.1) { x.fillStyle=['#1a3818','#142e10','#0e2208'][Math.floor(Math.random()*3)]; x.globalAlpha=0.25+Math.random()*0.25; x.fillRect(gx,gy,2,2); }
    }
    x.globalAlpha=1;

    // Grass blades
    x.fillStyle='#1a3818';
    for (let gx=0;gx<W;gx+=5+Math.random()*7) { if(gx>LAKE_LEFT-20&&gx<LAKE_RIGHT+20) continue; x.globalAlpha=0.25+Math.random()*0.3; const gh=3+Math.random()*7; x.fillRect(gx,FLOOR_Y-gh,1,gh); if(Math.random()>0.5) x.fillRect(gx+1,FLOOR_Y-gh+2,1,gh-2); }
    x.globalAlpha=1;


    // Dirt path
    x.fillStyle='#1a1408'; x.globalAlpha=0.08; x.fillRect(350,FLOOR_Y,300,16); x.fillRect(380,FLOOR_Y+14,240,10); x.globalAlpha=1;

    // Lake — full left edge, sloping beach on right
    const lg = x.createLinearGradient(0,FLOOR_Y-5,0,GAME_HEIGHT);
    lg.addColorStop(0,'#081828'); lg.addColorStop(0.4,'#061420'); lg.addColorStop(1,'#040e18');
    x.fillStyle = lg;
    x.beginPath();
    x.moveTo(0, FLOOR_Y - 5);
    x.lineTo(0, GAME_HEIGHT);
    x.lineTo(LAKE_RIGHT + 60, GAME_HEIGHT);             // water laps further right at bottom
    x.quadraticCurveTo(LAKE_RIGHT + 38, FLOOR_Y + 46, LAKE_RIGHT, FLOOR_Y + 30); // diagonal slope — no vertical wall
    x.quadraticCurveTo(LAKE_RIGHT + 16, FLOOR_Y + 12, LAKE_RIGHT - 10, FLOOR_Y + 4);
    x.quadraticCurveTo(LAKE_RIGHT - 28, FLOOR_Y - 4, LAKE_RIGHT - 58, FLOOR_Y + 3);
    x.quadraticCurveTo(LAKE_RIGHT - 88, FLOOR_Y + 11, LAKE_RIGHT - 122, FLOOR_Y - 1);
    x.quadraticCurveTo(LAKE_RIGHT - 160, FLOOR_Y - 8, LAKE_RIGHT - 200, FLOOR_Y - 3);
    x.lineTo(0, FLOOR_Y - 5);
    x.closePath();
    x.fill();

    // Sandy beach overlay — warm gradient over the shore transition zone
    const beachG = x.createLinearGradient(LAKE_RIGHT - 30, 0, LAKE_RIGHT + 85, 0);
    beachG.addColorStop(0,   'rgba(0,0,0,0)');
    beachG.addColorStop(0.1, 'rgba(18,13,6,0.5)');
    beachG.addColorStop(0.3, 'rgba(44,33,14,0.88)');
    beachG.addColorStop(0.55,'rgba(54,43,19,0.92)');
    beachG.addColorStop(0.8, 'rgba(38,28,12,0.65)');
    beachG.addColorStop(1,   'rgba(0,0,0,0)');
    x.fillStyle = beachG;
    x.beginPath();
    x.moveTo(LAKE_RIGHT - 30, FLOOR_Y - 6);
    x.quadraticCurveTo(LAKE_RIGHT + 15, FLOOR_Y - 3, LAKE_RIGHT + 85, FLOOR_Y);
    x.lineTo(LAKE_RIGHT + 85, GAME_HEIGHT);
    x.lineTo(LAKE_RIGHT - 30, GAME_HEIGHT);
    x.closePath();
    x.fill();

    // Sand grain texture along the waterline
    for (let sx = LAKE_RIGHT - 18; sx < LAKE_RIGHT + 70; sx += 3) {
      for (let sy = FLOOR_Y - 3; sy < FLOOR_Y + 38; sy += 4) {
        if (Math.random() < 0.28) {
          x.fillStyle = ['#2e2210','#3c2e16','#221a0a','#4a3c1e'][Math.floor(Math.random()*4)];
          x.globalAlpha = 0.18 + Math.random() * 0.28;
          x.fillRect(sx, sy, Math.random() > 0.65 ? 2 : 1, 1);
        }
      }
    }
    x.globalAlpha = 1;

    // Waterline stroke — follows the diagonal beach slope
    x.strokeStyle='#1a3020'; x.lineWidth=1; x.globalAlpha=0.5;
    x.beginPath();
    x.moveTo(LAKE_RIGHT + 60, GAME_HEIGHT);
    x.quadraticCurveTo(LAKE_RIGHT + 38, FLOOR_Y + 46, LAKE_RIGHT, FLOOR_Y + 30);
    x.quadraticCurveTo(LAKE_RIGHT + 16, FLOOR_Y + 12, LAKE_RIGHT - 10, FLOOR_Y + 4);
    x.quadraticCurveTo(LAKE_RIGHT - 28, FLOOR_Y - 4, LAKE_RIGHT - 58, FLOOR_Y + 3);
    x.quadraticCurveTo(LAKE_RIGHT - 88, FLOOR_Y + 11, LAKE_RIGHT - 122, FLOOR_Y - 1);
    x.quadraticCurveTo(LAKE_RIGHT - 160, FLOOR_Y - 8, LAKE_RIGHT - 200, FLOOR_Y - 3);
    x.stroke(); x.globalAlpha=1;

    // Dock
    r(DOCK_X+20,FLOOR_Y+4,6,30,'#2a1a08'); r(DOCK_X+120,FLOOR_Y+4,6,25,'#2a1a08'); r(DOCK_END_X-20,FLOOR_Y+4,6,20,'#2a1a08');
    for (let py=FLOOR_Y-1;py<FLOOR_Y+18;py+=7) { r(DOCK_X,py,DOCK_END_X-DOCK_X,5,py%14===0?'#3a2810':'#2e2008'); x.fillStyle='#081828'; x.globalAlpha=0.4; x.fillRect(DOCK_X,py+5,DOCK_END_X-DOCK_X,2); x.globalAlpha=1; }
    r(DOCK_X-2,FLOOR_Y-3,DOCK_END_X-DOCK_X+4,3,'#3a2810');
    r(DOCK_X+1,FLOOR_Y-24,5,22,'#3a2810'); r(DOCK_X-1,FLOOR_Y-26,12,3,'#2e2008');
    // Dock lantern post at left (water) end
    r(DOCK_X+1,FLOOR_Y-50,4,44,'#3a2810');   // tall post
    r(DOCK_X+5,FLOOR_Y-48,9,2,'#2e2008');    // bracket arm
    r(DOCK_X+5,FLOOR_Y-57,9,11,'#1a1008');   // lantern frame
    r(DOCK_X+6,FLOOR_Y-56,7,9,'#f0b030');    // amber glass
    r(DOCK_X+5,FLOOR_Y-58,9,2,'#2a1c0c');    // top cap
    r(DOCK_X+5,FLOOR_Y-47,9,2,'#2a1c0c');    // bottom cap
    x.globalAlpha=0.15; x.fillStyle='#f0a030';
    x.beginPath(); x.arc(DOCK_X+9,FLOOR_Y-52,20,0,Math.PI*2); x.fill();
    x.globalAlpha=0.07; x.beginPath(); x.arc(DOCK_X+9,FLOOR_Y-52,34,0,Math.PI*2); x.fill();
    x.globalAlpha=1;


    // Campfire pit
    const fx=FIRE_X, fy=FIRE_Y;
    [[-14,4],[-12,-6],[-4,-10],[6,-10],[14,-6],[16,4],[12,10],[4,12],[-6,12],[-14,8]].forEach(([sx,sy]) => { x.fillStyle='#2a2828'; x.globalAlpha=0.8; x.fillRect(fx+sx-3,fy+sy-2,6,4); x.fillStyle='#3a3838'; x.globalAlpha=0.4; x.fillRect(fx+sx-2,fy+sy-1,4,2); x.globalAlpha=1; });
    r(fx-22,fy+8,18,5,'#2a1808'); r(fx+6,fy+10,16,4,'#221406'); r(fx-6,fy-12,14,4,'#2a1808');
    r(fx-60,fy+5,28,8,'#2a1a08'); r(fx-61,fy+4,30,2,'#3a2810');
    r(fx+40,fy+8,32,7,'#241608'); r(fx+39,fy+7,34,2,'#3a2810');
    r(fx-30,fy+22,24,7,'#221406'); r(fx-31,fy+21,26,2,'#3a2810');


    // Rocks
    const rock = (rx: number, ry: number, rw: number, rh: number) => { x.fillStyle='#1a1818'; x.globalAlpha=0.6; x.fillRect(rx,ry,rw,rh); x.fillStyle='#2a2828'; x.globalAlpha=0.3; x.fillRect(rx+1,ry,rw-2,2); x.globalAlpha=1; };
    rock(420,FLOOR_Y+2,12,6); rock(620,FLOOR_Y+4,10,5); rock(1350,FLOOR_Y+3,8,4);

    // ── Cabin exterior ──
    { const cbX=CABIN_X, cbY=FLOOR_Y, cbW=CABIN_W, cbH=66;
      // Foundation
      r(cbX-4,cbY-2,cbW+8,6,'#181008');
      // Wall body
      r(cbX,cbY-cbH,cbW,cbH,'#2e2210');
      // Log texture — horizontal lines
      x.globalAlpha=0.45;
      for(let ly=cbY-cbH+8;ly<cbY-2;ly+=10){r(cbX,ly,cbW,2,'#201608');r(cbX,ly+2,cbW,1,'#3a2c14');}
      x.globalAlpha=1;
      // Side shading (depth illusion)
      r(cbX,cbY-cbH,9,cbH,'#1a1008'); r(cbX+cbW-9,cbY-cbH,9,cbH,'#1a1008');
      // Chimney — trapezoid whose base follows the right roof slope exactly, drawn before roof
      x.fillStyle='#201408';
      x.beginPath();
      x.moveTo(cbX+cbW-30, cbY-cbH-58); // top-left
      x.lineTo(cbX+cbW-10, cbY-cbH-58); // top-right
      x.lineTo(cbX+cbW-10, cbY-cbH-14); // bottom-right  (slope y at x-offset 106: peak+28*42/73≈14)
      x.lineTo(cbX+cbW-30, cbY-cbH-26); // bottom-left   (slope y at x-offset 86:  peak+28*42/73≈26)
      x.closePath(); x.fill();
      r(cbX+cbW-32,cbY-cbH-60,24,6,'#2a1c0a'); // chimney cap
      // Roof (dark triangle) — drawn over chimney base so it follows the diagonal
      x.fillStyle='#141008';
      x.beginPath();x.moveTo(cbX-15,cbY-cbH);x.lineTo(cbX+cbW/2,cbY-cbH-42);x.lineTo(cbX+cbW+15,cbY-cbH);x.closePath();x.fill();
      // Roof shingle overlay
      x.fillStyle='#0e0c06';
      x.beginPath();x.moveTo(cbX-13,cbY-cbH);x.lineTo(cbX+cbW/2,cbY-cbH-40);x.lineTo(cbX+cbW+13,cbY-cbH);x.lineTo(cbX+cbW+13,cbY-cbH+6);x.lineTo(cbX+cbW/2,cbY-cbH-34);x.lineTo(cbX-13,cbY-cbH+6);x.closePath();x.fill();
      // Window — warm amber glow
      x.globalAlpha=0.7; r(cbX+14,cbY-cbH+28,26,20,'#f0a030');
      x.globalAlpha=0.14; r(cbX+6,cbY-cbH+20,42,32,'#f0a030');
      x.globalAlpha=0.06; r(cbX-2,cbY-cbH+14,56,40,'#f0a030');
      x.globalAlpha=1;
      // Window frame + panes
      r(cbX+13,cbY-cbH+27,28,2,'#1a1008'); r(cbX+13,cbY-cbH+47,28,2,'#1a1008');
      r(cbX+13,cbY-cbH+27,2,22,'#1a1008'); r(cbX+39,cbY-cbH+27,2,22,'#1a1008');
      r(cbX+13,cbY-cbH+37,28,1,'#1a1008'); r(cbX+26,cbY-cbH+27,1,22,'#1a1008');
      // Door
      const dX=cbX+70,dW=22,dH=34;
      r(dX-2,cbY-dH-2,dW+4,2,'#2e2010'); r(dX-2,cbY-dH-2,2,dH+2,'#2e2010'); r(dX+dW,cbY-dH-2,2,dH+2,'#2e2010');
      r(dX,cbY-dH,dW,dH,'#1a1008'); r(dX+1,cbY-dH+1,dW-2,dH-1,'#211608');
      r(dX+dW-8,cbY-14,4,5,'#3a2810'); // handle
      // Small sign above door
      r(dX+3,cbY-dH-12,dW-6,10,'#2e2010'); r(dX+4,cbY-dH-11,dW-8,8,'#3a2c14');
    }

    // ── Fish drying rack (left of cabin) ──
    const fsX = 845;
    r(fsX-18, FLOOR_Y-42, 4, 42, '#2a1c0c');       // left post
    r(fsX+14, FLOOR_Y-42, 4, 42, '#2a1c0c');       // right post
    r(fsX-18, FLOOR_Y-42, 36, 4, '#2e2010');       // top crossbar
    r(fsX-18, FLOOR_Y-26, 36, 4, '#2e2010');       // bottom crossbar
    // Fish row 1
    const fishColors = ['#4a6858','#3a5870','#506050','#486068'];
    [fsX-12, fsX-3, fsX+6, fsX+14].forEach((fx2, i) => {
      r(fx2, FLOOR_Y-38, 2, 6, '#3a3028');          // string
      r(fx2-3, FLOOR_Y-32, 8, 5, fishColors[i]);    // body
      r(fx2-5, FLOOR_Y-30, 3, 3, fishColors[i]);    // tail fin
      r(fx2+4, FLOOR_Y-31, 2, 2, '#1a2018');        // eye
      r(fx2-3, FLOOR_Y-27, 8, 2, '#3a5048');        // belly shine
    });
    // Fish row 2 (smaller fish, different colors)
    const fishColors2 = ['#506858','#4a6070','#3a5848','#507060'];
    [fsX-12, fsX-3, fsX+6, fsX+14].forEach((fx2, i) => {
      r(fx2, FLOOR_Y-22, 2, 4, '#3a3028');          // string
      r(fx2-2, FLOOR_Y-18, 7, 4, fishColors2[i]);   // body
      r(fx2-4, FLOOR_Y-16, 3, 2, fishColors2[i]);   // tail fin
      r(fx2+3, FLOOR_Y-17, 2, 2, '#1a2018');        // eye
    });

    // ── Fishing rods on the dock ──
    x.strokeStyle='#3a2c10'; x.lineWidth=1.5;
    x.beginPath(); x.moveTo(DOCK_X+4,FLOOR_Y-2); x.lineTo(DOCK_X-14,FLOOR_Y-54); x.stroke();
    x.beginPath(); x.moveTo(DOCK_X+6,FLOOR_Y-2); x.lineTo(DOCK_X+2,FLOOR_Y-58); x.stroke();
    x.strokeStyle='#60584a'; x.lineWidth=0.5;
    x.beginPath(); x.moveTo(DOCK_X-14,FLOOR_Y-54); x.lineTo(DOCK_X-20,FLOOR_Y-40); x.stroke();
    x.beginPath(); x.moveTo(DOCK_X+2,FLOOR_Y-58); x.lineTo(DOCK_X+8,FLOOR_Y-44); x.stroke();
    x.lineWidth=1;

    // ── Stone well (right clearing) ──
    const wlX = 1220;
    // Stone base
    r(wlX-14, FLOOR_Y-24, 28, 24, '#1e1c16');
    r(wlX-16, FLOOR_Y-28, 32, 6, '#2a2820');        // upper ring
    r(wlX-16, FLOOR_Y-8,  32, 6, '#242218');        // lower ring
    // Stone texture
    x.globalAlpha=0.5;
    r(wlX-12,FLOOR_Y-22,10,5,'#28261c'); r(wlX+2,FLOOR_Y-22,8,5,'#201e16');
    r(wlX-10,FLOOR_Y-14,8,4,'#28261c'); r(wlX+4,FLOOR_Y-14,9,4,'#201e16');
    x.globalAlpha=1;
    // Dark water inside
    r(wlX-10, FLOOR_Y-26, 20, 4, '#060c10');
    x.globalAlpha=0.3; r(wlX-8,FLOOR_Y-25,6,2,'#1a3040'); x.globalAlpha=1; // water glint
    // Wooden frame posts
    r(wlX-16, FLOOR_Y-52, 5, 52, '#2a1c0c');
    r(wlX+11, FLOOR_Y-52, 5, 52, '#2a1c0c');
    // Crossbeam + winch roller
    r(wlX-16, FLOOR_Y-52, 32, 4, '#2e2010');
    r(wlX-10, FLOOR_Y-49, 20, 5, '#3a2810');        // winch roller
    // Rope
    r(wlX-1, FLOOR_Y-44, 2, 20, '#3a3028');
    // Roof
    x.fillStyle='#181208';
    x.beginPath(); x.moveTo(wlX-20,FLOOR_Y-52); x.lineTo(wlX,FLOOR_Y-68); x.lineTo(wlX+20,FLOOR_Y-52); x.closePath(); x.fill();
    x.fillStyle='#0e0c06';
    x.beginPath(); x.moveTo(wlX-18,FLOOR_Y-52); x.lineTo(wlX,FLOOR_Y-66); x.lineTo(wlX+18,FLOOR_Y-52); x.lineTo(wlX+18,FLOOR_Y-47); x.lineTo(wlX,FLOOR_Y-61); x.lineTo(wlX-18,FLOOR_Y-47); x.closePath(); x.fill();

    // ── Woodpile to the right of cabin ──
    const wpX = CABIN_X + CABIN_W + 12;
    r(wpX-2,FLOOR_Y-30,3,30,'#201408'); r(wpX+39,FLOOR_Y-30,3,30,'#201408'); // support posts
    r(wpX,FLOOR_Y-14,38,8,'#2a1808'); r(wpX+1,FLOOR_Y-14,36,2,'#3a2410'); r(wpX,FLOOR_Y-14,3,8,'#1e1006'); r(wpX+35,FLOOR_Y-14,3,8,'#1e1006'); // bottom row
    r(wpX+2,FLOOR_Y-22,34,8,'#2e1c0a'); r(wpX+2,FLOOR_Y-22,32,2,'#3e2814'); r(wpX+2,FLOOR_Y-22,3,8,'#1e1006'); r(wpX+33,FLOOR_Y-22,3,8,'#1e1006'); // mid row
    r(wpX+4,FLOOR_Y-30,30,8,'#261408'); r(wpX+4,FLOOR_Y-30,28,2,'#362010'); r(wpX+4,FLOOR_Y-30,3,8,'#1e1006'); r(wpX+31,FLOOR_Y-30,3,8,'#1e1006'); // top row
    // Rain barrel beside woodpile
    const rbX = wpX + 50;
    r(rbX,FLOOR_Y-28,18,28,'#281808'); r(rbX+2,FLOOR_Y-26,14,22,'#301c0c');
    r(rbX-1,FLOOR_Y-30,20,4,'#1a1008'); r(rbX-1,FLOOR_Y-16,20,3,'#1a1008'); r(rbX-1,FLOOR_Y-4,20,3,'#1a1008');



    // ── Path lantern post (x~1460) ──
    r(1458,FLOOR_Y-48,4,48,'#3a2810');           // post
    r(1462,FLOOR_Y-46,9,2,'#2e2008');            // bracket
    r(1462,FLOOR_Y-55,9,11,'#1a1008');           // lantern frame
    r(1463,FLOOR_Y-54,7,9,'#f0b030');            // amber glass
    r(1462,FLOOR_Y-56,9,2,'#2a1c0c');            // top cap
    r(1462,FLOOR_Y-45,9,2,'#2a1c0c');            // bottom cap
    x.globalAlpha=0.14; x.fillStyle='#f0a030';
    x.beginPath(); x.arc(1466,FLOOR_Y-50,20,0,Math.PI*2); x.fill();
    x.globalAlpha=0.06; x.beginPath(); x.arc(1466,FLOOR_Y-50,34,0,Math.PI*2); x.fill();
    x.globalAlpha=1;

    // ── Tree stumps scattered right of cabin ──
    // helper: stump(x, w, h)
    const stump = (sx: number, sw: number, sh: number) => {
      r(sx, FLOOR_Y-sh, sw, sh, '#241608');
      r(sx, FLOOR_Y-sh, sw, 3, '#3a2410');          // top face
      r(sx+3, FLOOR_Y-sh+1, Math.floor(sw*0.6), 2, '#2e1c0e'); // ring
      r(sx+Math.floor(sw*0.4), FLOOR_Y-sh+2, Math.floor(sw*0.2), 1, '#281808'); // inner
      r(sx-2, FLOOR_Y-sh+3, 3, sh-3, '#1a1006');   // left bark
      r(sx+sw-1, FLOOR_Y-sh+3, 3, sh-3, '#1a1006');// right bark
    };
    stump(1320, 18, 14);   // moved from left side to where fallen log was
    stump(1430, 16, 14);   // small, between stump and lantern
    stump(1538, 22, 18);   // far right

    // ── Telescope ──
    const tx = TELESCOPE_X;
    const tmY = FLOOR_Y - 24; // tripod apex / mount base (lower = less tall)

    // Tripod legs
    x.save();
    x.lineWidth = 2.5;
    x.strokeStyle = '#3a2810';
    x.beginPath(); x.moveTo(tx - 1, tmY); x.lineTo(tx - 12, FLOOR_Y); x.stroke();
    x.beginPath(); x.moveTo(tx - 1, tmY); x.lineTo(tx + 12, FLOOR_Y); x.stroke();
    x.lineWidth = 2;
    x.beginPath(); x.moveTo(tx - 1, tmY); x.lineTo(tx - 1, FLOOR_Y); x.stroke();
    x.restore();

    // Tripod feet
    r(tx - 14, FLOOR_Y - 2, 5, 2, '#2a1c0c');
    r(tx + 10,  FLOOR_Y - 2, 5, 2, '#2a1c0c');
    r(tx - 3,   FLOOR_Y - 2, 5, 2, '#2a1c0c');

    // Mount collar
    r(tx - 6, tmY - 3, 12, 6, '#5a4020');
    r(tx - 5, tmY - 5, 10, 3, '#6a5030');

    // Telescope tube — angled ~50° from vertical pointing upper-left at the sky
    x.save();
    x.translate(tx - 3, tmY - 4);
    x.rotate(-Math.PI * 0.28); // ~-50° → tube tip points upper-left
    const tL = 22; // tube length (shorter than before)
    x.fillStyle = '#3c2c14';
    x.fillRect(-3, -tL, 7, tL);
    x.fillStyle = '#5a4020';
    x.fillRect(-3, -tL, 7, 2);
    x.fillRect(-3, -tL, 1, tL);
    x.fillStyle = '#2a1c0c';
    x.fillRect(-3.5, -15, 8, 2);
    x.fillRect(-3.5, -8,  8, 2);
    // Objective lens cap
    x.fillStyle = '#1a1008';
    x.fillRect(-4, -tL - 2, 9, 4);
    x.fillStyle = '#0a0a18';
    x.fillRect(-3, -tL - 1, 7, 2);
    // Eyepiece
    x.fillStyle = '#4a3820';
    x.fillRect(-4, 0, 9, 5);
    x.restore();

    // Focus knob
    x.save();
    x.translate(tx - 3, tmY - 4);
    x.rotate(-Math.PI * 0.28);
    x.fillStyle = '#6a5030';
    x.fillRect(3, -13, 5, 4);
    x.restore();

    // Subtle ground shadow under tripod
    x.globalAlpha = 0.15;
    x.fillStyle = '#000000';
    x.beginPath(); x.ellipse(tx - 1, FLOOR_Y + 1, 18, 4, 0, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;

    // Right edge — district buildings peeking
    x.fillStyle='#0e0828'; x.globalAlpha=0.15;
    x.fillRect(W-30,FLOOR_Y-120,35,120); x.fillRect(W-55,FLOOR_Y-90,30,90); x.globalAlpha=1;

    // Lake mist
    x.fillStyle='#8aecd0'; x.globalAlpha=0.012; x.fillRect(LAKE_LEFT-30,FLOOR_Y-30,LAKE_RIGHT-LAKE_LEFT+60,50); x.globalAlpha=1;

    // Vignette
    const vg = x.createRadialGradient(W/2,GAME_HEIGHT/2,W*0.2,W/2,GAME_HEIGHT/2,W*0.55);
    vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,0.4)');
    x.fillStyle=vg; x.fillRect(0,0,W,GAME_HEIGHT);

    return c;
  }

  // ══════════════════════════════════════════════════════════════════
  // UPDATE
  // ══════════════════════════════════════════════════════════════════
  update(time: number, delta: number): void {
    this.updateMovement();
    this.parallaxBg.x = W / 2 - this.cameras.main.scrollX * 0.4;
    this.updateCampfire(time, delta);
    this.updateChimneySmoke(delta);
    this.updateFireflies(time, delta);
    const fireDist = Math.abs(this.player.x - FIRE_X);
    const fireT = Math.max(0, 1 - fireDist / 320);
    this.snd.setLoopElVolume(fireT * fireT);
    this.updateWater(time, delta);
    this.updateShootingStar(delta);
    this.updatePlayerGlow(time);
    this.updateCabinProximity();
    this.updateTelescopeProximity();
    this.updateDockTipProximity();
    this.updateBoatProximity();
    this.updateFishing(time, delta);

    const isWalking = this.isKeyboardMoving || this.isMoving || this.targetX !== null;
    if (isWalking) {
      this.footTimer += delta; if (this.footTimer >= 300) { this.footTimer = 0; this.snd.footstep(); }
      this.walkTime += delta;
      this.player.y = this.playerY + Math.abs(Math.sin(this.walkTime * Math.PI / 150)) * -2;
      const nf = Math.floor(this.walkTime / 150) % 4;
      if (nf !== this.walkFrame) { this.walkFrame = nf; this.player.setTexture(`player_walk${this.walkFrame}`); }
    } else { this.walkTime = 0; if (this.walkFrame >= 0) { this.walkFrame = -1; this.player.setTexture('player'); } this.player.y = this.playerY; }

    this.emoteGraphics.clear();
    this.emoteSet.setFishingSkin(getAvatar().rodSkin);
    this.emoteSet.updateAll(this.emoteGraphics, delta, this.player.x, this.player.y, this.facingRight, 'hub', isWalking);
    this.player.setAlpha(this.emoteSet.isActive('ghost') ? 0.3 : 1);

    if (this.player.x >= W - 24 && !this.isLeavingScene) { this.isLeavingScene = true; this.leaveToDistrict(); }

    this.playerName.setPosition(this.player.x, this.player.y + 14);
    this.playerStatusText.setPosition(this.player.x, this.player.y + 26);
    sendPosition(this.player.x, this.player.y, this.facingRight);

    this.updateOtherPlayers(time, delta);
    this.updateLocalNameColor(time);
  }

  private updateMovement(): void {
    if (!isPresenceReady()) return;
    const c = this.input.keyboard?.createCursorKeys();
    let vx = 0;
    if (c) {
      if (c.left.isDown) vx = -PLAYER_SPEED;
      else if (c.right.isDown) vx = PLAYER_SPEED;
    }
    if (vx === 0) {
      if (this.mobileLeft) vx = -PLAYER_SPEED;
      else if (this.mobileRight) vx = PLAYER_SPEED;
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
        this.player.x += Math.sign(dx) * PLAYER_SPEED / 60;
        this.facingRight = dx > 0;
      }
    }

    this.player.x = Phaser.Math.Clamp(this.player.x, DOCK_X, W - 20);
    if (this.player.x < DOCK_X) {
      this.player.x = DOCK_X;
      this.targetX = null;
      this.isMoving = false;
    }
    this.player.setFlipX(!this.facingRight);
  }

  // ══════════════════════════════════════════════════════════════════
  // CHIMNEY SMOKE
  // ══════════════════════════════════════════════════════════════════
  private updateChimneySmoke(delta: number): void {
    // Chimney center: CABIN_X + CABIN_W - 20, top of cap: FLOOR_Y - cbH(66) - 60 = FLOOR_Y - 126
    const cx = CABIN_X + CABIN_W - 20;
    const cy = FLOOR_Y - 126;
    if (Math.random() > 0.82) {
      this.chimneyPuffs.push({
        x: cx + (Math.random() - 0.5) * 6,
        y: cy,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -0.4 - Math.random() * 0.4,
        life: 0,
        maxLife: 1800 + Math.random() * 1200,
        size: 3 + Math.random() * 3,
      });
    }
    this.chimneyGraphics.clear();
    for (let i = this.chimneyPuffs.length - 1; i >= 0; i--) {
      const p = this.chimneyPuffs[i];
      p.x += p.vx * (delta / 16);
      p.y += p.vy * (delta / 16);
      p.vx += (Math.random() - 0.5) * 0.04;
      p.vy *= 0.998;
      p.life += delta;
      const t = p.life / p.maxLife;
      if (t >= 1) { this.chimneyPuffs.splice(i, 1); continue; }
      const alpha = t < 0.15 ? t / 0.15 : (1 - t) / 0.85;
      const radius = p.size * (1 + t * 3);
      this.chimneyGraphics.fillStyle(0x888880, alpha * 0.18);
      this.chimneyGraphics.fillCircle(p.x, p.y, radius);
    }
    if (this.chimneyPuffs.length > 40) this.chimneyPuffs = this.chimneyPuffs.slice(-30);
  }

  // ══════════════════════════════════════════════════════════════════
  // CAMPFIRE
  // ══════════════════════════════════════════════════════════════════
  private updateCampfire(time: number, delta: number): void {
    this.campfireGraphics.clear();
    const fx = FIRE_X, fy = FIRE_Y;

    const gp = 0.06 + Math.sin(time * 0.003) * 0.015;
    this.campfireGraphics.fillStyle(0xf0b040, gp);
    this.campfireGraphics.fillCircle(fx, fy, 90);
    this.campfireGraphics.fillStyle(0xe85454, gp * 0.5);
    this.campfireGraphics.fillCircle(fx, fy, 55);

    const fc = [0xf0b040, 0xe87830, 0xe85454, 0xfad480, 0xffe060];
    for (let i = 0; i < 7; i++) {
      const ox = Math.sin(time * 0.005 + i * 1.2) * 5;
      const fh = 10 + Math.sin(time * 0.008 + i * 0.8) * 5 + Math.random() * 3;
      const fw = 2.5 + Math.random() * 2.5;
      const bx = fx - 10 + i * 3.2 + ox;
      const a = 0.4 + Math.sin(time * 0.006 + i * 1.5) * 0.2;
      this.campfireGraphics.fillStyle(fc[i % fc.length], a);
      this.campfireGraphics.fillRect(bx - fw / 2, fy - fh, fw, fh);
      this.campfireGraphics.fillStyle(0xfad480, a * 0.6);
      this.campfireGraphics.fillRect(bx - 1, fy - fh * 0.7, 2, fh * 0.5);
    }

    this.campfireGraphics.fillStyle(0xf0b040, 0.3 + Math.sin(time * 0.004) * 0.1);
    this.campfireGraphics.fillRect(fx - 10, fy - 2, 20, 4);

    if (Math.random() > 0.65) {
      this.embers.push({
        x: fx + (Math.random() - 0.5) * 12, y: fy - 8 - Math.random() * 6,
        vx: (Math.random() - 0.5) * 0.6, vy: -0.3 - Math.random() * 0.5,
        life: 0, maxLife: 600 + Math.random() * 800, size: 1 + Math.random(),
      });
    }

    const dt = delta / 16;
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i];
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.vx += (Math.random() - 0.5) * 0.02;
      e.life += delta;
      const p = e.life / e.maxLife;
      if (p >= 1) { this.embers.splice(i, 1); continue; }
      const a = p < 0.2 ? p / 0.2 : (1 - p) / 0.8;
      this.campfireGraphics.fillStyle(p < 0.5 ? 0xfad480 : 0xf0b040, a * 0.7);
      this.campfireGraphics.fillRect(e.x, e.y, e.size, e.size);
    }
    if (this.embers.length > 30) this.embers = this.embers.slice(-20);

    for (let s = 0; s < 4; s++) {
      const sx = fx + Math.sin(time * 0.002 + s * 2) * 10;
      const sy = fy - 22 - s * 14 - Math.sin(time * 0.003 + s) * 4;
      this.campfireGraphics.fillStyle(0xcccccc, 0.035 - s * 0.008);
      this.campfireGraphics.fillRect(sx - 3, sy - 2, 6, 4);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // FIREFLIES
  // ══════════════════════════════════════════════════════════════════
  private updateFireflies(time: number, delta: number): void {
    this.fireflyGraphics.clear();
    const dt = delta / 16;
    for (const f of this.fireflies) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vx += (Math.random() - 0.5) * 0.015;
      f.vy += (Math.random() - 0.5) * 0.012;
      f.vx = Phaser.Math.Clamp(f.vx, -0.6, 0.6);
      f.vy = Phaser.Math.Clamp(f.vy, -0.4, 0.4);
      if (f.x < 20 || f.x > W - 20) f.vx *= -0.8;
      if (f.y < 40 || f.y > FLOOR_Y - 20) f.vy *= -0.8;
      f.x = Phaser.Math.Clamp(f.x, 10, W - 10);
      f.y = Phaser.Math.Clamp(f.y, 30, FLOOR_Y - 10);

      const pulse = 0.3 + Math.sin(time * 0.003 + f.phase) * 0.35;
      const alpha = Math.max(0, pulse);
      this.fireflyGraphics.fillStyle(0xaaff44, alpha * 0.08);
      this.fireflyGraphics.fillCircle(f.x, f.y, f.size * 4);
      this.fireflyGraphics.fillStyle(0xccff66, alpha * 0.2);
      this.fireflyGraphics.fillCircle(f.x, f.y, f.size * 2);
      this.fireflyGraphics.fillStyle(0xeeffaa, alpha * 0.8);
      this.fireflyGraphics.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // WATER
  // ══════════════════════════════════════════════════════════════════
  private updateWater(time: number, delta: number): void {
    this.waterGraphics.clear();

    for (let wy = FLOOR_Y + 4; wy < GAME_HEIGHT; wy += 12) {
      for (let wx = LAKE_LEFT + 20; wx < LAKE_RIGHT - 10; wx += 18) {
        const off = Math.sin(time * 0.001 + wx * 0.03 + wy * 0.02) * 3;
        const a = 0.04 + Math.sin(time * 0.002 + wx * 0.05) * 0.02;
        this.waterGraphics.fillStyle(0x5dcaa5, a);
        this.waterGraphics.fillRect(wx + off, wy, 10, 1);
      }
    }

    const mrx = 1100, mry = FLOOR_Y + 30, sh = Math.sin(time * 0.004) * 0.03;
    this.waterGraphics.fillStyle(0xf5e8d0, 0.04 + sh);
    this.waterGraphics.fillRect(mrx - 6, mry - 15, 12, 50);
    this.waterGraphics.fillStyle(0xf5e8d0, 0.02 + sh * 0.5);
    this.waterGraphics.fillRect(mrx - 10, mry - 5, 20, 30);

    this.rippleTimer += delta;
    if (this.rippleTimer > 2500 + Math.random() * 3500) {
      this.rippleTimer = 0;
      this.ripples.push({
        x: LAKE_LEFT + 50 + Math.random() * (LAKE_RIGHT - LAKE_LEFT - 100),
        y: FLOOR_Y + 15 + Math.random() * (GAME_HEIGHT - FLOOR_Y - 30),
        radius: 0, maxRadius: 6 + Math.random() * 10, alpha: 0.1,
      });
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.radius += delta * 0.008;
      rp.alpha -= delta * 0.00004;
      if (rp.alpha <= 0 || rp.radius >= rp.maxRadius) { this.ripples.splice(i, 1); continue; }
      this.waterGraphics.lineStyle(0.5, 0x5dcaa5, rp.alpha);
      this.waterGraphics.strokeCircle(rp.x, rp.y, rp.radius);
    }
  }

  private updatePlayerGlow(t: number): void {
    const p = 0.06 + Math.sin(t * ANIM.breatheSpeed) * 0.025;
    this.playerGlow.clear();
    this.playerGlow.setPosition(this.player.x, this.player.y);
    this.playerGlow.fillStyle(hexToNum(WOODS_ACCENT), p * 0.4);
    this.playerGlow.fillEllipse(0, -1, 36, 10);
    this.playerGlow.fillStyle(hexToNum(WOODS_ACCENT), p);
    this.playerGlow.fillEllipse(0, -1, 24, 6);
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
    this.playerGlow = this.add.graphics().setDepth(9);
    this.player = this.add.image(this.spawnX, this.playerY, 'player').setOrigin(0.5, 1).setDepth(10);
    const name = this.registry.get('playerName') || 'guest';
    this.playerName = this.add.text(this.player.x, this.playerY + 14, name.slice(0, 14), {
      fontFamily: '"Courier New", monospace', fontSize: '9px', color: WOODS_ACCENT,
      align: 'center', backgroundColor: '#04081088', padding: { x: 3, y: 1 },
    }).setOrigin(0.5).setDepth(11);
    const ms = getStatus();
    this.playerStatusText = this.add.text(this.player.x, this.playerY + 26, ms, {
      fontFamily: '"Courier New", monospace', fontSize: '8px', color: P.lpurp, align: 'center',
    }).setOrigin(0.5).setDepth(11).setAlpha(ms ? 1 : 0);
  }

  private updateShootingStar(d: number): void {
    this.shootingStarGraphics.clear();
    if (!this.shootingStar) {
      this.shootingStarTimer += d;
      if (this.shootingStarTimer > 8000 + Math.random() * 12000) {
        this.shootingStarTimer = 0;
        const goRight = Math.random() > 0.5;
        this.shootingStar = {
          x: goRight ? Math.random() * W * 0.4 : W * 0.6 + Math.random() * W * 0.4,
          y: 8 + Math.random() * 35,
          vx: goRight ? 4.5 + Math.random() * 3 : -(4.5 + Math.random() * 3),
          vy: 1.2 + Math.random() * 1.4,
          life: 0, maxLife: 450 + Math.random() * 350,
        };
      }
      return;
    }

    const s = this.shootingStar;
    const dt = d / 16;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life += d;
    const pr = s.life / s.maxLife;
    const a = pr < 0.15 ? pr / 0.15 : pr > 0.65 ? (1 - pr) / 0.35 : 1;

    for (let i = 1; i <= 10; i++) {
      const tx = s.x - s.vx * i * 2.0, ty = s.y - s.vy * i * 2.0;
      const ta = a * (0.22 - i * 0.018);
      if (ta > 0) {
        this.shootingStarGraphics.fillStyle(0xc8b8ff, ta);
        this.shootingStarGraphics.fillRect(tx - 1, ty, 3, 2);
      }
    }
    for (let i = 1; i <= 10; i++) {
      const tx = s.x - s.vx * i * 1.8, ty = s.y - s.vy * i * 1.8;
      const ta = a * (0.65 - i * 0.06);
      if (ta > 0) {
        this.shootingStarGraphics.fillStyle(i < 4 ? 0xfff5e6 : 0xb8a8f8, ta);
        this.shootingStarGraphics.fillRect(tx, ty, i < 4 ? 2 : 1, 1);
      }
    }

    this.shootingStarGraphics.fillStyle(0xddd0ff, a * 0.2);
    this.shootingStarGraphics.fillRect(s.x - 2, s.y - 2, 6, 6);
    this.shootingStarGraphics.fillStyle(0xffffff, a * 0.5);
    this.shootingStarGraphics.fillRect(s.x - 1, s.y - 1, 4, 4);
    this.shootingStarGraphics.fillStyle(0xffffff, a * 0.95);
    this.shootingStarGraphics.fillRect(s.x, s.y, 2, 2);

    if (s.life >= s.maxLife || s.y > 130 || s.x < -20 || s.x > W + 20) this.shootingStar = null;
  }

  // ══════════════════════════════════════════════════════════════════
  // BOAT
  // ══════════════════════════════════════════════════════════════════
  private drawBoat(): void {
    const g = this.boatGraphics;
    const bx = 490;             // center x — in the lake off the dock
    const wl = FLOOR_Y + 50;   // waterline y — sit low in the water

    // Water shadow beneath hull
    g.fillStyle(0x040c18, 0.5);
    g.fillEllipse(bx, wl + 10, 100, 14);

    // Hull body — classic rowboat profile, bow right (pointing out to lake), stern left
    g.fillStyle(0x3a2210, 1);
    g.fillPoints([
      { x: bx - 48, y: wl - 6 },   // stern top-left
      { x: bx - 46, y: wl + 8 },   // stern bottom
      { x: bx - 20, y: wl + 12 },  // keel mid-left
      { x: bx + 10, y: wl + 14 },  // keel center
      { x: bx + 36, y: wl + 10 },  // keel mid-right
      { x: bx + 54, y: wl + 2 },   // bow bottom
      { x: bx + 58, y: wl - 6 },   // bow tip
      { x: bx + 52, y: wl - 14 },  // bow top
      { x: bx + 30, y: wl - 18 },  // gunwale right
      { x: bx,      y: wl - 20 },  // gunwale center (highest)
      { x: bx - 30, y: wl - 18 },  // gunwale left
      { x: bx - 48, y: wl - 12 },  // stern top
    ], true);

    // Hull plank lines
    g.lineStyle(0.8, 0x2a1608, 0.7);
    for (let py = wl - 14; py <= wl + 8; py += 5) {
      g.beginPath();
      g.moveTo(bx - 44, py);
      g.lineTo(bx + 52, py - 2);
      g.strokePath();
    }

    // Hull inner (visible inside of boat)
    g.fillStyle(0x2a1808, 1);
    g.fillPoints([
      { x: bx - 42, y: wl - 10 },
      { x: bx - 40, y: wl + 4 },
      { x: bx - 16, y: wl + 8 },
      { x: bx + 12, y: wl + 9 },
      { x: bx + 34, y: wl + 6 },
      { x: bx + 48, y: wl - 2 },
      { x: bx + 46, y: wl - 10 },
      { x: bx + 28, y: wl - 14 },
      { x: bx,      y: wl - 16 },
      { x: bx - 26, y: wl - 14 },
    ], true);

    // Inner shadow gradient
    g.fillStyle(0x1a0e04, 0.5);
    g.fillPoints([
      { x: bx - 38, y: wl - 4 },
      { x: bx - 14, y: wl + 6 },
      { x: bx + 14, y: wl + 7 },
      { x: bx + 40, y: wl + 2 },
      { x: bx + 44, y: wl - 6 },
      { x: bx + 26, y: wl - 10 },
      { x: bx,      y: wl - 12 },
      { x: bx - 24, y: wl - 10 },
    ], true);

    // Gunwale (top rail) — thick visible rail
    g.lineStyle(2.5, 0x4e3418, 1);
    g.beginPath();
    g.moveTo(bx - 48, wl - 9);
    g.lineTo(bx - 30, wl - 18);
    g.lineTo(bx, wl - 20);
    g.lineTo(bx + 30, wl - 18);
    g.lineTo(bx + 52, wl - 14);
    g.lineTo(bx + 58, wl - 6);
    g.strokePath();
    // Gunwale highlight
    g.lineStyle(1, 0x6a4c20, 0.5);
    g.beginPath();
    g.moveTo(bx - 28, wl - 18);
    g.lineTo(bx, wl - 20);
    g.lineTo(bx + 28, wl - 18);
    g.strokePath();

    // Stern transom (flat back wall)
    g.fillStyle(0x3e2814, 1);
    g.fillPoints([
      { x: bx - 48, y: wl - 12 },
      { x: bx - 48, y: wl - 6 },
      { x: bx - 46, y: wl + 6 },
      { x: bx - 44, y: wl + 6 },
      { x: bx - 44, y: wl - 8 },
      { x: bx - 46, y: wl - 12 },
    ], true);

    // Thwarts (seat planks) — front and rear
    g.fillStyle(0x3a2410, 1);
    g.fillRect(bx - 22, wl - 15, 18, 4);  // rear seat
    g.fillRect(bx + 14, wl - 16, 18, 4);  // front seat
    // Seat highlights
    g.fillStyle(0x4a3418, 1);
    g.fillRect(bx - 22, wl - 15, 18, 1);
    g.fillRect(bx + 14, wl - 16, 18, 1);
    // Seat supports
    g.fillStyle(0x2a1808, 1);
    g.fillRect(bx - 20, wl - 11, 3, 6);
    g.fillRect(bx - 7, wl - 11, 3, 6);
    g.fillRect(bx + 16, wl - 12, 3, 6);
    g.fillRect(bx + 29, wl - 12, 3, 6);

    // Oarlocks (metal brackets on gunwale)
    g.fillStyle(0x505050, 1);
    g.fillRect(bx - 10, wl - 22, 3, 4);
    g.fillRect(bx + 8, wl - 22, 3, 4);

    // Oars resting in oarlocks
    g.lineStyle(1.5, 0x4a3418, 1);
    g.beginPath();
    g.moveTo(bx - 10, wl - 20);
    g.lineTo(bx - 42, wl - 8);
    g.strokePath();
    g.beginPath();
    g.moveTo(bx + 9, wl - 20);
    g.lineTo(bx - 26, wl - 6);
    g.strokePath();
    // Oar blades
    g.fillStyle(0x3a2810, 1);
    g.fillPoints([
      { x: bx - 42, y: wl - 12 },
      { x: bx - 50, y: wl - 6 },
      { x: bx - 46, y: wl - 2 },
      { x: bx - 38, y: wl - 6 },
    ], true);
    g.fillPoints([
      { x: bx - 26, y: wl - 10 },
      { x: bx - 34, y: wl - 4 },
      { x: bx - 30, y: wl },
      { x: bx - 22, y: wl - 4 },
    ], true);

    // Bow cap (decorative prow tip)
    g.fillStyle(0x5a3c18, 1);
    g.fillPoints([
      { x: bx + 56, y: wl - 14 },
      { x: bx + 60, y: wl - 8 },
      { x: bx + 58, y: wl - 4 },
      { x: bx + 54, y: wl - 12 },
    ], true);

    // Mooring rope to dock (catenary-like sag)
    g.lineStyle(1, 0x4a4038, 0.8);
    g.beginPath();
    const ropeStartX = bx - 46, ropeStartY = wl - 10;
    const ropeEndX = DOCK_X + 24, ropeEndY = FLOOR_Y + 4;
    g.moveTo(ropeStartX, ropeStartY);
    const ropeMidX = (ropeStartX + ropeEndX) / 2;
    const ropeSag = FLOOR_Y + 12;
    // Approximate quadratic curve with line segments
    for (let t = 0.1; t <= 1.0; t += 0.1) {
      const rx = (1 - t) * (1 - t) * ropeStartX + 2 * (1 - t) * t * ropeMidX + t * t * ropeEndX;
      const ry = (1 - t) * (1 - t) * ropeStartY + 2 * (1 - t) * t * ropeSag + t * t * ropeEndY;
      g.lineTo(rx, ry);
    }
    g.strokePath();
    // Rope knot on dock post
    g.fillStyle(0x4a4038, 1);
    g.fillCircle(DOCK_X + 24, FLOOR_Y + 4, 2);

    // Lantern hanging from bow
    g.fillStyle(0x2a1c0c, 1);
    g.fillRect(bx + 52, wl - 22, 5, 3);  // bracket
    g.fillStyle(0x1a1008, 1);
    g.fillRect(bx + 51, wl - 24, 7, 8);  // lantern frame
    g.fillStyle(0xd09020, 0.8);
    g.fillRect(bx + 52, wl - 23, 5, 6);  // amber glow
    // Lantern glow
    g.fillStyle(0xf0a030, 0.08);
    g.fillCircle(bx + 54, wl - 20, 16);
    g.fillStyle(0xf0a030, 0.04);
    g.fillCircle(bx + 54, wl - 20, 28);
  }

  private updateBoatProximity(): void {
    const boatCenterX = 490;
    const near = this.player.x >= boatCenterX - 60 && this.player.x <= boatCenterX + 60;
    if (near !== this.nearBoat) this.nearBoat = near;

    this.boatPromptBg.setVisible(near);
    this.boatPromptText.setVisible(near);
    this.boatPromptArrow.setVisible(near);
    if (near) {
      const px = boatCenterX, py = FLOOR_Y - 70;
      this.boatPromptBg.setPosition(px - 74, py - 2);
      this.boatPromptText.setPosition(px, py + 8);
      this.boatPromptArrow.setPosition(px, py + 22);
      if (!this.tweens.isTweening(this.boatPromptArrow)) {
        this.tweens.add({ targets: this.boatPromptArrow, y: py + 27, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    } else {
      this.tweens.killTweensOf(this.boatPromptArrow);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // FISHING
  // ══════════════════════════════════════════════════════════════════
  private static readonly FISH_TABLE = [
    // Common
    { name: 'tiny carp',                    kg: '0.2', rare: false, junk: false },
    { name: 'silver trout',                 kg: '1.4', rare: false, junk: false },
    { name: 'moonfish',                     kg: '0.8', rare: false, junk: false },
    { name: 'bluegill',                     kg: '0.4', rare: false, junk: false },
    { name: 'mud catfish',                  kg: '1.8', rare: false, junk: false },
    { name: 'speckled sunfish',             kg: '0.3', rare: false, junk: false },
    { name: 'lake minnow',                  kg: '0.1', rare: false, junk: false },
    { name: 'striped dace',                 kg: '0.6', rare: false, junk: false },
    { name: 'green sunperch',              kg: '0.5', rare: false, junk: false },
    { name: 'whiskered loach',             kg: '0.3', rare: false, junk: false },
    { name: 'spotted rudd',               kg: '0.7', rare: false, junk: false },
    { name: 'common bream',               kg: '1.2', rare: false, junk: false },
    { name: 'river roach',                kg: '0.4', rare: false, junk: false },
    { name: 'flathead chub',              kg: '0.8', rare: false, junk: false },
    { name: 'golden shiner',              kg: '0.3', rare: false, junk: false },
    { name: 'pumpkinseed',                kg: '0.5', rare: false, junk: false },
    // Rare
    { name: 'darkwater bass',      kg: '2.3', rare: true, junk: false, lore: 'It only surfaces when the moon is hidden. Its scales absorb light rather than reflect it.' },
    { name: 'luminous eel',        kg: '0.5', rare: true, junk: false, lore: 'Locals once used them as lanterns. They stopped when the eels started remembering the way home.' },
    { name: 'crystal perch',       kg: '3.1', rare: true, junk: false, lore: 'Almost completely transparent. You can see its heart beating through its chest, slow and deliberate.' },
    { name: 'ghost pike',          kg: '4.2', rare: true, junk: false, lore: 'Other fish scatter when it passes. The dock cat refuses to eat it. You almost put it back.' },
    { name: 'midnight sturgeon',   kg: '6.8', rare: true, junk: false, lore: 'Ancient and patient. It has outlived everyone who ever fished this lake. You wonder if it let you catch it.' },
    { name: 'starscale koi',       kg: '1.1', rare: true, junk: false, lore: 'Its scales map the night sky — every constellation perfectly arranged, slowly shifting as the real stars move.' },
    { name: 'abyssal anglerfish',  kg: '2.7', rare: true, junk: false, lore: 'The lake is not supposed to be deep enough for this. You decide not to think about that too long.' },
    { name: 'ancient goldfish',    kg: '0.9', rare: true, junk: false, lore: 'Carnival goldfish live two years. This one has rings like a tree. You count thirty-seven.' },
    { name: 'love letter',         kg: '0.0', rare: true, junk: false, lore: 'Sealed in a glass vial, perfectly dry. No signature. You put it in your pocket and don\'t say why.' },
    // Junk
    { name: 'old boot',                     kg: '?',   rare: false, junk: true  },
    { name: 'soggy message in a bottle',    kg: '0.3', rare: false, junk: true  },
    { name: 'rusty tin can',                kg: '?',   rare: false, junk: true  },
    { name: 'waterlogged hat',              kg: '?',   rare: false, junk: true  },
    { name: 'tangled fishing line',         kg: '?',   rare: false, junk: true  },
    { name: 'broken lantern',               kg: '?',   rare: false, junk: true  },
    // Legendary
    { name: 'ostrich',             kg: '63.5', rare: false, junk: false, legendary: true, flavor: '🪶 Something enormous thrashed at the end of the line. It wasn\'t a fish.', lore: 'They say an ostrich fell into the lake decades ago during a traveling circus that passed through the district. No one believed it survived down there — until now.' },
    { name: 'golden satoshi coin', kg: '0.01', rare: false, junk: false, legendary: true, flavor: '🪙 The line went taut on something tiny but impossibly heavy. It glowed when it broke the surface.', lore: 'An ancient coin stamped with the letter ₿, cold to the touch and humming faintly. The old-timers say Satoshi himself tossed it into the lake the night the district was founded, a blessing for whoever found it.' },
    { name: 'enchanted trident',   kg: '8.4',  rare: false, junk: false, legendary: true, flavor: '🔱 The water split apart as something rose on its own, the fishing line barely holding it back.', lore: 'The handle is wrapped in kelp that never dries and the prongs glow faintly under moonlight. Legend has it the lake spirit forged it to guard the deepest waters — and it chose to let you take it.' },
    { name: 'leviathan coelacanth', kg: '91.2',  rare: false, junk: false, legendary: true, flavor: '🐟 The line went still. Then the lake itself seemed to inhale.', lore: 'A living fossil thought extinct for 65 million years. Its scales are the color of deep ocean and its eyes hold no reflection. Scientists would lose their minds. You decide not to tell anyone.' },
    { name: 'meteor from Andromeda', kg: '???', rare: false, junk: false, legendary: true, flavor: '☄️ It didn\'t feel like a fish. It didn\'t feel like anything from here.', lore: 'Still warm. Faintly humming. The surface is pitted like it survived something unimaginable — 2.5 million light years of it. The lake has no business holding this. Neither do you.' },
  ] as const;

  private updateDockTipProximity(): void {
    const near = this.player.x < DOCK_X + 48;
    if (near !== this.nearDockTip) {
      this.nearDockTip = near;
      if (!near && this.fishingState !== 'idle') this.cancelFishing();
    }
    // Show / update prompt only in idle state while near
    const showPrompt = near && this.fishingState === 'idle';
    this.dockPromptBg.setVisible(showPrompt);
    this.dockPromptText.setVisible(showPrompt);
    this.dockPromptArrow.setVisible(showPrompt);
    if (showPrompt) {
      const px = DOCK_X + 12, py = FLOOR_Y - 90;
      this.dockPromptBg.setPosition(px - 58, py - 2);
      this.dockPromptText.setPosition(px, py + 8);
      this.dockPromptArrow.setPosition(px, py + 22);
      if (!this.tweens.isTweening(this.dockPromptArrow)) {
        this.tweens.add({ targets: this.dockPromptArrow, y: py + 27, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    } else {
      this.tweens.killTweensOf(this.dockPromptArrow);
    }
  }

  private updateFishing(time: number, delta: number): void {
    this.fishingLineGraphics.clear();
    if (this.fishingState === 'idle') return;

    // Rod grip is at player's left hand, tip arcs up-left overhead
    const gripX = this.player.x - 4;
    const gripY = this.player.y - 18;
    const rodTipX = this.player.x - 20;
    const rodTipY = this.player.y - 52;
    const bobberX = DOCK_X - this.fishingCastDist;

    this.fishingBobPhase += delta * 0.002;
    const isBite = this.fishingState === 'bite';
    const bobAmt = isBite
      ? Math.sin(this.fishingBobPhase * 4.5) * 5
      : Math.sin(this.fishingBobPhase) * 1.5;
    const bobberY = FLOOR_Y + 10 + bobAmt;

    // Fishing rod — thick base tapering to tip
    const _rodSkinKey = getAvatar().rodSkin;
    const _skin = ROD_SKINS[_rodSkinKey] ?? ROD_SKINS[''];
    const _isLegendary = _rodSkinKey === 'legendary';
    const _hue = (Date.now() / 20) % 360;
    const _gripColor   = _isLegendary ? Phaser.Display.Color.HSLToColor(_hue / 360, 0.9, 0.55).color : _skin.grip;
    const _tipColor    = _isLegendary ? Phaser.Display.Color.HSLToColor(((_hue + 40) % 360) / 360, 0.9, 0.65).color : _skin.tip;
    const _lineColor   = _isLegendary ? Phaser.Display.Color.HSLToColor(((_hue + 80) % 360) / 360, 0.7, 0.75).color : _skin.line;
    const _bobberColor = _isLegendary ? Phaser.Display.Color.HSLToColor(((_hue + 120) % 360) / 360, 0.9, 0.6).color : _skin.bobber;

    this.fishingLineGraphics.lineStyle(3, _gripColor, 1);
    this.fishingLineGraphics.beginPath();
    this.fishingLineGraphics.moveTo(gripX, gripY);
    this.fishingLineGraphics.lineTo(gripX - 8, gripY - 20);
    this.fishingLineGraphics.strokePath();
    this.fishingLineGraphics.lineStyle(2, _tipColor, 1);
    this.fishingLineGraphics.beginPath();
    this.fishingLineGraphics.moveTo(gripX - 8, gripY - 20);
    this.fishingLineGraphics.lineTo(rodTipX, rodTipY);
    this.fishingLineGraphics.strokePath();

    // Fishing line from rod tip to bobber
    this.fishingLineGraphics.lineStyle(1, _lineColor, 0.7);
    this.fishingLineGraphics.beginPath();
    this.fishingLineGraphics.moveTo(rodTipX, rodTipY);
    this.fishingLineGraphics.lineTo(bobberX, bobberY);
    this.fishingLineGraphics.strokePath();

    // Bobber float
    const bobColor = isBite ? 0xff4444 : _bobberColor;
    this.fishingLineGraphics.fillStyle(bobColor, 0.9);
    this.fishingLineGraphics.fillRect(bobberX - 2, bobberY - 4, 5, 4); // top (red/orange)
    this.fishingLineGraphics.fillStyle(0xf0f0f0, 0.85);
    this.fishingLineGraphics.fillRect(bobberX - 2, bobberY, 5, 4);     // bottom (white)

    // Water rings around bobber
    const ringAlpha = 0.08 + Math.sin(this.fishingBobPhase * 0.7) * 0.04;
    this.fishingLineGraphics.lineStyle(0.5, 0x5dcaa5, ringAlpha);
    this.fishingLineGraphics.strokeCircle(bobberX, bobberY + 2, 6);
    this.fishingLineGraphics.strokeCircle(bobberX, bobberY + 2, 11);

    // Bite state: show prompt + timeout check
    if (isBite) {
      const px = DOCK_X + 12, py = FLOOR_Y - 90;
      this.dockPromptText.setText(this.sys.game.device.input.touch ? '[TAP] Reel In!' : '[E] Reel In!');
      this.dockPromptText.setColor('#ff8888');
      this.dockPromptBg.setVisible(true);
      this.dockPromptText.setVisible(true);
      this.dockPromptArrow.setVisible(true);
      this.dockPromptBg.setPosition(px - 58, py - 2);
      this.dockPromptText.setPosition(px, py + 8);
      this.dockPromptArrow.setPosition(px, py + 22);
      this.fishingTimer += delta;
      if (this.fishingTimer > 4000) {
        // Fish escaped
        this.chatUI.addMessage('system', '* the fish got away...', WOODS_ACCENT);
        this.resetFishingState();
      }
    } else {
      // Waiting for bite
      this.fishingTimer += delta;
      if (this.fishingTimer >= this.fishingBiteMs) {
        this.fishingState = 'bite';
        this.fishingTimer = 0;
        this.chatUI.addMessage('system', '* something tugs the line!', '#ff8888');
        this.snd.coinFlip();
      } else if (this.fishingTimer > 45000) {
        // Nothing biting after 45s
        this.chatUI.addMessage('system', '* nothing biting tonight...', WOODS_ACCENT);
        this.resetFishingState();
      }
    }
  }

  private handleFishingPress(): void {
    if (this.fishingState === 'idle') {
      this.fishingState = 'waiting';
      this.fishingTimer = 0;
      this.fishingBiteMs = 4000 + Math.random() * 12000;
      this.fishingBobPhase = 0;
      this.fishingCastDist = 30 + Math.random() * 80;  // 30–110px out from dock edge
      ChatUI.showBubble(this, this.player.x, this.player.y - 48, '* casts a line...', WOODS_ACCENT, 3000);
      this.snd.fishingCast();
      sendChat('/emote fishing_on');
    } else if (this.fishingState === 'bite') {
      this.reelIn();
    } else {
      // Cancel cast
      this.cancelFishing();
    }
  }

  private reelIn(): void {
    const table = WoodsScene.FISH_TABLE;
    // Weighted: 0.15% legendary, 15% junk, 25% rare, 59.85% common
    const roll = Math.random();
    let catch_: typeof table[number];
    if (roll < 0.0015) {
      const legendary = table.filter(f => 'legendary' in f && f.legendary);
      catch_ = legendary[Math.floor(Math.random() * legendary.length)];
    } else if (roll < 0.1515) {
      const junk = table.filter(f => f.junk);
      catch_ = junk[Math.floor(Math.random() * junk.length)];
    } else if (roll < 0.4015) {
      const rare = table.filter(f => f.rare);
      catch_ = rare[Math.floor(Math.random() * rare.length)];
    } else {
      const common = table.filter(f => !f.rare && !f.junk && !('legendary' in f && f.legendary));
      catch_ = common[Math.floor(Math.random() * common.length)];
    }

    const isLegendary = 'legendary' in catch_ && catch_.legendary;
    const msg = isLegendary
      ? `* pulled a ${catch_.name} out of the lake?! (${catch_.kg}kg) ✦✦✦`
      : catch_.junk
        ? `* reeled in a ${catch_.name}. unfortunate.`
        : catch_.rare
          ? `* hooked a ${catch_.name} (${catch_.kg}kg)! ✦`
          : `* caught a ${catch_.name} (${catch_.kg}kg)`;
    const color = isLegendary ? '#ffd700' : catch_.rare ? '#aaff44' : WOODS_ACCENT;
    if (isLegendary) sendChat(msg);
    this.chatUI.addMessage('system', msg, color);
    if (catch_.rare && !isLegendary && 'lore' in catch_) {
      this.time.delayedCall(600, () => {
        this.chatUI.addMessage('system', `"${catch_.lore}"`, '#7a9a7a');
      });
    }
    if (isLegendary) {
      const flavor = 'flavor' in catch_ ? catch_.flavor : '';
      const lore = 'lore' in catch_ ? catch_.lore : '';
      this.showLegendaryPostPrompt(catch_.name, catch_.kg, flavor, lore);
    }
    this.resetFishingState();
  }

  private showLegendaryPostPrompt(name: string, kg: string, flavor: string, lore: string): void {
    const { pubkey, loginMethod } = authStore.getState();
    if (!pubkey || loginMethod === 'guest') return;

    const baseContent = `${flavor}\n\n🎣 Just pulled a ${name} (${kg}kg) out of the lake in Nostr District! ✦✦✦\n\n"${lore}"\n\nhttps://thedistrict.online/\n\n#nostrdistrict #fishing`;

    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);font-family:'Courier New',monospace;`;

    const modal = document.createElement('div');
    modal.style.cssText = `background:#0a0a1a;border:2px solid #ffd700;border-radius:12px;padding:24px 28px;max-width:420px;width:90vw;text-align:center;box-shadow:0 0 40px rgba(255,215,0,0.2);`;

    const title = document.createElement('div');
    title.style.cssText = `color:#ffd700;font-size:18px;font-weight:bold;margin-bottom:8px;`;
    title.textContent = '✦ LEGENDARY CATCH ✦';

    const desc = document.createElement('div');
    desc.style.cssText = `color:#f5e8d0;font-size:14px;margin-bottom:12px;line-height:1.5;`;
    desc.textContent = `You pulled a ${name} (${kg}kg) out of the lake!`;

    const loreEl = document.createElement('div');
    loreEl.style.cssText = `color:#c0a860;font-size:12px;font-style:italic;margin-bottom:16px;line-height:1.6;padding:0 8px;`;
    loreEl.textContent = `"${lore}"`;

    // Fish image preview — shown only if PNG exists for this legendary
    const fishImgSrc = LEGENDARY_FISH_IMAGES[name];
    if (fishImgSrc) {
      const imgEl = document.createElement('img');
      imgEl.src = fishImgSrc;
      imgEl.style.cssText = `image-rendering:pixelated;width:96px;height:96px;object-fit:contain;margin-bottom:14px;display:block;margin-left:auto;margin-right:auto;`;
      imgEl.onerror = () => imgEl.remove();
      modal.appendChild(title);
      modal.appendChild(imgEl);
      modal.appendChild(desc);
    } else {
      modal.appendChild(title);
      modal.appendChild(desc);
    }

    const notePreview = document.createElement('div');
    notePreview.style.cssText = `color:#777;font-size:11px;margin-bottom:16px;background:#111;border-radius:6px;padding:10px 12px;text-align:left;line-height:1.6;white-space:pre-wrap;border:1px solid #222;`;
    notePreview.textContent = baseContent;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = `display:flex;gap:10px;justify-content:center;`;

    const postBtn = document.createElement('button');
    postBtn.textContent = 'Post to Nostr';
    postBtn.style.cssText = `background:#ffd700;color:#0a0a1a;border:none;border-radius:6px;padding:10px 20px;font-family:'Courier New',monospace;font-size:13px;font-weight:bold;cursor:pointer;`;
    postBtn.addEventListener('click', async () => {
      postBtn.textContent = 'Uploading...';
      postBtn.style.opacity = '0.6';
      try {
        const imageUrl = await uploadFishImage(name);
        const tags: string[][] = [['client', 'Nostr District'], ['t', 'nostrdistrict'], ['t', 'fishing']];
        let noteContent = baseContent;
        if (imageUrl) {
          noteContent += `\n\n${imageUrl}`;
          tags.push(['imeta', `url ${imageUrl}`, 'm image/png']);
        }
        postBtn.textContent = 'Posting...';
        const event = await signEvent({
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags,
          content: noteContent,
        });
        const ok = await publishEvent(event);
        postBtn.textContent = ok ? 'Posted!' : 'Failed';
        setTimeout(() => overlay.remove(), 1200);
      } catch {
        postBtn.textContent = 'Failed';
        setTimeout(() => overlay.remove(), 1200);
      }
    });

    const skipBtn = document.createElement('button');
    skipBtn.textContent = 'Skip';
    skipBtn.style.cssText = `background:none;border:1px solid #444;color:#888;border-radius:6px;padding:10px 20px;font-family:'Courier New',monospace;font-size:13px;cursor:pointer;`;
    skipBtn.addEventListener('click', () => overlay.remove());

    btnRow.appendChild(postBtn);
    btnRow.appendChild(skipBtn);
    modal.appendChild(loreEl);
    modal.appendChild(notePreview);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  private cancelFishing(): void {
    this.chatUI.addMessage('system', '* reels in the line.', WOODS_ACCENT);
    this.resetFishingState();
  }

  private resetFishingState(): void {
    if (this.fishingState !== 'idle') sendChat('/emote fishing_off');
    this.fishingState = 'idle';
    this.fishingTimer = 0;
    this.fishingLineGraphics.clear();
    this.dockPromptText.setText(this.sys.game.device.input.touch ? '[TAP] Cast Line' : '[E] Cast Line');
    this.dockPromptText.setColor('#5dcaa5');
    this.tweens.killTweensOf(this.dockPromptArrow);
  }

  private leaveToDistrict(): void {
    this.snd.roomLeave(); this.snd.setRoom(''); sendRoomChange('hub'); this.chatUI.destroy();
    this.cameras.main.fadeOut(300, 10, 0, 20);
    this.time.delayedCall(300, () => { if (!this.scene.isActive()) return; this.scene.start('HubScene', { _returning: true, fromRoom: 'woods' }); });
  }

  private enterCabin(): void {
    this.snd.roomLeave(); sendRoomChange('cabin'); this.chatUI.destroy();
    this.cameras.main.fadeOut(300, 4, 2, 0);
    this.time.delayedCall(300, () => { if (!this.scene.isActive()) return; this.scene.start('CabinScene'); });
  }

  protected override teleportToRoom(roomId: string): void {
    if (roomId === 'hub') {
      this.leaveToDistrict();
      return;
    }
    if (roomId === 'cabin') {
      if (!this.isLeavingScene) {
        this.isLeavingScene = true;
        this.enterCabin();
      }
      return;
    }
    if (roomId === 'woods') {
      this.chatUI.addMessage('system', 'Already in the woods!', WOODS_ACCENT);
      return;
    }
    super.teleportToRoom(roomId);
  }

  private updateTelescopeProximity(): void {
    const near = Math.abs(this.player.x - TELESCOPE_X) < 44;
    if (near !== this.nearTelescope) {
      this.nearTelescope = near;
      this.telescopePromptBg.setVisible(near);
      this.telescopePromptText.setVisible(near);
      this.telescopePromptArrow.setVisible(near);
      if (!near) this.tweens.killTweensOf(this.telescopePromptArrow);
    }
    if (near) {
      const px = TELESCOPE_X, py = FLOOR_Y - 90;
      this.telescopePromptBg.setPosition(px - 60, py - 2);
      this.telescopePromptText.setPosition(px, py + 8);
      this.telescopePromptArrow.setPosition(px, py + 22);
      if (!this.tweens.isTweening(this.telescopePromptArrow)) {
        this.tweens.add({ targets: this.telescopePromptArrow, y: py + 27, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
  }

  private openTelescopeView(): void {
    if (this.telescopeOverlay) return;

    // ── seeded RNG ──
    const mkRng = (seed: number) => { let s = seed >>> 0; return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; }; };
    const viewSeed = (Math.random() * 0x7fffffff) | 0;
    const R = mkRng(viewSeed);
    const starRng = mkRng(viewSeed ^ 0xdeadbeef);

    // ── background stars ──
    const stars = Array.from({ length: 300 }, () => ({
      x: starRng() * 100, y: starRng() * 100,
      r: starRng() * 1.5 + 0.3,
      a: starRng() * 0.5 + 0.45,
      c: starRng() < 0.08 ? '#ffd8a0' : starRng() < 0.06 ? '#a0c8ff' : '#ffffff',
    }));
    const starSvg = stars.map(s =>
      `<circle cx="${s.x.toFixed(1)}%" cy="${s.y.toFixed(1)}%" r="${s.r.toFixed(2)}" fill="${s.c}" opacity="${s.a.toFixed(2)}">
        ${s.r > 1.1 ? `<animate attributeName="opacity" values="${s.a.toFixed(2)};${(s.a*0.5).toFixed(2)};${s.a.toFixed(2)}" dur="${(2+starRng()*3).toFixed(1)}s" repeatCount="indefinite"/>` : ''}
      </circle>`
    ).join('');

    // ── pick random scene type ──
    const scenes = [
      // planets
      'mercury','venus','mars','jupiter','saturn','uranus','neptune','pluto',
      // non-zodiac constellations
      'orion','bigdipper','cassiopeia','pleiades',
      // zodiac constellations
      'aries','taurus','gemini','cancer','leo','virgo','libra','scorpius','sagittarius','capricorn','aquarius','pisces',
      // moon
      'moon',
    ];
    const sceneType = scenes[R() * scenes.length | 0];

    // ── constellation helper ──
    const makeCon = (stars2: number[][], lines: number[][], col = 'rgba(160,200,255,0.5)') => {
      const starSize = (i: number) => stars2[i][2] ?? 1.8;
      return lines.map(([a,b]) =>
        `<line x1="${stars2[a][0]}%" y1="${stars2[a][1]}%" x2="${stars2[b][0]}%" y2="${stars2[b][1]}%" stroke="${col}" stroke-width="0.6" stroke-dasharray="2 1" opacity="0.7"/>`
      ).join('') + stars2.map((s,i) =>
        `<circle cx="${s[0]}%" cy="${s[1]}%" r="${starSize(i)}" fill="rgba(220,235,255,0.95)">
          <animate attributeName="opacity" values="0.95;0.6;0.95" dur="${(2.5+i*0.3).toFixed(1)}s" repeatCount="indefinite"/>
        </circle>`
      ).join('');
    };

    // ── scenes ──
    const uid = `tel${viewSeed}`;
    let subject = '';
    let label = '';
    let nebulaCol1 = 'rgba(20,15,50,0.7)'; let nc1x='35%'; let nc1y='40%';
    let nebulaCol2 = 'rgba(10,30,40,0.5)'; let nc2x='65%'; let nc2y='55%';


    if (sceneType === 'mercury') {
      label = 'Mercury';
      nebulaCol1 = 'rgba(30,20,10,0.3)';
      subject = `
        <image href="/assets/planets/mercury.png" x="35%" y="30%" width="30%" height="30%"
          style="image-rendering:pixelated;image-rendering:crisp-edges"/>
        <text x="50%" y="67%" font-family="Courier New" font-size="8" fill="rgba(200,180,140,0.6)" text-anchor="middle">MERCURY</text>
        <text x="50%" y="73%" font-family="Courier New" font-size="6" fill="rgba(160,140,100,0.4)" text-anchor="middle">no atmosphere</text>`;
    } else if (sceneType === 'venus') {
      label = 'Venus';
      nebulaCol1 = 'rgba(50,40,10,0.4)'; nc1x='50%'; nc1y='45%';
      subject = `
        <image href="/assets/planets/venus.png" x="24%" y="22%" width="52%" height="52%"
          style="image-rendering:pixelated;image-rendering:crisp-edges"/>
        <text x="50%" y="80%" font-family="Courier New" font-size="8" fill="rgba(240,210,120,0.6)" text-anchor="middle">VENUS</text>
        <text x="50%" y="86%" font-family="Courier New" font-size="6" fill="rgba(200,170,80,0.4)" text-anchor="middle">thick cloud cover</text>`;
    } else if (sceneType === 'mars') {
      label = 'Mars';
      nebulaCol1 = 'rgba(50,15,5,0.4)'; nc1x='50%'; nc1y='46%';
      subject = `
        <image href="/assets/planets/mars.png" x="27%" y="24%" width="46%" height="46%"
          style="image-rendering:pixelated;image-rendering:crisp-edges"/>
        <text x="50%" y="76%" font-family="Courier New" font-size="8" fill="rgba(220,100,60,0.6)" text-anchor="middle">MARS</text>
        <text x="50%" y="82%" font-family="Courier New" font-size="6" fill="rgba(180,80,40,0.4)" text-anchor="middle">polar ice caps visible</text>`;
    } else if (sceneType === 'jupiter') {
      label = 'Jupiter';
      nebulaCol1 = 'rgba(30,20,10,0.4)';
      subject = `
        <image href="/assets/planets/jupiter.png" x="19%" y="18%" width="62%" height="58%"
          style="image-rendering:pixelated;image-rendering:crisp-edges"/>
        <circle cx="32%" cy="45%" r="1%" fill="rgba(220,210,190,0.9)"><animate attributeName="opacity" values="0.9;0.5;0.9" dur="3.1s" repeatCount="indefinite"/></circle>
        <circle cx="28%" cy="49%" r="0.8%" fill="rgba(210,200,180,0.85)"><animate attributeName="opacity" values="0.85;0.45;0.85" dur="2.4s" repeatCount="indefinite"/></circle>
        <circle cx="69%" cy="44%" r="0.9%" fill="rgba(220,215,195,0.9)"><animate attributeName="opacity" values="0.9;0.5;0.9" dur="3.8s" repeatCount="indefinite"/></circle>
        <circle cx="74%" cy="47%" r="0.7%" fill="rgba(210,205,185,0.8)"><animate attributeName="opacity" values="0.8;0.4;0.8" dur="2.9s" repeatCount="indefinite"/></circle>
        <text x="50%" y="82%" font-family="Courier New" font-size="8" fill="rgba(200,170,100,0.6)" text-anchor="middle">JUPITER</text>
        <text x="50%" y="88%" font-family="Courier New" font-size="6" fill="rgba(180,150,80,0.4)" text-anchor="middle">4 Galilean moons visible</text>`;
    } else if (sceneType === 'saturn') {
      label = 'Saturn';
      nebulaCol1 = 'rgba(30,25,15,0.4)';
      const sx=50, sy=50;
      subject = `
        <image href="/assets/planets/saturn.png" x="14%" y="38%" width="72%" height="23%"
          style="image-rendering:pixelated;image-rendering:crisp-edges"/>
        <text x="50%" y="68%" font-family="Courier New" font-size="8" fill="rgba(200,180,100,0.6)" text-anchor="middle">SATURN</text>
        ${(() => {
          const mr = mkRng(viewSeed ^ 0xca551a);
          // [orbitRadius%, size%, color]
          const moons: [number,number,string][] = [
            [28, 1.4, 'rgba(220,190,120,0.95)'], // Titan — largest, golden
            [22, 0.9, 'rgba(210,205,195,0.9)'],  // Rhea
            [18, 0.8, 'rgba(205,200,190,0.85)'], // Dione
            [15, 0.7, 'rgba(200,198,190,0.85)'], // Tethys
            [12, 0.6, 'rgba(240,245,255,0.95)'], // Enceladus — bright white
          ];
          return moons.map(([orb, ms, col]) => {
            const ang = mr() * Math.PI * 2;
            const mx = sx + orb * Math.cos(ang);
            const my = sy + orb * 0.28 * Math.sin(ang);
            return `<circle cx="${mx.toFixed(1)}%" cy="${my.toFixed(1)}%" r="${ms}%" fill="${col}">
              <animate attributeName="opacity" values="0.95;0.55;0.95" dur="${(2.5+mr()*2).toFixed(1)}s" repeatCount="indefinite"/>
            </circle>`;
          }).join('');
        })()}`;
    } else if (sceneType === 'uranus') {
      label = 'Uranus';
      nebulaCol1 = 'rgba(10,40,50,0.4)'; nc1x='50%'; nc1y='45%';
      subject = `
        <image href="/assets/planets/uranus.png" x="24%" y="23%" width="52%" height="53%"
          style="image-rendering:pixelated;image-rendering:crisp-edges"/>
        <text x="50%" y="82%" font-family="Courier New" font-size="8" fill="rgba(140,220,230,0.6)" text-anchor="middle">URANUS</text>
        <text x="50%" y="88%" font-family="Courier New" font-size="6" fill="rgba(100,180,190,0.4)" text-anchor="middle">rotates on its side</text>`;
    } else if (sceneType === 'neptune') {
      label = 'Neptune';
      nebulaCol1 = 'rgba(5,10,50,0.6)'; nc1x='50%'; nc1y='45%';
      subject = `
        <image href="/assets/planets/neptune.png" x="24%" y="24%" width="53%" height="52%"
          style="image-rendering:pixelated;image-rendering:crisp-edges"/>
        <text x="50%" y="82%" font-family="Courier New" font-size="8" fill="rgba(100,130,255,0.6)" text-anchor="middle">NEPTUNE</text>
        <text x="50%" y="88%" font-family="Courier New" font-size="6" fill="rgba(80,110,220,0.4)" text-anchor="middle">Great Dark Spot</text>`;
    } else if (sceneType === 'pluto') {
      label = 'Pluto';
      nebulaCol1 = 'rgba(20,15,10,0.3)';
      subject = `
        <image href="/assets/planets/pluto.png" x="34%" y="30%" width="32%" height="30%"
          style="image-rendering:pixelated;image-rendering:crisp-edges"/>
        <text x="50%" y="68%" font-family="Courier New" font-size="8" fill="rgba(200,185,150,0.6)" text-anchor="middle">PLUTO</text>
        <text x="50%" y="74%" font-family="Courier New" font-size="6" fill="rgba(160,145,110,0.4)" text-anchor="middle">Tombaugh Regio</text>`;
    } else if (sceneType === 'orion') {
      label = 'Orion';
      nebulaCol1 = 'rgba(40,20,60,0.7)'; nc1x='50%'; nc1y='45%';
      const s = [[38,22,2.2],[62,20,2.1],[45,42,1.6],[50,42,1.5],[55,42,1.6],[48,52,1.4],[40,65,2],[60,63,2],[50,48,1.3],[50,55,1.2]];
      subject = makeCon(s,[[0,2],[1,2],[2,3],[3,4],[4,1],[0,6],[1,7],[2,8],[8,9]], 'rgba(180,200,255,0.55)');
      subject += `<text x="51%" y="17%" font-family="Courier New" font-size="7" fill="rgba(180,200,255,0.5)" text-anchor="middle">ORION</text>`;
    } else if (sceneType === 'bigdipper') {
      label = 'Ursa Major';
      const s = [[28,30,2],[36,25,1.8],[46,22,1.9],[52,27,1.8],[50,35,1.7],[40,38,1.6],[35,44,1.8]];
      subject = makeCon(s,[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[3,5]], 'rgba(180,210,255,0.55)');
      subject += `<text x="40%" y="18%" font-family="Courier New" font-size="7" fill="rgba(180,200,255,0.5)" text-anchor="middle">URSA MAJOR</text>`;
    } else if (sceneType === 'cassiopeia') {
      label = 'Cassiopeia';
      const s = [[25,35,2],[36,25,1.9],[50,32,2.1],[64,24,1.9],[75,33,2]];
      subject = makeCon(s,[[0,1],[1,2],[2,3],[3,4]], 'rgba(200,220,255,0.55)');
      subject += `<text x="50%" y="19%" font-family="Courier New" font-size="7" fill="rgba(180,200,255,0.5)" text-anchor="middle">CASSIOPEIA</text>`;
    } else if (sceneType === 'pleiades') {
      label = 'Pleiades Cluster';
      nebulaCol1 = 'rgba(20,30,70,0.7)'; nc1x='50%'; nc1y='45%';
      const cluster = Array.from({length:22},(_,i)=> {
        const cr = mkRng(i*31+7); return [42+cr()*16, 38+cr()*16, 0.8+cr()*1.6];
      });
      subject = cluster.map(s => `<circle cx="${s[0].toFixed(1)}%" cy="${s[1].toFixed(1)}%" r="${s[2].toFixed(1)}" fill="rgba(180,210,255,0.9)"><animate attributeName="opacity" values="0.9;0.5;0.9" dur="${(1.5+s[2]).toFixed(1)}s" repeatCount="indefinite"/></circle>`).join('');
      subject += `<ellipse cx="50%" cy="46%" rx="13%" ry="11%" fill="rgba(100,140,255,0.03)" stroke="rgba(140,180,255,0.08)" stroke-width="1"/>`;
      subject += `<text x="50%" y="32%" font-family="Courier New" font-size="7" fill="rgba(180,210,255,0.5)" text-anchor="middle">PLEIADES</text>`;
    } else if (sceneType === 'aries') {
      label = 'Aries';
      nebulaCol1 = 'rgba(50,20,10,0.35)'; nc1x='50%'; nc1y='45%';
      const s = [[35,42,2.3],[50,38,1.8],[58,40,1.7],[65,43,1.6]];
      subject = makeCon(s,[[0,1],[1,2],[2,3]], 'rgba(255,200,160,0.55)');
      subject += `<text x="50%" y="32%" font-family="Courier New" font-size="7" fill="rgba(255,200,160,0.5)" text-anchor="middle">ARIES</text>`;
    } else if (sceneType === 'taurus') {
      label = 'Taurus';
      nebulaCol1 = 'rgba(40,20,5,0.35)'; nc1x='48%'; nc1y='48%';
      // V-shape Hyades + Aldebaran
      const s = [[40,52,2.8],[50,46,1.9],[56,50,1.8],[50,56,1.7],[44,58,1.6],[35,40,1.5],[44,38,1.5],[58,34,1.4],[64,28,1.4]];
      subject = makeCon(s,[[0,1],[1,2],[2,3],[3,4],[4,0],[1,5],[1,6],[6,7],[7,8]], 'rgba(255,210,150,0.5)');
      subject += `<text x="50%" y="26%" font-family="Courier New" font-size="7" fill="rgba(255,210,150,0.5)" text-anchor="middle">TAURUS</text>`;
    } else if (sceneType === 'gemini') {
      label = 'Gemini';
      nebulaCol1 = 'rgba(20,20,50,0.35)'; nc1x='50%'; nc1y='44%';
      // Twin columns: Castor & Pollux at top
      const s = [[38,24,2.2],[56,26,2.4],[37,34,1.7],[55,35,1.7],[36,44,1.7],[54,44,1.6],[35,54,1.6],[54,54,1.5],[36,62,1.5],[55,62,1.5]];
      subject = makeCon(s,[[0,2],[2,4],[4,6],[6,8],[1,3],[3,5],[5,7],[7,9],[4,5]], 'rgba(200,220,255,0.55)');
      subject += `<text x="47%" y="18%" font-family="Courier New" font-size="7" fill="rgba(200,220,255,0.5)" text-anchor="middle">GEMINI</text>`;
    } else if (sceneType === 'cancer') {
      label = 'Cancer';
      nebulaCol1 = 'rgba(10,30,40,0.35)'; nc1x='50%'; nc1y='46%';
      const s = [[38,36,1.8],[56,34,1.8],[44,46,1.7],[50,56,2],[38,62,1.6],[56,62,1.6]];
      subject = makeCon(s,[[0,2],[1,2],[2,3],[3,4],[3,5]], 'rgba(170,220,255,0.5)');
      subject += `<text x="50%" y="28%" font-family="Courier New" font-size="7" fill="rgba(170,220,255,0.5)" text-anchor="middle">CANCER</text>`;
    } else if (sceneType === 'leo') {
      label = 'Leo';
      nebulaCol1 = 'rgba(40,25,10,0.4)'; nc1x='45%'; nc1y='45%';
      const s = [[35,55,2.4],[28,42,1.8],[35,32,1.7],[48,28,2],[58,32,1.8],[62,42,2.2],[55,55,1.7],[48,50,1.5]];
      subject = makeCon(s,[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[5,7],[7,0]], 'rgba(255,220,160,0.5)');
      subject += `<text x="46%" y="24%" font-family="Courier New" font-size="7" fill="rgba(255,220,160,0.45)" text-anchor="middle">LEO</text>`;
    } else if (sceneType === 'virgo') {
      label = 'Virgo';
      nebulaCol1 = 'rgba(30,40,10,0.35)'; nc1x='50%'; nc1y='47%';
      const s = [[50,22,1.8],[44,30,1.7],[38,38,2.3],[44,46,1.6],[50,52,1.7],[58,46,1.6],[64,38,1.8],[60,28,1.7],[52,38,1.5]];
      subject = makeCon(s,[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,0],[3,8],[8,5]], 'rgba(200,240,180,0.5)');
      subject += `<text x="50%" y="16%" font-family="Courier New" font-size="7" fill="rgba(200,240,180,0.5)" text-anchor="middle">VIRGO</text>`;
    } else if (sceneType === 'libra') {
      label = 'Libra';
      nebulaCol1 = 'rgba(20,30,20,0.35)'; nc1x='50%'; nc1y='46%';
      const s = [[38,54,2],[62,54,2],[34,42,1.8],[66,42,1.7],[50,36,1.9],[50,50,1.6]];
      subject = makeCon(s,[[0,1],[0,2],[1,3],[2,4],[3,4],[4,5],[5,0],[5,1]], 'rgba(180,240,180,0.5)');
      subject += `<text x="50%" y="28%" font-family="Courier New" font-size="7" fill="rgba(180,240,180,0.5)" text-anchor="middle">LIBRA</text>`;
    } else if (sceneType === 'scorpius') {
      label = 'Scorpius';
      nebulaCol1 = 'rgba(60,10,10,0.5)'; nc1x='50%'; nc1y='50%';
      const s = [[50,20,2.4],[47,28,1.8],[44,35,1.7],[40,42,1.6],[38,50,1.5],[40,58,1.4],[44,65,1.6],[48,70,1.5],[53,68,1.5],[42,34,1.4],[36,30,1.4]];
      subject = makeCon(s,[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[2,9],[9,10]], 'rgba(255,160,140,0.5)');
      subject += `<text x="50%" y="15%" font-family="Courier New" font-size="7" fill="rgba(255,160,140,0.5)" text-anchor="middle">SCORPIUS</text>`;
    } else if (sceneType === 'sagittarius') {
      label = 'Sagittarius';
      nebulaCol1 = 'rgba(40,20,5,0.45)'; nc1x='50%'; nc1y='50%';
      // Teapot asterism
      const s = [[44,58,1.8],[52,56,1.7],[58,52,2],[54,46,2.1],[46,46,1.8],[38,50,1.7],[36,56,1.7],[50,62,1.6]];
      subject = makeCon(s,[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,0],[0,7],[1,3],[4,3]], 'rgba(255,190,100,0.5)');
      subject += `<text x="50%" y="38%" font-family="Courier New" font-size="7" fill="rgba(255,190,100,0.5)" text-anchor="middle">SAGITTARIUS</text>`;
    } else if (sceneType === 'capricorn') {
      label = 'Capricorn';
      nebulaCol1 = 'rgba(15,25,35,0.35)'; nc1x='50%'; nc1y='47%';
      const s = [[32,38,2],[44,34,1.8],[56,34,1.8],[66,40,2],[60,50,1.7],[50,56,1.8],[40,56,1.7],[34,50,1.7]];
      subject = makeCon(s,[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,0],[1,6],[2,5]], 'rgba(160,200,220,0.5)');
      subject += `<text x="50%" y="28%" font-family="Courier New" font-size="7" fill="rgba(160,200,220,0.5)" text-anchor="middle">CAPRICORN</text>`;
    } else if (sceneType === 'aquarius') {
      label = 'Aquarius';
      nebulaCol1 = 'rgba(10,20,50,0.45)'; nc1x='50%'; nc1y='46%';
      const s = [[42,32,2.2],[50,36,1.8],[44,44,1.7],[52,50,1.8],[42,56,1.7],[56,56,1.7],[60,48,1.6],[38,48,1.6]];
      subject = makeCon(s,[[0,1],[0,2],[2,3],[3,4],[3,5],[3,6],[2,7]], 'rgba(140,200,255,0.5)');
      // water droplets
      subject += `<text x="50%" y="26%" font-family="Courier New" font-size="7" fill="rgba(140,200,255,0.5)" text-anchor="middle">AQUARIUS</text>`;
    } else if (sceneType === 'pisces') {
      label = 'Pisces';
      nebulaCol1 = 'rgba(10,20,40,0.4)'; nc1x='50%'; nc1y='46%';
      // Two fish + cord
      const s = [[28,38,2],[22,44,1.8],[28,52,1.8],[36,46,1.7],[72,38,2],[78,44,1.8],[72,52,1.8],[64,46,1.7],[50,46,1.5]];
      subject = makeCon(s,[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[3,8],[8,7]], 'rgba(160,200,255,0.5)');
      subject += `<text x="50%" y="28%" font-family="Courier New" font-size="7" fill="rgba(160,200,255,0.5)" text-anchor="middle">PISCES</text>`;
    } else { // moon
      nebulaCol1 = 'rgba(20,20,30,0.5)';
      // ── Real lunar phase ──────────────────────────────────────────
      // Known new moon: 2000-01-06 18:14 UTC
      const knownNewMoon = 947182440000;
      const lunarCycle  = 29.53059 * 86400000;
      const realPhase   = ((Date.now() - knownNewMoon) % lunarCycle) / lunarCycle;
      // 0=new moon  0.25=first quarter  0.5=full moon  0.75=last quarter
      const phaseNames = [
        [0.03,  'New Moon'],
        [0.22,  'Waxing Crescent'],
        [0.28,  'First Quarter'],
        [0.47,  'Waxing Gibbous'],
        [0.53,  'Full Moon'],
        [0.72,  'Waning Gibbous'],
        [0.78,  'Last Quarter'],
        [0.97,  'Waning Crescent'],
        [1.00,  'New Moon'],
      ];
      const phaseName = phaseNames.find(([t]) => realPhase <= (t as number))![1] as string;
      label = `Luna — ${phaseName}`;
      // Shadow offset: waxing moves shadow left (right side lit), waning moves right (left side lit)
      // moonR*2.1 pushes shadow fully off the disc at full moon
      const moonX = 50, moonY = 46, moonR = 18;
      const maxOff = moonR * 2.1;
      const shadowOff = realPhase <= 0.5
        ? -realPhase * 2 * maxOff          // 0 → -maxOff (new → full, waxing)
        : (1 - realPhase) * 2 * maxOff;   // +maxOff → 0 (full → new, waning)
      const craters = Array.from({length:12},(_,i)=>{const cr=mkRng(i*17+3);return{x:moonX-moonR+cr()*moonR*1.8,y:moonY-moonR+cr()*moonR*1.8,r:cr()*2+0.6,a:0.15+cr()*0.25};});
      const craterSvg = craters.map(c=>`<circle cx="${c.x.toFixed(1)}%" cy="${c.y.toFixed(1)}%" r="${c.r.toFixed(1)}" fill="none" stroke="rgba(160,155,130,${c.a.toFixed(2)})" stroke-width="0.5"/>`).join('');
      subject = `
        <defs>
          <radialGradient id="${uid}lunagrad" cx="35%" cy="32%" r="65%">
            <stop offset="0%" stop-color="#e8e0c0"/><stop offset="60%" stop-color="#c8c0a0"/><stop offset="100%" stop-color="#a09070"/>
          </radialGradient>
          <clipPath id="${uid}lunaclip"><circle cx="${moonX}%" cy="${moonY}%" r="${moonR}%"/></clipPath>
          <mask id="${uid}lunamask">
            <rect width="100%" height="100%" fill="white"/>
            <circle cx="${(moonX+shadowOff).toFixed(1)}%" cy="${(moonY-2).toFixed(1)}%" r="${(moonR*1.05).toFixed(1)}%" fill="black"/>
          </mask>
        </defs>
        <circle cx="${moonX}%" cy="${moonY}%" r="${moonR}%" fill="url(#${uid}lunagrad)" mask="url(#${uid}lunamask)"/>
        <g clip-path="url(#${uid}lunaclip)" mask="url(#${uid}lunamask)">${craterSvg}</g>
        <circle cx="${moonX}%" cy="${moonY}%" r="${moonR}%" fill="none" stroke="rgba(220,210,160,0.15)" stroke-width="0.5"/>
        <text x="50%" y="74%" font-family="Courier New" font-size="8" fill="rgba(220,210,160,0.55)" text-anchor="middle">LUNA</text>`;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,5,0.94);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;z-index:9000;';
    overlay.innerHTML = `
      <div style="font-family:'Courier New',monospace;font-size:11px;color:rgba(140,170,255,0.6);letter-spacing:0.15em;text-transform:uppercase">${label}</div>
      <div style="position:relative;width:min(460px,78vmin);height:min(460px,78vmin);border-radius:50%;overflow:hidden;
        box-shadow:0 0 0 3px #1a1a2e,0 0 0 7px #0d0d1a,0 0 50px rgba(50,70,160,0.4),inset 0 0 80px rgba(0,0,20,0.6);">
        <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="position:absolute;inset:0">
          <defs>
            <radialGradient id="${uid}n1" cx="${nc1x}" cy="${nc1y}" r="38%">
              <stop offset="0%" stop-color="${nebulaCol1}"/><stop offset="100%" stop-color="transparent"/>
            </radialGradient>
            <radialGradient id="${uid}n2" cx="${nc2x}" cy="${nc2y}" r="30%">
              <stop offset="0%" stop-color="${nebulaCol2}"/><stop offset="100%" stop-color="transparent"/>
            </radialGradient>
            <radialGradient id="${uid}vig" cx="50%" cy="50%" r="50%">
              <stop offset="70%" stop-color="transparent"/><stop offset="100%" stop-color="rgba(0,0,10,0.97)"/>
            </radialGradient>
          </defs>
          <rect width="100%" height="100%" fill="#00000c"/>
          <rect width="100%" height="100%" fill="url(#${uid}n1)"/>
          <rect width="100%" height="100%" fill="url(#${uid}n2)"/>
          ${starSvg}
          ${subject}
          <line x1="50%" y1="2%" x2="50%" y2="98%" stroke="rgba(80,120,255,0.12)" stroke-width="0.5"/>
          <line x1="2%" y1="50%" x2="98%" y2="50%" stroke="rgba(80,120,255,0.12)" stroke-width="0.5"/>
          <circle cx="50%" cy="50%" r="6%" fill="none" stroke="rgba(80,120,255,0.15)" stroke-width="0.5"/>
          <circle cx="50%" cy="50%" r="50%" fill="url(#${uid}vig)"/>
        </svg>
      </div>
      <div style="font-family:'Courier New',monospace;font-size:10px;color:rgba(100,130,200,0.4);letter-spacing:0.1em">[ESC] close</div>
    `;

    overlay.addEventListener('click', e => { if (e.target === overlay) this.closeTelescopeView(); });
    document.body.appendChild(overlay);
    this.telescopeOverlay = overlay;
    overlay.style.opacity = '0';
    requestAnimationFrame(() => { overlay.style.transition = 'opacity 0.4s ease'; overlay.style.opacity = '1'; });
  }

  private closeTelescopeView(): void {
    if (!this.telescopeOverlay) return;
    const el = this.telescopeOverlay;
    this.telescopeOverlay = null;
    el.style.transition = 'opacity 0.25s ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 260);
  }

  private updateCabinProximity(): void {
    const near = Math.abs(this.player.x - CABIN_DOOR_X) < 46;
    if (near !== this.nearCabin) {
      this.nearCabin = near;
      this.cabinPromptBg.setVisible(near); this.cabinPromptText.setVisible(near); this.cabinPromptArrow.setVisible(near);
      if (!near) this.tweens.killTweensOf(this.cabinPromptArrow);
    }
    if (near) {
      const px = CABIN_DOOR_X, py = FLOOR_Y - 96;
      this.cabinPromptBg.setPosition(px - 64, py - 2);
      this.cabinPromptText.setPosition(px, py + 8);
      this.cabinPromptArrow.setPosition(px, py + 22);
      if (!this.tweens.isTweening(this.cabinPromptArrow)) {
        this.tweens.add({ targets: this.cabinPromptArrow, y: py + 27, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // OTHER PLAYERS
  // ══════════════════════════════════════════════════════════════════
  protected override getPlayerSprite(): Phaser.GameObjects.Image { return this.player; }
  protected override showEmoteAsBubble(): boolean { return true; }
  protected override handleSceneEsc(): boolean {
    if (this.telescopeOverlay) { this.closeTelescopeView(); return true; }
    return false;
  }

  protected override getOtherPlayerConfig(): import('./BaseScene').OtherPlayerConfig {
    return {
      texKeyPrefix: 'avatar_hub_', scale: 1,
      nameYOffset: +14, statusYOffset: +26,
      nameColor: WOODS_ACCENT, nameFontSize: '9px', statusFontSize: '8px',
      nameBg: '#04081088', namePadding: { x: 3, y: 1 },
      czW: 40, czH: 50, czYOffset: -20,
      tintPalette: [0xe87aab, 0x7b68ee, 0x5dcaa5, 0xfad480, 0xb8a8f8],
      useFadeIn: true, interpolateY: false, emoteContext: 'hub',
    };
  }
  protected override renderOtherAvatar(cfg: import('../stores/avatarStore').AvatarConfig): HTMLCanvasElement {
    return renderHubSprite(cfg);
  }
  // ══════════════════════════════════════════════════════════════════
  // COMMANDS
  // ══════════════════════════════════════════════════════════════════
  protected override getSceneAccent(): string { return WOODS_ACCENT; }

  private handleCommand(text: string): void {
    const parts = text.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ').trim();

    switch (cmd) {
      case 'fish': case 'cast':
        if (this.nearDockTip) this.handleFishingPress();
        else this.chatUI.addMessage('system', 'Head to the end of the dock to fish.', WOODS_ACCENT);
        break;
      default: {
        if (!this.handleCommonCommand(cmd, arg))
          this.chatUI.addMessage('system', `Unknown: /${cmd}`, P.amber);
        break;
      }
    }
    this.chatUI.flashLog();
  }

  // WoodsScene shows an in-world speech bubble for emotes in addition to the
  // chat log message, so we override the base implementation.
  protected override handleEmoteCommand(name: string): void {
    const ac = this.getSceneAccent();
    if (this.emoteSet.isActive(name)) {
      this.emoteSet.stop(name);
      this.chatUI.addMessage('system', EMOTE_OFF_MSGS[name] ?? 'Done', ac);
      sendChat(`/emote ${name}_off`);
    } else {
      this.emoteSet.start(name);
      if (name === 'smoke') this.snd.lighterFlick();
      const flavor = EMOTE_FLAVORS[name] ?? `*${name}*`;
      ChatUI.showBubble(this, this.player.x, this.player.y - 48, flavor, ac);
      sendChat(`/emote ${name}_on`);
    }
  }
}

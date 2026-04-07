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
import { GAME_WIDTH, GAME_HEIGHT, WORLD_WIDTH, GROUND_Y, PLAYER_SPEED, P, ANIM, hexToNum, hexToRgb } from '../config/game.config';
import {
  setPresenceCallbacks, sendPosition, sendChat, sendRoomChange,
  sendRoomRequest, sendRoomResponse,
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
import { EmoteSet, EMOTE_FLAVORS, EMOTE_OFF_MSGS } from '../entities/EmoteSet';
import { SettingsPanel } from '../ui/SettingsPanel';
import { renderHubSprite } from '../entities/AvatarRenderer';
import { deserializeAvatar, getDefaultAvatar, getAvatar } from '../stores/avatarStore';
import { authStore } from '../stores/authStore';
import { SoundEngine } from '../audio/SoundEngine';
import { ComputerUI } from '../ui/ComputerUI';
import { MuteList } from '../ui/MuteList';
import { PlayerPicker } from '../ui/PlayerPicker';

const WOODS_ACCENT = '#aaff44';
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

// ── Particles ──
interface Firefly { x: number; y: number; vx: number; vy: number; phase: number; size: number; }
interface Ember { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; }
interface Ripple { x: number; y: number; radius: number; maxRadius: number; alpha: number; }
interface ChimneyPuff { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; }

interface OtherPlayer {
  sprite: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  targetX: number; targetY: number;
  name: string; avatar?: string; status?: string;
  clickZone?: Phaser.GameObjects.Zone;
  emotes?: EmoteSet;
}

export class WoodsScene extends Phaser.Scene {
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
  private dyingSprites = new Map<string, OtherPlayer>();

  private chatUI!: ChatUI;
  private dmPanel!: DMPanel;
  private followsPanel!: FollowsPanel;
  private settingsPanel = new SettingsPanel();
  private emoteGraphics!: Phaser.GameObjects.Graphics;
  private emoteSet = new EmoteSet();
  private snd = SoundEngine.get();
  private computerUI = new ComputerUI();
  private muteList = new MuteList();
  private playerPicker = new PlayerPicker();
  private isLeavingScene = false;

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

  constructor() { super({ key: 'WoodsScene' }); }
  init(data?: { fromCabin?: boolean }): void { this.emoteSet.stopAll(); this.isLeavingScene = false; this.spawnX = data?.fromCabin ? CABIN_DOOR_X - 60 : 1400; }

  create(): void {
    this.renderParallaxLayer();
    this.renderMainBackground();
    this.parallaxBg = this.add.image(W / 2, GAME_HEIGHT / 2, 'woods_parallax').setDepth(-2).setAlpha(0.6);
    this.add.image(W / 2, GAME_HEIGHT / 2, 'woods_bg').setDepth(-1);

    this.shootingStarGraphics = this.add.graphics().setDepth(-1);
    this.waterGraphics = this.add.graphics().setDepth(1);
    this.campfireGraphics = this.add.graphics().setDepth(3);
    this.chimneyGraphics = this.add.graphics().setDepth(4);
    this.fireflyGraphics = this.add.graphics().setDepth(12);
    this.emoteGraphics = this.add.graphics().setDepth(15);

    for (let i = 0; i < 50; i++) {
      this.fireflies.push({ x: 40 + Math.random() * (W - 80), y: 40 + Math.random() * (FLOOR_Y - 60), vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.3, phase: Math.random() * Math.PI * 2, size: 1.5 + Math.random() * 1.5 });
    }

    this.createPlayer();
    this.cameras.main.setBounds(0, 0, W, GAME_HEIGHT);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setDeadzone(80, 50);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { const wx = this.cameras.main.scrollX + p.x; if (p.y < FLOOR_Y - 10 || p.y > 455) return; if (wx < DOCK_X) return; this.targetX = Phaser.Math.Clamp(wx, DOCK_X, W - 20); this.isMoving = true; });

    const myPubkey = this.registry.get('playerPubkey');
    this.snd.setRoom('woods');
    this.chatUI = new ChatUI();
    const chatInput = this.chatUI.create('Chat in the woods...', WOODS_ACCENT, (cmd) => this.handleCommand(cmd));
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
    this.input.keyboard?.on('keydown-ESC', () => { if (document.activeElement === this.chatUI.getInput()) return; if (this.playerPicker.isOpen()) { this.playerPicker.close(); return; } });

    // Cabin door prompt
    this.cabinPromptBg = this.add.graphics().setDepth(50).setVisible(false);
    this.cabinPromptBg.fillStyle(0x080502, 0.9); this.cabinPromptBg.fillRoundedRect(0, 0, 128, 28, 5);
    this.cabinPromptBg.lineStyle(1, 0x6a3c10, 0.6); this.cabinPromptBg.strokeRoundedRect(0, 0, 128, 28, 5);
    this.cabinPromptText = this.add.text(0, 0, this.sys.game.device.input.touch ? '[TAP] Enter CABIN' : '[E] Enter CABIN', { fontFamily: '"Courier New", monospace', fontSize: '10px', color: '#f0a030', fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.cabinPromptArrow = this.add.text(0, 0, '▼', { fontFamily: 'monospace', fontSize: '9px', color: '#f0a030' }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.cabinPromptBg.setInteractive(new Phaser.Geom.Rectangle(0, 0, 128, 28), Phaser.Geom.Rectangle.Contains);
    this.cabinPromptBg.on('pointerdown', () => { if (this.nearCabin && !this.isLeavingScene) { this.isLeavingScene = true; this.enterCabin(); } });
    this.input.keyboard?.on('keydown-E', () => { if (document.activeElement === this.chatUI.getInput()) return; if (this.nearCabin && !this.isLeavingScene) { this.isLeavingScene = true; this.enterCabin(); } });

    setPresenceCallbacks({
      onPlayerJoin: (p) => { if (p.pubkey === myPubkey || this.otherPlayers.has(p.pubkey)) return; this.addOtherPlayer(p.pubkey, p.name, p.x, p.y, (p as any).avatar, (p as any).status); sendAvatarUpdate(); },
      onPlayerMove: (pk, x, y) => { const o = this.otherPlayers.get(pk); if (o) { o.targetX = x; o.targetY = y; } },
      onPlayerLeave: (pk) => this.removeOtherPlayer(pk),
      onCountUpdate: () => {},
      onChat: (pk, name, text) => {
        const isMe = pk === myPubkey;
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
                if (flavor) { ChatUI.showBubble(this, o.sprite.x, o.sprite.y - 48, flavor, P.dpurp); if (!mutedPlayers.has(pk)) this.chatUI.addMessage(name, flavor, P.dpurp, pk); }
              } else { o.emotes.stop(emoteName); }
            }
          }
          return;
        }
        if (!isMe && mutedPlayers.has(pk)) return;
        if (!isMe && shouldFilter(text)) return;
        this.chatUI.addMessage(name, text, isMe ? WOODS_ACCENT : P.lpurp, pk);
        if (!isMe && !this.chatUI.isFocused()) this.snd.chatPing();
        if (isMe) ChatUI.showBubble(this, this.player.x, this.player.y - 48, text, WOODS_ACCENT);
        else { const o = this.otherPlayers.get(pk); if (o) ChatUI.showBubble(this, o.sprite.x, o.sprite.y - 48, text, P.lpurp); }
      },
      onAvatarUpdate: (pk, avatarStr) => { const o = this.otherPlayers.get(pk); if (!o) return; o.avatar = avatarStr; const cfg = deserializeAvatar(avatarStr) || getDefaultAvatar(); const texKey = `avatar_hub_${pk}`; if (this.textures.exists(texKey)) this.textures.remove(texKey); this.textures.addCanvas(texKey, renderHubSprite(cfg)); o.sprite.setTexture(texKey).setTint(0xffffff); },
      onNameUpdate: (pk, name) => { const o = this.otherPlayers.get(pk); if (o) { o.nameText.setText(name.slice(0, 14)); o.name = name; } },
      onStatusUpdate: (pk, status) => { const o = this.otherPlayers.get(pk); if (o) { o.status = status; o.statusText.setText(status.slice(0, 30)); o.statusText.setAlpha(status ? 1 : 0); } },
    });
    sendRoomChange('woods', 1400, this.playerY);

    const unsubProfile = authStore.subscribe(() => { const n = authStore.getState().displayName; if (n && n !== this.registry.get('playerName')) { this.registry.set('playerName', n); this.playerName?.setText(n); sendNameUpdate(n); } });
    this.cameras.main.fadeIn(400, 4, 8, 10);
    this.settingsPanel.create();

    this.events.on('shutdown', () => {
      unsubProfile(); this.chatUI.destroy(); this.settingsPanel.destroy(); this.computerUI.close(); this.muteList.destroy(); this.playerPicker.close();
      if (this.dmPanel) this.dmPanel.close(); if (this.followsPanel) this.followsPanel.close();
      destroyPlayerMenu(); ProfileModal.destroy();
      this.cabinPromptBg?.destroy(); this.cabinPromptText?.destroy(); this.cabinPromptArrow?.destroy();
      this.otherPlayers.forEach(o => { o.sprite.destroy(); o.nameText.destroy(); o.statusText.destroy(); if (o.clickZone) o.clickZone.destroy(); });
      this.otherPlayers.clear();
      setRoomRequestHandler(null); setRoomKickHandler(null); setRoomGrantedHandler(null); setRoomDeniedHandler(null);
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
    const c = document.createElement('canvas'); c.width = W; c.height = GAME_HEIGHT;
    const x = c.getContext('2d')!; x.imageSmoothingEnabled = false;
    const r = (ax: number, ay: number, aw: number, ah: number, col: string) => { x.fillStyle = col; x.fillRect(ax, ay, aw, ah); };

    // Sky
    const sg = x.createLinearGradient(0, 0, 0, FLOOR_Y);
    sg.addColorStop(0, '#010008'); sg.addColorStop(0.2, '#020012'); sg.addColorStop(0.5, '#04081a'); sg.addColorStop(0.8, '#061020'); sg.addColorStop(1, '#081420');
    x.fillStyle = sg; x.fillRect(0, 0, W, FLOOR_Y);

    // Stars
    for (let i = 0; i < 300; i++) { x.fillStyle = ['#fad480','#fff','#fff','#fff','#b8a8f8','#8aecd0'][Math.floor(Math.random()*6)]; x.globalAlpha = 0.15+Math.random()*0.6; x.fillRect(Math.random()*W, Math.random()*(FLOOR_Y-80), Math.random()>0.92?2:1, 1); }
    for (let i = 0; i < 8; i++) { const sx=Math.random()*W, sy=10+Math.random()*150; x.fillStyle='#fff'; x.globalAlpha=0.4+Math.random()*0.3; x.fillRect(sx,sy,2,2); x.globalAlpha=0.08; x.fillRect(sx-2,sy,6,1); x.fillRect(sx,sy-2,1,6); }
    x.globalAlpha = 1;

    // Moon
    const moonX = 1100;
    x.fillStyle = '#f5e8d0';
    [0.04,0.08,0.2,0.45,0.7].forEach((a,i) => { x.globalAlpha=a; x.beginPath(); x.arc(moonX,55,40-i*7,0,Math.PI*2); x.fill(); });
    x.globalAlpha = 1;

    // Mid treeline
    x.fillStyle = '#050c08';
    for (let tx = -20; tx < W+30; tx += 16+Math.random()*25) { const th=50+Math.random()*110, tw=14+Math.random()*26; x.beginPath(); x.moveTo(tx+tw/2, FLOOR_Y-40-th); x.lineTo(tx+tw+3, FLOOR_Y-35); x.lineTo(tx-3, FLOOR_Y-35); x.closePath(); x.fill(); }

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

    // ── Fallen log (x~1320) ──
    r(1290, FLOOR_Y-14, 80, 14, '#2a1808');
    r(1290, FLOOR_Y-14, 80, 3, '#362010');
    r(1290, FLOOR_Y-14, 8, 14, '#1e1006');
    r(1292, FLOOR_Y-12, 4, 10, '#2a1a0c');
    r(1366, FLOOR_Y-14, 8, 14, '#1e1006');
    x.globalAlpha=0.5;
    for(let mx=1295;mx<1368;mx+=9){r(mx,FLOOR_Y-17,6,4,'#1a3010');}
    x.globalAlpha=1;


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
    stump(1170, 18, 14);   // small, between barrel and fallen log
    stump(1430, 16, 14);   // small, between log and lantern
    stump(1538, 22, 18);   // far right

    // Right edge — district buildings peeking
    x.fillStyle='#0e0828'; x.globalAlpha=0.15;
    x.fillRect(W-30,FLOOR_Y-120,35,120); x.fillRect(W-55,FLOOR_Y-90,30,90); x.globalAlpha=1;

    // Lake mist
    x.fillStyle='#8aecd0'; x.globalAlpha=0.012; x.fillRect(LAKE_LEFT-30,FLOOR_Y-30,LAKE_RIGHT-LAKE_LEFT+60,50); x.globalAlpha=1;

    // Vignette
    const vg = x.createRadialGradient(W/2,GAME_HEIGHT/2,W*0.2,W/2,GAME_HEIGHT/2,W*0.55);
    vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,0.4)');
    x.fillStyle=vg; x.fillRect(0,0,W,GAME_HEIGHT);

    if (this.textures.exists('woods_bg')) this.textures.remove('woods_bg');
    this.textures.addCanvas('woods_bg', c);
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
    this.updateWater(time, delta);
    this.updateShootingStar(delta);
    this.updateCabinProximity();

    const isWalking = this.isKeyboardMoving || this.isMoving || this.targetX !== null;
    if (isWalking) {
      this.footTimer += delta; if (this.footTimer >= 300) { this.footTimer = 0; this.snd.footstep(); }
      this.walkTime += delta;
      this.player.y = this.playerY + Math.abs(Math.sin(this.walkTime * Math.PI / 150)) * -2;
      const nf = Math.floor(this.walkTime / 150) % 2;
      if (nf !== this.walkFrame) { this.walkFrame = nf; this.player.setTexture(`player_walk${this.walkFrame}`); }
    } else { this.walkTime = 0; if (this.walkFrame !== 0) { this.walkFrame = 0; this.player.setTexture('player'); } this.player.y = this.playerY; }

    this.emoteGraphics.clear();
    this.emoteSet.updateAll(this.emoteGraphics, delta, this.player.x, this.player.y, this.facingRight, 'hub', isWalking);
    this.player.setAlpha(this.emoteSet.isActive('ghost') ? 0.3 : 1);

    if (this.player.x >= W - 24 && !this.isLeavingScene) { this.isLeavingScene = true; this.leaveToDistrict(); }

    this.playerName.setPosition(this.player.x, this.player.y - 44);
    this.playerStatusText.setPosition(this.player.x, this.player.y - 59);
    sendPosition(this.player.x, this.player.y);

    this.otherPlayers.forEach(o => {
      if (Math.abs(o.targetX - o.sprite.x) > 1) o.sprite.x += (o.targetX - o.sprite.x) * 0.12;
      if (Math.abs(o.targetY - o.sprite.y) > 1) o.sprite.y += (o.targetY - o.sprite.y) * 0.12;
      o.nameText.setPosition(o.sprite.x, o.sprite.y - 44); o.statusText.setPosition(o.sprite.x, o.sprite.y - 59);
      if (o.clickZone) o.clickZone.setPosition(o.sprite.x, o.sprite.y - 20);
      o.emotes?.updateAll(this.emoteGraphics, delta, o.sprite.x, o.sprite.y, true, 'hub');
      o.sprite.setAlpha(o.emotes?.isActive('ghost') ? 0.3 : 1);
      o.sprite.y = Math.abs(o.targetX - o.sprite.x) > 3 ? this.playerY + Math.abs(Math.sin(time * Math.PI / 150)) * -2 : this.playerY;
    });
  }

  private updateMovement(): void {
    const c = this.input.keyboard?.createCursorKeys(); let vx = 0;
    if (c) { if (c.left.isDown) vx = -PLAYER_SPEED; else if (c.right.isDown) vx = PLAYER_SPEED; }
    this.isKeyboardMoving = vx !== 0;
    if (vx !== 0) { this.targetX = null; this.isMoving = false; this.player.x += vx / 60; this.facingRight = vx > 0; }
    else if (this.isMoving && this.targetX !== null) { const dx = this.targetX - this.player.x; if (Math.abs(dx) < 3) { this.isMoving = false; this.targetX = null; } else { this.player.x += Math.sign(dx) * PLAYER_SPEED / 60; this.facingRight = dx > 0; } }
    this.player.x = Phaser.Math.Clamp(this.player.x, DOCK_X, W - 20);
    if (this.player.x < DOCK_X) { this.player.x = DOCK_X; this.targetX = null; this.isMoving = false; }
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
    this.campfireGraphics.fillStyle(0xf0b040, gp); this.campfireGraphics.fillCircle(fx, fy, 90);
    this.campfireGraphics.fillStyle(0xe85454, gp * 0.5); this.campfireGraphics.fillCircle(fx, fy, 55);
    const fc = [0xf0b040, 0xe87830, 0xe85454, 0xfad480, 0xffe060];
    for (let i = 0; i < 7; i++) { const ox=Math.sin(time*0.005+i*1.2)*5, fh=10+Math.sin(time*0.008+i*0.8)*5+Math.random()*3, fw=2.5+Math.random()*2.5, bx=fx-10+i*3.2+ox, a=0.4+Math.sin(time*0.006+i*1.5)*0.2; this.campfireGraphics.fillStyle(fc[i%fc.length],a); this.campfireGraphics.fillRect(bx-fw/2,fy-fh,fw,fh); this.campfireGraphics.fillStyle(0xfad480,a*0.6); this.campfireGraphics.fillRect(bx-1,fy-fh*0.7,2,fh*0.5); }
    this.campfireGraphics.fillStyle(0xf0b040, 0.3+Math.sin(time*0.004)*0.1); this.campfireGraphics.fillRect(fx-10,fy-2,20,4);
    if (Math.random()>0.65) this.embers.push({x:fx+(Math.random()-0.5)*12,y:fy-8-Math.random()*6,vx:(Math.random()-0.5)*0.6,vy:-0.3-Math.random()*0.5,life:0,maxLife:600+Math.random()*800,size:1+Math.random()});
    const dt=delta/16;
    for (let i=this.embers.length-1;i>=0;i--) { const e=this.embers[i]; e.x+=e.vx*dt; e.y+=e.vy*dt; e.vx+=(Math.random()-0.5)*0.02; e.life+=delta; const p=e.life/e.maxLife; if(p>=1){this.embers.splice(i,1);continue;} const a=p<0.2?p/0.2:(1-p)/0.8; this.campfireGraphics.fillStyle(p<0.5?0xfad480:0xf0b040,a*0.7); this.campfireGraphics.fillRect(e.x,e.y,e.size,e.size); }
    if (this.embers.length > 30) this.embers = this.embers.slice(-20);
    for (let s=0;s<4;s++) { const sx=fx+Math.sin(time*0.002+s*2)*10, sy=fy-22-s*14-Math.sin(time*0.003+s)*4; this.campfireGraphics.fillStyle(0xcccccc,0.035-s*0.008); this.campfireGraphics.fillRect(sx-3,sy-2,6,4); }
  }

  // ══════════════════════════════════════════════════════════════════
  // FIREFLIES
  // ══════════════════════════════════════════════════════════════════
  private updateFireflies(time: number, delta: number): void {
    this.fireflyGraphics.clear();
    const dt=delta/16;
    for (const f of this.fireflies) {
      f.x+=f.vx*dt; f.y+=f.vy*dt; f.vx+=(Math.random()-0.5)*0.015; f.vy+=(Math.random()-0.5)*0.012;
      f.vx=Phaser.Math.Clamp(f.vx,-0.6,0.6); f.vy=Phaser.Math.Clamp(f.vy,-0.4,0.4);
      if(f.x<20||f.x>W-20)f.vx*=-0.8; if(f.y<40||f.y>FLOOR_Y-20)f.vy*=-0.8;
      f.x=Phaser.Math.Clamp(f.x,10,W-10); f.y=Phaser.Math.Clamp(f.y,30,FLOOR_Y-10);
      const pulse=0.3+Math.sin(time*0.003+f.phase)*0.35, alpha=Math.max(0,pulse);
      this.fireflyGraphics.fillStyle(0xaaff44,alpha*0.08); this.fireflyGraphics.fillCircle(f.x,f.y,f.size*4);
      this.fireflyGraphics.fillStyle(0xccff66,alpha*0.2); this.fireflyGraphics.fillCircle(f.x,f.y,f.size*2);
      this.fireflyGraphics.fillStyle(0xeeffaa,alpha*0.8); this.fireflyGraphics.fillRect(f.x-f.size/2,f.y-f.size/2,f.size,f.size);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // WATER
  // ══════════════════════════════════════════════════════════════════
  private updateWater(time: number, delta: number): void {
    this.waterGraphics.clear();
    for (let wy=FLOOR_Y+4;wy<GAME_HEIGHT;wy+=12) for (let wx=LAKE_LEFT+20;wx<LAKE_RIGHT-10;wx+=18) { const off=Math.sin(time*0.001+wx*0.03+wy*0.02)*3, a=0.04+Math.sin(time*0.002+wx*0.05)*0.02; this.waterGraphics.fillStyle(0x5dcaa5,a); this.waterGraphics.fillRect(wx+off,wy,10,1); }
    const mrx=1100, mry=FLOOR_Y+30, sh=Math.sin(time*0.004)*0.03;
    this.waterGraphics.fillStyle(0xf5e8d0,0.04+sh); this.waterGraphics.fillRect(mrx-6,mry-15,12,50);
    this.waterGraphics.fillStyle(0xf5e8d0,0.02+sh*0.5); this.waterGraphics.fillRect(mrx-10,mry-5,20,30);
    this.rippleTimer+=delta;
    if(this.rippleTimer>2500+Math.random()*3500){this.rippleTimer=0;this.ripples.push({x:LAKE_LEFT+50+Math.random()*(LAKE_RIGHT-LAKE_LEFT-100),y:FLOOR_Y+15+Math.random()*(GAME_HEIGHT-FLOOR_Y-30),radius:0,maxRadius:6+Math.random()*10,alpha:0.1});}
    for(let i=this.ripples.length-1;i>=0;i--){const rp=this.ripples[i];rp.radius+=delta*0.008;rp.alpha-=delta*0.00004;if(rp.alpha<=0||rp.radius>=rp.maxRadius){this.ripples.splice(i,1);continue;}this.waterGraphics.lineStyle(0.5,0x5dcaa5,rp.alpha);this.waterGraphics.strokeCircle(rp.x,rp.y,rp.radius);}
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
    this.player = this.add.image(this.spawnX, this.playerY, 'player').setOrigin(0.5, 1).setDepth(10);
    const name = this.registry.get('playerName') || 'guest';
    this.playerName = this.add.text(this.player.x, this.playerY - 44, name, { fontFamily: '"Courier New", monospace', fontSize: '9px', color: WOODS_ACCENT, align: 'center', backgroundColor: '#04081088', padding: { x: 3, y: 1 } }).setOrigin(0.5).setDepth(11);
    const ms = localStorage.getItem('nd_status') || '';
    this.playerStatusText = this.add.text(this.player.x, this.playerY - 59, ms, { fontFamily: '"Courier New", monospace', fontSize: '8px', color: P.lpurp, align: 'center' }).setOrigin(0.5).setDepth(11).setAlpha(ms ? 1 : 0);
  }

  private updateShootingStar(d: number): void {
    this.shootingStarGraphics.clear();
    if (!this.shootingStar) {
      this.shootingStarTimer += d;
      if (this.shootingStarTimer > 8000 + Math.random() * 12000) {
        this.shootingStarTimer = 0;
        const goRight = Math.random() > 0.5;
        this.shootingStar = { x: goRight ? Math.random() * W * 0.4 : W * 0.6 + Math.random() * W * 0.4, y: 8 + Math.random() * 35, vx: goRight ? 4.5 + Math.random() * 3 : -(4.5 + Math.random() * 3), vy: 1.2 + Math.random() * 1.4, life: 0, maxLife: 450 + Math.random() * 350 };
      }
      return;
    }
    const s = this.shootingStar;
    const dt = d / 16;
    s.x += s.vx * dt; s.y += s.vy * dt; s.life += d;
    const pr = s.life / s.maxLife;
    const a = pr < 0.15 ? pr / 0.15 : pr > 0.65 ? (1 - pr) / 0.35 : 1;
    for (let i = 1; i <= 10; i++) { const tx = s.x - s.vx * i * 2.0, ty = s.y - s.vy * i * 2.0, ta = a * (0.22 - i * 0.018); if (ta > 0) { this.shootingStarGraphics.fillStyle(0xc8b8ff, ta); this.shootingStarGraphics.fillRect(tx - 1, ty, 3, 2); } }
    for (let i = 1; i <= 10; i++) { const tx = s.x - s.vx * i * 1.8, ty = s.y - s.vy * i * 1.8, ta = a * (0.65 - i * 0.06); if (ta > 0) { this.shootingStarGraphics.fillStyle(i < 4 ? 0xfff5e6 : 0xb8a8f8, ta); this.shootingStarGraphics.fillRect(tx, ty, i < 4 ? 2 : 1, 1); } }
    this.shootingStarGraphics.fillStyle(0xddd0ff, a * 0.2); this.shootingStarGraphics.fillRect(s.x - 2, s.y - 2, 6, 6);
    this.shootingStarGraphics.fillStyle(0xffffff, a * 0.5); this.shootingStarGraphics.fillRect(s.x - 1, s.y - 1, 4, 4);
    this.shootingStarGraphics.fillStyle(0xffffff, a * 0.95); this.shootingStarGraphics.fillRect(s.x, s.y, 2, 2);
    if (s.life >= s.maxLife || s.y > 130 || s.x < -20 || s.x > W + 20) this.shootingStar = null;
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
  private addOtherPlayer(pk: string, name: string, px: number, py: number, avatarStr?: string, status?: string): void {
    const dying=this.dyingSprites.get(pk); if(dying){this.tweens.killTweensOf([dying.sprite,dying.nameText,dying.statusText]);dying.sprite.destroy();dying.nameText.destroy();dying.statusText.destroy();if(dying.clickZone)dying.clickZone.destroy();this.dyingSprites.delete(pk);}
    const texKey=`avatar_hub_${pk}`; const cfg=avatarStr?(deserializeAvatar(avatarStr)||getDefaultAvatar()):getDefaultAvatar();
    if(this.textures.exists(texKey))this.textures.remove(texKey); this.textures.addCanvas(texKey,renderHubSprite(cfg));
    const sp=this.add.image(px,py,texKey).setOrigin(0.5,1).setDepth(8);
    if(!avatarStr){const h=name.split('').reduce((a:number,c:string)=>a+c.charCodeAt(0),0);sp.setTint([0xe87aab,0x7b68ee,0x5dcaa5,0xfad480,0xb8a8f8][h%5]);}
    const nt=this.add.text(px,py-44,name.slice(0,14),{fontFamily:'"Courier New", monospace',fontSize:'9px',color:WOODS_ACCENT,align:'center',backgroundColor:'#04081088',padding:{x:3,y:1}}).setOrigin(0.5).setDepth(9);
    const ss=(status||'').slice(0,30); const st=this.add.text(px,py-59,ss,{fontFamily:'"Courier New", monospace',fontSize:'8px',color:P.lpurp,align:'center'}).setOrigin(0.5).setDepth(9).setAlpha(ss?1:0);
    const cz=this.add.zone(px,py-20,40,50).setInteractive({useHandCursor:true}).setDepth(12);
    cz.on('pointerdown',(ptr:Phaser.Input.Pointer)=>{ptr.event.stopPropagation();const op2=this.otherPlayers.get(pk);showPlayerMenu(pk,name.slice(0,14),ptr.x,ptr.y,{onChat:(t,c)=>this.chatUI.addMessage('system',t,c),getDMPanel:()=>this.dmPanel},op2?.avatar,op2?.status);});
    this.otherPlayers.set(pk,{sprite:sp,nameText:nt,statusText:st,targetX:px,targetY:py,name,avatar:avatarStr,status:status||'',clickZone:cz});
  }
  private removeOtherPlayer(pk: string): void {
    const o=this.otherPlayers.get(pk);if(!o)return;this.otherPlayers.delete(pk);this.dyingSprites.set(pk,o);
    this.tweens.add({targets:[o.sprite,o.nameText,o.statusText],alpha:0,duration:300,onComplete:()=>{o.sprite.destroy();o.nameText.destroy();o.statusText.destroy();if(o.clickZone)o.clickZone.destroy();this.dyingSprites.delete(pk);}});
  }

  // ══════════════════════════════════════════════════════════════════
  // COMMANDS
  // ══════════════════════════════════════════════════════════════════
  private handleCommand(text: string): void {
    const parts=text.slice(1).split(' ');const cmd=parts[0].toLowerCase();const arg=parts.slice(1).join(' ').trim();
    switch(cmd){
      case 'dm':{if(!canUseDMs()){this.chatUI.addMessage('system','DMs need a key',P.amber);return;}if(!arg){const ps:string[]=[];this.otherPlayers.forEach(o=>ps.push(o.name));this.chatUI.addMessage('system',ps.length?`Online: ${ps.join(', ')}`:'No players here',WOODS_ACCENT);return;}let tp:string|null=null;this.otherPlayers.forEach((o,pk)=>{if(o.name?.toLowerCase().includes(arg.toLowerCase()))tp=pk;});if(tp){this.dmPanel.open(tp);this.chatUI.addMessage('system','Opening DM...',WOODS_ACCENT);}else this.chatUI.addMessage('system',`"${arg}" not found`,P.amber);break;}
      case 'zap':{if(!arg){this.chatUI.addMessage('system','Usage: /zap <name>',WOODS_ACCENT);return;}const za=authStore.getState();if(!za.pubkey||za.isGuest){this.chatUI.addMessage('system','Login to zap',P.amber);return;}let zt:string|null=null;let zn=arg;this.otherPlayers.forEach((o,pk)=>{if(o.name?.toLowerCase().includes(arg.toLowerCase())){zt=pk;zn=o.name;}});if(!zt){this.chatUI.addMessage('system',`"${arg}" not found`,P.amber);return;}ZapModal.show(zt,zn);break;}
      case 'smoke':{if(this.emoteSet.isActive('smoke')){this.emoteSet.stop('smoke');this.chatUI.addMessage('system',EMOTE_OFF_MSGS['smoke'],P.dpurp);sendChat('/emote smoke_off');}else{this.emoteSet.start('smoke');this.snd.lighterFlick();ChatUI.showBubble(this,this.player.x,this.player.y-48,EMOTE_FLAVORS['smoke'],P.dpurp);sendChat('/emote smoke_on');}break;}
      case 'coffee':case 'music':case 'zzz':case 'think':case 'hearts':case 'angry':case 'sweat':case 'sparkle':case 'confetti':case 'fire':case 'ghost':case 'rain':{this.handleEmoteCommand(cmd);break;}
      case 'tp':case 'teleport':case 'go':{if(!arg){this.chatUI.addMessage('system','Rooms: hub, cabin, relay, feed, myroom, lounge, market',WOODS_ACCENT);return;}const al:Record<string,string>={hub:'hub',cabin:'cabin',relay:'relay',feed:'feed',thefeed:'feed',myroom:'myroom',room:'picker',lounge:'lounge',rooftop:'lounge',market:'market',shop:'market',store:'market'};const rid=al[arg.toLowerCase().replace(/\s+/g,'')];if(rid==='hub'){this.leaveToDistrict();return;}if(rid==='cabin'){if(!this.isLeavingScene){this.isLeavingScene=true;this.enterCabin();}return;}if(rid==='myroom'){const pk=this.registry.get('playerPubkey');const n=this.registry.get('playerName')||'My Room';sendRoomChange('hub');this.chatUI.destroy();this.scene.start('RoomScene',{id:`myroom:${pk}`,name:`${n}'s Room`,neonColor:P.teal,ownerPubkey:pk});return;}if(rid==='picker'){const pk=this.registry.get('playerPubkey');const n=this.registry.get('playerName')||'My Room';this.playerPicker.open(pk,n,()=>{sendRoomChange('hub');this.chatUI.destroy();this.scene.start('RoomScene',{id:`myroom:${pk}`,name:`${n}'s Room`,neonColor:P.teal,ownerPubkey:pk});},(opk)=>{sendRoomChange(opk);this.chatUI.addMessage('system','Requesting access...',WOODS_ACCENT);});return;}if(rid){sendRoomChange('hub');this.chatUI.destroy();this.scene.start('RoomScene',{id:rid,name:rid.charAt(0).toUpperCase()+rid.slice(1),neonColor:P.teal});return;}this.chatUI.addMessage('system',`Unknown room "${arg}"`,P.amber);break;}
      case 'players':case 'who':case 'online':{const ps:string[]=[];this.otherPlayers.forEach(o=>ps.push(o.name));this.chatUI.addMessage('system',ps.length?`${ps.length} here: ${ps.join(', ')}`:'No other players',WOODS_ACCENT);break;}
      case 'follows':case 'following':case 'friends':{this.followsPanel.toggle();break;}
      case 'mute':{const s=toggleMute();this.chatUI.addMessage('system',s?'Muted':'Unmuted',s?P.amber:WOODS_ACCENT);break;}
      case 'filter':{if(!arg){const w=getCustomBannedWords();this.chatUI.addMessage('system',w.length?`Filtered: ${w.join(', ')}`:'No filters',WOODS_ACCENT);return;}addBannedWord(arg);this.chatUI.addMessage('system',`Added "${arg}"`,WOODS_ACCENT);break;}
      case 'unfilter':{if(!arg)return;removeBannedWord(arg);this.chatUI.addMessage('system',`Removed "${arg}"`,WOODS_ACCENT);break;}
      case 'terminal':case 'wardrobe':case 'avatar':{if(this.computerUI.isOpen()){this.computerUI.close();return;}this.computerUI.open(undefined,(newName)=>{this.registry.set('playerName',newName);this.playerName?.setText(newName);sendNameUpdate(newName);},undefined,undefined,undefined,undefined,['profile']);break;}
      case 'help':case '?':{this.chatUI.addMessage('system','Commands:',WOODS_ACCENT);['/tp <room>','/dm <n>','/zap <name>','/smoke','/coffee','/music','/zzz','/think','/hearts','/angry','/sweat','/sparkle','/confetti','/fire','/ghost','/rain','/terminal','/players','/follows','/mute','/filter <w>'].forEach(h=>this.chatUI.addMessage('system',h,P.lpurp));break;}
      default:this.chatUI.addMessage('system',`Unknown: /${cmd}`,P.amber);
    }
    this.chatUI.flashLog();
  }

  private handleEmoteCommand(name: string): void {
    if (this.emoteSet.isActive(name)) {
      this.emoteSet.stop(name);
      this.chatUI.addMessage('system', EMOTE_OFF_MSGS[name] ?? 'Done', P.dpurp);
      sendChat(`/emote ${name}_off`);
    } else {
      this.emoteSet.start(name);
      const flavor = EMOTE_FLAVORS[name] ?? `*${name}*`;
      ChatUI.showBubble(this, this.player.x, this.player.y - 48, flavor, P.dpurp);
      sendChat(`/emote ${name}_on`);
    }
  }
}
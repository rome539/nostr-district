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
import { getStatus } from '../stores/statusStore';
import { onNextAvatarSync } from '../nostr/nostrService';
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
import { CrewPanel } from '../ui/CrewPanel';
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
const TELESCOPE_X  = 1170;         // telescope center x

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
  joinTime: number;
  shown: boolean;
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
  private crewPanel!: CrewPanel;
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
  private nearTelescope = false;
  private telescopePromptBg!: Phaser.GameObjects.Graphics;
  private telescopePromptText!: Phaser.GameObjects.Text;
  private telescopePromptArrow!: Phaser.GameObjects.Text;
  private telescopeOverlay: HTMLElement | null = null;

  constructor() { super({ key: 'WoodsScene' }); }
  init(data?: { fromCabin?: boolean }): void { this.emoteSet.stopAll(); this.isLeavingScene = false; this.spawnX = data?.fromCabin ? CABIN_DOOR_X - 10 : 1400; }

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

    this.fireflies = [];
    for (let i = 0; i < 50; i++) {
      this.fireflies.push({ x: 40 + Math.random() * (W - 80), y: 40 + Math.random() * (FLOOR_Y - 60), vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.3, phase: Math.random() * Math.PI * 2, size: 1.5 + Math.random() * 1.5 });
    }

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

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if ((p.event.target as HTMLElement)?.tagName !== 'CANVAS') return; const wx = this.cameras.main.scrollX + p.x; if (p.y < FLOOR_Y - 10 || p.y > 455) return; if (wx < DOCK_X) return; this.targetX = Phaser.Math.Clamp(wx, DOCK_X, W - 20); this.isMoving = true; });

    const myPubkey = this.registry.get('playerPubkey');
    this.snd.setRoom('woods');
    this.chatUI = new ChatUI();
    const chatInput = this.chatUI.create('Chat in the woods...', WOODS_ACCENT, (cmd) => this.handleCommand(cmd));
    this.chatUI.setNameClickHandler((pubkey, name) => { const op = this.otherPlayers.get(pubkey); ProfileModal.show(pubkey, name, op?.avatar, op?.status); });
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (document.activeElement?.closest('.dm-panel')) return;
      if (document.activeElement?.closest('.cp-panel')) return;
      if (this.dmPanel?.isOpen) { this.dmPanel.focusInput(); return; }
      if (this.crewPanel?.isVisible()) { this.crewPanel.focusInput(); return; }
      if (document.activeElement !== chatInput) chatInput.focus();
    });

    this.dmPanel = this.registry.get('dmPanel') as DMPanel;
    if (!this.dmPanel) { this.dmPanel = new DMPanel(myPubkey); this.registry.set('dmPanel', this.dmPanel); }
    this.input.keyboard?.on('keydown-M', () => { if (document.activeElement === this.chatUI.getInput()) return; this.crewPanel.close(); this.dmPanel.toggle(); });
    this.crewPanel = this.registry.get('crewPanel') as CrewPanel;
    if (!this.crewPanel) { this.crewPanel = new CrewPanel(); this.registry.set('crewPanel', this.crewPanel); }
    this.input.keyboard?.on('keydown-G', () => { if (document.activeElement === this.chatUI.getInput()) return; this.dmPanel.close(); this.crewPanel.toggle(); });

    let rfp = this.registry.get('followsPanel') as FollowsPanel | undefined;
    if (!rfp) { rfp = new FollowsPanel(); this.registry.set('followsPanel', rfp); }
    this.followsPanel = rfp;
    this.input.keyboard?.on('keydown-F', () => { if (document.activeElement === this.chatUI.getInput()) return; this.followsPanel.toggle(); });
    this.input.keyboard?.on('keydown-S', () => { if (document.activeElement === this.chatUI.getInput()) return; this.settingsPanel.toggle(); });
    this.input.keyboard?.on('keydown-T', () => { if (document.activeElement === this.chatUI.getInput()) return; if (this.computerUI.isOpen()) { this.computerUI.close(); } else { this.computerUI.open(undefined, (newName) => { this.registry.set('playerName', newName); this.playerName?.setText(newName.slice(0, 14)); sendNameUpdate(newName); }, undefined, undefined, (s) => { this.playerStatusText.setText(s.slice(0, 30)); this.playerStatusText.setAlpha(s ? 1 : 0); }, undefined, ['profile']); } });
    this.input.keyboard?.on('keydown-U', () => { if (document.activeElement === this.chatUI.getInput()) return; this.muteList.toggle(); });
    this.input.keyboard?.on('keydown-ESC', () => {
      if (document.activeElement === this.chatUI.getInput()) return;
      if (this.telescopeOverlay) { this.closeTelescopeView(); return; }
      if (this.dmPanel?.isOpen) { this.dmPanel.handleEsc(); return; }
      if (this.crewPanel?.isVisible()) { this.crewPanel.pressEsc(); return; }
      if (this.playerPicker.isOpen()) { this.playerPicker.close(); return; }
    });

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
      if (document.activeElement === this.chatUI.getInput()) return;
      if (document.querySelector('.dm-panel.dm-open, .cp-panel.cp-open, .cp-modal-overlay')) return;
      if (this.nearCabin && !this.isLeavingScene) { this.isLeavingScene = true; this.enterCabin(); return; }
      if (this.nearTelescope) { this.openTelescopeView(); }
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
    sendRoomChange('woods', this.spawnX, this.playerY);

    const unsubProfile = authStore.subscribe(() => { const n = authStore.getState().displayName; if (n && n !== this.registry.get('playerName')) { this.registry.set('playerName', n); this.playerName?.setText(n.slice(0, 14)); sendNameUpdate(n); } });
    this.cameras.main.fadeIn(400, 4, 8, 10);
    this.settingsPanel.create();

    this.events.on('shutdown', () => {
      unsubProfile(); this.chatUI.destroy(); this.settingsPanel.destroy(); this.computerUI.close(); this.muteList.destroy(); this.playerPicker.close();
      if (this.dmPanel) this.dmPanel.close(); if (this.crewPanel) this.crewPanel.close(); if (this.followsPanel) this.followsPanel.close();
      destroyPlayerMenu(); ProfileModal.destroy();
      this.cabinPromptBg?.destroy(); this.cabinPromptText?.destroy(); this.cabinPromptArrow?.destroy();
      this.telescopePromptBg?.destroy(); this.telescopePromptText?.destroy(); this.telescopePromptArrow?.destroy();
      this.telescopeOverlay?.remove(); this.telescopeOverlay = null;
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
    const fireDist = Math.abs(this.player.x - FIRE_X);
    const fireT = Math.max(0, 1 - fireDist / 320);
    this.snd.setLoopElVolume(fireT * fireT);
    this.updateWater(time, delta);
    this.updateShootingStar(delta);
    this.updateCabinProximity();
    this.updateTelescopeProximity();

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
      if (!o.shown) {
        if (Date.now() - o.joinTime >= 500) {
          o.sprite.x = o.targetX; o.sprite.y = this.playerY;
          o.sprite.setAlpha(1); o.nameText.setAlpha(1); o.statusText.setAlpha(o.statusText.text ? 1 : 0);
          o.shown = true;
        } else { return; }
      }
      const dx = o.targetX - o.sprite.x;
      if (Math.abs(dx) > 1) o.sprite.x += dx * 0.12;
      o.nameText.setPosition(o.sprite.x, o.sprite.y - 44); o.statusText.setPosition(o.sprite.x, o.sprite.y - 59);
      if (o.clickZone) o.clickZone.setPosition(o.sprite.x, o.sprite.y - 20);
      o.emotes?.updateAll(this.emoteGraphics, delta, o.sprite.x, o.sprite.y, true, 'hub');
      o.sprite.setAlpha(o.emotes?.isActive('ghost') ? 0.3 : 1);
      o.sprite.y = Math.abs(dx) > 3 ? this.playerY + Math.abs(Math.sin(time * Math.PI / 150)) * -2 : this.playerY;
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
    this.playerName = this.add.text(this.player.x, this.playerY - 44, name.slice(0, 14), { fontFamily: '"Courier New", monospace', fontSize: '9px', color: WOODS_ACCENT, align: 'center', backgroundColor: '#04081088', padding: { x: 3, y: 1 } }).setOrigin(0.5).setDepth(11);
    const ms = getStatus();
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

    // ── planet helper ──
    const makePlanet = (px:number,py:number,pr:number,gradId:string,gradStops:string,clipId:string,innerSvg:string) => `
      <defs>
        <radialGradient id="${uid}${gradId}" cx="38%" cy="35%" r="65%">${gradStops}</radialGradient>
        <clipPath id="${uid}${clipId}"><circle cx="${px}%" cy="${py}%" r="${pr}%"/></clipPath>
      </defs>
      <circle cx="${px}%" cy="${py}%" r="${pr}%" fill="url(#${uid}${gradId})"/>
      <g clip-path="url(#${uid}${clipId})">${innerSvg}</g>
      <circle cx="${px}%" cy="${py}%" r="${pr}%" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>`;

    if (sceneType === 'mercury') {
      label = 'Mercury';
      nebulaCol1 = 'rgba(30,20,10,0.3)';
      const mx=50, my=46, mr=6;
      subject = makePlanet(mx,my,mr,'mercg',
        `<stop offset="0%" stop-color="#c8b898"/><stop offset="100%" stop-color="#706050"/>`,
        'mercc',
        `<circle cx="48%" cy="42%" r="1.5%" fill="rgba(80,65,50,0.6)"/>
         <circle cx="56%" cy="52%" r="1%" fill="rgba(70,55,40,0.5)"/>
         <circle cx="44%" cy="54%" r="0.8%" fill="rgba(75,60,45,0.5)"/>
         <circle cx="52%" cy="44%" r="0.6%" fill="rgba(85,70,55,0.4)"/>
         <circle cx="46%" cy="48%" r="0.5%" fill="rgba(65,50,35,0.45)"/>`);
      subject += `<text x="50%" y="63%" font-family="Courier New" font-size="8" fill="rgba(200,180,140,0.6)" text-anchor="middle">MERCURY</text>
        <text x="50%" y="69%" font-family="Courier New" font-size="6" fill="rgba(160,140,100,0.4)" text-anchor="middle">no atmosphere</text>`;
    } else if (sceneType === 'venus') {
      label = 'Venus';
      nebulaCol1 = 'rgba(50,40,10,0.4)'; nc1x='50%'; nc1y='45%';
      const vx=50, vy=46, vr=10;
      subject = `
        <defs>
          <radialGradient id="${uid}vg" cx="42%" cy="38%" r="65%">
            <stop offset="0%" stop-color="#fffae0"/><stop offset="50%" stop-color="#e8d080"/><stop offset="100%" stop-color="#c0a040"/>
          </radialGradient>
          <clipPath id="${uid}vc"><circle cx="${vx}%" cy="${vy}%" r="${vr}%"/></clipPath>
        </defs>
        <circle cx="${vx}%" cy="${vy}%" r="${vr}%" fill="url(#${uid}vg)"/>
        <g clip-path="url(#${uid}vc)">
          <ellipse cx="50%" cy="40%" rx="8%" ry="2%" fill="rgba(230,200,80,0.3)"/>
          <ellipse cx="50%" cy="46%" rx="9%" ry="2.5%" fill="rgba(220,190,60,0.25)"/>
          <ellipse cx="50%" cy="52%" rx="7%" ry="2%" fill="rgba(210,175,50,0.3)"/>
        </g>
        <circle cx="${vx}%" cy="${vy}%" r="${vr}%" fill="none" stroke="rgba(240,210,100,0.2)" stroke-width="0.5"/>
        <text x="50%" y="66%" font-family="Courier New" font-size="8" fill="rgba(240,210,120,0.6)" text-anchor="middle">VENUS</text>
        <text x="50%" y="72%" font-family="Courier New" font-size="6" fill="rgba(200,170,80,0.4)" text-anchor="middle">thick cloud cover</text>`;
    } else if (sceneType === 'mars') {
      label = 'Mars';
      nebulaCol1 = 'rgba(50,15,5,0.4)'; nc1x='50%'; nc1y='46%';
      const mx=50, my=46, mr=8;
      subject = `
        <defs>
          <radialGradient id="${uid}mgrad" cx="38%" cy="35%" r="65%">
            <stop offset="0%" stop-color="#e07040"/><stop offset="100%" stop-color="#901808"/>
          </radialGradient>
          <clipPath id="${uid}mclip"><circle cx="${mx}%" cy="${my}%" r="${mr}%"/></clipPath>
        </defs>
        <circle cx="${mx}%" cy="${my}%" r="${mr}%" fill="url(#${uid}mgrad)"/>
        <g clip-path="url(#${uid}mclip)">
          <ellipse cx="${mx-2}%" cy="${my-6}%" rx="3%" ry="1.5%" fill="rgba(230,230,240,0.7)"/>
          <ellipse cx="${mx+1}%" cy="${my+6}%" rx="1.5%" ry="1%" fill="rgba(200,210,230,0.4)"/>
          <circle cx="${mx+2}%" cy="${my+1}%" r="2%" fill="rgba(80,20,10,0.5)"/>
          <circle cx="${mx-3}%" cy="${my-1}%" r="1.2%" fill="rgba(70,15,5,0.4)"/>
          <circle cx="${mx+3}%" cy="${my+3}%" r="0.8%" fill="rgba(60,10,5,0.35)"/>
        </g>
        <circle cx="${mx}%" cy="${my}%" r="${mr}%" fill="none" stroke="rgba(200,80,30,0.2)" stroke-width="1"/>
        <text x="50%" y="64%" font-family="Courier New" font-size="8" fill="rgba(220,100,60,0.6)" text-anchor="middle">MARS</text>
        <text x="50%" y="70%" font-family="Courier New" font-size="6" fill="rgba(180,80,40,0.4)" text-anchor="middle">polar ice caps visible</text>`;
    } else if (sceneType === 'jupiter') {
      label = 'Jupiter';
      nebulaCol1 = 'rgba(30,20,10,0.4)';
      const jx=50, jy=46, jr=13;
      subject = `
        <defs>
          <clipPath id="${uid}jclip"><circle cx="${jx}%" cy="${jy}%" r="${jr}%"/></clipPath>
          <radialGradient id="${uid}jgrad" cx="45%" cy="40%" r="60%">
            <stop offset="0%" stop-color="#f0d8a0"/><stop offset="100%" stop-color="#c8a060"/>
          </radialGradient>
        </defs>
        <circle cx="${jx}%" cy="${jy}%" r="${jr}%" fill="url(#${uid}jgrad)"/>
        <g clip-path="url(#${uid}jclip)">
          <rect x="${jx-jr}%" y="${jy-9}%" width="${jr*2}%" height="4%" fill="rgba(160,100,50,0.55)" rx="2"/>
          <rect x="${jx-jr}%" y="${jy-4}%" width="${jr*2}%" height="6%" fill="rgba(200,130,60,0.4)" rx="2"/>
          <rect x="${jx-jr}%" y="${jy+3}%" width="${jr*2}%" height="3%" fill="rgba(150,90,40,0.5)" rx="2"/>
          <rect x="${jx-jr}%" y="${jy+7}%" width="${jr*2}%" height="5%" fill="rgba(180,110,50,0.45)" rx="2"/>
          <ellipse cx="${jx-4}%" cy="${jy+1}%" rx="3%" ry="2%" fill="rgba(180,80,40,0.6)"/>
        </g>
        <circle cx="${jx}%" cy="${jy}%" r="${jr}%" fill="none" stroke="rgba(200,150,80,0.3)" stroke-width="1"/>
        <circle cx="${jx-18}%" cy="${jy-1}%" r="1%" fill="rgba(220,210,190,0.9)"><animate attributeName="opacity" values="0.9;0.5;0.9" dur="3.1s" repeatCount="indefinite"/></circle>
        <circle cx="${jx-22}%" cy="${jy+3}%" r="0.8%" fill="rgba(210,200,180,0.85)"><animate attributeName="opacity" values="0.85;0.45;0.85" dur="2.4s" repeatCount="indefinite"/></circle>
        <circle cx="${jx+19}%" cy="${jy-2}%" r="0.9%" fill="rgba(220,215,195,0.9)"><animate attributeName="opacity" values="0.9;0.5;0.9" dur="3.8s" repeatCount="indefinite"/></circle>
        <circle cx="${jx+24}%" cy="${jy+1}%" r="0.7%" fill="rgba(210,205,185,0.8)"><animate attributeName="opacity" values="0.8;0.4;0.8" dur="2.9s" repeatCount="indefinite"/></circle>
        <text x="50%" y="68%" font-family="Courier New" font-size="8" fill="rgba(200,170,100,0.6)" text-anchor="middle">JUPITER</text>
        <text x="50%" y="74%" font-family="Courier New" font-size="6" fill="rgba(180,150,80,0.4)" text-anchor="middle">4 Galilean moons visible</text>`;
    } else if (sceneType === 'saturn') {
      label = 'Saturn';
      nebulaCol1 = 'rgba(30,25,15,0.4)';
      const sx=50, sy=47, sr=10;
      subject = `
        <defs>
          <clipPath id="${uid}sclip"><circle cx="${sx}%" cy="${sy}%" r="${sr}%"/></clipPath>
          <radialGradient id="${uid}sgrad" cx="40%" cy="38%" r="65%">
            <stop offset="0%" stop-color="#e8d898"/><stop offset="100%" stop-color="#b89848"/>
          </radialGradient>
        </defs>
        <ellipse cx="${sx}%" cy="${sy+1}%" rx="${sr+14}%" ry="3.5%" fill="none" stroke="rgba(200,170,90,0.35)" stroke-width="6"/>
        <ellipse cx="${sx}%" cy="${sy+1}%" rx="${sr+10}%" ry="2.5%" fill="none" stroke="rgba(190,155,75,0.28)" stroke-width="4"/>
        <circle cx="${sx}%" cy="${sy}%" r="${sr}%" fill="url(#${uid}sgrad)"/>
        <g clip-path="url(#${uid}sclip)">
          <rect x="${sx-sr}%" y="${sy-5}%" width="${sr*2}%" height="3%" fill="rgba(160,120,50,0.4)" rx="1"/>
          <rect x="${sx-sr}%" y="${sy-1}%" width="${sr*2}%" height="4%" fill="rgba(180,140,60,0.3)" rx="1"/>
          <rect x="${sx-sr}%" y="${sy+4}%" width="${sr*2}%" height="3%" fill="rgba(155,115,45,0.35)" rx="1"/>
        </g>
        <ellipse cx="${sx}%" cy="${sy+1}%" rx="${sr+14}%" ry="3.5%" fill="none" stroke="rgba(200,170,90,0.2)" stroke-width="1"/>
        <text x="50%" y="70%" font-family="Courier New" font-size="8" fill="rgba(200,180,100,0.6)" text-anchor="middle">SATURN</text>
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
      const ux=50, uy=46, ur=9;
      subject = `
        <defs>
          <radialGradient id="${uid}ug" cx="40%" cy="36%" r="65%">
            <stop offset="0%" stop-color="#c0f0f0"/><stop offset="60%" stop-color="#60c0c8"/><stop offset="100%" stop-color="#308090"/>
          </radialGradient>
          <clipPath id="${uid}uc"><circle cx="${ux}%" cy="${uy}%" r="${ur}%"/></clipPath>
        </defs>
        <circle cx="${ux}%" cy="${uy}%" r="${ur}%" fill="url(#${uid}ug)"/>
        <g clip-path="url(#${uid}uc)">
          <ellipse cx="50%" cy="44%" rx="8%" ry="1.5%" fill="rgba(160,230,235,0.2)"/>
          <ellipse cx="50%" cy="48%" rx="8%" ry="1.5%" fill="rgba(140,215,220,0.15)"/>
        </g>
        <ellipse cx="${ux}%" cy="${uy}%" rx="${ur+10}%" ry="2%" fill="none" stroke="rgba(140,220,230,0.3)" stroke-width="2"/>
        <ellipse cx="${ux}%" cy="${uy}%" rx="${ur+7}%" ry="1.4%" fill="none" stroke="rgba(120,200,210,0.2)" stroke-width="1.5"/>
        <circle cx="${ux}%" cy="${uy}%" r="${ur}%" fill="none" stroke="rgba(140,210,220,0.15)" stroke-width="0.5"/>
        <text x="50%" y="66%" font-family="Courier New" font-size="8" fill="rgba(140,220,230,0.6)" text-anchor="middle">URANUS</text>
        <text x="50%" y="72%" font-family="Courier New" font-size="6" fill="rgba(100,180,190,0.4)" text-anchor="middle">rotates on its side</text>`;
    } else if (sceneType === 'neptune') {
      label = 'Neptune';
      nebulaCol1 = 'rgba(5,10,50,0.6)'; nc1x='50%'; nc1y='45%';
      const nx=50, ny=46, nr=8;
      subject = `
        <defs>
          <radialGradient id="${uid}ng" cx="38%" cy="33%" r="65%">
            <stop offset="0%" stop-color="#8090f8"/><stop offset="60%" stop-color="#2030d0"/><stop offset="100%" stop-color="#101080"/>
          </radialGradient>
          <clipPath id="${uid}nc"><circle cx="${nx}%" cy="${ny}%" r="${nr}%"/></clipPath>
        </defs>
        <circle cx="${nx}%" cy="${ny}%" r="${nr}%" fill="url(#${uid}ng)"/>
        <g clip-path="url(#${uid}nc)">
          <ellipse cx="48%" cy="46%" rx="4%" ry="2%" fill="rgba(10,10,80,0.6)"/>
          <ellipse cx="50%" cy="42%" rx="7%" ry="1.5%" fill="rgba(100,120,240,0.3)"/>
          <ellipse cx="50%" cy="50%" rx="6%" ry="1.5%" fill="rgba(80,100,220,0.25)"/>
        </g>
        <circle cx="${nx}%" cy="${ny}%" r="${nr}%" fill="none" stroke="rgba(80,100,220,0.2)" stroke-width="0.5"/>
        <text x="50%" y="64%" font-family="Courier New" font-size="8" fill="rgba(100,130,255,0.6)" text-anchor="middle">NEPTUNE</text>
        <text x="50%" y="70%" font-family="Courier New" font-size="6" fill="rgba(80,110,220,0.4)" text-anchor="middle">Great Dark Spot</text>`;
    } else if (sceneType === 'pluto') {
      label = 'Pluto';
      nebulaCol1 = 'rgba(20,15,10,0.3)';
      const px=50, py=46, pr=4;
      subject = makePlanet(px,py,pr,'plutg',
        `<stop offset="0%" stop-color="#d8c8a8"/><stop offset="60%" stop-color="#a09070"/><stop offset="100%" stop-color="#706050"/>`,
        'plutc',
        `<ellipse cx="51%" cy="45%" rx="3%" ry="2.5%" fill="rgba(240,230,210,0.55)"/>
         <ellipse cx="48%" cy="50%" rx="2%" ry="1.2%" fill="rgba(180,140,100,0.4)"/>`);
      subject += `<text x="50%" y="61%" font-family="Courier New" font-size="8" fill="rgba(200,185,150,0.6)" text-anchor="middle">PLUTO</text>
        <text x="50%" y="67%" font-family="Courier New" font-size="6" fill="rgba(160,145,110,0.4)" text-anchor="middle">Tombaugh Regio</text>`;
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
  private addOtherPlayer(pk: string, name: string, px: number, py: number, avatarStr?: string, status?: string): void {
    const dying=this.dyingSprites.get(pk); if(dying){this.tweens.killTweensOf([dying.sprite,dying.nameText,dying.statusText]);dying.sprite.destroy();dying.nameText.destroy();dying.statusText.destroy();if(dying.clickZone)dying.clickZone.destroy();this.dyingSprites.delete(pk);}
    const texKey=`avatar_hub_${pk}`; const cfg=avatarStr?(deserializeAvatar(avatarStr)||getDefaultAvatar()):getDefaultAvatar();
    if(this.textures.exists(texKey))this.textures.remove(texKey); this.textures.addCanvas(texKey,renderHubSprite(cfg));
    const sp=this.add.image(px,py,texKey).setOrigin(0.5,1).setDepth(8);
    if(!avatarStr){const h=name.split('').reduce((a:number,c:string)=>a+c.charCodeAt(0),0);sp.setTint([0xe87aab,0x7b68ee,0x5dcaa5,0xfad480,0xb8a8f8][h%5]);}
    const nt=this.add.text(px,py-44,name.slice(0,14),{fontFamily:'"Courier New", monospace',fontSize:'9px',color:WOODS_ACCENT,align:'center',backgroundColor:'#04081088',padding:{x:3,y:1}}).setOrigin(0.5).setDepth(9);
    const ss=(status||'').slice(0,30); const st=this.add.text(px,py-59,ss,{fontFamily:'"Courier New", monospace',fontSize:'8px',color:P.lpurp,align:'center'}).setOrigin(0.5).setDepth(9).setAlpha(ss?1:0);
    const cz=this.add.zone(px,py-20,40,50).setInteractive({useHandCursor:true}).setDepth(12);
    cz.on('pointerdown',(ptr:Phaser.Input.Pointer)=>{if((ptr.event.target as HTMLElement)?.tagName!=='CANVAS')return;ptr.event.stopPropagation();const op2=this.otherPlayers.get(pk);showPlayerMenu(pk,name.slice(0,14),ptr.x,ptr.y,{onChat:(t,c)=>this.chatUI.addMessage('system',t,c),getDMPanel:()=>this.dmPanel},op2?.avatar,op2?.status);});
    sp.setAlpha(0); nt.setAlpha(0); st.setAlpha(0);
    this.otherPlayers.set(pk,{sprite:sp,nameText:nt,statusText:st,targetX:px,targetY:py,name,avatar:avatarStr,status:status||'',clickZone:cz,joinTime:Date.now(),shown:false});
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
      case 'terminal':case 'avatar':{if(this.computerUI.isOpen()){this.computerUI.close();return;}this.computerUI.open(undefined,(newName)=>{this.registry.set('playerName',newName);this.playerName?.setText(newName.slice(0,14));sendNameUpdate(newName);},undefined,undefined,undefined,undefined,['profile']);break;}
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
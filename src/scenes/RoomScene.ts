import Phaser from 'phaser';
import { FireworksEngine, isJuly4thPeriod, FW_SHAPE_MIX } from '../utils/fireworks';
import { BatEngine, newBatEngine, drawBatsCanvas, drawBatsPhaser, isHalloweenPeriod } from '../utils/bats';
import { HeartsEngine, newHeartsEngine, drawHeartsPhaser, isValentinePeriod } from '../utils/valentineFX';
import { BaseScene } from './BaseScene';
import { getStatus } from '../stores/statusStore';
import { onNextAvatarSync } from '../nostr/nostrService';
import { GAME_WIDTH, GAME_HEIGHT, P, ANIM, hexToNum, hexToRgb } from '../config/game.config';
import {
  setPresenceCallbacks, sendPosition, sendChat, sendRoomChange,
  sendRoomResponse, setRoomKickHandler, sendRoomRequest,
  setRoomGrantedHandler, setRoomDeniedHandler, requestOnlinePlayers, setOnlinePlayersHandler,
  clearRoomKickHandler, clearRoomGrantedHandler, clearRoomDeniedHandler,
  sendAvatarUpdate, isPresenceReady,
} from '../nostr/presenceService';
import { ChatUI } from '../ui/ChatUI';
import { t as ti18n } from '../i18n/i18n';
import { showPlayerMenu } from '../ui/PlayerMenu';
import { ProfileModal } from '../ui/ProfileModal';
import { RoomRenderer } from '../rooms/RoomRenderer';
import { renderRoomSprite, renderHubSprite, itemImagesReady } from '../entities/AvatarRenderer';
import { deserializeAvatar, getDefaultAvatar, getAvatar, setAvatar, onLocalAvatarChange, AvatarConfig } from '../stores/avatarStore';
import { RoomConfig, POSTER_DEFAULT_POS, POSTER_SIZE, FURNITURE_BOUNDS } from '../stores/roomStore';
import { SoundEngine } from '../audio/SoundEngine';
import { RoomFeedSystem } from './room/RoomFeedSystem';
import { RoomRelaySystem } from './room/RoomRelaySystem';
import { updateLoungeRoom } from './room/RoomLoungeSystem';
import { LoungeLiveBanner } from '../ui/LoungeLiveBanner';
import { updateBlinkingLEDs, updateCandleFlames, updateAmbient, updateLightingOverlay, updateFireplaceFlames, updateVoidStars } from './room/RoomAnimations';
import { MyRoomSystem } from './room/MyRoomSystem';
import { MarketRoomSystem } from './room/MarketRoomSystem';
import { initCardGameService, setRoomPlayers, teardownCardGameService } from '../ui/games/cardGameService';
import { notifyGamePlayerLeft } from '../ui/CardTableModal';

interface RoomSceneConfig { id: string; name: string; neonColor: string; ownerPubkey?: string; ownerRoomConfig?: string; }

export class RoomScene extends BaseScene {
  private player!: Phaser.GameObjects.Image;
  private roomConfig!: RoomSceneConfig;
  private isOwner = false;
  private waitingForAccess = false;

  private roomRenderer = new RoomRenderer();
  private roomBgImage!: Phaser.GameObjects.Image;

  private readonly roomKickHandler = (r: string) => { this.chatUI.addMessage('system', r || ti18n('sys.owner_left'), P.amber); setTimeout(() => this.leaveRoom(), 1500); };
  private readonly roomGrantedHandler = (op: string, on: string, room: string, roomConfig?: string) => {
    this.waitingForAccess = false;
    this.chatUI.addMessage('system', ti18n('sys.room.accepted', { name: on }), P.teal);
    this.scene.start('RoomScene', { id: room, name: `${on}'s Room`, neonColor: P.teal, ownerPubkey: op, ownerRoomConfig: roomConfig });
  };
  private readonly roomDeniedHandler = (r: string) => { this.waitingForAccess = false; this.chatUI.addMessage('system', r || ti18n('sys.room.denied'), P.amber); };

  // Walk animation
  private walkTimer = 0;
  private isWalking = false;

  // Animated graphics layers
  private ledGraphics!: Phaser.GameObjects.Graphics;
  private flameGraphics!: Phaser.GameObjects.Graphics;
  private ambientGraphics!: Phaser.GameObjects.Graphics;
  private lightingOverlayGraphics!: Phaser.GameObjects.Graphics;
  private loungeGraphics!: Phaser.GameObjects.Graphics;
  private shootingStarGraphics!: Phaser.GameObjects.Graphics;
  private voidStarsGraphics!: Phaser.GameObjects.Graphics;
  private shootingStar: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number } | null = null;
  private shootingStarTimer = 0;
  private fireplaceGraphics!: Phaser.GameObjects.Graphics;
  private cityFwEngines: FireworksEngine[] = [];
  private cityBatEngine: BatEngine | null = null;
  private cityHeartsEngine: HeartsEngine | null = null;
  private bgTexKey = '';
  private bgOffscreen: HTMLCanvasElement | null = null;
  private bgLiveCanvas: HTMLCanvasElement | null = null;
  private bgLiveCtx: CanvasRenderingContext2D | null = null;

  // Subsystems
  private feedSystem = new RoomFeedSystem();
  private relaySystem = new RoomRelaySystem();
  private myRoom = new MyRoomSystem();
  private market = new MarketRoomSystem();

  private globalPlayerCount = 1;
  private isLeavingRoom = false;
  private backBtnEl: HTMLButtonElement | null = null;
  /** Lazily created when entering the Lounge — handles NIP-53 live stream
   *  discovery, the LIVE banner UI, and swapping the lounge audio. */
  private loungeLiveBanner: LoungeLiveBanner | null = null;

  constructor() { super({ key: 'RoomScene' }); }

  protected override shouldBlockPanelKeys(): boolean {
    return super.shouldBlockPanelKeys() || this.myRoom.shouldBlockKeys();
  }

  protected override onTKey(): void { this.myRoom.onTKey(); }

  init(data: RoomSceneConfig): void {
    super.init(data);
    this.roomConfig = data;
    this.feedSystem.reset();
    this.myRoom.intro.isActive = false;
    this.isLeavingRoom = false;
    this.playerY = 420;
  }

  preload(): void {
    this.myRoom.preload(this, this.roomConfig);
  }

  create(): void {
    const myPubkey = this.registry.get('playerPubkey');
    this.isOwner = this.roomConfig.id.startsWith('myroom:') && this.roomConfig.ownerPubkey === myPubkey;

    let parsedOwnerConfig: RoomConfig | undefined;
    if (this.roomConfig.ownerRoomConfig) {
      try { parsedOwnerConfig = JSON.parse(this.roomConfig.ownerRoomConfig); } catch (_) {}
    }

    const texKey = this.roomRenderer.render(this, this.roomConfig.id, this.roomConfig.neonColor, GAME_WIDTH, GAME_HEIGHT, parsedOwnerConfig);
    this.roomBgImage = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, texKey).setDepth(-1);
    this.bgTexKey = texKey;
    this.captureBgCanvas();

    // Graphics layers
    this.ledGraphics             = this.add.graphics();
    this.flameGraphics           = this.add.graphics();
    this.ambientGraphics         = this.add.graphics().setDepth(2);
    this.lightingOverlayGraphics = this.add.graphics().setDepth(3);
    this.loungeGraphics          = this.add.graphics().setDepth(4);
    this.shootingStarGraphics    = this.add.graphics().setDepth(0);
    this.buildCityWindowMask(); // clip all window FX to the open panes (behind the frame cross-bars)
    if (isJuly4thPeriod()) {
      const winCfg = (x1: number, x2: number, initialDelay: number) => ({
        launchY: 248, explodeYMin: 30, explodeYMax: 150,
        xMin: x1 + 10, xMax: x2 - 10,
        intervalMin: 2500, intervalMax: 4000,
        particleRadius: 0.8, explosionCount: 14, explosionSpeed: 1.8,
        shapes: FW_SHAPE_MIX,
        initialDelay,
      });
      this.cityFwEngines = [
        new FireworksEngine(GAME_WIDTH, GAME_HEIGHT, winCfg(52,  233, 0)),
        new FireworksEngine(GAME_WIDTH, GAME_HEIGHT, winCfg(309, 492, 1800)),
        new FireworksEngine(GAME_WIDTH, GAME_HEIGHT, winCfg(565, 747, 3600)),
      ];
    }
    if (isHalloweenPeriod()) {
      // Bats confined to the window y-range so they appear in the city sky
      this.cityBatEngine = newBatEngine(GAME_WIDTH, {
        yMin: 25, yMax: 220, count: 5, speedMin: 0.3, speedMax: 0.7,
      });
    }
    if (isValentinePeriod()) {
      // Hearts drift up through the city sky behind the windows
      this.cityHeartsEngine = newHeartsEngine(GAME_WIDTH, 220, {
        yMin: 25, yMax: 220, count: 6, speedMin: 0.15, speedMax: 0.4,
      });
    }
    this.voidStarsGraphics       = this.add.graphics();
    this.fireplaceGraphics       = this.add.graphics();
    this.emoteGraphics   = this.add.graphics().setDepth(1000);

    // Feed subsystem
    this.feedSystem.create(this, this.roomConfig.id);

    this.createPlayer();
    const rerenderPlayerSprite = (broadcast = false) => {
      const av = getAvatar();
      if (this.textures.exists('player_room')) this.textures.remove('player_room');
      this.textures.addCanvas('player_room', renderRoomSprite(av));
      this.player?.setTexture('player_room');
      if (this.textures.exists('player')) this.textures.remove('player');
      this.textures.addCanvas('player', renderHubSprite(av));
      if (broadcast) sendAvatarUpdate();
    };
    onNextAvatarSync(() => rerenderPlayerSprite(true));
    // Shop-equip / outfit-load already call sendAvatarUpdate themselves, so the
    // local-change handler only needs to refresh the sprite textures here.
    const unsubLocalAvatar = onLocalAvatarChange(() => rerenderPlayerSprite(false));
    this.events.once('shutdown', unsubLocalAvatar);
    this.createBackButton();
    // Lounge owns its top strip for the live-streamer banner — skip the
    // generic room-name pill there so the two don't compete for space.
    if (this.roomConfig.id !== 'lounge') this.createRoomLabel();

    this.chatUI = new ChatUI();
    this.chatInput = this.chatUI.create(`Chat in ${this.roomConfig.name}...`, this.roomConfig.neonColor, (cmd) => this.handleCommand(cmd));
    this.chatUI.setNameClickHandler((pubkey, name) => {
      const op = this.otherPlayers.get(pubkey);
      ProfileModal.show(pubkey, name, op?.avatar, op?.status);
    });
    if (this.sys.game.device.input.touch) {
      this.cameras.main.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT);
    }
    this.createMobileControls();
    this.setupRegistryPanels(myPubkey);
    this.setupCommonKeyboardHandlers();

    this.input.on('pointerdown', (p: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
      if ((p.event.target as HTMLElement)?.tagName !== 'CANVAS') return;
      if (currentlyOver.length > 0) return;
      if (this.myRoom.intro.isActive) return;
      if (p.worldY < 330 || p.worldY > 470) return;
      this.targetX = Phaser.Math.Clamp(p.worldX, 40, GAME_WIDTH - 40);
      this.isMoving = true;
    });

    // Setup myroom subsystem (must be after chatUI is created)
    if (this.roomConfig.id.startsWith('myroom:')) {
      this.myRoom.setup({
        scene: this,
        roomBgImage: this.roomBgImage,
        roomRenderer: this.roomRenderer,
        roomId: this.roomConfig.id,
        neonColor: this.roomConfig.neonColor,
        ownerPubkey: this.roomConfig.ownerPubkey,
        ownerRoomConfig: this.roomConfig.ownerRoomConfig,
        isOwner: this.isOwner,
        player: this.player,
        playerName: this.playerName,
        playerStatusText: this.playerStatusText,
        computerUI: this.computerUI,
        chatUI: this.chatUI,
        registry: this.registry,
        leaveRoom: () => this.leaveRoom(),
      }, parsedOwnerConfig);
    }

    // Setup market subsystem
    if (this.roomConfig.id === 'market') this.market.setup(this);

    this.setupPresenceCallbacks(myPubkey);
    initCardGameService();
    sendRoomChange(this.roomConfig.id, GAME_WIDTH / 2, this.playerY);
    const ae = this.emoteSet.activeNames(); if (ae.length) this.time.delayedCall(500, () => ae.forEach(n => sendChat(`/emote ${n}_on sync`)));
    if (this.isOwner && this.roomConfig.id.startsWith('myroom:')) {
      this.time.delayedCall(500, () => sendChat(`/game:music:${SoundEngine.get().myRoomTrack}`));
    }
    const _roomSoundId = this.roomConfig.id.startsWith('myroom:') ? 'myroom' : this.roomConfig.id;
    SoundEngine.get().setRoom(_roomSoundId as any);
    // SoundEngine no longer auto-plays for myroom. Owner starts their own
    // saved track immediately for zero-latency music; visitors stay silent
    // and pick up the owner's track when the /game:music: broadcast arrives.
    if (this.roomConfig.id.startsWith('myroom:') && this.isOwner) {
      SoundEngine.get().applyMyRoomTrack(SoundEngine.get().myRoomTrack);
    }

    this.setupProfileSubscription();

    setRoomKickHandler(this.roomKickHandler);
    setRoomGrantedHandler(this.roomGrantedHandler);
    setRoomDeniedHandler(this.roomDeniedHandler);

    this.cameras.main.fadeIn(300, 10, 0, 20);
    this.settingsPanel.create();

    if (this.roomConfig.id === 'relay') this.relaySystem.setup(this);

    if (this.roomConfig.id === 'lounge') {
      this.loungeLiveBanner = new LoungeLiveBanner();
      this.loungeLiveBanner.mount();
    }

    this.events.on('shutdown', () => {
      this.shutdownCommonPanels();
      this.myRoom.destroy();
      this.market.destroy();
      if (this.backBtnEl) { this.backBtnEl.remove(); this.backBtnEl = null; }
      this.feedSystem.destroy();
      this.relaySystem.destroy();
      this.loungeLiveBanner?.unmount();
      this.loungeLiveBanner = null;
      clearRoomKickHandler(this.roomKickHandler);
      clearRoomGrantedHandler(this.roomGrantedHandler);
      clearRoomDeniedHandler(this.roomDeniedHandler);
      teardownCardGameService();
    });
  }

  // ── Update ──
  update(time: number, delta: number): void {
    if (!this.myRoom.intro.isActive) this.updateMovement(delta);
    this.playerName.setPosition(this.player.x, this.player.y + 14);
    this.playerStatusText.setPosition(this.player.x, this.player.y + 26);
    this.player.setDepth(this.player.y);
    this.playerName.setDepth(this.player.y + 1);
    this.playerStatusText.setDepth(this.player.y + 1);

    updateBlinkingLEDs(this.ledGraphics, this.roomRenderer.blinkingLEDs, time);
    updateCandleFlames(this.flameGraphics, this.roomRenderer.candleFlames, time);
    updateFireplaceFlames(this.fireplaceGraphics, this.roomRenderer.fireplaceFlames, time);
    updateVoidStars(this.voidStarsGraphics, this.roomRenderer.voidStars, time);
    updateAmbient(this.ambientGraphics, this.roomConfig.neonColor, time);
    if (this.roomConfig.id.startsWith('myroom:')) {
      updateLightingOverlay(this.lightingOverlayGraphics, this.myRoom.parsedRoomConfig?.lighting ?? 'teal', time);
      if (this.myRoom.parsedRoomConfig?.wallTheme === 'cityview') {
        this.updateShootingStar(delta);
        this.updateCityWindowFireworks(time, delta);
        this.updateCityWindowCritters(time, delta);
      } else {
        this.shootingStarGraphics.clear();
      }
    }

    this.emoteGraphics.clear();
    this.emoteSet.updateAll(this.emoteGraphics, delta, this.player.x, this.player.y, this.facingRight, 'room', this.isWalking);
    this.player.setAlpha(this.emoteSet.isActive('ghost') ? 0.3 : 1);

    sendPosition(this.player.x, this.player.y, this.facingRight);

    if (this.roomConfig.id.startsWith('myroom:') && !this.myRoom.intro.isActive) {
      this.myRoom.update(delta);
      this.myRoom.updateFrame(this.player.x);
    }

    if (this.roomConfig.id === 'market') {
      this.market.update(this.player.x, this.myRoom.intro.isActive);
    }

    const rc = this.roomConfig.id.startsWith('myroom:') ? 'myroom' : this.roomConfig.id;
    if (rc === 'feed')   this.feedSystem.update(time, delta);
    if (rc === 'relay')  this.relaySystem.update(delta, this.globalPlayerCount);
    if (rc === 'lounge') updateLoungeRoom(this.loungeGraphics, time, delta);

    // Local player walk animation
    if (this.isWalking) {
      this.walkTimer += delta;
      if (this.walkTimer >= 180) {
        this.walkTimer = 0;
        this.walkFrame = (this.walkFrame % 4) + 1;
        if (this.textures.exists('player_room')) this.textures.remove('player_room');
        this.textures.addCanvas('player_room', renderRoomSprite(getAvatar(), this.walkFrame));
        this.player.setTexture('player_room');
      }
    } else if (this.walkFrame !== 0) {
      this.walkFrame = 0;
      this.walkTimer = 0;
      if (this.textures.exists('player_room')) this.textures.remove('player_room');
      this.textures.addCanvas('player_room', renderRoomSprite(getAvatar(), 0));
      this.player.setTexture('player_room');
    }

    this.updateOtherPlayers(time, delta);
    this.updateLocalNameColor(time, delta);
  }

  // Inner bounds of the three city-view windows (frame-inset)
  private static readonly CITY_WINDOWS = [
    { x1: 52, x2: 233, y1: 17, y2: 245 },
    { x1: 309, x2: 492, y1: 17, y2: 245 },
    { x1: 565, x2: 747, y1: 17, y2: 245 },
  ];

  private inCityWindow(px: number, py: number): boolean {
    return RoomScene.CITY_WINDOWS.some(w => px >= w.x1 && px <= w.x2 && py >= w.y1 && py <= w.y2);
  }

  private inCityDecoration(px: number, py: number): boolean {
    const cfg = this.myRoom.parsedRoomConfig;
    // Posters
    for (let i = 0; i < 3; i++) {
      if ((cfg?.posters?.[i] ?? 'none') === 'none') continue;
      const pos = cfg?.posterPositions?.[i] ?? POSTER_DEFAULT_POS[i];
      const sz  = POSTER_SIZE[i];
      if (px >= pos.x - 8 && px <= pos.x + sz.w + 8 &&
          py >= pos.y - 8 && py <= pos.y + sz.h + 8) return true;
    }
    // Desk (always present)
    const dpos = cfg?.furniturePositions?.['desk'] ?? { x: 558, y: 160 };
    const dsz  = FURNITURE_BOUNDS['desk'] ?? { w: 196, h: 140 };
    if (px >= dpos.x - 4 && px <= dpos.x + dsz.w + 4 &&
        py >= dpos.y - 4 && py <= dpos.y + dsz.h + 4) return true;
    return false;
  }

  private updateShootingStar(delta: number): void {
    const g = this.shootingStarGraphics;
    g.clear();
    if (!this.shootingStar) {
      this.shootingStarTimer += delta;
      if (this.shootingStarTimer > 25000 + Math.random() * 30000) {
        this.shootingStarTimer = 0;
        const win = RoomScene.CITY_WINDOWS[Math.floor(Math.random() * 3)];
        this.shootingStar = {
          x: win.x1 + 20 + Math.random() * (win.x2 - win.x1 - 40),
          y: win.y1 + 10 + Math.random() * 60,
          vx: -(0.7 + Math.random() * 0.5),
          vy:  (0.3 + Math.random() * 0.3),
          life: 0,
          maxLife: 900 + Math.random() * 500,
        };
      }
      return;
    }
    const s = this.shootingStar;
    s.x += s.vx * (delta / 16);
    s.y += s.vy * (delta / 16);
    s.life += delta;
    const a = Math.sin((s.life / s.maxLife) * Math.PI);

    // Trail extends opposite to direction of travel (behind the star)
    for (let i = 8; i >= 1; i--) {
      const tx = s.x - s.vx * i * 1.4;
      const ty = s.y - s.vy * i * 1.4;
      if (!this.inCityWindow(tx, ty) || this.inCityDecoration(tx, ty)) continue;
      const ta = a * (1 - i / 9) * 0.55;
      g.fillStyle(0xc8b8ff, ta);
      g.fillRect(tx - 1, ty, 2, 1);
    }
    // Head — only draw if inside a window and not over a decoration
    if (this.inCityWindow(s.x, s.y) && !this.inCityDecoration(s.x, s.y)) {
      g.fillStyle(0xddd0ff, a * 0.22);
      g.fillRect(s.x - 2, s.y - 2, 5, 5);
      g.fillStyle(0xffffff, a * 0.6);
      g.fillRect(s.x - 1, s.y - 1, 3, 3);
      g.fillStyle(0xffffff, a);
      g.fillRect(s.x, s.y, 2, 2);
    }

    if (s.life >= s.maxLife || !this.inCityWindow(s.x, s.y) || this.inCityDecoration(s.x, s.y)) this.shootingStar = null;
  }

  private captureBgCanvas(): void {
    const src = this.textures.get(this.bgTexKey)?.getSourceImage() as HTMLCanvasElement | undefined;
    if (!src || typeof src.getContext !== 'function') return;
    this.bgLiveCanvas = src;
    this.bgLiveCtx = src.getContext('2d')!;
    if (!this.bgOffscreen) this.bgOffscreen = document.createElement('canvas');
    this.bgOffscreen.width = src.width;
    this.bgOffscreen.height = src.height;
    this.bgOffscreen.getContext('2d')!.drawImage(src, 0, 0);
  }

  private updateCityCanvasEffects(time: number, delta: number): void {
    if (!this.bgLiveCtx || !this.bgOffscreen || !this.bgLiveCanvas) return;
    const ctx = this.bgLiveCtx;
    // Restore static background each frame
    ctx.drawImage(this.bgOffscreen, 0, 0);
    // Clip all drawing to window panes
    ctx.save();
    ctx.beginPath();
    for (const w of RoomScene.CITY_WINDOWS) ctx.rect(w.x1, w.y1, w.x2 - w.x1, w.y2 - w.y1);
    ctx.clip();
    // Shooting star
    this.drawShootingStarToCtx(ctx, delta);
    // Bats
    if (this.cityBatEngine) {
      this.cityBatEngine.tick(time, delta);
      drawBatsCanvas(ctx, this.cityBatEngine, time);
    }
    // Fireworks
    for (const fw of this.cityFwEngines) {
      fw.tick(time, delta);
      for (const r of fw.rockets) {
        for (let i = 0; i < r.trail.length; i++) {
          ctx.globalAlpha = (i / r.trail.length) * 0.5;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(r.trail[i].x - 1, r.trail[i].y - 1, 2, 2);
        }
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(r.x, r.y, fw.radius, 0, Math.PI * 2); ctx.fill();
      }
      for (const p of fw.particles) {
        ctx.globalAlpha = p.alpha * 0.9;
        ctx.fillStyle = fw.colorCss(p.ci);
        ctx.beginPath(); ctx.arc(p.x, p.y, fw.radius, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    // Push updated canvas to GPU
    const tex = this.textures.get(this.bgTexKey);
    if (tex?.source?.[0]) tex.source[0].update();
  }

  private drawShootingStarToCtx(ctx: CanvasRenderingContext2D, delta: number): void {
    if (!this.shootingStar) {
      this.shootingStarTimer += delta;
      if (this.shootingStarTimer > 25000 + Math.random() * 30000) {
        this.shootingStarTimer = 0;
        const win = RoomScene.CITY_WINDOWS[Math.floor(Math.random() * 3)];
        this.shootingStar = {
          x: win.x1 + 20 + Math.random() * (win.x2 - win.x1 - 40),
          y: win.y1 + 10 + Math.random() * 60,
          vx: -(0.7 + Math.random() * 0.5),
          vy:  (0.3 + Math.random() * 0.3),
          life: 0, maxLife: 900 + Math.random() * 500,
        };
      }
      return;
    }
    const s = this.shootingStar;
    s.x += s.vx * (delta / 16);
    s.y += s.vy * (delta / 16);
    s.life += delta;
    const a = Math.sin((s.life / s.maxLife) * Math.PI);
    for (let i = 8; i >= 1; i--) {
      const tx = s.x - s.vx * i * 1.4;
      const ty = s.y - s.vy * i * 1.4;
      if (!this.inCityWindow(tx, ty)) continue;
      ctx.globalAlpha = a * (1 - i / 9) * 0.55;
      ctx.fillStyle = '#c8b8ff';
      ctx.fillRect(tx - 1, ty, 2, 1);
    }
    if (this.inCityWindow(s.x, s.y)) {
      ctx.globalAlpha = a * 0.22; ctx.fillStyle = '#ddd0ff'; ctx.fillRect(s.x - 2, s.y - 2, 5, 5);
      ctx.globalAlpha = a * 0.6;  ctx.fillStyle = '#ffffff';  ctx.fillRect(s.x - 1, s.y - 1, 3, 3);
      ctx.globalAlpha = a;         ctx.fillStyle = '#ffffff';  ctx.fillRect(s.x, s.y, 2, 2);
    }
    ctx.globalAlpha = 1;
    if (s.life >= s.maxLife || !this.inCityWindow(s.x, s.y) || this.inCityDecoration(s.x, s.y)) this.shootingStar = null;
  }

  private updateCityWindowFireworks(time: number, delta: number): void {
    if (!this.cityFwEngines.length) return;
    const g = this.shootingStarGraphics;
    for (const fw of this.cityFwEngines) {
      fw.tick(time, delta);
      for (const r of fw.rockets) {
        for (let i = 0; i < r.trail.length; i++) {
          const pt = r.trail[i];
          if (!this.inCityWindow(pt.x, pt.y) || this.inCityDecoration(pt.x, pt.y)) continue;
          g.fillStyle(0xffffff, (i / r.trail.length) * 0.5);
          g.fillRect(pt.x - 1, pt.y - 1, 2, 2);
        }
        if (this.inCityWindow(r.x, r.y) && !this.inCityDecoration(r.x, r.y)) {
          g.fillStyle(0xffffff, 0.9);
          g.fillCircle(r.x, r.y, fw.radius);
        }
      }
      for (const p of fw.particles) {
        if (!this.inCityWindow(p.x, p.y)) continue;
        if (this.inCityDecoration(p.x, p.y)) continue;
        g.fillStyle(fw.colorNum(p.ci), p.alpha * 0.85);
        g.fillCircle(p.x, p.y, fw.radius);
      }
    }
  }

  // Halloween bats + Valentine's hearts in the city sky — drawn into the same
  // window-clipped graphics layer as the fireworks (only where inside a window
  // pane and not over a decoration), so they appear behind the glass.
  private updateCityWindowCritters(time: number, delta: number): void {
    if (!this.cityBatEngine && !this.cityHeartsEngine) return;
    const accept = (x: number, y: number) => this.inCityWindow(x, y) && !this.inCityDecoration(x, y);
    if (this.cityBatEngine) {
      this.cityBatEngine.tick(time, delta);
      drawBatsPhaser(this.shootingStarGraphics, this.cityBatEngine, time, accept);
    }
    if (this.cityHeartsEngine) {
      this.cityHeartsEngine.tick(time, delta);
      drawHeartsPhaser(this.shootingStarGraphics, this.cityHeartsEngine, accept);
    }
  }

  // Clip the city-window FX layer to the four open panes of each window, so the
  // frame's cross-bars (baked into the bg at depth -1) occlude any heart/bat/
  // firework crossing them — partially hidden, not vanished. Geometry mirrors
  // roomWalls.ts: FR=7 border inset, mullions at the window's mid-lines.
  private buildCityWindowMask(): void {
    const wins = [
      { wx: 45,  wy: 10, ww: 195, wh: 242 },
      { wx: 302, wy: 10, ww: 197, wh: 242 },
      { wx: 558, wy: 10, ww: 196, wh: 242 },
    ];
    const FR = 7;
    const g = this.make.graphics({}, false);
    g.fillStyle(0xffffff);
    for (const { wx, wy, ww, wh } of wins) {
      const ix = wx + FR,        rx = wx + ww - FR;
      const iy = wy + FR,        by = wy + wh - FR;
      const vx = wx + Math.round(ww / 2) - 2, vr = vx + 4; // vertical mullion gap
      const hy = wy + Math.round(wh / 2) - 2, hb = hy + 4; // horizontal mullion gap
      g.fillRect(ix, iy, vx - ix, hy - iy); // top-left pane
      g.fillRect(vr, iy, rx - vr, hy - iy); // top-right pane
      g.fillRect(ix, hb, vx - ix, by - hb); // bottom-left pane
      g.fillRect(vr, hb, rx - vr, by - hb); // bottom-right pane
    }
    this.shootingStarGraphics.setMask(g.createGeometryMask());
  }

  // ── BaseScene Overrides ──
  protected override getPlayerSprite(): Phaser.GameObjects.Image { return this.player; }
  protected override getBubbleYOffset(): number { return -135; }
  protected override getBubbleFontSize(): string { return this.nameTagStyle.fontSize; }
  protected override clampPlayerMoveY(y: number): number { return Phaser.Math.Clamp(y, 320, 470); }
  protected override onPresenceCountUpdate(c: number): void { super.onPresenceCountUpdate(c); this.globalPlayerCount = c; }

  /**
   * Extend BaseScene's presence callbacks with a `onRoomConfigUpdate` handler
   * so visitors see live changes when the room owner saves new furniture, wall
   * theme, posters, lighting, pet, etc. without re-entering the room.
   * Only accept updates from this room's actual owner — defense-in-depth on
   * top of the server's room-scoped broadcast.
   */
  protected override buildPresenceCallbacks(myPubkey: string) {
    const base = super.buildPresenceCallbacks(myPubkey);
    base.onRoomConfigUpdate = (pk: string, roomConfig: string) => {
      if (!this.roomConfig.ownerPubkey || pk !== this.roomConfig.ownerPubkey) return;
      this.myRoom.applyRemoteRoomUpdate(roomConfig);
    };
    return base;
  }
  protected override afterPlayerJoin(_p: { pubkey: string; [k: string]: unknown }): void {
    this.myRoom.onPlayerJoin();
    setRoomPlayers([...this.otherPlayers.entries()].map(([pk, o]) => ({ pubkey: pk, name: o.name })));
  }
  protected override onBeforeRemoveOtherPlayer(pk: string): void {
    const remaining = [...this.otherPlayers.entries()]
      .filter(([k]) => k !== pk)
      .map(([k, o]) => ({ pubkey: k, name: o.name }));
    setRoomPlayers(remaining);
    notifyGamePlayerLeft(pk);
  }

  protected override handleSceneChatCommand(pk: string, _name: string, text: string, isMe: boolean): boolean {
    // Intercept zap effect commands (same behavior as HubScene): render a
    // bubble above the sender's sprite and suppress the raw "/zap:N" chat line.
    if (text.startsWith('/zap:')) {
      const sats = parseInt(text.slice(5), 10);
      if (!isNaN(sats)) {
        const sprite = isMe ? this.player : this.otherPlayers.get(pk)?.sprite;
        // Use the scene's bubble Y offset so the zap pill sits exactly where
        // chat bubbles do (above the head), not at chest level.
        if (sprite) ChatUI.showBubble(this, sprite.x, sprite.y + this.getBubbleYOffset(), `⚡ ${sats.toLocaleString()} sats`, '#f0b040', 3000, undefined, isMe);
      }
      return true;
    }
    return this.myRoom.onChatCommand(pk, text);
  }
  protected override handleSceneEsc(): boolean {
    if (this.myRoom.handleEsc()) return true;
    if (this.market.handleEsc()) return true;
    return false;
  }
  protected override onEscFallthrough(): void { this.leaveRoom(); }
  protected override getEyePixelOffsets(): { lx: number; rx: number; yFrac: number } {
    return { lx: -3.5 / 76, rx: 3.5 / 76, yFrac: 45 / 76 };
  }
  protected override getHandPixelOffsets(): { xFrac: number; yFrac: number } {
    // Room canvas 48×76: at the wrist height, nudged up.
    return { xFrac: 8 / 76, yFrac: 20 / 76 };
  }
  /** Single source of truth for Room name tags (local + other players); color is per-room. */
  private get nameTagStyle(): import('./BaseScene').NameTagStyle {
    return { fontSize: '13px', color: this.roomConfig.neonColor, bg: '#0a0014ee', padding: { x: 5, y: 3 } };
  }
  protected override getOtherPlayerConfig(): import('./BaseScene').OtherPlayerConfig {
    return {
      texKeyPrefix: 'avatar_room_', scale: 3,
      nameYOffset: +14, statusYOffset: +26,
      nameColor: this.nameTagStyle.color, nameFontSize: this.nameTagStyle.fontSize, statusFontSize: '9px',
      nameBg: this.nameTagStyle.bg, namePadding: this.nameTagStyle.padding,
      czW: 60, czH: 120, czYOffset: -80,
      tintPalette: [0xe87aab, 0x7b68ee, 0x5dcaa5, 0xfad480, 0xb8a8f8],
      useFadeIn: false, interpolateY: true, emoteContext: 'room',
    };
  }
  protected override renderOtherAvatar(cfg: AvatarConfig): HTMLCanvasElement {
    return renderRoomSprite(cfg, 0);
  }
  protected override setupClickZone(zone: Phaser.GameObjects.Zone, pk: string, name: string): void {
    let czDownX = 0, czDownY = 0;
    zone.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if ((ptr.event.target as HTMLElement)?.tagName !== 'CANVAS') return;
      czDownX = ptr.x; czDownY = ptr.y;
    });
    zone.on('pointerup', (ptr: Phaser.Input.Pointer) => {
      if ((ptr.event.target as HTMLElement)?.tagName !== 'CANVAS') return;
      if (this.computerUI.isOpen()) return;
      const dx = ptr.x - czDownX, dy = ptr.y - czDownY;
      if (Math.sqrt(dx * dx + dy * dy) > 8) return;
      const op = this.otherPlayers.get(pk);
      showPlayerMenu(pk, name.slice(0, 14), ptr.x, ptr.y,
        { onChat: (t, c) => this.chatUI.addMessage('system', t, c), getDMPanel: () => this.dmPanel },
        op?.avatar, op?.status);
    });
  }
  protected override afterAddOtherPlayer(pk: string, _name: string): void {
    const o = this.otherPlayers.get(pk);
    if (o) { o.walkFrame = 0; o.walkTimer = 0; }
  }
  protected override updateOtherPlayerExtras(pk: string, o: import('./BaseScene').OtherPlayer, dx: number, delta: number): void {
    o.sprite.setDepth(o.sprite.y);
    o.nameText.setDepth(o.sprite.y + 1);
    o.statusText.setDepth(o.sprite.y + 1);
    const oMoving = Math.abs(dx) > 1;
    if (oMoving) {
      o.walkTimer = (o.walkTimer ?? 0) + delta;
      if (o.walkTimer >= 180) {
        o.walkTimer = 0;
        o.walkFrame = o.walkFrame === 1 ? 2 : 1;
        const avatarConfig = o.avatar ? (deserializeAvatar(o.avatar) || getDefaultAvatar()) : getDefaultAvatar();
        const texKey = `avatar_room_${pk}`;
        if (this.textures.exists(texKey)) this.textures.remove(texKey);
        this.textures.addCanvas(texKey, renderRoomSprite(avatarConfig, o.walkFrame));
        o.sprite.setTexture(texKey);
      }
    } else if (o.walkFrame !== 0) {
      o.walkFrame = 0; o.walkTimer = 0;
      const avatarConfig = o.avatar ? (deserializeAvatar(o.avatar) || getDefaultAvatar()) : getDefaultAvatar();
      const texKey = `avatar_room_${pk}`;
      if (this.textures.exists(texKey)) this.textures.remove(texKey);
      this.textures.addCanvas(texKey, renderRoomSprite(avatarConfig, 0));
      o.sprite.setTexture(texKey);
    }
  }

  // ── Player Setup ──
  private createPlayer(): void {
    itemImagesReady.then(() => {
      if (this.textures.exists('player_room')) this.textures.remove('player_room');
      this.textures.addCanvas('player_room', renderRoomSprite(getAvatar(), 0));
      this.player?.setTexture('player_room');
    });
    this.player = this.add.image(GAME_WIDTH / 2, this.playerY, 'player_room').setOrigin(0.5, 1).setScale(3).setDepth(this.playerY);
    this.playerSprite = this.player;
    this._localPlayerTexKey = 'player_room';
    const name = this.registry.get('playerName') || 'guest';
    this.playerName = this.makeNameText(GAME_WIDTH / 2, this.playerY + 14, name, this.nameTagStyle, this.playerY + 1);
    const myStatus = getStatus();
    this.playerStatusText = this.add.text(GAME_WIDTH / 2, this.playerY + 26, myStatus, {
      fontFamily: '"Courier New", monospace', fontSize: '9px', color: P.lpurp, align: 'center',
    }).setOrigin(0.5).setDepth(this.playerY + 1).setAlpha(myStatus ? 1 : 0);
  }

  private createBackButton(): void {
    const nc = this.roomConfig.neonColor;
    const bg = this.add.graphics();
    bg.fillStyle(hexToNum(P.bg), 0.92); bg.fillRoundedRect(12, 5, 168, 34, 7);
    bg.lineStyle(1, hexToNum(nc), 0.3); bg.strokeRoundedRect(12, 5, 168, 34, 7); bg.setDepth(99).setScrollFactor(0);
    const btn = this.add.text(96, 22, '← Back to District', {
      fontFamily: '"Courier New", monospace', fontSize: '12px', color: nc, align: 'center',
    }).setOrigin(0.5).setDepth(100).setScrollFactor(0);
    const el = document.createElement('button');
    this.backBtnEl = el;
    const canvasRect = this.game.canvas.getBoundingClientRect();
    const scaleX = canvasRect.width  / this.scale.gameSize.width;
    const scaleY = canvasRect.height / this.scale.gameSize.height;
    el.style.cssText = `position:fixed;left:${canvasRect.left + 12 * scaleX}px;top:${canvasRect.top + 5 * scaleY}px;width:${180 * scaleX}px;height:${38 * scaleY}px;background:transparent;border:none;outline:none;cursor:pointer;z-index:500;pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent;`;
    el.addEventListener('pointerover', () => { btn.setColor(P.lcream); btn.setScale(1.05); });
    el.addEventListener('pointerout',  () => { btn.setColor(nc); btn.setScale(1); });
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.leaveRoom(); });
    document.body.appendChild(el);
    this.setupEscHandler();
  }

  private createRoomLabel(): void {
    const nc = this.roomConfig.neonColor;
    const labelW = Math.max(160, this.roomConfig.name.length * 9 + 32);
    const bg = this.add.graphics();
    bg.fillStyle(hexToNum(P.bg), 0.92); bg.fillRoundedRect(GAME_WIDTH / 2 - labelW / 2, 4, labelW, 32, 6);
    bg.lineStyle(1, hexToNum(nc), 0.35); bg.strokeRoundedRect(GAME_WIDTH / 2 - labelW / 2, 4, labelW, 32, 6); bg.setDepth(99).setScrollFactor(0);
    this.add.text(GAME_WIDTH / 2, 20, this.roomConfig.name, {
      fontFamily: '"Courier New", monospace', fontSize: '14px', color: nc, fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(100).setScrollFactor(0);
  }

  private leaveRoom(): void {
    if (this.isLeavingRoom) return;
    this.isLeavingRoom = true;
    this.backBtnEl?.remove(); this.backBtnEl = null;
    this.waitingForAccess = false;
    setPresenceCallbacks({ ...({} as any), onPlayerJoin: () => {} });
    SoundEngine.get().roomLeave();
    SoundEngine.get().setRoom('');
    sendRoomChange('hub');
    this.computerUI.close();
    this.chatUI.destroy();
    this.cameras.main.fadeOut(200, 10, 0, 20);
    this.time.delayedCall(200, () => {
      if (!this.scene.isActive()) return;
      this.scene.start('HubScene', { _returning: true, fromRoom: this.roomConfig.id });
    });
  }

  // ── Navigation ──
  protected override teleportToRoom(roomId: string): void {
    if (roomId === 'hub') { this.leaveRoom(); return; }
    if (roomId === 'woods') {
      sendRoomChange('woods');
      this.chatUI.destroy();
      this.cameras.main.fadeOut(300, 10, 0, 20);
      this.time.delayedCall(300, () => { if (!this.scene.isActive()) return; this.scene.start('WoodsScene'); });
      return;
    }
    if (roomId === 'cabin') {
      sendRoomChange('cabin');
      this.chatUI.destroy();
      this.cameras.main.fadeOut(300, 4, 2, 0);
      this.time.delayedCall(300, () => { if (!this.scene.isActive()) return; this.scene.start('CabinScene'); });
      return;
    }
    if (roomId === 'myroom') {
      const pk = this.registry.get('playerPubkey');
      const n = this.registry.get('playerName') || 'My Room';
      this.chatUI.destroy();
      this.scene.start('RoomScene', { id: `myroom:${pk}`, name: `${n}'s Room`, neonColor: P.teal, ownerPubkey: pk });
      return;
    }
    if (roomId === 'picker') {
      const pk = this.registry.get('playerPubkey');
      const n = this.registry.get('playerName') || 'My Room';
      this.playerPicker.open(pk, n,
        () => {
          this.chatUI.destroy();
          this.scene.start('RoomScene', { id: `myroom:${pk}`, name: `${n}'s Room`, neonColor: P.teal, ownerPubkey: pk });
        },
        (opk) => {
          this.chatUI.addMessage('system', ti18n('sys.room.requesting'), P.teal);
          this.waitingForAccess = true;
          sendRoomRequest(opk);
          setTimeout(() => {
            if (this.waitingForAccess) { this.waitingForAccess = false; this.chatUI.addMessage('system', ti18n('sys.request_timed_out'), P.amber); }
          }, 30000);
        },
      );
      return;
    }
    this.scene.start('RoomScene', {
      id: roomId, name: roomId.charAt(0).toUpperCase() + roomId.slice(1), neonColor: P.teal,
    });
  }

  // ── Movement ──
  private updateMovement(delta: number): void {
    if (this.shouldBlockPanelKeys()) { this.isKeyboardMoving = false; return; }
    if (!isPresenceReady()) return;
    const c = this.input.keyboard?.createCursorKeys();
    let vx = 0, vy = 0;
    const sp = 250;
    if (c) {
      if (c.left.isDown) vx = -sp; else if (c.right.isDown) vx = sp;
      if (c.up.isDown) vy = -sp;   else if (c.down.isDown) vy = sp;
    }
    if (vx === 0) {
      if (this.mobileLeft) vx = -sp; else if (this.mobileRight) vx = sp;
    }
    if (vx !== 0 || vy !== 0) {
      this.targetX = null; this.isMoving = false;
      this.player.x = Math.round(this.player.x + vx * (delta / 1000));
      this.player.y = Math.round(this.player.y + vy * (delta / 1000));
      if (vx !== 0) this.facingRight = vx > 0;
    } else if (this.isMoving && this.targetX !== null) {
      const dx = this.targetX - this.player.x;
      if (Math.abs(dx) < 3) { this.isMoving = false; this.targetX = null; }
      else { this.player.x = Math.round(this.player.x + Math.sign(dx) * sp * (delta / 1000)); this.facingRight = dx > 0; }
    }
    this.player.x = Phaser.Math.Clamp(this.player.x, 40, GAME_WIDTH - 40);
    this.player.y = Phaser.Math.Clamp(this.player.y, 320, 470);
    this.playerY = this.player.y;
    this.player.setFlipX(!this.facingRight);
    this.isWalking = vx !== 0 || vy !== 0 || (this.isMoving && this.targetX !== null);
  }

  // ── Commands ──
  protected override getSceneAccent(): string { return this.roomConfig?.neonColor ?? P.teal; }

  private handleCommand(text: string): void {
    const parts = text.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ').trim();
    switch (cmd) {
      default: {
        if (!this.handleCommonCommand(cmd, arg))
          this.chatUI.addMessage('system', ti18n('sys.unknown_cmd', { cmd }), P.amber);
        break;
      }
    }
    this.chatUI.flashLog();
  }
}

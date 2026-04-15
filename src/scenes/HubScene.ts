import Phaser from 'phaser';
import { BaseScene } from './BaseScene';
import { GAME_WIDTH, GAME_HEIGHT, WORLD_WIDTH, GROUND_Y, PLAYER_SPEED, P, ANIM, hexToNum, hexToRgb } from '../config/game.config';
import {
  connectPresence, setPresenceCallbacks, sendPosition, sendChat, sendRoomChange,
  sendRoomRequest, sendRoomResponse, requestOnlinePlayers, sendAvatarUpdate,
  setRoomRequestHandler, setRoomGrantedHandler, setRoomDeniedHandler, setRoomKickHandler,
  isPresenceReady,
} from '../nostr/presenceService';
import { startDMSubscription, canUseDMs } from '../nostr/dmService';
import { ChatUI } from '../ui/ChatUI';
import { ProfileModal } from '../ui/ProfileModal';
import { EMOTE_FLAVORS, EMOTE_OFF_MSGS } from '../entities/EmoteSet';
import { renderHubSprite, renderRoomSprite } from '../entities/AvatarRenderer';
import { getAvatar } from '../stores/avatarStore';
import { ComputerUI } from '../ui/ComputerUI';
import { authStore } from '../stores/authStore';
import { loadNostrTheme } from '../nostr/nostrThemeService';
import { initEmojiService } from '../nostr/emojiService';
import { subscribeToZapReceipts } from '../nostr/zapService';
import { ZapModal } from '../ui/ZapModal';
import { showZapToast } from '../ui/ZapToast';
import { LoginScreen } from '../ui/LoginScreen';
import {
  loginWithExtension, loginWithNsec, loginAsGuest,
  startBunkerFlow, loginWithBunkerUrl, cancelBunkerFlow,
  onNextAvatarSync,
} from '../nostr/nostrService';
import { getRoomConfig } from '../stores/roomStore';
import { getStatus } from '../stores/statusStore';
import { TutorialOverlay, isTutorialDone } from '../ui/TutorialOverlay';

interface BuildingZone { id: string; name: string; doorX: number; neonColor: string; }

const ENTERABLE: BuildingZone[] = [
  { id: 'relay', name: 'RELAY', doorX: 180, neonColor: P.sign1 },
  { id: 'feed', name: 'THE FEED', doorX: 480, neonColor: P.pink },
  { id: 'myroom', name: 'MY ROOM', doorX: 740, neonColor: P.teal },
  { id: 'lounge', name: 'LOUNGE', doorX: 980, neonColor: P.pink },
  { id: 'market', name: 'MARKET', doorX: 1215, neonColor: P.amber },
];

export class HubScene extends BaseScene {
  private static readonly WOODS_OPEN = true;
  private player!: Phaser.GameObjects.Image;
  private playerGlow!: Phaser.GameObjects.Graphics;
  private nearBuilding: BuildingZone | null = null;
  private promptText!: Phaser.GameObjects.Text;
  private promptBg!: Phaser.GameObjects.Graphics;
  private promptArrow!: Phaser.GameObjects.Text;
  private playerNames = new Map<string, string>();

  private parallaxBg!: Phaser.GameObjects.Image;
  private dustParticles: { x: number; y: number; vx: number; vy: number; alpha: number; size: number; color: string }[] = [];
  private dustGraphics!: Phaser.GameObjects.Graphics;
  private neonTimer = 0;
  private neonFrame = 0;
  private chimneyGraphics!: Phaser.GameObjects.Graphics;
  private chimneyParticles: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number }[] = [];
  private chimneySpawnTimer = 0;
  // [worldX, chimney-cap Y] — matches BootScene fgBuildings where ri%2===0 && w>50
  // 3 chimneys on unnamed buildings: bi=0 (left), bi=2 (mid-left), bi=12 (right)
  private readonly CHIMNEYS: [number, number][] = [
    [22, GROUND_Y - 238], [318, GROUND_Y - 258], [1502, GROUND_Y - 218],
  ];
  private nearBulletinBoard = false;
  private nearCrewBoard = false;
  private readonly BULLETIN_X = 860;
  private readonly CREW_BOARD_X = 615;

  private isReturning = false;
  private waitingForAccess = false;
  private returnFromRoom: string | null = null;
  private isLeavingToWoods = false;
  private isLeavingToAlley = false;
  private nearAlley = false;
  private lastWoodsClosedNotice = 0;

  // Alley entrance — gap between RELAY building (ends ~260) and unnamed building (starts 300)
  // Secret: no prompt shown, press E while in the gap to enter
  private readonly ALLEY_ENTER_X = 280;
  private readonly ALLEY_ENTER_RANGE = 30;

  constructor() { super({ key: 'HubScene' }); }
  init(data?: any): void { super.init(data); this.isReturning = !!data?._returning; this.returnFromRoom = data?.fromRoom || null; this.isLeavingToWoods = false; this.isLeavingToAlley = false; }

  create(): void {
    // ── Login gate ──
    const auth = authStore.getState();
    if (!auth.isLoggedIn && !auth.isGuest) {
      this.showLoginScreen();
      return;
    }
    this.startGame();
  }

  private showLoginScreen(): void {
    const loginScreen = new LoginScreen({
      onExtensionLogin: async () => {
        try {
          this.snd.startBoot();
          await loginWithExtension();
          loginScreen.destroy();
          this.finishLogin();
        } catch (e: any) {
          loginScreen.setStatus(e.message, true);
        }
      },
      onNsecLogin: async (nsec: string) => {
        try {
          this.snd.startBoot();
          await loginWithNsec(nsec);
          loginScreen.destroy();
          this.finishLogin();
        } catch (e: any) {
          loginScreen.setStatus(e.message, true);
        }
      },
      onGuestLogin: async () => {
        this.snd.startBoot();
        await loginAsGuest();
        loginScreen.destroy();
        this.finishLogin();
      },
      onBunkerLogin: async (url: string) => {
        try {
          await loginWithBunkerUrl(url);
          loginScreen.destroy();
          this.finishLogin();
        } catch (e: any) {
          loginScreen.setBunkerStatus(e.message, true);
        }
      },
      onBunkerClientFlow: async () => {
        try {
          this.snd.startBoot();
          const qrContainer = loginScreen.getQRContainer();
          const { connectUri, waitForConnect } = await startBunkerFlow(
            (status, msg) => {
              loginScreen.setBunkerStatus(msg);
            },
            qrContainer,
          );
          if (connectUri) loginScreen.showConnectUri(connectUri);
          loginScreen.setBunkerStatus('Waiting for signer approval...');

          // Watch authStore for login completion — more reliable than awaiting the promise
          const unsub = authStore.subscribe(() => {
            const s = authStore.getState();
            if (s.isLoggedIn && s.loginMethod === 'bunker') {
              unsub();
              loginScreen.destroy();
              this.finishLogin();
            }
          });

          // Also await the promise as a fallback
          waitForConnect.then(() => {
            const s = authStore.getState();
            if (s.isLoggedIn) {
              unsub();
              loginScreen.destroy();
              this.finishLogin();
            }
          }).catch((e: any) => {
            unsub();
            loginScreen.setBunkerStatus(e.message, true);
          });

        } catch (e: any) {
          loginScreen.setBunkerStatus(e.message, true);
        }
      },
      onBunkerCancel: () => {
        cancelBunkerFlow();
      },
    });
  }

  private _loginDone = false;
  private finishLogin(): void {
    if (this._loginDone) return;
    this._loginDone = true;
    const auth = authStore.getState();
    this.registry.set('playerPubkey', auth.pubkey || '');
    this.registry.set('playerName', auth.displayName || 'anon');
    // Fetch kind 16767 for panel theming (fire-and-forget)
    if (auth.pubkey) {
      void loadNostrTheme(auth.pubkey);
      void initEmojiService(auth.pubkey);
    }
    this.startGame();
  }

  private startGame(): void {
    this.snd.stopBoot();
    // Ensure registry has current auth state (covers guest + returning from room)
    const auth = authStore.getState();
    if (!this.registry.get('playerPubkey') && auth.pubkey) {
      this.registry.set('playerPubkey', auth.pubkey);
      this.registry.set('playerName', auth.displayName || 'anon');
    }
    this.parallaxBg = this.add.image(WORLD_WIDTH / 2, GAME_HEIGHT / 2, 'parallax_bg').setDepth(-2).setAlpha(0.6);
    this.add.image(WORLD_WIDTH / 2, GAME_HEIGHT / 2, 'district_bg').setDepth(-1);
    this.dustGraphics = this.add.graphics().setDepth(5); this.initDustParticles();
this.chimneyGraphics = this.add.graphics().setDepth(1);
    this.emoteGraphics = this.add.graphics().setDepth(15);
    this.createPlayer(); this.createInteractPrompt(); this.createBulletinBoard(); this.createCrewBoard();
    onNextAvatarSync(() => {
      this.generateWalkFrames(getAvatar());
      if (this.textures.exists('player')) this.textures.remove('player');
      this.textures.addCanvas('player', renderHubSprite(getAvatar()));
      this.player?.setTexture('player');
      sendAvatarUpdate();
    });
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, GAME_HEIGHT);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setDeadzone(80, 50);
    this.setupMobileCamera();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if ((p.event.target as HTMLElement)?.tagName !== 'CANVAS') return; if (p.worldY < GROUND_Y - 10 || p.worldY > 460) return; this.targetX = Phaser.Math.Clamp(p.worldX, 20, WORLD_WIDTH - 20); this.isMoving = true; });
    this.input.keyboard?.on('keydown-E', () => this.tryEnter());
    this.input.keyboard?.on('keydown-SPACE', () => this.tryEnter());
    this.setupPresenceCallbacks(this.registry.get('playerPubkey')); this.setupRoomRequestHandlers();

    this.setupProfileSubscription();

    // ── Zap receipt subscription ──
    const zapAuth = authStore.getState();
    if (zapAuth.pubkey && !zapAuth.isGuest) {
      const unsubZap = subscribeToZapReceipts(zapAuth.pubkey, (senderPubkey, amountSats, comment) => {
        // Resolve sender name from known players
        const senderName = this.otherPlayers.get(senderPubkey)?.name
          || this.playerNames?.get(senderPubkey)
          || senderPubkey.slice(0, 8) + '…';
        showZapToast(senderName, amountSats, comment || undefined, 'incoming');
      });
      this.events.once('shutdown', unsubZap);
    }

    this.chatUI = new ChatUI();
    this.chatInput = this.chatUI.create('Chat or /terminal /dm /help...', P.teal, (cmd) => this.handleCommand(cmd));
    this.chatUI.setNameClickHandler((pubkey, name) => {
      const op = this.otherPlayers.get(pubkey);
      ProfileModal.show(pubkey, name, op?.avatar, op?.status);
    });
    this.createMobileControls();

    this.setupRegistryPanels(this.registry.get('playerPubkey') || null);
    ProfileModal.setDMPanel(this.dmPanel);
    if (!this.isReturning && canUseDMs()) startDMSubscription();
    this.setupCommonKeyboardHandlers();

    this.setupEscHandler();
    this.cameras.main.fadeIn(400, 10, 0, 20);
    this.settingsPanel.create();
    this.events.on('shutdown', () => {
      this.shutdownCommonPanels();
      this.chimneyGraphics?.destroy(); this.chimneyParticles = [];
    });
  }

  update(time: number, delta: number): void {
    this.updateMovement(); this.updateProximity(); this.updateParallax();
    this.updateDustParticles(delta); this.updateNeonFlicker(delta); this.updatePlayerGlow(time);
    this.updateChimneySmoke(delta);

    // Walk animation — bob up/down and alternate leg frame
    const isWalking = this.isKeyboardMoving || this.isMoving || this.targetX !== null;
    if (isWalking) {
      this.footTimer += delta;
      if (this.footTimer >= 300) { this.footTimer = 0; this.snd.footstep(); }
      this.walkTime += delta;
      // Bob: full cycle every 300ms, 2px up then back
      const bobOffset = Math.abs(Math.sin(this.walkTime * Math.PI / 150)) * -2;
      this.player.y = this.playerY + bobOffset;
      // Leg frame: switch every 150ms
      const newFrame = Math.floor(this.walkTime / 150) % 2;
      if (newFrame !== this.walkFrame) {
        this.walkFrame = newFrame;
        this.player.setTexture(`player_walk${this.walkFrame}`);
      }
    } else {
      this.walkTime = 0;
      if (this.walkFrame !== 0) {
        this.walkFrame = 0;
        this.player.setTexture('player');
      }
      this.player.y = this.playerY;
    }

    this.emoteGraphics.clear();
    this.emoteSet.updateAll(this.emoteGraphics, delta, this.player.x, this.player.y, this.facingRight, 'hub', isWalking);
    this.player.setAlpha(this.emoteSet.isActive('ghost') ? 0.3 : 1);

    // ── Alley: secret entrance — track proximity silently, no UI shown ──
    if (!this.isLeavingToAlley && !this.isLeavingToWoods) {
      this.nearAlley = Math.abs(this.player.x - this.ALLEY_ENTER_X) <= this.ALLEY_ENTER_RANGE;
    }

    // ── Woods transition: walk off the left edge ──
    if (this.player.x <= 24 && !this.isLeavingToWoods) {
      if (!HubScene.WOODS_OPEN) {
        this.player.x = 24;
        this.notifyWoodsClosed();
      } else {
        this.isLeavingToWoods = true;
        this.enterWoods();
      }
    }

    this.playerName.setPosition(this.player.x, this.player.y - 44);
    this.playerStatusText.setPosition(this.player.x, this.player.y - 59);
    const ghostAlpha = this.emoteSet.isActive('ghost') ? 0.3 : 1;
    this.playerName.setAlpha(ghostAlpha); this.playerStatusText.setAlpha(ghostAlpha);
    sendPosition(this.player.x, this.player.y, this.facingRight);
    this.updateOtherPlayers(time, delta);
  }

  // ── Room Requests ──
  protected override setupRoomRequestHandlers(): void {
    setRoomRequestHandler((rp, rn) => this.showRoomRequestToast(rp, rn));
    setRoomGrantedHandler((op, on, room, roomConfig) => { this.waitingForAccess = false; this.chatUI.addMessage('system', `${on} accepted!`, P.teal); this.enterRoom(room, `${on}'s Room`, P.teal, op, roomConfig); });
    setRoomDeniedHandler((r) => { this.waitingForAccess = false; this.chatUI.addMessage('system', r || 'Denied', P.amber); });
    setRoomKickHandler((r) => { this.chatUI.addMessage('system', r || 'Removed from room', P.amber); });
  }
  // ── Player Picker ──
  private showPlayerPicker(): void {
    const myPk = this.registry.get('playerPubkey'); const myName = this.registry.get('playerName') || 'My Room';
    this.playerPicker.open(myPk, myName,
      () => this.enterRoom(`myroom:${myPk}`, `${myName}'s Room`, P.teal, myPk),
      (pk) => this.requestRoomAccess(pk),
    );
  }
  private requestRoomAccess(op: string): void { this.chatUI.addMessage('system', `Requesting access...`, P.teal); this.waitingForAccess = true; sendRoomRequest(op); setTimeout(() => { if (this.waitingForAccess) { this.waitingForAccess = false; this.chatUI.addMessage('system', 'Timed out', P.amber); } }, 30000); }
  private enterRoom(rid: string, rn: string, nc: string, op?: string, ownerRoomConfig?: string): void {
    if (this.isLeavingScene) return;
    this.isLeavingScene = true;
    this.snd.roomEnter();
    this.snd.setRoom('');
    this.chatUI.destroy(); const f = this.add.graphics().setDepth(200); const rgb = hexToRgb(nc); f.fillStyle(Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b), 0.35); f.fillRect(this.cameras.main.scrollX, 0, GAME_WIDTH, GAME_HEIGHT);
    const f2 = this.add.graphics().setDepth(201); f2.fillStyle(0xffffff, 0.15); f2.fillRect(this.cameras.main.scrollX, 0, GAME_WIDTH, GAME_HEIGHT);
    this.tweens.add({ targets: [f, f2], alpha: 0, duration: ANIM.enterFlashDuration, ease: 'Quad.easeOut', onComplete: () => { f.destroy(); f2.destroy(); this.scene.start('RoomScene', { id: rid, name: rn, neonColor: nc, ownerPubkey: op, ownerRoomConfig }); } });
  }

  private enterWoods(): void {
    if (this.isLeavingScene) return;
    if (!HubScene.WOODS_OPEN) {
      this.notifyWoodsClosed();
      return;
    }
    this.isLeavingScene = true;
    this.snd.roomEnter();
    this.snd.setRoom('');
    this.chatUI.destroy();
    this.cameras.main.fadeOut(400, 4, 8, 10);
    this.time.delayedCall(400, () => {
      if (!this.scene.isActive()) return;
      this.scene.start('WoodsScene', { fromCabin: false });
    });
  }

  private notifyWoodsClosed(): void {
    if (this.lastWoodsClosedNotice !== 0) return;
    this.lastWoodsClosedNotice = Date.now();
    this.chatUI.addMessage('system', 'The woods are temporarily closed.', P.amber);
  }

  // ── Presence ──
  protected override setupPresenceCallbacks(myPubkey: string): void {
    const cb = this.buildPresenceCallbacks(myPubkey);
    if (!this.isReturning) connectPresence(cb);
    else { setPresenceCallbacks(cb); sendRoomChange('hub', 400, GROUND_Y + 8); const ae = this.emoteSet.activeNames(); if (ae.length) this.time.delayedCall(500, () => ae.forEach(n => sendChat(`/emote ${n}_on`))); }
    this.snd.setRoom('hub');

    // ── First-time tutorial ──
    if (!this.isReturning && !isTutorialDone()) {
      this.time.delayedCall(800, () => { new TutorialOverlay(() => {}); });
    }
  }

  // ── Other Players ──
  protected override getPlayerSprite(): Phaser.GameObjects.Image { return this.player; }
  protected override showEmoteAsBubble(): boolean { return true; }
  protected override handleSceneChatCommand(pk: string, _name: string, text: string, isMe: boolean): boolean {
    if (text.startsWith('/zap:')) {
      const sats = parseInt(text.slice(5), 10);
      if (!isNaN(sats)) { const sprite = isMe ? this.player : this.otherPlayers.get(pk)?.sprite; if (sprite) ChatUI.showBubble(this, sprite.x, sprite.y - 48, `⚡ ${sats.toLocaleString()} sats`, '#f0b040', 3000); }
      return true;
    }
    return false;
  }
  protected override handleSceneEsc(): boolean {
    if (this.computerUI.isOpen()) { this.computerUI.close(); return true; }
    return false;
  }

  protected override getOtherPlayerConfig(): import('./BaseScene').OtherPlayerConfig {
    return {
      texKeyPrefix: 'avatar_hub_', scale: 1,
      nameYOffset: -44, statusYOffset: -59,
      nameColor: P.lcream, nameFontSize: '10px', statusFontSize: '9px',
      nameBg: '#0a0014bb', namePadding: { x: 4, y: 2 },
      czW: 24, czH: 44, czYOffset: -20,
      tintPalette: [0xe87aab, 0x7b68ee, 0x5dcaa5, 0x6a4888, 0x4a6080],
      useFadeIn: true, interpolateY: false, emoteContext: 'hub',
    };
  }
  protected override renderOtherAvatar(cfg: import('../stores/avatarStore').AvatarConfig): HTMLCanvasElement {
    return renderHubSprite(cfg);
  }
  protected override afterAddOtherPlayer(pk: string, name: string): void {
    this.playerNames.set(pk, name.slice(0, 14)); this.playerNames.set(name.toLowerCase(), pk);
  }
  protected override onBeforeRemoveOtherPlayer(pk: string): void {
    const n = this.playerNames.get(pk); if (n) this.playerNames.delete(n.toLowerCase()); this.playerNames.delete(pk);
  }

  // ── Visuals ──
  private updateParallax(): void { this.parallaxBg.x = WORLD_WIDTH / 2 - this.cameras.main.scrollX * ANIM.parallaxFactor; }
  private initDustParticles(): void { const c = [P.pink, P.purp, P.amber, P.teal, P.lcream]; for (let i = 0; i < 40; i++) this.dustParticles.push({ x: Math.random() * WORLD_WIDTH, y: 50 + Math.random() * (GROUND_Y - 60), vx: -0.1 + Math.random() * 0.2, vy: -0.05 + Math.random() * 0.1, alpha: 0.05 + Math.random() * 0.12, size: Math.random() > 0.8 ? 2 : 1, color: c[Math.floor(Math.random() * c.length)] }); }
  private updateDustParticles(d: number): void { this.dustGraphics.clear(); const dt = d / 16; this.dustParticles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; if (p.x < 0) p.x = WORLD_WIDTH; if (p.x > WORLD_WIDTH) p.x = 0; if (p.y < 40) p.y = GROUND_Y - 20; if (p.y > GROUND_Y - 10) p.y = 50; const rgb = hexToRgb(p.color); this.dustGraphics.fillStyle(Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b), p.alpha); this.dustGraphics.fillRect(p.x, p.y, p.size, p.size); }); }
  private updateChimneySmoke(delta: number): void {
    this.chimneySpawnTimer += delta;
    if (this.chimneySpawnTimer > 90) {
      this.chimneySpawnTimer = 0;
      for (const [cx, cy] of this.CHIMNEYS) {
        if (Math.random() > 0.45) {
          this.chimneyParticles.push({
            x: cx + 3 + (Math.random() - 0.5) * 4,
            y: cy,
            vx: (Math.random() - 0.5) * 0.5,
            vy: -(0.35 + Math.random() * 0.5),
            life: 0,
            maxLife: 2200 + Math.random() * 1800,
            size: 3 + Math.random() * 3,
          });
        }
      }
    }
    this.chimneyGraphics.clear();
    const dt = delta / 16;
    for (let i = this.chimneyParticles.length - 1; i >= 0; i--) {
      const p = this.chimneyParticles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx += (Math.random() - 0.5) * 0.025;
      p.life += delta;
      const progress = p.life / p.maxLife;
      if (progress >= 1) { this.chimneyParticles.splice(i, 1); continue; }
      const alpha = progress < 0.15 ? progress / 0.15 : (1 - progress) / 0.85;
      const radius = p.size + progress * 5;
      this.chimneyGraphics.fillStyle(0xbbbbcc, alpha * 0.28);
      this.chimneyGraphics.fillCircle(p.x, p.y, radius);
    }
    if (this.chimneyParticles.length > 120) this.chimneyParticles = this.chimneyParticles.slice(-90);
  }
  private updateNeonFlicker(d: number): void { this.neonTimer += d; if (this.neonTimer > ANIM.neonFlicker + Math.random() * 200) { this.neonTimer = 0; this.neonFrame = (this.neonFrame + 1) % 4; } }
  private updatePlayerGlow(t: number): void { const p = 0.06 + Math.sin(t * ANIM.breatheSpeed) * 0.025; this.playerGlow.clear(); this.playerGlow.setPosition(this.player.x, this.player.y); this.playerGlow.fillStyle(hexToNum(P.teal), p * 0.4); this.playerGlow.fillEllipse(0, -1, 36, 10); this.playerGlow.fillStyle(hexToNum(P.teal), p); this.playerGlow.fillEllipse(0, -1, 24, 6); }

  // ── Player ──
  private createPlayer(): void {
    this.playerGlow = this.add.graphics().setDepth(9);
    let sx = 400; if (this.returnFromRoom === 'woods') { sx = 60; } else if (this.returnFromRoom === 'alley') { sx = 310; } else if (this.returnFromRoom) { const d = ENTERABLE.find(e => e.id === this.returnFromRoom || (this.returnFromRoom?.startsWith('myroom') && e.id === 'myroom')); if (d) sx = d.doorX; }
    this.player = this.add.image(sx, this.playerY, 'player').setOrigin(0.5, 1).setScale(1).setDepth(10);
    const n = this.registry.get('playerName') || 'guest';
    this.playerName = this.add.text(sx, this.playerY - 44, n.slice(0, 14), { fontFamily: '"Courier New", monospace', fontSize: '10px', color: P.teal, align: 'center', backgroundColor: '#0a0014bb', padding: { x: 4, y: 2 } }).setOrigin(0.5).setDepth(11);
    const myStatus = getStatus();
    this.playerStatusText = this.add.text(sx, this.playerY - 59, myStatus, { fontFamily: '"Courier New", monospace', fontSize: '9px', color: P.lpurp, align: 'center' }).setOrigin(0.5).setDepth(11).setAlpha(myStatus ? 1 : 0);
    this.generateWalkFrames(getAvatar());
  }

  private generateWalkFrames(avatar = getAvatar()): void {
    if (this.textures.exists('player_walk0')) this.textures.remove('player_walk0');
    if (this.textures.exists('player_walk1')) this.textures.remove('player_walk1');
    this.textures.addCanvas('player_walk0', renderHubSprite(avatar, 0));
    this.textures.addCanvas('player_walk1', renderHubSprite(avatar, 1));
  }
  private updateMovement(): void {
    if (!isPresenceReady()) return; // freeze until server confirms sync
    const c = this.input.keyboard?.createCursorKeys();
    let vx = 0;
    if (c) { if (c.left.isDown) vx = -PLAYER_SPEED; else if (c.right.isDown) vx = PLAYER_SPEED; }
    // Mobile arrow buttons
    if (vx === 0) { if (this.mobileLeft) vx = -PLAYER_SPEED; else if (this.mobileRight) vx = PLAYER_SPEED; }
    this.isKeyboardMoving = vx !== 0;
    // Clear proximity prompts the moment the player starts moving so they don't linger
    if (vx !== 0 && (this.nearBuilding || this.nearCrewBoard || this.nearBulletinBoard)) {
      this.nearBuilding = null; this.nearCrewBoard = false; this.nearBulletinBoard = false;
      this.promptBg.setVisible(false); this.promptText.setVisible(false); this.promptArrow.setVisible(false);
      this.tweens.killTweensOf(this.promptArrow);
    }
    if (vx !== 0) { this.targetX = null; this.isMoving = false; this.player.x += vx / 60; this.facingRight = vx > 0; }
    else if (this.isMoving && this.targetX !== null) { const dx = this.targetX - this.player.x; if (Math.abs(dx) < 3) { this.isMoving = false; this.targetX = null; } else { this.player.x += Math.sign(dx) * PLAYER_SPEED / 60; this.facingRight = dx > 0; } }
    this.player.x = Phaser.Math.Clamp(this.player.x, 20, WORLD_WIDTH - 20);
    this.player.setFlipX(!this.facingRight);
  }
  private updateProximity(): void {
    // Check crew board
    const cdist = Math.abs(this.player.x - this.CREW_BOARD_X);
    const wasNearCrew = this.nearCrewBoard;
    this.nearCrewBoard = cdist < 52;
    if (this.nearCrewBoard !== wasNearCrew) {
      if (this.nearCrewBoard) {
        const px = this.CREW_BOARD_X; const py = GROUND_Y - 75;
        this.promptBg.setVisible(true); this.promptText.setVisible(true); this.promptArrow.setVisible(true);
        this.promptBg.setPosition(px - 62, py - 2);
        this.promptText.setPosition(px, py + 8); this.promptText.setText(`${this.sys.game.device.input.touch ? '[TAP]' : '[E]'} Crews`); this.promptText.setColor(P.teal);
        this.promptArrow.setPosition(px, py + 22); this.promptArrow.setColor(P.teal);
        this.tweens.add({ targets: this.promptArrow, y: py + 26, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      } else {
        this.promptBg.setVisible(false); this.promptText.setVisible(false); this.promptArrow.setVisible(false);
        this.tweens.killTweensOf(this.promptArrow);
      }
    }
    if (this.nearCrewBoard) return;

    // Check bulletin board
    const bdist = Math.abs(this.player.x - this.BULLETIN_X);
    const wasNearBoard = this.nearBulletinBoard;
    this.nearBulletinBoard = bdist < 52;
    if (this.nearBulletinBoard !== wasNearBoard) {
      if (this.nearBulletinBoard) {
        const px = this.BULLETIN_X; const py = GROUND_Y - 75;
        this.promptBg.setVisible(true); this.promptText.setVisible(true); this.promptArrow.setVisible(true);
        this.promptBg.setPosition(px - 62, py - 2);
        this.promptText.setPosition(px, py + 8); this.promptText.setText(`${this.sys.game.device.input.touch ? '[TAP]' : '[E]'} View Polls`); this.promptText.setColor(P.amber);
        this.promptArrow.setPosition(px, py + 22); this.promptArrow.setColor(P.amber);
        this.tweens.add({ targets: this.promptArrow, y: py + 26, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.nearBuilding = null;
        return;
      } else {
        this.promptBg.setVisible(false); this.promptText.setVisible(false); this.promptArrow.setVisible(false);
        this.tweens.killTweensOf(this.promptArrow);
      }
    }
    if (this.nearBulletinBoard) return;

    let fi = -1; let cd = Infinity;
    for (let i = 0; i < ENTERABLE.length; i++) { const d = Math.abs(this.player.x - ENTERABLE[i].doorX); if (d < 48 && d < cd) { fi = i; cd = d; } }
    const f = fi >= 0 ? ENTERABLE[fi] : null;
    if (f !== this.nearBuilding) { this.nearBuilding = f; if (f) { this.promptBg.setVisible(true); this.promptText.setVisible(true); this.promptArrow.setVisible(true); const px = f.doorX; const py = GROUND_Y - 75; this.promptBg.setPosition(px - 62, py - 2); this.promptText.setPosition(px, py + 8); this.promptText.setText(`${this.sys.game.device.input.touch ? '[TAP]' : '[E]'} Enter ${f.name}`); this.promptText.setColor(f.neonColor); this.promptArrow.setPosition(px, py + 22); this.promptArrow.setColor(f.neonColor); this.tweens.add({ targets: this.promptArrow, y: py + 26, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }); } else { this.promptBg.setVisible(false); this.promptText.setVisible(false); this.promptArrow.setVisible(false); this.tweens.killTweensOf(this.promptArrow); } }
  }
  private createInteractPrompt(): void { this.promptBg = this.add.graphics(); this.promptBg.fillStyle(hexToNum(P.bg), 0.88); this.promptBg.fillRoundedRect(0, 0, 124, 28, 5); this.promptBg.lineStyle(1, hexToNum(P.dpurp), 0.4); this.promptBg.strokeRoundedRect(0, 0, 124, 28, 5); this.promptBg.setDepth(50); this.promptBg.setVisible(false); this.promptBg.setInteractive(new Phaser.Geom.Rectangle(0, 0, 124, 28), Phaser.Geom.Rectangle.Contains); this.promptBg.on('pointerdown', () => this.tryEnter()); this.promptText = this.add.text(0, 0, '', { fontFamily: '"Courier New", monospace', fontSize: '10px', color: P.teal, fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(51); this.promptText.setVisible(false); this.promptText.setInteractive(); this.promptText.on('pointerdown', () => this.tryEnter()); this.promptArrow = this.add.text(0, 0, '\u25BC', { fontFamily: 'monospace', fontSize: '9px', color: P.teal, align: 'center' }).setOrigin(0.5).setDepth(51); this.promptArrow.setVisible(false); }
  private createBulletinBoard(): void {
    const bx = this.BULLETIN_X;
    const g = this.add.graphics().setDepth(4);

    // Legs — from board bottom flush to ground
    g.fillStyle(0x3a2a18, 1);
    g.fillRect(bx - 14, GROUND_Y - 10, 2, 10);
    g.fillRect(bx + 12, GROUND_Y - 10, 2, 10);

    // Board face — sits just above the legs
    g.fillStyle(0x5c3d20, 1);
    g.fillRect(bx - 17, GROUND_Y - 32, 34, 22);
    g.lineStyle(1, 0x7a5530, 1);
    g.strokeRect(bx - 17, GROUND_Y - 32, 34, 22);

    // Top shadow
    g.fillStyle(0x3a2a10, 0.4);
    g.fillRect(bx - 17, GROUND_Y - 32, 34, 2);

    // Papers
    g.fillStyle(0xf0e8d0, 0.9);
    g.fillRect(bx - 14, GROUND_Y - 29, 13, 8);
    g.fillStyle(0xeae0c4, 0.9);
    g.fillRect(bx +  1, GROUND_Y - 28, 12, 7);
    g.fillStyle(0xf5f0e0, 0.9);
    g.fillRect(bx - 10, GROUND_Y - 18, 18, 6);

    // Pushpins
    g.fillStyle(0xe84040, 1); g.fillCircle(bx - 7,  GROUND_Y - 30, 1.2);
    g.fillStyle(0x4499ee, 1); g.fillCircle(bx +  8, GROUND_Y - 29, 1.2);
    g.fillStyle(0xf0a020, 1); g.fillCircle(bx - 1,  GROUND_Y - 19, 1.2);

    // "POLLS" label
    const signText = this.add.text(bx, GROUND_Y - 34, 'POLLS', {
      fontFamily: '"Courier New", monospace',
      fontSize: '7px', color: P.amber, fontStyle: 'bold',
    }).setOrigin(0.5, 1).setDepth(5);

    this.events.on('update', (time: number) => {
      signText.setAlpha(Math.sin(time * 0.003) > 0.94 ? 0.4 : 1);
    });
  }

  private createCrewBoard(): void {
    const bx = this.CREW_BOARD_X;
    const g = this.add.graphics().setDepth(4);

    // Legs
    g.fillStyle(0x1a3a2a, 1);
    g.fillRect(bx - 14, GROUND_Y - 10, 2, 10);
    g.fillRect(bx + 12, GROUND_Y - 10, 2, 10);

    // Board face — dark teal tone
    g.fillStyle(0x0e2e24, 1);
    g.fillRect(bx - 17, GROUND_Y - 32, 34, 22);
    g.lineStyle(1, hexToNum(P.teal), 0.6);
    g.strokeRect(bx - 17, GROUND_Y - 32, 34, 22);

    // Top shadow
    g.fillStyle(0x000000, 0.3);
    g.fillRect(bx - 17, GROUND_Y - 32, 34, 2);

    // Glowing grid lines (crew aesthetic)
    g.lineStyle(1, hexToNum(P.teal), 0.25);
    g.lineBetween(bx - 14, GROUND_Y - 26, bx + 14, GROUND_Y - 26);
    g.lineBetween(bx - 14, GROUND_Y - 20, bx + 14, GROUND_Y - 20);
    g.lineBetween(bx - 3, GROUND_Y - 30, bx - 3, GROUND_Y - 12);

    // Emblem dots
    g.fillStyle(hexToNum(P.teal), 0.9); g.fillCircle(bx - 8, GROUND_Y - 28, 1.5);
    g.fillStyle(hexToNum(P.pink), 0.9); g.fillCircle(bx + 5, GROUND_Y - 22, 1.5);
    g.fillStyle(hexToNum(P.amber), 0.9); g.fillCircle(bx - 2, GROUND_Y - 16, 1.5);

    // "CREWS" label
    const signText = this.add.text(bx, GROUND_Y - 34, 'CREWS', {
      fontFamily: '"Courier New", monospace',
      fontSize: '7px', color: P.teal, fontStyle: 'bold',
    }).setOrigin(0.5, 1).setDepth(5);

    this.events.on('update', (time: number) => {
      signText.setAlpha(Math.sin(time * 0.0025 + 1.5) > 0.94 ? 0.4 : 1);
    });
  }

  private tryEnter(): void {
    if (this.isLeavingScene) return;
    if (document.querySelector('.dm-panel.dm-open, .cp-panel.cp-open, .cp-modal-overlay')) return;
    if (this.nearCrewBoard) { this.crewPanel.toggle(); return; }
    if (this.nearBulletinBoard) { this.pollBoard.toggle(); return; }
    if (this.nearAlley && !this.isLeavingToAlley) { this.enterAlley(); return; }
    if (!this.nearBuilding) return;
    this.isMoving = false; this.targetX = null;
    if (this.nearBuilding.id === 'myroom') { this.showPlayerPicker(); return; }
    this.enterRoom(this.nearBuilding.id, this.nearBuilding.name, this.nearBuilding.neonColor);
  }

  private enterAlley(): void {
    this.isLeavingToAlley = true;
    this.isMoving = false; this.targetX = null;
    this.snd.roomEnter();
    this.snd.setRoom('');
    this.chatUI.destroy();
    this.cameras.main.fadeOut(350, 0, 0, 0);
    this.time.delayedCall(350, () => {
      if (!this.scene.isActive()) return;
      this.scene.start('AlleyScene');
    });
  }

  // ── Helpers ──
  private async resolvePlayerPubkey(arg: string): Promise<string | null> {
    if (arg.startsWith('npub1')) {
      try {
        const { nip19 } = await import('nostr-tools');
        const decoded = nip19.decode(arg);
        if (decoded.type === 'npub') return decoded.data as string;
      } catch {}
      return null;
    }
    let found: string | null = null;
    this.otherPlayers.forEach((o, pk) => { if (o.name?.toLowerCase().includes(arg.toLowerCase())) found = pk; });
    return found;
  }

  // ── Commands ──
  private handleCommand(text: string): void {
    const parts = text.slice(1).split(' '); const cmd = parts[0].toLowerCase(); const arg = parts.slice(1).join(' ').trim();
    switch (cmd) {
      case 'visit': { if (!arg) return; this.resolvePlayerPubkey(arg).then(tp => { if (tp) this.requestRoomAccess(tp); else this.chatUI.addMessage('system', `"${arg}" not found`, P.amber); }); break; }
      case 'tp': case 'teleport': case 'go': { if (!arg) { this.chatUI.addMessage('system', `Rooms: relay, feed, myroom, lounge, market${HubScene.WOODS_OPEN ? ', woods' : ''}`, P.teal); return; } const al: Record<string, string> = { relay:'relay', feed:'feed', thefeed:'feed', myroom:'myroom', room:'picker', lounge:'lounge', rooftop:'lounge', market:'market', shop:'market', store:'market', woods:'woods', forest:'woods', camp:'woods' }; const rid = al[arg.toLowerCase().replace(/\s+/g, '')]; if (!rid) { this.chatUI.addMessage('system', `Unknown room "${arg}"`, P.amber); return; } if (rid === 'woods') { this.enterWoods(); return; } if (rid === 'picker') { this.showPlayerPicker(); return; } if (rid === 'myroom') { const myPk = this.registry.get('playerPubkey'); const myName = this.registry.get('playerName') || 'My Room'; this.enterRoom(`myroom:${myPk}`, `${myName}'s Room`, P.teal, myPk); return; } const b = ENTERABLE.find(e => e.id === rid); if (!b) return; this.enterRoom(b.id, b.name, b.neonColor); break; }
      case 'zap': { if (!arg) { this.chatUI.addMessage('system', 'Usage: /zap <name>', P.teal); return; } const auth2 = authStore.getState(); if (!auth2.pubkey || auth2.isGuest) { this.chatUI.addMessage('system', 'Login to zap', P.amber); return; } let zapTarget: string | null = null; let zapName = arg; this.otherPlayers.forEach((o, pk) => { if (o.name?.toLowerCase().includes(arg.toLowerCase())) { zapTarget = pk; zapName = o.name; } }); if (!zapTarget) { this.chatUI.addMessage('system', `"${arg}" not found`, P.amber); return; } ZapModal.show(zapTarget, zapName); break; }
      default: { if (!this.handleCommonCommand(cmd, arg)) this.chatUI.addMessage('system', `Unknown: /${cmd}`, P.amber); break; }
    }
    this.chatUI.flashLog();
  }

  // HubScene shows an in-world speech bubble above the player for emotes
  protected override handleEmoteCommand(name: string): void {
    if (this.emoteSet.isActive(name)) {
      this.emoteSet.stop(name);
      this.chatUI.addMessage('system', EMOTE_OFF_MSGS[name] ?? 'Done', P.dpurp);
      sendChat(`/emote ${name}_off`);
    } else {
      this.emoteSet.start(name);
      if (name === 'smoke') this.snd.lighterFlick();
      const flavor = EMOTE_FLAVORS[name] ?? `*${name}*`;
      ChatUI.showBubble(this, this.player.x, this.player.y - 48, flavor, P.dpurp);
      sendChat(`/emote ${name}_on`);
    }
  }
}

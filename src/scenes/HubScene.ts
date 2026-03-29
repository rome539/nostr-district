import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, WORLD_WIDTH, GROUND_Y, PLAYER_SPEED, P, ANIM, hexToNum, hexToRgb } from '../config/game.config';
import {
  connectPresence, setPresenceCallbacks, sendPosition, sendChat, sendRoomChange,
  sendRoomRequest, sendRoomResponse, requestOnlinePlayers, sendNameUpdate,
  setRoomRequestHandler, setRoomGrantedHandler, setRoomDeniedHandler, setRoomKickHandler, setOnlinePlayersHandler,
} from '../nostr/presenceService';
import { startDMSubscription, canUseDMs } from '../nostr/dmService';
import { shouldFilter, toggleMute, addBannedWord, removeBannedWord, getCustomBannedWords } from '../nostr/moderationService';
import { DMPanel } from '../ui/DMPanel';
import { FollowsPanel } from '../ui/FollowsPanel';
import { ChatUI } from '../ui/ChatUI';
import { showPlayerMenu, destroyPlayerMenu, mutedPlayers } from '../ui/PlayerMenu';
import { ProfileModal } from '../ui/ProfileModal';
import { SmokeEmote } from '../entities/SmokeEmote';
import { SettingsPanel } from '../ui/SettingsPanel';
import { renderHubSprite, renderRoomSprite } from '../entities/AvatarRenderer';
import { deserializeAvatar, getDefaultAvatar, getAvatar } from '../stores/avatarStore';
import { sendAvatarUpdate } from '../nostr/presenceService';
import { ComputerUI } from '../ui/ComputerUI';
import { authStore } from '../stores/authStore';
import { loadNostrTheme } from '../nostr/nostrThemeService';
import { LoginScreen } from '../ui/LoginScreen';
import {
  loginWithExtension, loginWithNsec, loginAsGuest,
  startBunkerFlow, loginWithBunkerUrl, cancelBunkerFlow,
} from '../nostr/nostrService';
import { getRoomConfig } from '../stores/roomStore';
import { PollBoard } from '../ui/PollBoard';

interface BuildingZone { id: string; name: string; doorX: number; neonColor: string; }

const ENTERABLE: BuildingZone[] = [
  { id: 'relay', name: 'RELAY', doorX: 180, neonColor: P.sign1 },
  { id: 'feed', name: 'THE FEED', doorX: 480, neonColor: P.pink },
  { id: 'myroom', name: 'MY ROOM', doorX: 740, neonColor: P.teal },
  { id: 'lounge', name: 'LOUNGE', doorX: 980, neonColor: P.pink },
  { id: 'market', name: 'MARKET', doorX: 1215, neonColor: P.amber },
];

interface OtherPlayer {
  sprite: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  targetX: number; targetY: number;
  name: string;
  avatar?: string;
  status?: string;
  clickZone?: Phaser.GameObjects.Zone;
  smoke?: SmokeEmote;
}

export class HubScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Image;
  private playerName!: Phaser.GameObjects.Text;
  private playerStatusText!: Phaser.GameObjects.Text;
  private playerGlow!: Phaser.GameObjects.Graphics;
  private targetX: number | null = null;
  private isMoving = false;
  private isKeyboardMoving = false;
  private walkTime = 0;
  private walkFrame = 0;
  private facingRight = true;
  private nearBuilding: BuildingZone | null = null;
  private promptText!: Phaser.GameObjects.Text;
  private promptBg!: Phaser.GameObjects.Graphics;
  private promptArrow!: Phaser.GameObjects.Text;
  private otherPlayers = new Map<string, OtherPlayer>();
  private dyingSprites = new Map<string, OtherPlayer>();

  private chatUI!: ChatUI;
  private dmPanel!: DMPanel;
  private followsPanel!: FollowsPanel;
  private playerNames = new Map<string, string>();

  private parallaxBg!: Phaser.GameObjects.Image;
  private dustParticles: { x: number; y: number; vx: number; vy: number; alpha: number; size: number; color: string }[] = [];
  private dustGraphics!: Phaser.GameObjects.Graphics;
  private neonTimer = 0;
  private neonFrame = 0;
  private onlineCount = 0;

  private shootingStar: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number } | null = null;
  private shootingStarTimer = 0;
  private shootingStarGraphics!: Phaser.GameObjects.Graphics;
  private smokeGraphics!: Phaser.GameObjects.Graphics;
  private chimneyGraphics!: Phaser.GameObjects.Graphics;
  private chimneyParticles: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number }[] = [];
  private chimneySpawnTimer = 0;
  // [worldX, chimney-cap Y] — matches BootScene fgBuildings where ri%2===0 && w>50
  // 3 chimneys on unnamed buildings: bi=0 (left), bi=2 (mid-left), bi=12 (right)
  private readonly CHIMNEYS: [number, number][] = [
    [22, GROUND_Y - 238], [318, GROUND_Y - 258], [1502, GROUND_Y - 218],
  ];
  private smokeEmote = new SmokeEmote();
  private settingsPanel = new SettingsPanel();
  private computerUI = new ComputerUI();
  private pollBoard = new PollBoard();
  private nearBulletinBoard = false;
  private readonly BULLETIN_X = 1095;

  private playerY = GROUND_Y + 8;
  private isReturning = false;
  private playerPickerEl: HTMLDivElement | null = null;
  private toastEl: HTMLDivElement | null = null;
  private waitingForAccess = false;
  private returnFromRoom: string | null = null;

  constructor() { super({ key: 'HubScene' }); }
  init(data?: any): void { this.isReturning = !!data?._returning; this.returnFromRoom = data?.fromRoom || null; this.smokeEmote.stop(); }

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
          await loginWithExtension();
          loginScreen.destroy();
          this.finishLogin();
        } catch (e: any) {
          loginScreen.setStatus(e.message, true);
        }
      },
      onNsecLogin: async (nsec: string) => {
        try {
          await loginWithNsec(nsec);
          loginScreen.destroy();
          this.finishLogin();
        } catch (e: any) {
          loginScreen.setStatus(e.message, true);
        }
      },
      onGuestLogin: async () => {
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
    if (auth.pubkey) void loadNostrTheme(auth.pubkey);
    this.startGame();
  }

  private startGame(): void {
    // Ensure registry has current auth state (covers guest + returning from room)
    const auth = authStore.getState();
    if (!this.registry.get('playerPubkey') && auth.pubkey) {
      this.registry.set('playerPubkey', auth.pubkey);
      this.registry.set('playerName', auth.displayName || 'anon');
    }
    this.parallaxBg = this.add.image(WORLD_WIDTH / 2, GAME_HEIGHT / 2, 'parallax_bg').setDepth(-2).setAlpha(0.6);
    this.add.image(WORLD_WIDTH / 2, GAME_HEIGHT / 2, 'district_bg').setDepth(-1);
    this.dustGraphics = this.add.graphics().setDepth(5); this.initDustParticles();
    this.shootingStarGraphics = this.add.graphics().setDepth(-1);
    this.chimneyGraphics = this.add.graphics().setDepth(1);
    this.smokeGraphics = this.add.graphics().setDepth(15);
    this.createPlayer(); this.createInteractPrompt(); this.createBulletinBoard();
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, GAME_HEIGHT);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setDeadzone(80, 50);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { const wx = this.cameras.main.scrollX + p.x; if (p.y < GROUND_Y - 10 || p.y > 455) return; this.targetX = Phaser.Math.Clamp(wx, 20, WORLD_WIDTH - 20); this.isMoving = true; });
    this.input.keyboard?.on('keydown-E', () => this.tryEnter());
    this.input.keyboard?.on('keydown-SPACE', () => this.tryEnter());
    this.connectToPresence(); this.setupRoomRequestHandlers();

    // When background profile fetch completes, update name text + presence
    const unsubProfile = authStore.subscribe(() => {
      const newName = authStore.getState().displayName;
      if (newName && newName !== this.registry.get('playerName')) {
        this.registry.set('playerName', newName);
        this.playerName?.setText(newName);
        sendNameUpdate(newName);
      }
    });
    this.events.on('shutdown', () => unsubProfile());

    this.chatUI = new ChatUI();
    const chatInput = this.chatUI.create('Chat or /terminal /dm /help...', P.teal, (cmd) => this.handleCommand(cmd));
    this.chatUI.setNameClickHandler((pubkey, name) => {
      const op = this.otherPlayers.get(pubkey);
      ProfileModal.show(pubkey, name, op?.avatar, op?.status);
    });
    this.input.keyboard?.on('keydown-ENTER', () => { if (document.activeElement !== chatInput) chatInput.focus(); });
    let ep = this.registry.get('dmPanel') as DMPanel | undefined;
    if (!ep) { ep = new DMPanel(this.registry.get('playerPubkey') || null); this.registry.set('dmPanel', ep); }
    this.dmPanel = ep;
    ProfileModal.setDMPanel(this.dmPanel);
    if (canUseDMs()) startDMSubscription();
    this.input.keyboard?.on('keydown-M', () => { if (document.activeElement === this.chatUI.getInput()) return; this.dmPanel.toggle(); });
    this.input.keyboard?.on('keydown-T', () => { if (document.activeElement === this.chatUI.getInput()) return; if (this.computerUI.isOpen()) { this.computerUI.close(); } else { this.computerUI.open((newAvatar) => { if (this.textures.exists('player')) this.textures.remove('player'); this.textures.addCanvas('player', renderHubSprite(newAvatar, 0)); this.textures.addCanvas('player_walk1', renderHubSprite(newAvatar, 1)); }, this.chatUI); } });

    let fp = this.registry.get('followsPanel') as FollowsPanel | undefined;
    if (!fp) { fp = new FollowsPanel(); this.registry.set('followsPanel', fp); }
    this.followsPanel = fp;
    this.input.keyboard?.on('keydown-G', () => { if (document.activeElement === this.chatUI.getInput()) return; this.followsPanel.toggle(); });
    this.input.keyboard?.on('keydown-S', () => { if (document.activeElement === this.chatUI.getInput()) return; this.settingsPanel.toggle(); });
    this.input.keyboard?.on('keydown-B', () => { if (document.activeElement === this.chatUI.getInput()) return; this.pollBoard.toggle(); });
    this.cameras.main.fadeIn(400, 10, 0, 20);
    this.settingsPanel.create();
    this.events.on('shutdown', () => { this.chatUI.destroy(); this.settingsPanel.destroy(); this.computerUI.close(); this.pollBoard.destroy(); this.chimneyGraphics?.destroy(); this.chimneyParticles = []; if (this.playerPickerEl) { this.playerPickerEl.remove(); this.playerPickerEl = null; } if (this.toastEl) { this.toastEl.remove(); this.toastEl = null; } if (this.dmPanel) this.dmPanel.close(); if (this.followsPanel) this.followsPanel.close(); destroyPlayerMenu(); ProfileModal.destroy(); this.otherPlayers.forEach(o => { o.sprite.destroy(); o.nameText.destroy(); if (o.clickZone) o.clickZone.destroy(); }); this.otherPlayers.clear(); });
  }

  update(time: number, delta: number): void {
    this.updateMovement(); this.updateProximity(); this.updateParallax();
    this.updateDustParticles(delta); this.updateNeonFlicker(delta); this.updatePlayerGlow(time); this.updateShootingStar(delta);
    this.updateChimneySmoke(delta);

    // Walk animation — bob up/down and alternate leg frame
    const isWalking = this.isKeyboardMoving || this.isMoving || this.targetX !== null;
    if (isWalking) {
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

    // Update other players' walk bob
    this.otherPlayers.forEach((o) => {
      if (Math.abs(o.targetX - o.sprite.x) > 3) {
        const bob = Math.abs(Math.sin(time * Math.PI / 150)) * -2;
        o.sprite.y = this.playerY + bob;
      } else {
        o.sprite.y = this.playerY;
      }
    });

    this.smokeGraphics.clear();
    if (this.smokeEmote.active) { if (isWalking) this.smokeEmote.stop(); else this.smokeEmote.update(this.smokeGraphics, delta, this.player.x, this.player.y, this.facingRight, 'hub'); }
    this.playerName.setPosition(this.player.x, this.player.y - 44);
    this.playerStatusText.setPosition(this.player.x, this.player.y - 59);
    sendPosition(this.player.x, this.player.y);
    this.otherPlayers.forEach(o => {
      if (Math.abs(o.targetX - o.sprite.x) > 1) o.sprite.x += (o.targetX - o.sprite.x) * 0.12;
      if (Math.abs(o.targetY - o.sprite.y) > 1) o.sprite.y += (o.targetY - o.sprite.y) * 0.12;
      o.nameText.setPosition(o.sprite.x, o.sprite.y - 44);
      o.statusText.setPosition(o.sprite.x, o.sprite.y - 59);
      if (o.clickZone) o.clickZone.setPosition(o.sprite.x, o.sprite.y - 20);
      if (o.smoke?.active) o.smoke.update(this.smokeGraphics, delta, o.sprite.x, o.sprite.y, true, 'hub');
    });
  }

  // ── Room Requests ──
  private setupRoomRequestHandlers(): void {
    setRoomRequestHandler((rp, rn) => this.showRoomRequestToast(rp, rn));
    setRoomGrantedHandler((op, on, room, roomConfig) => { this.waitingForAccess = false; this.chatUI.addMessage('system', `${on} accepted!`, P.teal); this.enterRoom(room, `${on}'s Room`, P.teal, op, roomConfig); });
    setRoomDeniedHandler((r) => { this.waitingForAccess = false; this.chatUI.addMessage('system', r || 'Denied', P.amber); });
    setRoomKickHandler((r) => { this.chatUI.addMessage('system', r || 'Removed from room', P.amber); });
  }
  private showRoomRequestToast(rp: string, rn: string): void {
    if (this.toastEl) this.toastEl.remove();
    const esc = (s: string) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    this.toastEl = document.createElement('div');
    this.toastEl.style.cssText = `position:fixed;top:20px;right:20px;z-index:3000;background:linear-gradient(135deg,${P.bg},#0e0828);border:1px solid ${P.teal}55;border-radius:10px;padding:16px 20px;font-family:'Courier New',monospace;box-shadow:0 4px 20px rgba(0,0,0,0.6);max-width:300px;`;
    this.toastEl.innerHTML = `<div style="color:${P.teal};font-size:14px;font-weight:bold;margin-bottom:10px;">Room Request</div><div style="color:${P.lcream};font-size:13px;margin-bottom:14px;"><strong>${esc(rn)}</strong> wants to enter</div><div style="display:flex;gap:8px;"><button id="ta" style="flex:1;padding:8px;background:${P.teal}33;border:1px solid ${P.teal}66;border-radius:6px;color:${P.teal};font-size:13px;cursor:pointer;font-weight:bold;">Accept</button><button id="td" style="flex:1;padding:8px;background:${P.red}22;border:1px solid ${P.red}44;border-radius:6px;color:${P.red};font-size:13px;cursor:pointer;">Deny</button></div>`;
    document.body.appendChild(this.toastEl);
    this.toastEl.querySelector('#ta')!.addEventListener('click', () => { sendRoomResponse(rp, true, JSON.stringify(getRoomConfig())); this.toastEl?.remove(); this.toastEl = null; });
    this.toastEl.querySelector('#td')!.addEventListener('click', () => { sendRoomResponse(rp, false); this.toastEl?.remove(); this.toastEl = null; });
    setTimeout(() => { if (this.toastEl) { sendRoomResponse(rp, false); this.toastEl.remove(); this.toastEl = null; } }, 30000);
  }

  // ── Player Picker ──
  private showPlayerPicker(): void {
    if (this.playerPickerEl) { this.playerPickerEl.remove(); this.playerPickerEl = null; }
    const esc = (s: string) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    const myPk = this.registry.get('playerPubkey'); const myName = this.registry.get('playerName') || 'My Room';
    this.playerPickerEl = document.createElement('div');
    this.playerPickerEl.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:3000;background:linear-gradient(180deg,var(--nd-bg),var(--nd-navy));border:1px solid color-mix(in srgb,var(--nd-dpurp) 33%,transparent);border-radius:10px;padding:20px 24px;font-family:'Courier New',monospace;box-shadow:0 8px 30px rgba(0,0,0,0.7);min-width:300px;max-width:360px;`;
    this.playerPickerEl.innerHTML = `<div style="color:var(--nd-accent);font-size:15px;font-weight:bold;margin-bottom:14px;text-align:center;">MY ROOM</div><button class="pe" style="width:100%;padding:10px;margin-bottom:12px;background:color-mix(in srgb,var(--nd-accent) 13%,transparent);border:1px solid color-mix(in srgb,var(--nd-accent) 33%,transparent);border-radius:6px;color:var(--nd-accent);font-size:13px;cursor:pointer;font-weight:bold;">Enter ${esc(myName)}'s Room</button><div style="color:var(--nd-subtext);font-size:12px;margin-bottom:10px;text-align:center;">\u2014 or visit someone \u2014</div><input class="ps" type="text" placeholder="Search..." style="width:100%;padding:8px 12px;margin-bottom:10px;background:color-mix(in srgb,var(--nd-bg) 80%,transparent);border:1px solid color-mix(in srgb,var(--nd-dpurp) 27%,transparent);border-radius:6px;color:var(--nd-text);font-size:13px;outline:none;box-sizing:border-box;"/><div class="pl" style="max-height:200px;overflow-y:auto;border:1px solid color-mix(in srgb,var(--nd-dpurp) 13%,transparent);border-radius:6px;"></div><button class="pc" style="width:100%;padding:8px;margin-top:12px;background:none;border:1px solid color-mix(in srgb,var(--nd-dpurp) 27%,transparent);border-radius:6px;color:var(--nd-subtext);font-size:12px;cursor:pointer;">Cancel</button>`;
    document.body.appendChild(this.playerPickerEl);
    this.playerPickerEl.querySelector('.pe')!.addEventListener('click', () => { this.closePlayerPicker(); this.enterRoom(`myroom:${myPk}`, `${myName}'s Room`, P.teal, myPk); });
    this.playerPickerEl.querySelector('.pc')!.addEventListener('click', () => this.closePlayerPicker());
    const si = this.playerPickerEl.querySelector('.ps') as HTMLInputElement;
    si.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.closePlayerPicker(); });
    const eh = (e: KeyboardEvent) => { if (e.key === 'Escape') this.closePlayerPicker(); };
    document.addEventListener('keydown', eh); (this.playerPickerEl as any)._eh = eh;
    const ll = this.playerPickerEl.querySelector('.pl') as HTMLDivElement;
    ll.innerHTML = `<div style="color:var(--nd-subtext);font-size:12px;text-align:center;padding:12px;">Loading...</div>`;
    let ap: { pubkey: string; name: string }[] = [];
    const rl = (f: string) => { const fl = f ? ap.filter(p => p.name.toLowerCase().includes(f.toLowerCase())) : ap; if (!fl.length) { ll.innerHTML = `<div style="color:var(--nd-subtext);font-size:12px;text-align:center;padding:12px;">${f ? 'No matches' : 'No players online'}</div>`; return; } ll.innerHTML = fl.map(p => `<div class="pp" data-pk="${p.pubkey}" style="padding:10px 14px;border-bottom:1px solid color-mix(in srgb,var(--nd-dpurp) 8%,transparent);cursor:pointer;display:flex;justify-content:space-between;align-items:center;"><span style="color:var(--nd-text);font-size:13px;">${esc(p.name)}</span><span style="color:var(--nd-accent);font-size:11px;opacity:0.6;">Request \u2192</span></div>`).join(''); ll.querySelectorAll('.pp').forEach(el => { el.addEventListener('mouseenter', () => (el as HTMLElement).style.background = `color-mix(in srgb,var(--nd-dpurp) 10%,transparent)`); el.addEventListener('mouseleave', () => (el as HTMLElement).style.background = 'transparent'); el.addEventListener('click', () => { const pk = (el as HTMLElement).dataset.pk; if (pk) { this.closePlayerPicker(); this.requestRoomAccess(pk); } }); }); };
    si.addEventListener('input', () => rl(si.value));
    setOnlinePlayersHandler((p) => { setOnlinePlayersHandler(null); ap = p; rl(si.value); }); requestOnlinePlayers();
  }
  private closePlayerPicker(): void { if (this.playerPickerEl) { const h = (this.playerPickerEl as any)._eh; if (h) document.removeEventListener('keydown', h); this.playerPickerEl.remove(); this.playerPickerEl = null; } setOnlinePlayersHandler(null); }
  private requestRoomAccess(op: string): void { this.chatUI.addMessage('system', `Requesting access...`, P.teal); this.waitingForAccess = true; sendRoomRequest(op); setTimeout(() => { if (this.waitingForAccess) { this.waitingForAccess = false; this.chatUI.addMessage('system', 'Timed out', P.amber); } }, 30000); }
  private enterRoom(rid: string, rn: string, nc: string, op?: string, ownerRoomConfig?: string): void {
    this.chatUI.destroy(); const f = this.add.graphics().setDepth(200); const rgb = hexToRgb(nc); f.fillStyle(Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b), 0.35); f.fillRect(this.cameras.main.scrollX, 0, GAME_WIDTH, GAME_HEIGHT);
    const f2 = this.add.graphics().setDepth(201); f2.fillStyle(0xffffff, 0.15); f2.fillRect(this.cameras.main.scrollX, 0, GAME_WIDTH, GAME_HEIGHT);
    this.tweens.add({ targets: [f, f2], alpha: 0, duration: ANIM.enterFlashDuration, ease: 'Quad.easeOut', onComplete: () => { f.destroy(); f2.destroy(); this.scene.start('RoomScene', { id: rid, name: rn, neonColor: nc, ownerPubkey: op, ownerRoomConfig }); } });
  }

  // ── Presence ──
  private connectToPresence(): void {
    const cb = {
      onPlayerJoin: (p: any) => { const mk = this.registry.get('playerPubkey'); if (p.pubkey === mk || this.otherPlayers.has(p.pubkey)) return; this.addOtherPlayer(p.pubkey, p.name, p.x, p.y, p.avatar, p.status); sendAvatarUpdate(); },
      onPlayerMove: (pk: string, x: number, y: number) => { const o = this.otherPlayers.get(pk); if (o) { o.targetX = x; o.targetY = y; } },
      onPlayerLeave: (pk: string) => this.removeOtherPlayer(pk),
      onCountUpdate: (c: number) => { this.onlineCount = c; },
      onChat: (pk: string, name: string, text: string) => {
        const isMe = pk === this.registry.get('playerPubkey');
        if (!isMe && text === '/emote smoke_on') { const o = this.otherPlayers.get(pk); if (o) { if (!o.smoke) o.smoke = new SmokeEmote(); o.smoke.start(); ChatUI.showBubble(this, o.sprite.x, o.sprite.y - 48, '*lights a cigarette*', P.dpurp); } if (!mutedPlayers.has(pk)) this.chatUI.addMessage(name, '*lights a cigarette*', P.dpurp, pk); return; }
        if (!isMe && text === '/emote smoke_off') { const o = this.otherPlayers.get(pk); if (o?.smoke) o.smoke.stop(); return; }
        if (isMe && text.startsWith('/emote ')) return;
        if (!isMe && mutedPlayers.has(pk)) return;
        if (!isMe && shouldFilter(text)) return;
        this.chatUI.addMessage(name, text, isMe ? P.teal : P.lpurp, pk);
        if (isMe) ChatUI.showBubble(this, this.player.x, this.player.y - 48, text, P.teal);
        else { const o = this.otherPlayers.get(pk); if (o) ChatUI.showBubble(this, o.sprite.x, o.sprite.y - 48, text, P.lpurp); }
      },
      onAvatarUpdate: (pk: string, avatarStr: string) => {
        const o = this.otherPlayers.get(pk); if (!o) return;
        o.avatar = avatarStr;
        const avatarConfig = deserializeAvatar(avatarStr) || getDefaultAvatar();
        const texKey = `avatar_hub_${pk}`;
        if (this.textures.exists(texKey)) this.textures.remove(texKey);
        this.textures.addCanvas(texKey, renderHubSprite(avatarConfig));
        o.sprite.setTexture(texKey).setTint(0xffffff);
      },
      onNameUpdate: (pk: string, name: string) => {
        const o = this.otherPlayers.get(pk); if (!o) return;
        o.name = name;
        o.nameText.setText(name.slice(0, 14));
      },
      onStatusUpdate: (pk: string, status: string) => {
        const o = this.otherPlayers.get(pk); if (!o) return;
        o.status = status;
        o.statusText.setText(status.slice(0, 30));
        o.statusText.setAlpha(status ? 1 : 0);
      },
    };
    if (!this.isReturning) connectPresence(cb);
    else { setPresenceCallbacks(cb); sendRoomChange('hub', 400, GROUND_Y + 8); if (this.smokeEmote.active) this.time.delayedCall(500, () => sendChat('/emote smoke_on')); }
  }

  // ── Other Players ──
  private addOtherPlayer(pk: string, name: string, px: number, py: number, avatarStr?: string, status?: string): void {
    // If a dying sprite for this pk is still fading out, destroy it immediately
    // before we remove its texture — otherwise glTexture becomes null and crashes WebGL
    const dying = this.dyingSprites.get(pk);
    if (dying) {
      this.tweens.killTweensOf([dying.sprite, dying.nameText, dying.statusText]);
      dying.sprite.destroy(); dying.nameText.destroy(); dying.statusText.destroy(); if (dying.clickZone) dying.clickZone.destroy();
      this.dyingSprites.delete(pk);
    }
    const texKey = `avatar_hub_${pk}`;
    const avatarConfig = avatarStr ? (deserializeAvatar(avatarStr) || getDefaultAvatar()) : getDefaultAvatar();
    if (this.textures.exists(texKey)) this.textures.remove(texKey);
    this.textures.addCanvas(texKey, renderHubSprite(avatarConfig));
    const sp = this.add.image(px, py, texKey).setOrigin(0.5, 1).setScale(1).setDepth(8);
    if (!avatarStr) {
      const h = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      sp.setTint([0xe87aab, 0x7b68ee, 0x5dcaa5, 0x6a4888, 0x4a6080][h % 5]);
    }
    const nt = this.add.text(px, py - 44, name.slice(0, 14), { fontFamily: '"Courier New", monospace', fontSize: '10px', color: P.lcream, align: 'center', backgroundColor: '#0a0014bb', padding: { x: 4, y: 2 } }).setOrigin(0.5).setDepth(9);
    const statusStr = (status || '').slice(0, 30);
    const st = this.add.text(px, py - 59, statusStr, { fontFamily: '"Courier New", monospace', fontSize: '9px', color: P.lpurp, align: 'center' }).setOrigin(0.5).setDepth(9).setAlpha(statusStr ? 1 : 0);
    this.otherPlayers.set(pk, { sprite: sp, nameText: nt, statusText: st, targetX: px, targetY: py, name: name.slice(0, 14), avatar: avatarStr, status: status || '' });
    this.playerNames.set(pk, name.slice(0, 14)); this.playerNames.set(name.toLowerCase(), pk);
    const cz = this.add.zone(px, py - 20, 24, 44).setInteractive({ useHandCursor: true }).setDepth(12);
    cz.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      ptr.event.stopPropagation();
      const op2 = this.otherPlayers.get(pk);
      showPlayerMenu(pk, name.slice(0, 14), ptr.x, ptr.y, { onChat: (t, c) => this.chatUI.addMessage('system', t, c), getDMPanel: () => this.dmPanel }, op2?.avatar, op2?.status);
    });
    const op = this.otherPlayers.get(pk); if (op) op.clickZone = cz;
  }
  private removeOtherPlayer(pk: string): void {
    const o = this.otherPlayers.get(pk); if (!o) return;
    this.otherPlayers.delete(pk);
    const n = this.playerNames.get(pk); if (n) this.playerNames.delete(n.toLowerCase()); this.playerNames.delete(pk);
    this.dyingSprites.set(pk, o);
    this.tweens.add({ targets: [o.sprite, o.nameText, o.statusText], alpha: 0, duration: 300, onComplete: () => {
      o.sprite.destroy(); o.nameText.destroy(); o.statusText.destroy(); if (o.clickZone) o.clickZone.destroy();
      this.dyingSprites.delete(pk);
    }});
  }

  // ── Visuals ──
  private updateParallax(): void { this.parallaxBg.x = WORLD_WIDTH / 2 - this.cameras.main.scrollX * ANIM.parallaxFactor; }
  private initDustParticles(): void { const c = [P.pink, P.purp, P.amber, P.teal, P.lcream]; for (let i = 0; i < 40; i++) this.dustParticles.push({ x: Math.random() * WORLD_WIDTH, y: 50 + Math.random() * (GROUND_Y - 60), vx: -0.1 + Math.random() * 0.2, vy: -0.05 + Math.random() * 0.1, alpha: 0.05 + Math.random() * 0.12, size: Math.random() > 0.8 ? 2 : 1, color: c[Math.floor(Math.random() * c.length)] }); }
  private updateDustParticles(d: number): void { this.dustGraphics.clear(); const dt = d / 16; this.dustParticles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; if (p.x < 0) p.x = WORLD_WIDTH; if (p.x > WORLD_WIDTH) p.x = 0; if (p.y < 40) p.y = GROUND_Y - 20; if (p.y > GROUND_Y - 10) p.y = 50; const rgb = hexToRgb(p.color); this.dustGraphics.fillStyle(Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b), p.alpha); this.dustGraphics.fillRect(p.x, p.y, p.size, p.size); }); }
  private updateShootingStar(d: number): void {
    this.shootingStarGraphics.clear();
    if (!this.shootingStar) {
      this.shootingStarTimer += d;
      if (this.shootingStarTimer > 8000 + Math.random() * 12000) {
        this.shootingStarTimer = 0;
        const goRight = Math.random() > 0.5;
        this.shootingStar = {
          x: goRight ? Math.random() * WORLD_WIDTH * 0.4 : WORLD_WIDTH * 0.6 + Math.random() * WORLD_WIDTH * 0.4,
          y: 8 + Math.random() * 35,
          vx: goRight ? 4.5 + Math.random() * 3 : -(4.5 + Math.random() * 3),
          vy: 1.2 + Math.random() * 1.4,
          life: 0,
          maxLife: 450 + Math.random() * 350,
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
    // Wide glow trail (outer layer)
    for (let i = 1; i <= 10; i++) {
      const tx = s.x - s.vx * i * 2.0;
      const ty = s.y - s.vy * i * 2.0;
      const ta = a * (0.22 - i * 0.018);
      if (ta > 0) { this.shootingStarGraphics.fillStyle(0xc8b8ff, ta); this.shootingStarGraphics.fillRect(tx - 1, ty, 3, 2); }
    }
    // Bright core trail
    for (let i = 1; i <= 10; i++) {
      const tx = s.x - s.vx * i * 1.8;
      const ty = s.y - s.vy * i * 1.8;
      const ta = a * (0.65 - i * 0.06);
      if (ta > 0) { this.shootingStarGraphics.fillStyle(i < 4 ? 0xfff5e6 : 0xb8a8f8, ta); this.shootingStarGraphics.fillRect(tx, ty, i < 4 ? 2 : 1, 1); }
    }
    // Head with bloom layers
    this.shootingStarGraphics.fillStyle(0xddd0ff, a * 0.2);
    this.shootingStarGraphics.fillRect(s.x - 2, s.y - 2, 6, 6);
    this.shootingStarGraphics.fillStyle(0xffffff, a * 0.5);
    this.shootingStarGraphics.fillRect(s.x - 1, s.y - 1, 4, 4);
    this.shootingStarGraphics.fillStyle(0xffffff, a * 0.95);
    this.shootingStarGraphics.fillRect(s.x, s.y, 2, 2);
    if (s.life >= s.maxLife || s.y > 130 || s.x < -20 || s.x > WORLD_WIDTH + 20) this.shootingStar = null;
  }
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
    let sx = 400; if (this.returnFromRoom) { const d = ENTERABLE.find(e => e.id === this.returnFromRoom || (this.returnFromRoom?.startsWith('myroom') && e.id === 'myroom')); if (d) sx = d.doorX; }
    this.player = this.add.image(sx, this.playerY, 'player').setOrigin(0.5, 1).setScale(1).setDepth(10);
    const n = this.registry.get('playerName') || 'guest';
    this.playerName = this.add.text(sx, this.playerY - 44, n, { fontFamily: '"Courier New", monospace', fontSize: '10px', color: P.teal, align: 'center', backgroundColor: '#0a0014bb', padding: { x: 4, y: 2 } }).setOrigin(0.5).setDepth(11);
    const myStatus = localStorage.getItem('nd_status') || '';
    this.playerStatusText = this.add.text(sx, this.playerY - 59, myStatus, { fontFamily: '"Courier New", monospace', fontSize: '9px', color: P.lpurp, align: 'center' }).setOrigin(0.5).setDepth(11).setAlpha(myStatus ? 1 : 0);
    this.generateWalkFrames(getAvatar());
  }

  private generateWalkFrames(avatar = getAvatar()): void {
    if (this.textures.exists('player_walk0')) this.textures.remove('player_walk0');
    if (this.textures.exists('player_walk1')) this.textures.remove('player_walk1');
    this.textures.addCanvas('player_walk0', renderHubSprite(avatar, 0));
    this.textures.addCanvas('player_walk1', renderHubSprite(avatar, 1));
  }
  private updateMovement(): void { const c = this.input.keyboard?.createCursorKeys(); let vx = 0; if (c) { if (c.left.isDown) vx = -PLAYER_SPEED; else if (c.right.isDown) vx = PLAYER_SPEED; } this.isKeyboardMoving = vx !== 0; if (vx !== 0) { this.targetX = null; this.isMoving = false; this.player.x += vx / 60; this.facingRight = vx > 0; } else if (this.isMoving && this.targetX !== null) { const dx = this.targetX - this.player.x; if (Math.abs(dx) < 3) { this.isMoving = false; this.targetX = null; } else { this.player.x += Math.sign(dx) * PLAYER_SPEED / 60; this.facingRight = dx > 0; } } this.player.x = Phaser.Math.Clamp(this.player.x, 20, WORLD_WIDTH - 20); this.player.setFlipX(!this.facingRight); }
  private updateProximity(): void {
    // Check bulletin board first
    const bdist = Math.abs(this.player.x - this.BULLETIN_X);
    const wasNearBoard = this.nearBulletinBoard;
    this.nearBulletinBoard = bdist < 52;
    if (this.nearBulletinBoard !== wasNearBoard) {
      if (this.nearBulletinBoard) {
        const px = this.BULLETIN_X; const py = GROUND_Y - 75;
        this.promptBg.setVisible(true); this.promptText.setVisible(true); this.promptArrow.setVisible(true);
        this.promptBg.setPosition(px - 62, py - 2);
        this.promptText.setPosition(px, py + 8); this.promptText.setText('[E] View Polls'); this.promptText.setColor(P.amber);
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
    if (f !== this.nearBuilding) { this.nearBuilding = f; if (f) { this.promptBg.setVisible(true); this.promptText.setVisible(true); this.promptArrow.setVisible(true); const px = f.doorX; const py = GROUND_Y - 75; this.promptBg.setPosition(px - 62, py - 2); this.promptText.setPosition(px, py + 8); this.promptText.setText(`[E] Enter ${f.name}`); this.promptText.setColor(f.neonColor); this.promptArrow.setPosition(px, py + 22); this.promptArrow.setColor(f.neonColor); this.tweens.add({ targets: this.promptArrow, y: py + 26, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }); } else { this.promptBg.setVisible(false); this.promptText.setVisible(false); this.promptArrow.setVisible(false); this.tweens.killTweensOf(this.promptArrow); } }
  }
  private createInteractPrompt(): void { this.promptBg = this.add.graphics(); this.promptBg.fillStyle(hexToNum(P.bg), 0.88); this.promptBg.fillRoundedRect(0, 0, 124, 28, 5); this.promptBg.lineStyle(1, hexToNum(P.dpurp), 0.4); this.promptBg.strokeRoundedRect(0, 0, 124, 28, 5); this.promptBg.setDepth(50); this.promptBg.setVisible(false); this.promptText = this.add.text(0, 0, '', { fontFamily: '"Courier New", monospace', fontSize: '10px', color: P.teal, fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(51); this.promptText.setVisible(false); this.promptArrow = this.add.text(0, 0, '\u25BC', { fontFamily: 'monospace', fontSize: '9px', color: P.teal, align: 'center' }).setOrigin(0.5).setDepth(51); this.promptArrow.setVisible(false); }
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

  private tryEnter(): void {
    if (this.nearBulletinBoard) { this.pollBoard.toggle(); return; }
    if (!this.nearBuilding) return;
    this.isMoving = false; this.targetX = null;
    if (this.nearBuilding.id === 'myroom') { this.showPlayerPicker(); return; }
    this.enterRoom(this.nearBuilding.id, this.nearBuilding.name, this.nearBuilding.neonColor);
  }

  // ── Commands ──
  private handleCommand(text: string): void {
    const parts = text.slice(1).split(' '); const cmd = parts[0].toLowerCase(); const arg = parts.slice(1).join(' ').trim();
    switch (cmd) {
      case 'dm': { if (!canUseDMs()) { this.chatUI.addMessage('system', 'DMs need a key', P.amber); return; } if (!arg) { const ps: string[] = []; this.otherPlayers.forEach(o => ps.push(o.name)); this.chatUI.addMessage('system', ps.length ? `Online: ${ps.join(', ')}` : 'No players online', P.teal); return; } let tp: string | null = null; const tn = arg.toLowerCase(); this.otherPlayers.forEach((o, pk) => { if (o.name?.toLowerCase().includes(tn)) tp = pk; }); if (tp) { this.dmPanel.open(tp); this.chatUI.addMessage('system', 'Opening DM...', P.teal); } else this.chatUI.addMessage('system', `"${arg}" not found`, P.amber); break; }
      case 'visit': { if (!arg) return; let tp: string | null = null; this.otherPlayers.forEach((o, pk) => { if (o.name?.toLowerCase().includes(arg.toLowerCase())) tp = pk; }); if (tp) this.requestRoomAccess(tp); else this.chatUI.addMessage('system', `"${arg}" not found`, P.amber); break; }
      case 'players': case 'who': case 'online': { const ps: string[] = []; this.otherPlayers.forEach(o => ps.push(o.name)); this.chatUI.addMessage('system', ps.length ? `${ps.length} online: ${ps.join(', ')}` : 'No players online', P.teal); break; }
      case 'tp': case 'teleport': case 'go': { if (!arg) { this.chatUI.addMessage('system', 'Rooms: relay, feed, myroom, lounge, market', P.teal); return; } const al: Record<string, string> = { relay:'relay', feed:'feed', thefeed:'feed', myroom:'myroom', room:'myroom', my:'myroom', lounge:'lounge', rooftop:'lounge', market:'market', shop:'market', store:'market' }; const rid = al[arg.toLowerCase().replace(/\s+/g, '')]; if (!rid) { this.chatUI.addMessage('system', `Unknown room "${arg}"`, P.amber); return; } const b = ENTERABLE.find(e => e.id === rid); if (!b) return; if (rid === 'myroom') this.showPlayerPicker(); else this.enterRoom(b.id, b.name, b.neonColor); break; }
      case 'mute': { const s = toggleMute(); this.chatUI.addMessage('system', s ? 'Chat muted' : 'Unmuted', s ? P.amber : P.teal); break; }
      case 'filter': { if (!arg) { const w = getCustomBannedWords(); this.chatUI.addMessage('system', w.length ? `Filtered: ${w.join(', ')}` : 'No filters', P.teal); return; } addBannedWord(arg); this.chatUI.addMessage('system', `Added "${arg}"`, P.teal); break; }
      case 'unfilter': { if (!arg) return; removeBannedWord(arg); this.chatUI.addMessage('system', `Removed "${arg}"`, P.teal); break; }
      case 'smoke': { if (this.smokeEmote.active) { this.smokeEmote.stop(); this.chatUI.addMessage('system', 'Put it out', P.dpurp); sendChat('/emote smoke_off'); } else { this.smokeEmote.start(); ChatUI.showBubble(this, this.player.x, this.player.y - 48, '*lights a cigarette*', P.dpurp); sendChat('/emote smoke_on'); } break; }
      case 'terminal': case 'wardrobe': case 'outfit': case 'avatar': {
        if (this.computerUI.isOpen()) { this.computerUI.close(); return; }
        this.computerUI.open(
          (newAvatar) => {
            if (this.textures.exists('player')) this.textures.remove('player');
            this.textures.addCanvas('player', renderHubSprite(newAvatar));
            this.player.setTexture('player');
            this.generateWalkFrames(newAvatar);
            if (this.textures.exists('player_room')) this.textures.remove('player_room');
            this.textures.addCanvas('player_room', renderRoomSprite(newAvatar));
            sendAvatarUpdate();
          },
          (newName) => {
            this.registry.set('playerName', newName);
            this.playerName.setText(newName);
            sendNameUpdate(newName);
          }
        );
        this.chatUI.addMessage('system', 'Terminal opened', P.teal);
        break;
      }
      case 'polls': { this.pollBoard.toggle(); break; }
      case 'flip': case 'coin': {
        const result = Math.random() < 0.5 ? '👑 HEADS' : '🦅 TAILS';
        sendChat(`🪙 flipped a coin: ${result}`);
        break;
      }
      case '8ball': {
        if (!arg) { this.chatUI.addMessage('system', 'Usage: /8ball <question>', P.teal); return; }
        const responses = [
          'It is certain.', 'Without a doubt.', 'Yes, definitely.', 'You may rely on it.',
          'As I see it, yes.', 'Most likely.', 'Outlook good.', 'Signs point to yes.',
          'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.',
          'Cannot predict now.', 'Concentrate and ask again.',
          "Don't count on it.", 'My reply is no.', 'My sources say no.',
          'Outlook not so good.', 'Very doubtful.', 'Absolutely not.', 'The stars say no.',
        ];
        const answer = responses[Math.floor(Math.random() * responses.length)];
        sendChat(`🎱 ${arg} — ${answer}`);
        break;
      }
      case 'follows': case 'following': case 'friends': { this.followsPanel.toggle(); break; }
      case 'status': { const myStatus = localStorage.getItem('nd_status') || '(none)'; this.chatUI.addMessage('system', `Your status: ${myStatus}`, P.teal); break; }
      case 'help': case '?': { this.chatUI.addMessage('system', 'Commands:', P.teal); ['/tp <room>', '/dm <n>', '/visit <n>', '/players', '/smoke', '/terminal', '/follows', '/polls', '/flip', '/8ball <q>', '/mute', '/filter <w>', '/status'].forEach(h => this.chatUI.addMessage('system', h, P.lpurp)); break; }
      default: this.chatUI.addMessage('system', `Unknown: /${cmd}`, P.amber);
    }
    this.chatUI.flashLog();
  }
}

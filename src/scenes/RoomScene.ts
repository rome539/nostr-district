import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, P, ANIM, hexToNum, hexToRgb } from '../config/game.config';
import {
  setPresenceCallbacks, sendPosition, sendChat, sendRoomChange,
  sendRoomResponse, setRoomRequestHandler, setRoomKickHandler, sendRoomRequest,
  setRoomGrantedHandler, setRoomDeniedHandler, requestOnlinePlayers, setOnlinePlayersHandler,
} from '../nostr/presenceService';
import { shouldFilter, toggleMute, addBannedWord, removeBannedWord, getCustomBannedWords } from '../nostr/moderationService';
import { popFeedNote, FeedEvent, getEventRate } from '../nostr/feedService';
import { canUseDMs, getRelayManager } from '../nostr/dmService';
import { DEFAULT_RELAYS } from '../nostr/relayManager';
import { DMPanel } from '../ui/DMPanel';
import { ChatUI } from '../ui/ChatUI';
import { showPlayerMenu, destroyPlayerMenu, mutedPlayers } from '../ui/PlayerMenu';
import { ProfileModal } from '../ui/ProfileModal';
import { SmokeEmote } from '../entities/SmokeEmote';
import { PetSprite } from '../entities/PetSprite';
import { FollowsPanel } from '../ui/FollowsPanel';
import { RoomRenderer } from '../rooms/RoomRenderer';
import { SettingsPanel } from '../ui/SettingsPanel';
import { renderRoomSprite, renderHubSprite } from '../entities/AvatarRenderer';
import { deserializeAvatar, getDefaultAvatar, getAvatar, setAvatar, AvatarConfig } from '../stores/avatarStore';
import { sendAvatarUpdate, sendNameUpdate } from '../nostr/presenceService';
import { ComputerUI } from '../ui/ComputerUI';
import { authStore } from '../stores/authStore';
import { isFirstVisit, markSetupComplete, getRoomConfig, RoomConfig } from '../stores/roomStore';
import { getPet, setPet, getPetPaths, petTexKey, PET_FRAME_SIZE, PetSelection, getAnimSpecs } from '../stores/petStore';

interface RoomSceneConfig { id: string; name: string; neonColor: string; ownerPubkey?: string; ownerRoomConfig?: string; }
interface FeedNote { npub: string; text: string; color: string; y: number; targetY: number; alpha: number; age: number; npubText?: Phaser.GameObjects.Text; msgText?: Phaser.GameObjects.Text; }
interface OtherPlayer { sprite: Phaser.GameObjects.Image; nameText: Phaser.GameObjects.Text; statusText: Phaser.GameObjects.Text; targetX: number; targetY: number; avatar?: string; status?: string; clickZone?: Phaser.GameObjects.Zone; smoke?: SmokeEmote; walkFrame: number; walkTimer: number; }

export class RoomScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Image;
  private playerName!: Phaser.GameObjects.Text;
  private playerStatusText!: Phaser.GameObjects.Text;
  private targetX: number | null = null;
  private isMoving = false;
  private facingRight = true;
  private roomConfig!: RoomSceneConfig;
  private playerY = 420;
  private otherPlayers = new Map<string, OtherPlayer>();
  private dyingSprites = new Map<string, OtherPlayer>();
  private isOwner = false;
  private waitingForAccess = false;
  private toastEl: HTMLDivElement | null = null;

  private chatUI!: ChatUI;
  private dmPanel!: DMPanel;
  private followsPanel!: FollowsPanel;
  private smokeGraphics!: Phaser.GameObjects.Graphics;
  private smokeEmote = new SmokeEmote();
  private settingsPanel = new SettingsPanel();
  private computerUI = new ComputerUI();
  private roomRenderer = new RoomRenderer();
  private pet: PetSprite | null = null;
  private computerPrompt!: Phaser.GameObjects.Text;
  private computerPromptBg!: Phaser.GameObjects.Graphics;
  private nearComputer = false;
  private roomBgImage!: Phaser.GameObjects.Image;
  private stickyNoteGroup: Phaser.GameObjects.Group | null = null;
  private stickyNoteOverlay: HTMLDivElement | null = null;

  // Walk animation
  private walkFrame = 0;
  private walkTimer = 0;
  private isWalking = false;

  // First-time intro state
  private introActive = false;
  private introOverlay: Phaser.GameObjects.Graphics | null = null;
  private introText: Phaser.GameObjects.Text | null = null;

  // Animated elements
  private ledGraphics!: Phaser.GameObjects.Graphics;
  private ambientGraphics!: Phaser.GameObjects.Graphics;
  private feedGraphics!: Phaser.GameObjects.Graphics;
  private loungeGraphics!: Phaser.GameObjects.Graphics;
  private feedNotes: FeedNote[] = [];

  // Relay room status UI
  private relayStatusLines: { dot: Phaser.GameObjects.Graphics; lat: Phaser.GameObjects.Text }[] = [];
  private relayHeaderText: Phaser.GameObjects.Text | null = null;
  private relayCountText: Phaser.GameObjects.Text | null = null;
  private relayEventsText: Phaser.GameObjects.Text | null = null;
  private relayUpdateTimer = 0;
  private globalPlayerCount = 1;

  constructor() { super({ key: 'RoomScene' }); }
  init(data: RoomSceneConfig): void { this.roomConfig = data; this.feedNotes = []; this.smokeEmote.stop(); this.introActive = false; }

  preload(): void {
    const sel = getPet();
    if (sel.species === 'none') return;
    const prefix = petTexKey(sel);
    const size   = PET_FRAME_SIZE[sel.species];
    for (const spec of getAnimSpecs(sel.species)) {
      const texKey = `${prefix}-${spec.key}`;
      if (!this.textures.exists(texKey)) {
        this.load.spritesheet(texKey, `pets/${sel.species}-${sel.breed}-${spec.key}.png`, { frameWidth: size, frameHeight: size });
      }
    }
    if (!this.textures.exists('meow-vfx')) {
      this.load.spritesheet('meow-vfx', 'pets/meow-vfx.png', { frameWidth: 16, frameHeight: 16 });
    }
  }

  create(): void {
    const myPubkey = this.registry.get('playerPubkey');
    this.isOwner = this.roomConfig.id.startsWith('myroom:') && this.roomConfig.ownerPubkey === myPubkey;

    // Render room background via shared renderer
    let parsedOwnerConfig: RoomConfig | undefined;
    if (this.roomConfig.ownerRoomConfig) {
      try { parsedOwnerConfig = JSON.parse(this.roomConfig.ownerRoomConfig); } catch (_) {}
    }
    const texKey = this.roomRenderer.render(this, this.roomConfig.id, this.roomConfig.neonColor, GAME_WIDTH, GAME_HEIGHT, parsedOwnerConfig);
    this.roomBgImage = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, texKey).setDepth(-1);

    // Sticky note on wall (owner's config for visitor rooms, own config for myroom)
    const initialNote = parsedOwnerConfig?.pinnedNote ?? (this.roomConfig.id.startsWith('myroom:') ? getRoomConfig().pinnedNote : null);
    if (initialNote) this.createStickyNote(initialNote);

    // Graphics layers
    this.ledGraphics = this.add.graphics().setDepth(3);
    this.ambientGraphics = this.add.graphics().setDepth(2);
    this.feedGraphics = this.add.graphics().setDepth(4);
    this.loungeGraphics = this.add.graphics().setDepth(4);
    this.smokeGraphics = this.add.graphics().setDepth(15);

    this.createPlayer();
    this.createBackButton();
    this.createRoomLabel();

    // Spawn pet in myroom
    if (this.roomConfig.id.startsWith('myroom:')) {
      this.spawnPet(getPet());
    }

    // Chat UI
    this.chatUI = new ChatUI();
    const chatInput = this.chatUI.create(`Chat in ${this.roomConfig.name}...`, this.roomConfig.neonColor, (cmd) => this.handleCommand(cmd));
    this.chatUI.setNameClickHandler((pubkey, name) => {
      const op = this.otherPlayers.get(pubkey);
      ProfileModal.show(pubkey, name, op?.avatar, op?.status);
    });
    this.input.keyboard?.on('keydown-ENTER', () => { if (document.activeElement !== chatInput) chatInput.focus(); });

    // DM Panel — singleton
    this.dmPanel = this.registry.get('dmPanel') as DMPanel;
    if (!this.dmPanel) { this.dmPanel = new DMPanel(myPubkey); this.registry.set('dmPanel', this.dmPanel); }
    this.input.keyboard?.on('keydown-M', () => { if (document.activeElement === this.chatUI.getInput()) return; this.dmPanel.toggle(); });

    let rfp = this.registry.get('followsPanel') as FollowsPanel | undefined;
    if (!rfp) { rfp = new FollowsPanel(); this.registry.set('followsPanel', rfp); }
    this.followsPanel = rfp;
    this.input.keyboard?.on('keydown-G', () => { if (document.activeElement === this.chatUI.getInput()) return; this.followsPanel.toggle(); });
    this.input.keyboard?.on('keydown-S', () => { if (document.activeElement === this.chatUI.getInput()) return; this.settingsPanel.toggle(); });

    // Click to move
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if (this.introActive) return; if (p.y < 300 || p.y > 450) return; this.targetX = Phaser.Math.Clamp(p.x, 40, GAME_WIDTH - 40); this.isMoving = true; });

    // Computer interaction prompt (only in myroom)
    this.computerPromptBg = this.add.graphics().setDepth(50).setVisible(false);
    this.computerPromptBg.fillStyle(hexToNum(P.bg), 0.9);
    this.computerPromptBg.fillRoundedRect(0, 0, 130, 28, 5);
    this.computerPromptBg.lineStyle(1, hexToNum(P.teal), 0.3);
    this.computerPromptBg.strokeRoundedRect(0, 0, 130, 28, 5);
    this.computerPrompt = this.add.text(0, 0, '[E] Use Computer', {
      fontFamily: '"Courier New", monospace', fontSize: '11px', color: P.teal, fontStyle: 'bold', align: 'center'
    }).setOrigin(0.5).setDepth(51).setVisible(false);

    this.input.keyboard?.on('keydown-E', () => {
      if (this.introActive) return;
      if (document.activeElement === this.chatUI.getInput()) return;
      if (this.nearComputer && this.isMyRoom()) {
        this.openComputer();
      }
    });

    // Presence
    setPresenceCallbacks({
      onPlayerJoin: (p) => { if (p.pubkey === myPubkey || this.otherPlayers.has(p.pubkey)) return; this.addRoomPlayer(p.pubkey, p.name, p.x, p.y, (p as any).avatar, (p as any).status); sendAvatarUpdate(); },
      onPlayerMove: (pk, x, y) => { const o = this.otherPlayers.get(pk); if (o) { o.targetX = x; o.targetY = y; } },
      onPlayerLeave: (pk) => this.removeRoomPlayer(pk),
      onCountUpdate: (c) => { this.globalPlayerCount = c; },
      onChat: (pk, name, text) => {
        const isMe = pk === myPubkey;
        if (!isMe && text === '/emote smoke_on') { const o = this.otherPlayers.get(pk); if (o) { if (!o.smoke) o.smoke = new SmokeEmote(); o.smoke.start(); } if (!mutedPlayers.has(pk)) this.chatUI.addMessage(name, '*lights a cigarette*', P.dpurp, pk); return; }
        if (!isMe && text === '/emote smoke_off') { const o = this.otherPlayers.get(pk); if (o?.smoke) o.smoke.stop(); return; }
        if (isMe && text.startsWith('/emote ')) return;
        if (!isMe && mutedPlayers.has(pk)) return;
        if (!isMe && shouldFilter(text)) return;
        this.chatUI.addMessage(name, text, isMe ? P.teal : P.lpurp, pk);
        if (isMe) ChatUI.showBubble(this, this.player.x, this.player.y - 155, text, P.teal);
        else { const o = this.otherPlayers.get(pk); if (o) ChatUI.showBubble(this, o.sprite.x, o.sprite.y - 155, text, P.lpurp); }
      },
      onAvatarUpdate: (pk, avatarStr) => {
        const o = this.otherPlayers.get(pk); if (!o) return;
        o.avatar = avatarStr;
        const avatarConfig = deserializeAvatar(avatarStr) || getDefaultAvatar();
        const texKey = `avatar_room_${pk}`;
        if (this.textures.exists(texKey)) this.textures.remove(texKey);
        this.textures.addCanvas(texKey, renderRoomSprite(avatarConfig));
        o.sprite.setTexture(texKey).setTint(0xffffff);
      },
      onNameUpdate: (pk, name) => {
        const o = this.otherPlayers.get(pk); if (!o) return;
        o.nameText.setText(name.slice(0, 14));
      },
      onStatusUpdate: (pk, status) => {
        const o = this.otherPlayers.get(pk); if (!o) return;
        o.status = status;
        o.statusText.setText(status.slice(0, 30));
        o.statusText.setAlpha(status ? 1 : 0);
      },
    });
    sendRoomChange(this.roomConfig.id, GAME_WIDTH / 2, this.playerY);
    if (this.smokeEmote.active) this.time.delayedCall(500, () => sendChat('/emote smoke_on'));

    // When background profile fetch completes, update name text + presence
    const unsubProfile = authStore.subscribe(() => {
      const newName = authStore.getState().displayName;
      if (newName && newName !== this.registry.get('playerName')) {
        this.registry.set('playerName', newName);
        this.playerName?.setText(newName);
        sendNameUpdate(newName);
      }
    });

    if (this.isOwner) setRoomRequestHandler((rp, rn) => this.showRoomRequestToast(rp, rn));
    setRoomKickHandler((r) => { this.chatUI.addMessage('system', r || 'Owner left', P.amber); setTimeout(() => this.leaveRoom(), 1500); });
    setRoomGrantedHandler((op, on, room, roomConfig) => {
      this.waitingForAccess = false;
      this.chatUI.addMessage('system', `${on} accepted!`, P.teal);
      // Leave current room and go to the granted room
      sendRoomChange('hub');
      this.scene.start('RoomScene', { id: room, name: `${on}'s Room`, neonColor: P.teal, ownerPubkey: op, ownerRoomConfig: roomConfig });
    });
    setRoomDeniedHandler((r) => { this.waitingForAccess = false; this.chatUI.addMessage('system', r || 'Denied', P.amber); });

    this.cameras.main.fadeIn(300, 10, 0, 20);
    this.settingsPanel.create();

    if (this.roomConfig.id === 'relay') this.setupRelayStatusUI();

    // ── First-time room intro ──
    if (this.isOwner && this.isMyRoom() && isFirstVisit()) {
      this.startFirstTimeIntro();
    }

    this.events.on('shutdown', () => {
      unsubProfile();
      this.chatUI.destroy();
      this.settingsPanel.destroy();
      this.computerUI.close();
      this.pet?.destroy(); this.pet = null;
      if (this.introOverlay) { this.introOverlay.destroy(); this.introOverlay = null; }
      if (this.introText) { this.introText.destroy(); this.introText = null; }
      if (this.toastEl) { this.toastEl.remove(); this.toastEl = null; }
      this.destroyStickyNote();
      if (this.dmPanel) this.dmPanel.close();
      if (this.followsPanel) this.followsPanel.close();
      destroyPlayerMenu(); ProfileModal.destroy();
      this.feedNotes.forEach(n => { n.npubText?.destroy(); n.msgText?.destroy(); });
      this.feedNotes = [];
      this.relayStatusLines.forEach(l => { l.dot.destroy(); l.lat.destroy(); });
      this.relayStatusLines = [];
      this.relayHeaderText?.destroy(); this.relayHeaderText = null;
      this.relayCountText?.destroy(); this.relayCountText = null;
      this.relayEventsText?.destroy(); this.relayEventsText = null;
      this.otherPlayers.forEach(o => { o.sprite.destroy(); o.nameText.destroy(); o.statusText.destroy(); if (o.clickZone) o.clickZone.destroy(); });
      this.otherPlayers.clear();
      setRoomRequestHandler(null); setRoomKickHandler(null); setRoomGrantedHandler(null); setRoomDeniedHandler(null);
    });
  }

  // ══════════════════════════════════════
  // FIRST-TIME INTRO SEQUENCE
  // ══════════════════════════════════════
  private startFirstTimeIntro(): void {
    this.introActive = true;

    // Dark overlay
    this.introOverlay = this.add.graphics().setDepth(200);
    this.introOverlay.fillStyle(0x0a0014, 0.85);
    this.introOverlay.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Welcome text
    this.introText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30, '', {
      fontFamily: '"Courier New", monospace', fontSize: '18px', color: P.teal,
      align: 'center', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(201).setAlpha(0);

    // Step 1: "Welcome home" fade in
    this.introText.setText('Welcome home.');
    this.tweens.add({
      targets: this.introText, alpha: 1, duration: 1200, ease: 'Quad.easeOut',
      onComplete: () => {
        // Step 2: Hold, then fade subtitle
        this.time.delayedCall(1500, () => {
          const subtitle = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10, 'Let\'s make this place yours.', {
            fontFamily: '"Courier New", monospace', fontSize: '12px', color: P.lpurp,
            align: 'center',
          }).setOrigin(0.5).setDepth(201).setAlpha(0);

          this.tweens.add({
            targets: subtitle, alpha: 0.7, duration: 800, ease: 'Quad.easeOut',
            onComplete: () => {
              // Step 3: After a beat, dissolve overlay and open terminal
              this.time.delayedCall(1800, () => {
                this.tweens.add({
                  targets: [this.introOverlay, this.introText, subtitle],
                  alpha: 0, duration: 600, ease: 'Quad.easeIn',
                  onComplete: () => {
                    this.introOverlay?.destroy(); this.introOverlay = null;
                    this.introText?.destroy(); this.introText = null;
                    subtitle.destroy();
                    this.introActive = false;

                    // Mark setup as complete
                    markSetupComplete();

                    // Auto-open terminal on Room tab
                    this.chatUI.addMessage('system', 'Terminal opened — customize your room!', P.teal);
                    this.computerUI.openToRoom(
                      (newAvatar) => {
                        if (this.textures.exists('player_room')) this.textures.remove('player_room');
                        this.textures.addCanvas('player_room', renderRoomSprite(newAvatar));
                        this.player.setTexture('player_room');
                        if (this.textures.exists('player')) this.textures.remove('player');
                        this.textures.addCanvas('player', renderHubSprite(newAvatar));
                        sendAvatarUpdate();
                      },
                      (newName) => {
                        this.registry.set('playerName', newName);
                        this.playerName.setText(newName);
                        sendNameUpdate(newName);
                      },
                      (newConfig) => {
                        this.refreshRoomBackground();
                      },
                      (sel) => {
                        this.switchPet(sel);
                      },
                      (newStatus) => {
                        this.playerStatusText.setText(newStatus.slice(0, 30));
                        this.playerStatusText.setAlpha(newStatus ? 1 : 0);
                      },
                    );
                  },
                });
              });
            },
          });
        });
      },
    });
  }

  // ══════════════════════════════════════
  // LIVE ROOM REFRESH
  // ══════════════════════════════════════
  private refreshRoomBackground(): void {
    const texKey = this.roomRenderer.render(this, this.roomConfig.id, this.roomConfig.neonColor, GAME_WIDTH, GAME_HEIGHT);
    this.roomBgImage.setTexture(texKey);
    this.destroyStickyNote();
    const note = getRoomConfig().pinnedNote;
    if (note) this.createStickyNote(note);
  }

  private destroyStickyNote(): void {
    this.stickyNoteGroup?.clear(true, true);
    this.stickyNoteGroup = null;
    if (this.stickyNoteOverlay) { this.stickyNoteOverlay.remove(); this.stickyNoteOverlay = null; }
  }

  private createStickyNote(text: string): void {
    this.destroyStickyNote();

    // Position: wall just left of the computer desk
    const NX = 565, NY = 195, NW = 38, NH = 34;

    const g = this.add.graphics().setDepth(5).setInteractive(
      new Phaser.Geom.Rectangle(NX - NW / 2, NY - NH / 2, NW, NH),
      Phaser.Geom.Rectangle.Contains,
    );

    // Paper shadow
    g.fillStyle(0x000000, 0.25);
    g.fillRect(NX - NW / 2 + 3, NY - NH / 2 + 3, NW, NH);
    // Paper body — warm yellow
    g.fillStyle(0xe8d87a, 1);
    g.fillRect(NX - NW / 2, NY - NH / 2, NW, NH);
    // Folded corner top-right
    g.fillStyle(0xc8b850, 1);
    g.fillTriangle(NX + NW / 2 - 14, NY - NH / 2, NX + NW / 2, NY - NH / 2, NX + NW / 2, NY - NH / 2 + 14);
    // Pushpin
    g.fillStyle(0xdd3344, 1);
    g.fillCircle(NX, NY - NH / 2 + 5, 3);
    g.fillStyle(0xaa2233, 1);
    g.fillCircle(NX, NY - NH / 2 + 5, 2);
    // Pin shadow
    g.fillStyle(0x000000, 0.18);
    g.fillCircle(NX + 1, NY - NH / 2 + 6, 2);

    // Note text preview (truncate to fit)
    const preview = text.length > 30 ? text.slice(0, 28) + '…' : text;
    const noteText = this.add.text(NX - NW / 2 + 5, NY - NH / 2 + 13, preview, {
      fontFamily: '"Courier New", monospace',
      fontSize: '7px',
      color: '#3a2e0a',
      wordWrap: { width: NW - 12 },
      lineSpacing: 2,
    }).setDepth(6);

    g.setInteractive(new Phaser.Geom.Rectangle(NX - NW / 2, NY - NH / 2, NW, NH), Phaser.Geom.Rectangle.Contains);
    g.input!.cursor = 'pointer';

    g.on('pointerover', () => { g.setAlpha(0.85); });
    g.on('pointerout',  () => { g.setAlpha(1); });
    g.on('pointerdown', () => this.showStickyNoteOverlay(text));

    this.stickyNoteGroup = this.add.group([g, noteText]);
  }

  private showStickyNoteOverlay(text: string): void {
    if (this.stickyNoteOverlay) { this.stickyNoteOverlay.remove(); this.stickyNoteOverlay = null; return; }

    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      background:#f0e878;color:#2a1e04;
      font-family:"Courier New",monospace;font-size:13px;line-height:1.7;
      padding:20px 22px 16px;border-radius:2px;
      box-shadow:4px 6px 18px rgba(0,0,0,0.6);
      max-width:320px;width:90%;white-space:pre-wrap;word-break:break-word;
      z-index:9999;cursor:pointer;
    `;
    // Pushpin at top
    const pin = document.createElement('div');
    pin.style.cssText = `
      position:absolute;top:-10px;left:50%;transform:translateX(-50%);
      width:18px;height:18px;border-radius:50%;
      background:radial-gradient(circle at 40% 35%,#ff6677,#aa1122);
      box-shadow:0 2px 6px rgba(0,0,0,0.5);
    `;
    el.appendChild(pin);

    const content = document.createElement('div');
    content.textContent = text;
    el.appendChild(content);

    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:12px;font-size:10px;color:#7a6020;opacity:0.7;text-align:right;';
    hint.textContent = 'click to close';
    el.appendChild(hint);

    el.addEventListener('click', () => { el.remove(); this.stickyNoteOverlay = null; });
    document.body.appendChild(el);
    this.stickyNoteOverlay = el;
  }

  private setComputerPromptVisible(visible: boolean): void {
    this.computerPrompt.setVisible(visible);
    this.computerPromptBg.setVisible(visible);
    if (visible) {
      this.computerPromptBg.setPosition(595, 260);
      this.computerPrompt.setPosition(660, 274);
    }
  }

  update(time: number, delta: number): void {
    if (!this.introActive) {
      this.updateMovement();
    }
    this.playerName.setPosition(this.player.x, this.player.y - 150);
    this.playerStatusText.setPosition(this.player.x, this.player.y - 165);
    this.pet?.update(delta);
    this.updateBlinkingLEDs(time);
    this.updateAmbient(time);

    // Smoke
    this.smokeGraphics.clear();
    if (this.smokeEmote.active) {
      if (this.isMoving || this.targetX !== null) this.smokeEmote.stop();
      else this.smokeEmote.update(this.smokeGraphics, delta, this.player.x, this.player.y, this.facingRight, 'room');
    }

    sendPosition(this.player.x, this.player.y);

    // Computer proximity check (myroom only — desk is around x=600-720)
    if (this.isMyRoom() && !this.introActive) {
      const near = this.player.x > 560 && this.player.x < 740;
      if (near !== this.nearComputer) this.nearComputer = near;
      this.setComputerPromptVisible(near && !this.computerUI.isOpen());
    }

    // Room-specific updates
    const rc = this.roomConfig.id.startsWith('myroom:') ? 'myroom' : this.roomConfig.id;
    if (rc === 'feed') this.updateFeedRoom(time, delta);
    if (rc === 'relay') this.updateRelayStatus(delta);
    if (rc === 'lounge') this.updateLoungeRoom(time, delta);

    // Local player walk animation
    if (this.isWalking) {
      this.walkTimer += delta;
      if (this.walkTimer >= 180) {
        this.walkTimer = 0;
        this.walkFrame = this.walkFrame === 1 ? 2 : 1;
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

    // Other players
    this.otherPlayers.forEach((o, pk) => {
      const prevX = o.sprite.x;
      if (Math.abs(o.targetX - o.sprite.x) > 1) o.sprite.x += (o.targetX - o.sprite.x) * 0.12;
      if (Math.abs(o.targetY - o.sprite.y) > 1) o.sprite.y += (o.targetY - o.sprite.y) * 0.12;
      o.nameText.setPosition(o.sprite.x, o.sprite.y - 150);
      o.statusText.setPosition(o.sprite.x, o.sprite.y - 165);
      if (o.clickZone) o.clickZone.setPosition(o.sprite.x, o.sprite.y - 80);
      if (o.smoke?.active) o.smoke.update(this.smokeGraphics, delta, o.sprite.x, o.sprite.y, true, 'room');

      // Walk animation for other players
      const oMoving = Math.abs(o.targetX - o.sprite.x) > 1;
      if (oMoving) {
        o.sprite.setFlipX(o.targetX < o.sprite.x);
        o.walkTimer += delta;
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
        o.walkFrame = 0;
        o.walkTimer = 0;
        const avatarConfig = o.avatar ? (deserializeAvatar(o.avatar) || getDefaultAvatar()) : getDefaultAvatar();
        const texKey = `avatar_room_${pk}`;
        if (this.textures.exists(texKey)) this.textures.remove(texKey);
        this.textures.addCanvas(texKey, renderRoomSprite(avatarConfig, 0));
        o.sprite.setTexture(texKey);
      }
    });
  }

  // ── Feed Room ──
  private updateFeedRoom(time: number, delta: number): void {
    this.feedGraphics.clear();
    const dt = delta / 1000;
    const scrollSpeed = 22; const bottomY = 268; const topY = 62; const contentY = 84; const rowH = 22;
    const W = GAME_WIDTH;

    for (let i = this.feedNotes.length - 1; i >= 0; i--) {
      const n = this.feedNotes[i];
      n.age += delta; n.y -= scrollSpeed * dt;
      if (n.alpha < 1) n.alpha = Math.min(1, n.alpha + delta * 0.005);
      if (n.y < contentY + 20) n.alpha = Math.max(0, (n.y - contentY) / 20);
      if (n.y < topY) { n.npubText?.destroy(); n.msgText?.destroy(); this.feedNotes.splice(i, 1); continue; }
      const ey = Math.round(n.y); const ta = n.alpha;
      // Hide text objects when they're inside the header zone
      const textVisible = ey >= contentY;
      if (n.npubText) { n.npubText.setPosition(66, ey + 2); n.npubText.setAlpha(textVisible ? ta : 0); }
      if (n.msgText) { n.msgText.setPosition(160, ey + 2); n.msgText.setAlpha(textVisible ? ta : 0); }
      if (n.alpha > 0) {
        const isEven = Math.round((ey - 84) / rowH) % 2 === 0;
        this.feedGraphics.fillStyle(isEven ? 0x0a0818 : 0x0c0a20, n.alpha * 0.7);
        this.feedGraphics.fillRect(44, ey, W - 88, 18);
        const rgb = hexToRgb(n.color); const dc = Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b);
        this.feedGraphics.fillStyle(dc, n.alpha * 0.35); this.feedGraphics.fillCircle(55, ey + 9, 4);
        if (n.age < 1200) { this.feedGraphics.fillStyle(dc, Math.sin(n.age * 0.006) * 0.08 * n.alpha); this.feedGraphics.fillCircle(55, ey + 9, 7); }
      }
    }

    // Cover rect — paint over anything that bled into the header zone
    this.feedGraphics.fillStyle(0x0a0818, 1);
    this.feedGraphics.fillRect(30, 48, W - 60, contentY - 48);

    const last = this.feedNotes[this.feedNotes.length - 1];
    if (!last || last.y < bottomY - rowH) { const ev = popFeedNote(); if (ev) this.spawnFeedNote(ev); }
    this.feedGraphics.fillStyle(hexToNum(P.red), 0.4 + Math.sin(time * 0.005) * 0.4); this.feedGraphics.fillCircle(60, 64, 3);
  }

  private truncateFeedText(text: string, style: Phaser.Types.GameObjects.Text.TextStyle, maxWidth: number): string {
    const probe = this.add.text(-9999, -9999, '', style).setVisible(false);
    let result = text;
    if (probe.setText(result).width <= maxWidth) {
      probe.destroy();
      return result;
    }

    const ellipsis = '...';
    let low = 0;
    let high = text.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const candidate = text.slice(0, mid) + ellipsis;
      probe.setText(candidate);
      if (probe.width <= maxWidth) low = mid;
      else high = mid - 1;
    }

    result = text.slice(0, Math.max(0, low)) + ellipsis;
    probe.destroy();
    return result;
  }

  private spawnFeedNote(ev: FeedEvent): void {
    const colors = [P.pink, P.purp, P.teal, P.amber];
    const color = colors[Math.abs(ev.pubkey.charCodeAt(0)) % colors.length];
    const ts = { fontFamily: 'monospace', fontSize: '8px', color: '#fff' };
    const startY = 268;
    const npubX = 66;
    const msgX = 160;
    const rightPad = 52;
    const maxMsgWidth = GAME_WIDTH - msgX - rightPad;
    const displayContent = this.truncateFeedText(ev.content, { ...ts, color: P.lcream }, maxMsgWidth);
    const n: FeedNote = { npub: ev.npub, text: ev.content, color, y: startY, targetY: startY, alpha: 0, age: 0 };
    n.npubText = this.add.text(npubX, startY, ev.npub, { ...ts, color, fontStyle: 'bold' }).setDepth(5).setAlpha(0);
    n.msgText = this.add.text(msgX, startY, displayContent, {
      ...ts,
      color: P.lcream,
      fixedWidth: maxMsgWidth,
      wordWrap: { width: maxMsgWidth, useAdvancedWrap: false },
    }).setDepth(5).setAlpha(0);
    this.feedNotes.push(n);
  }

  // ── Relay Room ──
  private setupRelayStatusUI(): void {
    const rm = getRelayManager();
    if (rm) rm.pingAll();

    const ts = { fontFamily: 'monospace', fontSize: '9px' };
    const relays = DEFAULT_RELAYS.slice(0, 7);

    const overlay = this.add.graphics().setDepth(4);
    overlay.fillStyle(0x0a0818, 1);
    overlay.fillRect(461, 40, 289, 24);
    overlay.fillRect(461, 78, 289, relays.length * 26);

    this.relayHeaderText = this.add.text(605, 57, 'RELAY STATUS: CHECKING...', {
      ...ts, fontSize: '11px', color: P.teal, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(5);

    relays.forEach((url, i) => {
      const ry = 78 + i * 26;
      const dot = this.add.graphics().setDepth(5);
      this.add.text(484, ry + 14, url.replace('wss://', ''), { ...ts, color: P.lcream })
        .setAlpha(0.5).setDepth(5);
      const lat = this.add.text(740, ry + 14, '—', { ...ts, color: P.teal })
        .setOrigin(1, 0).setAlpha(0.5).setDepth(5);
      this.relayStatusLines.push({ dot, lat });
    });

    const footOverlay = this.add.graphics().setDepth(4);
    footOverlay.fillStyle(0x080616, 1);
    footOverlay.fillRect(461, 268, 289, 20);

    this.relayCountText = this.add.text(530, 282, '...', {
      ...ts, fontSize: '8px', color: P.amber, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(5);
    this.relayEventsText = this.add.text(680, 282, '...', {
      ...ts, fontSize: '8px', color: P.pink, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(5);
  }

  private updateRelayStatus(delta: number): void {
    this.relayUpdateTimer += delta;
    if (this.relayUpdateTimer < 800) return;
    this.relayUpdateTimer = 0;

    const rm = getRelayManager();
    const statuses = rm ? rm.getRelayStatuses() : [];
    const statusMap = new Map(statuses.map(s => [s.url, s]));
    const relays = DEFAULT_RELAYS.slice(0, 7);

    let connectedCount = 0;
    relays.forEach((url, i) => {
      const line = this.relayStatusLines[i];
      if (!line) return;
      const s = statusMap.get(url);
      const connected = s?.connected ?? false;
      if (connected) connectedCount++;
      const latMs = s?.latencyMs ?? 0;

      line.dot.clear();
      line.dot.fillStyle(connected ? hexToNum(P.teal) : hexToNum(P.red), connected ? 0.85 : 0.5);
      line.dot.fillRect(468, 78 + i * 26 + 6, 8, 8);
      line.lat.setText(connected && latMs > 0 ? `${latMs}ms` : connected ? '—' : 'ERR');
      line.lat.setColor(connected ? P.teal : P.red).setAlpha(connected ? 0.7 : 0.5);
    });

    const totalRelays = relays.length;
    this.relayHeaderText?.setText(`RELAY STATUS: ${connectedCount}/${totalRelays} CONNECTED`);
    this.relayHeaderText?.setColor(connectedCount > 0 ? P.teal : P.red);

    this.relayCountText?.setText(`${this.globalPlayerCount} ONLINE`);

    const evRate = getEventRate();
    this.relayEventsText?.setText(evRate > 0 ? `${evRate.toLocaleString()} EVENTS/HR` : '— EVENTS/HR');
  }

  // ── Lounge Room ──
  private updateLoungeRoom(time: number, delta: number): void {
    this.loungeGraphics.clear(); const FY = 300; const W = GAME_WIDTH;
    for (let row = 0; row < 2; row++) { const ry = 197 + row * 10; for (let lx = 8; lx < W - 8; lx += 16) { const cs = [P.pink, P.amber, P.teal, P.purp, P.lcream, P.red]; const ci = Math.floor((lx + row * 7) / 16) % cs.length; const rgb = hexToRgb(cs[ci]); const c = Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b); const tw = 0.3 + Math.sin(time * 0.004 + lx * 0.15 + row * 2.5) * 0.4; this.loungeGraphics.fillStyle(c, tw); this.loungeGraphics.fillRect(lx, ry, 2, 2); this.loungeGraphics.fillStyle(c, tw * 0.03); this.loungeGraphics.fillCircle(lx + 1, ry + 1, 3); } }
    const fx = 715; const fy = FY - 50; [P.amber, P.red, P.amber, '#fad480', P.amber, P.red, '#ffe060', P.amber].forEach((cl, i) => { const rgb = hexToRgb(cl); const c = Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b); const fl = Math.sin(time * 0.008 + i * 1.3) * 0.25; const h = 5 + Math.random() * 10 + Math.sin(time * 0.006 + i * 0.9) * 4; this.loungeGraphics.fillStyle(c, 0.3 + fl); this.loungeGraphics.fillRect(fx + 8 + i * 3.5, fy - h, 3, h); });
    this.loungeGraphics.fillStyle(hexToNum(P.amber), 0.06 + Math.sin(time * 0.005) * 0.03); this.loungeGraphics.fillCircle(fx + 20, fy - 8, 40);
  }

  // ── Animated Elements ──
  private updateBlinkingLEDs(time: number): void {
    if (this.roomRenderer.blinkingLEDs.length === 0) return; this.ledGraphics.clear();
    this.roomRenderer.blinkingLEDs.forEach(led => { const on = Math.sin(time * 0.003 + led.phase) > -0.2 + Math.random() * 0.1; if (on) { const rgb = hexToRgb(led.color); const c = Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b); this.ledGraphics.fillStyle(c, 0.5 + Math.random() * 0.3); this.ledGraphics.fillRect(led.x, led.y, 4, 4); this.ledGraphics.fillStyle(c, 0.08); this.ledGraphics.fillRect(led.x - 2, led.y - 2, 8, 8); } });
  }
  private updateAmbient(time: number): void {
    this.ambientGraphics.clear(); const rgb = hexToRgb(this.roomConfig.neonColor); const c = Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b);
    this.ambientGraphics.fillStyle(c, 0.015 + Math.sin(time * 0.001) * 0.008); this.ambientGraphics.fillRect(0, 0, GAME_WIDTH, 6);
  }

  // ── Other Players ──
  private addRoomPlayer(pk: string, name: string, px: number, py: number, avatarStr?: string, status?: string): void {
    const dying = this.dyingSprites.get(pk);
    if (dying) {
      this.tweens.killTweensOf([dying.sprite, dying.nameText, dying.statusText]);
      dying.sprite.destroy(); dying.nameText.destroy(); dying.statusText.destroy(); if (dying.clickZone) dying.clickZone.destroy();
      this.dyingSprites.delete(pk);
    }
    const texKey = `avatar_room_${pk}`;
    const avatarConfig = avatarStr ? (deserializeAvatar(avatarStr) || getDefaultAvatar()) : getDefaultAvatar();
    if (this.textures.exists(texKey)) this.textures.remove(texKey);
    this.textures.addCanvas(texKey, renderRoomSprite(avatarConfig));
    const sp = this.add.image(px, py, texKey).setOrigin(0.5, 1).setScale(2.5).setDepth(8);
    if (!avatarStr) {
      const h = name.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
      sp.setTint([0xe87aab, 0x7b68ee, 0x5dcaa5, 0xfad480, 0xb8a8f8][h % 5]);
    }
    const nt = this.add.text(px, py - 150, name.slice(0, 14), { fontFamily: '"Courier New", monospace', fontSize: '10px', color: this.roomConfig.neonColor, align: 'center', backgroundColor: '#0a001488', padding: { x: 4, y: 2 } }).setOrigin(0.5).setDepth(9);
    const statusStr = (status || '').slice(0, 30);
    const st = this.add.text(px, py - 165, statusStr, { fontFamily: '"Courier New", monospace', fontSize: '9px', color: P.lpurp, align: 'center' }).setOrigin(0.5).setDepth(9).setAlpha(statusStr ? 1 : 0);
    const cz = this.add.zone(px, py - 70, 70, 140).setInteractive({ useHandCursor: true }).setDepth(12);
    cz.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      ptr.event.stopPropagation();
      const op2 = this.otherPlayers.get(pk);
      showPlayerMenu(pk, name.slice(0, 14), ptr.x, ptr.y, { onChat: (t, c) => this.chatUI.addMessage('system', t, c), getDMPanel: () => this.dmPanel }, op2?.avatar, op2?.status);
    });
    this.otherPlayers.set(pk, { sprite: sp, nameText: nt, statusText: st, targetX: px, targetY: py, avatar: avatarStr, status: status || '', clickZone: cz, walkFrame: 0, walkTimer: 0 });
  }
  private removeRoomPlayer(pk: string): void {
    const o = this.otherPlayers.get(pk); if (!o) return;
    this.otherPlayers.delete(pk);
    this.dyingSprites.set(pk, o);
    this.tweens.add({ targets: [o.sprite, o.nameText, o.statusText], alpha: 0, duration: 300, onComplete: () => {
      o.sprite.destroy(); o.nameText.destroy(); o.statusText.destroy(); if (o.clickZone) o.clickZone.destroy();
      this.dyingSprites.delete(pk);
    }});
  }

  // ── Room Request Toast ──
  private showRoomRequestToast(rp: string, rn: string): void {
    if (this.toastEl) this.toastEl.remove();
    const esc = (s: string) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    this.toastEl = document.createElement('div');
    this.toastEl.style.cssText = `position:fixed;top:20px;right:20px;z-index:3000;background:linear-gradient(135deg,${P.bg},#0e0828);border:1px solid ${P.teal}55;border-radius:10px;padding:16px 20px;font-family:'Courier New',monospace;box-shadow:0 4px 20px rgba(0,0,0,0.6);max-width:300px;`;
    this.toastEl.innerHTML = `<div style="color:${P.teal};font-size:14px;font-weight:bold;margin-bottom:10px;">Room Request</div><div style="color:${P.lcream};font-size:13px;margin-bottom:14px;"><strong>${esc(rn)}</strong> wants to enter</div><div style="display:flex;gap:8px;"><button id="ta" style="flex:1;padding:8px;background:${P.teal}33;border:1px solid ${P.teal}66;border-radius:6px;color:${P.teal};font-size:13px;cursor:pointer;font-weight:bold;">Accept</button><button id="td" style="flex:1;padding:8px;background:${P.red}22;border:1px solid ${P.red}44;border-radius:6px;color:${P.red};font-size:13px;cursor:pointer;">Deny</button></div>`;
    document.body.appendChild(this.toastEl);
    this.toastEl.querySelector('#ta')!.addEventListener('click', () => { sendRoomResponse(rp, true, JSON.stringify(getRoomConfig())); this.toastEl?.remove(); this.toastEl = null; this.chatUI.addMessage('system', `Accepted ${rn}`, P.teal); });
    this.toastEl.querySelector('#td')!.addEventListener('click', () => { sendRoomResponse(rp, false); this.toastEl?.remove(); this.toastEl = null; });
    setTimeout(() => { if (this.toastEl) { sendRoomResponse(rp, false); this.toastEl.remove(); this.toastEl = null; } }, 30000);
  }

  // ── Player ──
  private createPlayer(): void {
    this.player = this.add.image(GAME_WIDTH / 2, this.playerY, 'player_room').setOrigin(0.5, 1).setScale(2.5).setDepth(10);
    const name = this.registry.get('playerName') || 'guest';
    this.playerName = this.add.text(GAME_WIDTH / 2, this.playerY - 120, name, { fontFamily: '"Courier New", monospace', fontSize: '10px', color: this.roomConfig.neonColor, align: 'center', backgroundColor: '#0a001488', padding: { x: 4, y: 2 } }).setOrigin(0.5).setDepth(11);
    const myStatus = localStorage.getItem('nd_status') || '';
    this.playerStatusText = this.add.text(GAME_WIDTH / 2, this.playerY - 165, myStatus, { fontFamily: '"Courier New", monospace', fontSize: '9px', color: P.lpurp, align: 'center' }).setOrigin(0.5).setDepth(11).setAlpha(myStatus ? 1 : 0);
  }
  private createBackButton(): void {
    const nc = this.roomConfig.neonColor; const bg = this.add.graphics();
    bg.fillStyle(hexToNum(P.bg), 0.92); bg.fillRoundedRect(16, 6, 150, 28, 6);
    bg.lineStyle(1, hexToNum(nc), 0.3); bg.strokeRoundedRect(16, 6, 150, 28, 6); bg.setDepth(99);
    const btn = this.add.text(91, 20, '\u2190 Back to District', { fontFamily: '"Courier New", monospace', fontSize: '11px', color: nc, align: 'center' }).setOrigin(0.5).setDepth(100).setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => { btn.setColor(P.lcream); btn.setScale(1.05); });
    btn.on('pointerout', () => { btn.setColor(nc); btn.setScale(1); });
    btn.on('pointerdown', () => this.leaveRoom());
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.computerUI.isOpen()) {
        this.computerUI.close();
        this.setComputerPromptVisible(this.nearComputer);
        return;
      }
      this.leaveRoom();
    });
  }
  private createRoomLabel(): void {
    const nc = this.roomConfig.neonColor; const bg = this.add.graphics();
    bg.fillStyle(hexToNum(P.bg), 0.92); bg.fillRoundedRect(GAME_WIDTH / 2 - 80, 4, 160, 32, 6);
    bg.lineStyle(1, hexToNum(nc), 0.35); bg.strokeRoundedRect(GAME_WIDTH / 2 - 80, 4, 160, 32, 6); bg.setDepth(99);
    this.add.text(GAME_WIDTH / 2, 20, this.roomConfig.name, { fontFamily: '"Courier New", monospace', fontSize: '14px', color: nc, fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(100);
  }
  private leaveRoom(): void { this.chatUI.destroy(); this.cameras.main.fadeOut(200, 10, 0, 20); this.time.delayedCall(200, () => { this.scene.start('HubScene', { _returning: true, fromRoom: this.roomConfig.id }); }); }
  private isMyRoom(): boolean { return this.roomConfig.id.startsWith('myroom:') && this.roomConfig.ownerPubkey === this.registry.get('playerPubkey'); }

  private spawnPet(sel: PetSelection): void {
    if (sel.species === 'none') return;
    this.pet = new PetSprite();
    this.pet.create(this, sel);
  }

  /** Called from ComputerUI when the user picks a new pet */
  switchPet(sel: PetSelection): void {
    this.pet?.destroy();
    this.pet = null;
    if (sel.species === 'none') return;

    const prefix = petTexKey(sel);
    const size   = PET_FRAME_SIZE[sel.species];

    let anyToLoad = false;
    for (const spec of getAnimSpecs(sel.species)) {
      const texKey = `${prefix}-${spec.key}`;
      if (!this.textures.exists(texKey)) {
        this.load.spritesheet(texKey, `pets/${sel.species}-${sel.breed}-${spec.key}.png`, { frameWidth: size, frameHeight: size });
        anyToLoad = true;
      }
    }
    if (!this.textures.exists('meow-vfx')) {
      this.load.spritesheet('meow-vfx', 'pets/meow-vfx.png', { frameWidth: 16, frameHeight: 16 });
      anyToLoad = true;
    }

    if (!anyToLoad) { this.spawnPet(sel); return; }

    this.load.once('complete', () => { if (!this.pet) this.spawnPet(sel); });
    this.load.start();
  }
  private openComputer(): void {
    if (this.computerUI.isOpen()) { this.computerUI.close(); this.setComputerPromptVisible(this.nearComputer); return; }
    this.setComputerPromptVisible(false);
    this.computerUI.open(
      (newAvatar) => {
        if (this.textures.exists('player_room')) this.textures.remove('player_room');
        this.textures.addCanvas('player_room', renderRoomSprite(newAvatar));
        this.player.setTexture('player_room');
        if (this.textures.exists('player')) this.textures.remove('player');
        this.textures.addCanvas('player', renderHubSprite(newAvatar));
        sendAvatarUpdate();
      },
      (newName) => {
        this.registry.set('playerName', newName);
        this.playerName.setText(newName);
        sendNameUpdate(newName);
      },
      (newConfig) => {
        this.refreshRoomBackground();
      },
      (sel) => {
        this.switchPet(sel);
      },
      (newStatus) => {
        this.playerStatusText.setText(newStatus.slice(0, 30));
        this.playerStatusText.setAlpha(newStatus ? 1 : 0);
      },
    );
  }
  private updateMovement(): void {
    const c = this.input.keyboard?.createCursorKeys(); let vx = 0; let vy = 0; const sp = 250;
    if (c) { if (c.left.isDown) vx = -sp; else if (c.right.isDown) vx = sp; if (c.up.isDown) vy = -sp; else if (c.down.isDown) vy = sp; }
    if (vx !== 0 || vy !== 0) { this.targetX = null; this.isMoving = false; this.player.x += vx / 60; this.player.y += vy / 60; if (vx !== 0) this.facingRight = vx > 0; }
    else if (this.isMoving && this.targetX !== null) { const dx = this.targetX - this.player.x; if (Math.abs(dx) < 3) { this.isMoving = false; this.targetX = null; } else { this.player.x += Math.sign(dx) * sp / 60; this.facingRight = dx > 0; } }
    this.player.x = Phaser.Math.Clamp(this.player.x, 40, GAME_WIDTH - 40);
    this.player.y = Phaser.Math.Clamp(this.player.y, 350, 445);
    this.playerY = this.player.y; this.player.setFlipX(!this.facingRight);
    this.isWalking = vx !== 0 || vy !== 0 || (this.isMoving && this.targetX !== null);
  }

  // ── Commands ──
  private handleCommand(text: string): void {
    const parts = text.slice(1).split(' '); const cmd = parts[0].toLowerCase(); const arg = parts.slice(1).join(' ').trim();
    switch (cmd) {
      case 'dm': { if (!canUseDMs()) { this.chatUI.addMessage('system', 'DMs need a key', P.amber); return; } if (!arg) { const ps: string[] = []; this.otherPlayers.forEach(o => { if (o.nameText?.text) ps.push(o.nameText.text); }); this.chatUI.addMessage('system', ps.length ? `Online: ${ps.join(', ')}` : 'No players here', P.teal); return; } let tp: string | null = null; this.otherPlayers.forEach((o, pk) => { if (o.nameText?.text?.toLowerCase().includes(arg.toLowerCase())) tp = pk; }); if (tp) { this.dmPanel.open(tp); this.chatUI.addMessage('system', 'Opening DM...', P.teal); } else this.chatUI.addMessage('system', `"${arg}" not found`, P.amber); break; }
      case 'smoke': { if (this.smokeEmote.active) { this.smokeEmote.stop(); this.chatUI.addMessage('system', 'Put it out', P.dpurp); sendChat('/emote smoke_off'); } else { this.smokeEmote.start(); this.chatUI.addMessage('system', '*lights a cigarette*', P.dpurp); sendChat('/emote smoke_on'); } break; }
      case 'terminal': case 'wardrobe': case 'outfit': case 'avatar': case 'computer': {
        if (!this.isMyRoom()) { this.chatUI.addMessage('system', 'Only works in your own room', P.amber); return; }
        this.openComputer();
        break;
      }
      case 'visit': case 'tp': case 'teleport': case 'go': { if (!arg) { this.chatUI.addMessage('system', 'Usage: /tp <room> or /tp <player>', P.teal); return; } const al: Record<string, string> = { relay:'relay', feed:'feed', thefeed:'feed', hub:'hub', lounge:'lounge', rooftop:'lounge', market:'market', shop:'market', store:'market' }; const rid = al[arg.toLowerCase().replace(/\s+/g, '')]; if (rid === 'hub') { this.leaveRoom(); return; } if (rid) { sendRoomChange('hub'); this.scene.start('RoomScene', { id: rid, name: rid.charAt(0).toUpperCase() + rid.slice(1), neonColor: P.teal }); return; } let target: string | null = null; this.otherPlayers.forEach((o, pk) => { if (o.nameText?.text?.toLowerCase().includes(arg.toLowerCase())) target = pk; }); if (target) { this.chatUI.addMessage('system', 'Requesting access...', P.teal); this.waitingForAccess = true; sendRoomRequest(target); setTimeout(() => { if (this.waitingForAccess) { this.waitingForAccess = false; this.chatUI.addMessage('system', 'Request timed out', P.amber); } }, 30000); } else this.chatUI.addMessage('system', `Unknown room or player "${arg}"`, P.amber); break; }
      case 'players': case 'who': case 'online': { const ps: string[] = []; this.otherPlayers.forEach(o => { if (o.nameText?.text) ps.push(o.nameText.text); }); this.chatUI.addMessage('system', ps.length ? `${ps.length} here: ${ps.join(', ')}` : 'No other players', P.teal); break; }
      case 'follows': case 'following': case 'friends': { this.followsPanel.toggle(); break; }
      case 'help': case '?': { this.chatUI.addMessage('system', 'Commands:', P.teal); ['/dm', '/smoke', '/terminal', '/tp <room|player>', '/players', '/follows', '/mute', '/filter <w>'].forEach(h => this.chatUI.addMessage('system', h, P.lpurp)); break; }
      case 'mute': { const s = toggleMute(); this.chatUI.addMessage('system', s ? 'Muted' : 'Unmuted', s ? P.amber : P.teal); break; }
      case 'filter': { if (!arg) { const w = getCustomBannedWords(); this.chatUI.addMessage('system', w.length ? `Filtered: ${w.join(', ')}` : 'No filters', P.teal); return; } addBannedWord(arg); this.chatUI.addMessage('system', `Added "${arg}"`, P.teal); break; }
      case 'unfilter': { if (!arg) return; removeBannedWord(arg); this.chatUI.addMessage('system', `Removed "${arg}"`, P.teal); break; }
      default: this.chatUI.addMessage('system', `Unknown: /${cmd}`, P.amber);
    }
    this.chatUI.flashLog();
  }
}

import Phaser from 'phaser';
import { BaseScene } from './BaseScene';
import { getStatus } from '../stores/statusStore';
import { onNextAvatarSync } from '../nostr/nostrService';
import { GAME_WIDTH, GAME_HEIGHT, P, ANIM, hexToNum, hexToRgb } from '../config/game.config';
import {
  setPresenceCallbacks, sendPosition, sendChat, sendRoomChange,
  sendRoomResponse, setRoomRequestHandler, setRoomKickHandler, sendRoomRequest,
  setRoomGrantedHandler, setRoomDeniedHandler, requestOnlinePlayers, setOnlinePlayersHandler,
  clearRoomRequestHandler, clearRoomKickHandler, clearRoomGrantedHandler, clearRoomDeniedHandler,
  sendAvatarUpdate, sendNameUpdate, isPresenceReady,
} from '../nostr/presenceService';
import { popFeedNote, FeedEvent, getEventRate } from '../nostr/feedService';
import { getRelayManager } from '../nostr/dmService';
import { DEFAULT_RELAYS } from '../nostr/relayManager';
import { ChatUI } from '../ui/ChatUI';
import { showPlayerMenu } from '../ui/PlayerMenu';
import { ProfileModal } from '../ui/ProfileModal';
import { ZapModal } from '../ui/ZapModal';
import { PetSprite } from '../entities/PetSprite';
import { RoomRenderer, CandleFlame } from '../rooms/RoomRenderer';
import { renderRoomSprite, renderHubSprite } from '../entities/AvatarRenderer';
import { deserializeAvatar, getDefaultAvatar, getAvatar, setAvatar, AvatarConfig } from '../stores/avatarStore';
import { authStore } from '../stores/authStore';
import { isFirstVisit, markSetupComplete, getRoomConfig, RoomConfig } from '../stores/roomStore';
import { SoundEngine } from '../audio/SoundEngine';
import { getPet, setPet, getPetPaths, petTexKey, PET_FRAME_SIZE, PetSelection, getAnimSpecs } from '../stores/petStore';
import { BookcaseModal } from '../ui/BookcaseModal';

interface RoomSceneConfig { id: string; name: string; neonColor: string; ownerPubkey?: string; ownerRoomConfig?: string; }
interface FeedNote { npub: string; text: string; color: string; y: number; targetY: number; alpha: number; age: number; npubText?: Phaser.GameObjects.Text; msgText?: Phaser.GameObjects.Text; }
export class RoomScene extends BaseScene {
  private player!: Phaser.GameObjects.Image;
  private roomConfig!: RoomSceneConfig;
  private isOwner = false;
  private waitingForAccess = false;
  private toastEl: HTMLDivElement | null = null;

  private roomRenderer = new RoomRenderer();
  private pet: PetSprite | null = null;
  private computerPrompt!: Phaser.GameObjects.Text;
  private computerPromptBg!: Phaser.GameObjects.Graphics;
  private nearComputer = false;
  private bookcasePrompt!: Phaser.GameObjects.Text;
  private bookcasePromptBg!: Phaser.GameObjects.Graphics;
  private nearBookcase = false;
  private hasBookcase = false;
  private parsedRoomConfig: any = null;
  private roomBgImage!: Phaser.GameObjects.Image;
  private roomFgImage!: Phaser.GameObjects.Image;
  private readonly incomingRoomRequestHandler = (rp: string, rn: string) => this.showIncomingRoomRequest(rp, rn);
  private readonly roomKickHandler = (r: string) => { this.chatUI.addMessage('system', r || 'Owner left', P.amber); setTimeout(() => this.leaveRoom(), 1500); };
  private readonly roomGrantedHandler = (op: string, on: string, room: string, roomConfig?: string) => {
    this.waitingForAccess = false;
    this.chatUI.addMessage('system', `${on} accepted!`, P.teal);
    // Do NOT sendRoomChange('hub') here — that subscribes to hub's presence channel
    // and causes hub players to appear as ghosts in the destination room.
    // The new RoomScene will call sendRoomChange(room) in its own create().
    this.scene.start('RoomScene', { id: room, name: `${on}'s Room`, neonColor: P.teal, ownerPubkey: op, ownerRoomConfig: roomConfig });
  };
  private readonly roomDeniedHandler = (r: string) => { this.waitingForAccess = false; this.chatUI.addMessage('system', r || 'Denied', P.amber); };
  // Walk animation (player)
  private walkTimer = 0;
  private isWalking = false;

  // First-time intro state
  private introActive = false;
  private introOverlay: Phaser.GameObjects.Graphics | null = null;
  private introText: Phaser.GameObjects.Text | null = null;

  // Animated elements
  private ledGraphics!: Phaser.GameObjects.Graphics;
  private flameGraphics!: Phaser.GameObjects.Graphics;
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
  private isLeavingRoom = false;
  private backBtnEl: HTMLButtonElement | null = null;

  constructor() { super({ key: 'RoomScene' }); }

  // Block all panel hotkeys while the bookcase modal is open (textarea focus)
  protected override shouldBlockPanelKeys(): boolean { return BookcaseModal.isOpen(); }

  // RoomScene T key: open the full computer in myroom, profile-only elsewhere
  protected override onTKey(): void {
    if (this.computerUI.isOpen()) { this.computerUI.close(); this.setComputerPromptVisible(this.nearComputer); return; }
    if (this.isMyRoom()) { this.openComputer(); }
    else { this.computerUI.open(undefined, (newName) => { this.registry.set('playerName', newName); this.playerName.setText(newName.slice(0, 14)); sendNameUpdate(newName); }, undefined, undefined, undefined, undefined, ['profile']); }
  }

  init(data: RoomSceneConfig): void {
    super.init(data);
    this.roomConfig = data;
    this.feedNotes = [];
    this.introActive = false;
    this.isLeavingRoom = false;
    this.playerY = 420;
  }

  preload(): void {
    if (!this.roomConfig.id.startsWith('myroom:')) return;
    // Use the room owner's pet — visitors get it from ownerRoomConfig, owners use their own
    let sel: PetSelection = { species: 'none', breed: 1 };
    if (this.roomConfig.ownerRoomConfig) {
      try { sel = (JSON.parse(this.roomConfig.ownerRoomConfig) as any).pet || sel; } catch (_) {}
    } else {
      sel = getPet();
    }
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
    // For own room use live config; for visitor rooms use owner's parsed config only (no local fallback)
    this.parsedRoomConfig = parsedOwnerConfig ?? (this.isOwner ? getRoomConfig() : null);
    this.hasBookcase = Array.isArray(this.parsedRoomConfig?.furniture) && this.parsedRoomConfig.furniture.includes('bookshelf');
    const texKey = this.roomRenderer.render(this, this.roomConfig.id, this.roomConfig.neonColor, GAME_WIDTH, GAME_HEIGHT, parsedOwnerConfig);
    this.roomBgImage = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, texKey).setDepth(-1);
    const fgTexKey = this.roomRenderer.renderForeground(this, this.roomConfig.id, GAME_WIDTH, GAME_HEIGHT, parsedOwnerConfig);
    this.roomFgImage = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, fgTexKey).setDepth(12);

    // Graphics layers
    this.ledGraphics = this.add.graphics().setDepth(3);
    this.flameGraphics = this.add.graphics().setDepth(3);
    this.ambientGraphics = this.add.graphics().setDepth(2);
    this.feedGraphics = this.add.graphics().setDepth(4);
    this.loungeGraphics = this.add.graphics().setDepth(4);
    this.emoteGraphics = this.add.graphics().setDepth(15);

    this.createPlayer();
    onNextAvatarSync(() => {
      const av = getAvatar();
      if (this.textures.exists('player_room')) this.textures.remove('player_room');
      this.textures.addCanvas('player_room', renderRoomSprite(av));
      this.player?.setTexture('player_room');
      if (this.textures.exists('player')) this.textures.remove('player');
      this.textures.addCanvas('player', renderHubSprite(av));
      sendAvatarUpdate();
    });
    this.createBackButton();
    this.createRoomLabel();

    // Spawn pet in myroom — visitors use owner's pet, owner uses their own
    if (this.roomConfig.id.startsWith('myroom:')) {
      const petSel = this.roomConfig.ownerRoomConfig
        ? ((parsedOwnerConfig as any)?.pet ?? { species: 'none', breed: 1 })
        : getPet();
      this.spawnPet(petSel);
    }

    // Chat UI
    this.chatUI = new ChatUI();
    this.chatInput = this.chatUI.create(`Chat in ${this.roomConfig.name}...`, this.roomConfig.neonColor, (cmd) => this.handleCommand(cmd));
    this.chatUI.setNameClickHandler((pubkey, name) => {
      const op = this.otherPlayers.get(pubkey);
      ProfileModal.show(pubkey, name, op?.avatar, op?.status);
    });
    // Mobile: zoom in and follow player so the room fills the screen properly
    if (this.sys.game.device.input.touch) {
      // No zoom in rooms — room is exactly game-sized, zoom scrolls title/leave off screen
      this.cameras.main.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT);
    }
    this.createMobileControls();

    this.setupRegistryPanels(myPubkey);
    this.setupCommonKeyboardHandlers();  // shouldBlockPanelKeys() guards with BookcaseModal.isOpen()

    // Click to move
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if ((p.event.target as HTMLElement)?.tagName !== 'CANVAS') return; if (this.introActive) return; if (p.worldY < 330 || p.worldY > 470) return; this.targetX = Phaser.Math.Clamp(p.worldX, 40, GAME_WIDTH - 40); this.isMoving = true; });

    // Computer interaction prompt (only in myroom)
    this.computerPromptBg = this.add.graphics().setDepth(50).setVisible(false);
    this.computerPromptBg.fillStyle(hexToNum(P.bg), 0.9);
    this.computerPromptBg.fillRoundedRect(0, 0, 130, 28, 5);
    this.computerPromptBg.lineStyle(1, hexToNum(P.teal), 0.3);
    this.computerPromptBg.strokeRoundedRect(0, 0, 130, 28, 5);
    this.computerPrompt = this.add.text(0, 0, '[E] Use Computer', {
      fontFamily: '"Courier New", monospace', fontSize: '11px', color: P.teal, fontStyle: 'bold', align: 'center'
    }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.computerPrompt.setInteractive();
    this.computerPrompt.on('pointerdown', () => {
      if (!this.introActive && this.nearComputer && this.isMyRoom()) this.openComputer();
    });

    // Bookcase interaction prompt (any myroom with a bookshelf)
    this.bookcasePromptBg = this.add.graphics().setDepth(50).setVisible(false);
    this.bookcasePromptBg.fillStyle(hexToNum(P.bg), 0.9);
    this.bookcasePromptBg.fillRoundedRect(0, 0, 148, 28, 5);
    this.bookcasePromptBg.lineStyle(1, hexToNum(P.purp), 0.3);
    this.bookcasePromptBg.strokeRoundedRect(0, 0, 148, 28, 5);
    this.bookcasePrompt = this.add.text(0, 0, '[E] Sign the bookcase', {
      fontFamily: '"Courier New", monospace', fontSize: '11px', color: P.purp, fontStyle: 'bold', align: 'center'
    }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.bookcasePrompt.setInteractive();
    this.bookcasePrompt.on('pointerdown', () => {
      if (!this.introActive && this.nearBookcase) this.openBookcase();
    });

    this.input.keyboard?.on('keydown-E', () => {
      if (this.introActive) return;
      if (BookcaseModal.isOpen()) return;
      if (document.activeElement === this.chatUI.getInput()) return;
      if (this.nearComputer && this.isMyRoom()) {
        this.openComputer();
      } else if (this.nearBookcase) {
        this.openBookcase();
      }
    });

    // Presence
    this.setupPresenceCallbacks(myPubkey);
    sendRoomChange(this.roomConfig.id, GAME_WIDTH / 2, this.playerY);
    const ae = this.emoteSet.activeNames(); if (ae.length) this.time.delayedCall(500, () => ae.forEach(n => sendChat(`/emote ${n}_on`)));
    // If this is the owner's room, broadcast current track to anyone who joins
    if (this.isOwner && this.roomConfig.id.startsWith('myroom:')) {
      this.time.delayedCall(500, () => sendChat(`/game:music:${SoundEngine.get().myRoomTrack}`));
    }
    const _roomSoundId = this.roomConfig.id.startsWith('myroom:') ? 'myroom' : this.roomConfig.id;
    SoundEngine.get().setRoom(_roomSoundId as any);

    this.setupProfileSubscription();

    if (this.isOwner) setRoomRequestHandler(this.incomingRoomRequestHandler);
    setRoomKickHandler(this.roomKickHandler);
    setRoomGrantedHandler(this.roomGrantedHandler);
    setRoomDeniedHandler(this.roomDeniedHandler);

    this.cameras.main.fadeIn(300, 10, 0, 20);
    this.settingsPanel.create();

    if (this.roomConfig.id === 'relay') this.setupRelayStatusUI();

    // ── First-time room intro ──
    if (this.isOwner && this.isMyRoom() && isFirstVisit()) {
      this.startFirstTimeIntro();
    }

    this.events.on('shutdown', () => {
      this.shutdownCommonPanels();
      BookcaseModal.destroy();
      this.pet?.destroy(); this.pet = null;
      if (this.introOverlay) { this.introOverlay.destroy(); this.introOverlay = null; }
      if (this.introText) { this.introText.destroy(); this.introText = null; }
      if (this.toastEl) { this.toastEl.remove(); this.toastEl = null; }
      if (this.backBtnEl) { this.backBtnEl.remove(); this.backBtnEl = null; }
      this.feedNotes.forEach(n => { n.npubText?.destroy(); n.msgText?.destroy(); });
      this.feedNotes = [];
      this.relayStatusLines.forEach(l => { l.dot.destroy(); l.lat.destroy(); });
      this.relayStatusLines = [];
      this.relayHeaderText?.destroy(); this.relayHeaderText = null;
      this.relayCountText?.destroy(); this.relayCountText = null;
      this.relayEventsText?.destroy(); this.relayEventsText = null;
      clearRoomRequestHandler(this.incomingRoomRequestHandler);
      clearRoomKickHandler(this.roomKickHandler);
      clearRoomGrantedHandler(this.roomGrantedHandler);
      clearRoomDeniedHandler(this.roomDeniedHandler);
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
                        this.playerName.setText(newName.slice(0, 14));
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
                      (trackId) => {
                        if (this.isOwner) sendChat(`/game:music:${trackId}`);
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
    // Re-read live room config so hasBookcase stays in sync after ComputerUI saves
    const liveConfig = getRoomConfig();
    this.parsedRoomConfig = liveConfig;
    this.hasBookcase = Array.isArray(liveConfig?.furniture) && liveConfig.furniture.includes('bookshelf');
    if (!this.hasBookcase) this.setBookcasePromptVisible(false);
    const texKey = this.roomRenderer.render(this, this.roomConfig.id, this.roomConfig.neonColor, GAME_WIDTH, GAME_HEIGHT);
    this.roomBgImage.setTexture(texKey);
    const fgTexKey = this.roomRenderer.renderForeground(this, this.roomConfig.id, GAME_WIDTH, GAME_HEIGHT);
    this.roomFgImage.setTexture(fgTexKey);
  }

  private setComputerPromptVisible(visible: boolean): void {
    this.computerPrompt.setVisible(visible);
    this.computerPromptBg.setVisible(visible);
    if (visible) {
      this.computerPromptBg.setPosition(595, 260);
      this.computerPrompt.setPosition(660, 274);
    }
  }

  private setBookcasePromptVisible(visible: boolean): void {
    this.bookcasePrompt.setVisible(visible);
    this.bookcasePromptBg.setVisible(visible);
    if (visible) {
      this.bookcasePromptBg.setPosition(634, 318);
      this.bookcasePrompt.setPosition(708, 332);
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
    this.updateCandleFlames(time);
    this.updateAmbient(time);

    // Smoke
    this.emoteGraphics.clear();
    this.emoteSet.updateAll(this.emoteGraphics, delta, this.player.x, this.player.y, this.facingRight, 'room', this.isWalking);
    this.player.setAlpha(this.emoteSet.isActive('ghost') ? 0.3 : 1);

    sendPosition(this.player.x, this.player.y, this.facingRight);

    // Computer proximity check (myroom only — desk is around x=600-720)
    if (this.isMyRoom() && !this.introActive) {
      const near = this.player.x > 560 && this.player.x < 740;
      if (near !== this.nearComputer) this.nearComputer = near;
      this.setComputerPromptVisible(near && !this.computerUI.isOpen());
    }

    // Bookcase proximity check (bookshelf is at x=755-790)
    if (this.hasBookcase && !this.introActive) {
      const nearShelf = this.player.x > 715 && this.player.x < 830;
      if (nearShelf !== this.nearBookcase) this.nearBookcase = nearShelf;
      this.setBookcasePromptVisible(nearShelf && !BookcaseModal.isOpen());
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
    this.updateOtherPlayers(time, delta);
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
  private updateCandleFlames(time: number): void {
    const flames = this.roomRenderer.candleFlames;
    this.flameGraphics.clear();
    if (flames.length === 0) return;
    flames.forEach((f: CandleFlame) => {
      // Flicker: vary height and sway with sin waves
      const flicker  = Math.sin(time * 0.009 + f.phase) * 0.4 + Math.sin(time * 0.017 + f.phase * 2.1) * 0.2;
      const sway     = Math.sin(time * 0.006 + f.phase * 1.7) * 1.2;
      const h        = 6 + flicker * 3;
      const cx       = f.x + sway;
      const baseY    = f.y;
      // Outer flame — orange
      this.flameGraphics.fillStyle(0xff8800, 0.82 + flicker * 0.1);
      this.flameGraphics.fillEllipse(cx, baseY - h * 0.55, 5, h);
      // Inner core — bright yellow-white
      this.flameGraphics.fillStyle(0xffee88, 0.9);
      this.flameGraphics.fillEllipse(cx, baseY - h * 0.65, 2.5, h * 0.6);
      // Glow halo
      this.flameGraphics.fillStyle(0xff6600, 0.04 + Math.abs(flicker) * 0.02);
      this.flameGraphics.fillCircle(cx, baseY - h * 0.4, 10);
    });
  }
  private updateAmbient(time: number): void {
    this.ambientGraphics.clear(); const rgb = hexToRgb(this.roomConfig.neonColor); const c = Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b);
    this.ambientGraphics.fillStyle(c, 0.015 + Math.sin(time * 0.001) * 0.008); this.ambientGraphics.fillRect(0, 0, GAME_WIDTH, 6);
  }

  // ── Other Players ──
  protected override getPlayerSprite(): Phaser.GameObjects.Image { return this.player; }
  protected override getBubbleYOffset(): number { return -155; }
  protected override clampPlayerMoveY(y: number): number { return Phaser.Math.Clamp(y, 340, 470); }
  protected override onPresenceCountUpdate(c: number): void { super.onPresenceCountUpdate(c); this.globalPlayerCount = c; }
  protected override afterPlayerJoin(_p: { pubkey: string; [k: string]: unknown }): void {
    if (this.isOwner && this.roomConfig.id.startsWith('myroom:')) {
      this.time.delayedCall(300, () => sendChat(`/game:music:${SoundEngine.get().myRoomTrack}`));
    }
  }
  protected override handleSceneChatCommand(pk: string, _name: string, text: string, _isMe: boolean): boolean {
    if (text.startsWith('/game:music:')) {
      if (this.roomConfig.id.startsWith('myroom:') && pk === this.roomConfig.ownerPubkey) {
        const trackId = text.slice('/game:music:'.length) as any;
        SoundEngine.get().applyMyRoomTrack(trackId);
      }
      return true;
    }
    return false;
  }
  protected override handleSceneEsc(): boolean {
    if (BookcaseModal.isOpen()) {
      // If a profile is open inside the bookcase, let ESC close just the profile first
      if (document.getElementById('profile-modal')) return true;
      BookcaseModal.destroy(); return true;
    }
    if (this.computerUI.isOpen()) { this.computerUI.close(); this.setComputerPromptVisible(this.nearComputer); return true; }
    return false;
  }
  protected override onEscFallthrough(): void { this.leaveRoom(); }

  protected override getOtherPlayerConfig(): import('./BaseScene').OtherPlayerConfig {
    return {
      texKeyPrefix: 'avatar_room_', scale: 2.5,
      nameYOffset: -150, statusYOffset: -165,
      nameColor: this.roomConfig.neonColor, nameFontSize: '10px', statusFontSize: '9px',
      nameBg: '#0a001488', namePadding: { x: 4, y: 2 },
      czW: 60, czH: 120, czYOffset: -80,
      tintPalette: [0xe87aab, 0x7b68ee, 0x5dcaa5, 0xfad480, 0xb8a8f8],
      useFadeIn: false, interpolateY: true, emoteContext: 'room',
    };
  }
  protected override renderOtherAvatar(cfg: AvatarConfig): HTMLCanvasElement {
    return renderRoomSprite(cfg, 0);
  }
  protected override setupClickZone(zone: Phaser.GameObjects.Zone, pk: string, name: string): void {
    let czDownX = 0; let czDownY = 0;
    zone.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if ((ptr.event.target as HTMLElement)?.tagName !== 'CANVAS') return;
      czDownX = ptr.x; czDownY = ptr.y;
    });
    zone.on('pointerup', (ptr: Phaser.Input.Pointer) => {
      if ((ptr.event.target as HTMLElement)?.tagName !== 'CANVAS') return;
      if (this.computerUI.isOpen()) return;
      const dx = ptr.x - czDownX; const dy = ptr.y - czDownY;
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
      o.walkFrame = 0;
      o.walkTimer = 0;
      const avatarConfig = o.avatar ? (deserializeAvatar(o.avatar) || getDefaultAvatar()) : getDefaultAvatar();
      const texKey = `avatar_room_${pk}`;
      if (this.textures.exists(texKey)) this.textures.remove(texKey);
      this.textures.addCanvas(texKey, renderRoomSprite(avatarConfig, 0));
      o.sprite.setTexture(texKey);
    }
  }
  // ── Room Request Toast ──
  private showIncomingRoomRequest(rp: string, rn: string): void {
    if (this.toastEl) this.toastEl.remove();
    SoundEngine.get().roomRequest();
    const esc = (s: string) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    this.toastEl = document.createElement('div');
    this.toastEl.style.cssText = `position:fixed;top:20px;right:20px;z-index:3000;background:linear-gradient(180deg,var(--nd-bg) 0%, var(--nd-navy) 100%);border:1px solid color-mix(in srgb,var(--nd-dpurp) 44%, transparent);border-radius:10px;padding:16px 20px;font-family:'Courier New',monospace;box-shadow:0 4px 20px rgba(0,0,0,0.6);max-width:300px;`;
    this.toastEl.innerHTML = `<div style="color:var(--nd-accent);font-size:14px;font-weight:bold;margin-bottom:10px;">Room Request</div><div style="color:var(--nd-text);font-size:13px;margin-bottom:14px;"><strong>${esc(rn)}</strong> wants to enter</div><div style="display:flex;gap:8px;"><button id="ta" style="flex:1;padding:8px;background:color-mix(in srgb,var(--nd-accent) 18%, transparent);border:1px solid color-mix(in srgb,var(--nd-accent) 44%, transparent);border-radius:6px;color:var(--nd-accent);font-size:13px;cursor:pointer;font-weight:bold;">Accept</button><button id="td" style="flex:1;padding:8px;background:${P.red}22;border:1px solid ${P.red}44;border-radius:6px;color:${P.red};font-size:13px;cursor:pointer;">Deny</button></div>`;
    document.body.appendChild(this.toastEl);
    this.toastEl.querySelector('#ta')!.addEventListener('click', () => { sendRoomResponse(rp, true, JSON.stringify(getRoomConfig())); this.toastEl?.remove(); this.toastEl = null; this.chatUI.addMessage('system', `Accepted ${rn}`, P.teal); });
    this.toastEl.querySelector('#td')!.addEventListener('click', () => { sendRoomResponse(rp, false); this.toastEl?.remove(); this.toastEl = null; });
    setTimeout(() => { if (this.toastEl) { sendRoomResponse(rp, false); this.toastEl.remove(); this.toastEl = null; } }, 30000);
  }

  // ── Player ──
  private createPlayer(): void {
    this.player = this.add.image(GAME_WIDTH / 2, this.playerY, 'player_room').setOrigin(0.5, 1).setScale(2.5).setDepth(10);
    const name = this.registry.get('playerName') || 'guest';
    this.playerName = this.add.text(GAME_WIDTH / 2, this.playerY - 120, name.slice(0, 14), { fontFamily: '"Courier New", monospace', fontSize: '10px', color: this.roomConfig.neonColor, align: 'center', backgroundColor: '#0a001488', padding: { x: 4, y: 2 } }).setOrigin(0.5).setDepth(11);
    const myStatus = getStatus();
    this.playerStatusText = this.add.text(GAME_WIDTH / 2, this.playerY - 165, myStatus, { fontFamily: '"Courier New", monospace', fontSize: '9px', color: P.lpurp, align: 'center' }).setOrigin(0.5).setDepth(11).setAlpha(myStatus ? 1 : 0);
  }
  private createBackButton(): void {
    const nc = this.roomConfig.neonColor;
    // Phaser visual only — not interactive (HTML button handles all taps/clicks)
    const bg = this.add.graphics();
    bg.fillStyle(hexToNum(P.bg), 0.92); bg.fillRoundedRect(12, 5, 168, 34, 7);
    bg.lineStyle(1, hexToNum(nc), 0.3); bg.strokeRoundedRect(12, 5, 168, 34, 7); bg.setDepth(99).setScrollFactor(0);
    const btn = this.add.text(96, 22, '\u2190 Back to District', { fontFamily: '"Courier New", monospace', fontSize: '12px', color: nc, align: 'center' }).setOrigin(0.5).setDepth(100).setScrollFactor(0);
    // Transparent HTML overlay — Phaser Zone + setInteractive is unreliable on mobile touch.
    // A real DOM element at fixed position is guaranteed to receive pointer events.
    // Oversized relative to the visual so finger imprecision near the edges still registers.
    const el = document.createElement('button');
    this.backBtnEl = el;
    el.style.cssText = 'position:fixed;top:0;left:0;width:220px;height:60px;background:transparent;border:none;outline:none;cursor:pointer;z-index:500;pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent;';
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
    this.add.text(GAME_WIDTH / 2, 20, this.roomConfig.name, { fontFamily: '"Courier New", monospace', fontSize: '14px', color: nc, fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(100).setScrollFactor(0);
  }
  private leaveRoom(): void {
    if (this.isLeavingRoom) return;
    this.isLeavingRoom = true;
    this.backBtnEl?.remove(); this.backBtnEl = null;
    this.waitingForAccess = false;
    // Stop accepting new player joins before broadcasting hub presence
    // so hub players don't flash as ghosts during the fade-out
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
  private openBookcase(): void {
    if (BookcaseModal.isOpen()) { BookcaseModal.destroy(); return; }
    this.setBookcasePromptVisible(false);
    const ownerPubkey = this.roomConfig.ownerPubkey || this.registry.get('playerPubkey');
    BookcaseModal.show(ownerPubkey);
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
        this.playerName.setText(newName.slice(0, 14));
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
      (trackId) => {
        // Owner changed track — broadcast to room so visitors hear it
        if (this.isOwner) sendChat(`/game:music:${trackId}`);
      },
    );
  }
  private updateMovement(): void {
    if (!isPresenceReady()) return; // freeze until server confirms sync
    const c = this.input.keyboard?.createCursorKeys(); let vx = 0; let vy = 0; const sp = 250;
    if (c) { if (c.left.isDown) vx = -sp; else if (c.right.isDown) vx = sp; if (c.up.isDown) vy = -sp; else if (c.down.isDown) vy = sp; }
    // Mobile arrow buttons (up = interact, not vertical movement)
    if (vx === 0) { if (this.mobileLeft) vx = -sp; else if (this.mobileRight) vx = sp; }
    if (vx !== 0 || vy !== 0) { this.targetX = null; this.isMoving = false; this.player.x += vx / 60; this.player.y += vy / 60; if (vx !== 0) this.facingRight = vx > 0; }
    else if (this.isMoving && this.targetX !== null) { const dx = this.targetX - this.player.x; if (Math.abs(dx) < 3) { this.isMoving = false; this.targetX = null; } else { this.player.x += Math.sign(dx) * sp / 60; this.facingRight = dx > 0; } }
    this.player.x = Phaser.Math.Clamp(this.player.x, 40, GAME_WIDTH - 40);
    this.player.y = Phaser.Math.Clamp(this.player.y, 340, 470);
    this.playerY = this.player.y; this.player.setFlipX(!this.facingRight);
    this.isWalking = vx !== 0 || vy !== 0 || (this.isMoving && this.targetX !== null);
  }

  // ── Commands ──
  protected override getSceneAccent(): string { return this.roomConfig?.neonColor ?? P.teal; }

  private handleCommand(text: string): void {
    const parts = text.slice(1).split(' '); const cmd = parts[0].toLowerCase(); const arg = parts.slice(1).join(' ').trim();
    switch (cmd) {
      case 'zap': { if (!arg) { this.chatUI.addMessage('system', 'Usage: /zap <name>', P.teal); return; } const za = authStore.getState(); if (!za.pubkey || za.isGuest) { this.chatUI.addMessage('system', 'Login to zap', P.amber); return; } let zt: string | null = null; let zn = arg; this.otherPlayers.forEach((o, pk) => { if (o.nameText?.text?.toLowerCase().includes(arg.toLowerCase())) { zt = pk; zn = o.nameText.text; } }); if (!zt) { this.chatUI.addMessage('system', `"${arg}" not found`, P.amber); return; } ZapModal.show(zt, zn); break; }
      case 'visit': case 'tp': case 'teleport': case 'go': { if (!arg) { this.chatUI.addMessage('system', 'Usage: /tp <room> or /tp <player>', P.teal); return; } const al: Record<string, string> = { relay:'relay', feed:'feed', thefeed:'feed', hub:'hub', woods:'woods', cabin:'cabin', myroom:'myroom', room:'picker', lounge:'lounge', rooftop:'lounge', market:'market', shop:'market', store:'market' }; const rid = al[arg.toLowerCase().replace(/\s+/g, '')]; if (rid === 'myroom') { const pk = this.registry.get('playerPubkey'); const n = this.registry.get('playerName') || 'My Room'; this.chatUI.destroy(); this.scene.start('RoomScene', { id: `myroom:${pk}`, name: `${n}'s Room`, neonColor: P.teal, ownerPubkey: pk }); return; } if (rid === 'picker') { const pk = this.registry.get('playerPubkey'); const n = this.registry.get('playerName') || 'My Room'; this.playerPicker.open(pk, n, () => { this.chatUI.destroy(); this.scene.start('RoomScene', { id: `myroom:${pk}`, name: `${n}'s Room`, neonColor: P.teal, ownerPubkey: pk }); }, (opk) => { this.chatUI.addMessage('system', 'Requesting access...', P.teal); this.waitingForAccess = true; sendRoomRequest(opk); setTimeout(() => { if (this.waitingForAccess) { this.waitingForAccess = false; this.chatUI.addMessage('system', 'Request timed out', P.amber); } }, 30000); }); return; } if (rid === 'hub') { this.leaveRoom(); return; } if (rid === 'woods') { sendRoomChange('woods'); this.chatUI.destroy(); this.cameras.main.fadeOut(300, 10, 0, 20); this.time.delayedCall(300, () => { if (!this.scene.isActive()) return; this.scene.start('WoodsScene'); }); return; } if (rid === 'cabin') { sendRoomChange('cabin'); this.chatUI.destroy(); this.cameras.main.fadeOut(300, 4, 2, 0); this.time.delayedCall(300, () => { if (!this.scene.isActive()) return; this.scene.start('CabinScene'); }); return; } if (rid) { this.scene.start('RoomScene', { id: rid, name: rid.charAt(0).toUpperCase() + rid.slice(1), neonColor: P.teal }); return; } let target: string | null = null; this.otherPlayers.forEach((o, pk) => { if (o.nameText?.text?.toLowerCase().includes(arg.toLowerCase())) target = pk; }); if (target) { this.chatUI.addMessage('system', 'Requesting access...', P.teal); this.waitingForAccess = true; sendRoomRequest(target); setTimeout(() => { if (this.waitingForAccess) { this.waitingForAccess = false; this.chatUI.addMessage('system', 'Request timed out', P.amber); } }, 30000); } else this.chatUI.addMessage('system', `Unknown room or player "${arg}"`, P.amber); break; }
      case 'players': case 'who': case 'online': { const ps: string[] = []; this.otherPlayers.forEach(o => { if (o.name) ps.push(o.name); }); this.chatUI.addMessage('system', ps.length ? `${ps.length} here: ${ps.join(', ')}` : 'No other players', P.teal); break; }
      default: { if (!this.handleCommonCommand(cmd, arg)) this.chatUI.addMessage('system', `Unknown: /${cmd}`, P.amber); break; }
    }
    this.chatUI.flashLog();
  }

}

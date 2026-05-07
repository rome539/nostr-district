import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, P, hexToNum } from '../../config/game.config';
import {
  getRoomConfig, setRoomConfig, isFirstVisit, RoomConfig, FurnitureId,
  getDefaultPos, getFurnitureColor,
} from '../../stores/roomStore';
import { PNG_FURNITURE_IDS, PNG_FURNITURE_PATHS, PNG_BACKGROUND_IDS, PNG_TINT_WHITE_IDS, getFurnitureBounds } from '../../rooms/RoomRenderer';
import { FurnitureDragUI } from '../../rooms/FurnitureDragUI';
import { publishRoomConfig, onNextRoomSync } from '../../nostr/nostrService';
import { PetSprite } from '../../entities/PetSprite';
import { getPet, petTexKey, PET_FRAME_SIZE, PetSelection, getAnimSpecs } from '../../stores/petStore';
import { BookcaseModal } from '../../ui/BookcaseModal';
import { renderRoomSprite, renderHubSprite } from '../../entities/AvatarRenderer';
import { getAvatar } from '../../stores/avatarStore';
import { sendAvatarUpdate, sendNameUpdate, sendChat, setRoomRequestHandler, clearRoomRequestHandler } from '../../nostr/presenceService';
import { SoundEngine } from '../../audio/SoundEngine';
import { RoomIntro } from './RoomIntro';
import { RoomRequestToast } from './RoomRequestToast';

export interface MyRoomCtx {
  scene: Phaser.Scene;
  roomBgImage: Phaser.GameObjects.Image;
  roomRenderer: any; // RoomRenderer — use any to avoid circular
  roomId: string;
  neonColor: string;
  ownerPubkey?: string;
  ownerRoomConfig?: string;
  isOwner: boolean;
  player: Phaser.GameObjects.Image;
  playerName: Phaser.GameObjects.Text;
  playerStatusText: Phaser.GameObjects.Text;
  computerUI: any; // ComputerUI
  chatUI: any; // ChatUI
  registry: Phaser.Data.DataManager;
  leaveRoom: () => void;
}

function applyWhiteTint(scene: Phaser.Scene, srcKey: string, dstKey: string, hex: string): string {
  const src = scene.textures.get(srcKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const w = (src as HTMLImageElement).naturalWidth || (src as HTMLCanvasElement).width;
  const h = (src as HTMLImageElement).naturalHeight || (src as HTMLCanvasElement).height;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(src as CanvasImageSource, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    if (d[i] >= 131 && d[i + 1] >= 130 && d[i + 2] >= 130) {
      d[i]     = Math.round(d[i]     * r / 255);
      d[i + 1] = Math.round(d[i + 1] * g / 255);
      d[i + 2] = Math.round(d[i + 2] * b / 255);
    }
  }
  ctx.putImageData(imageData, 0, 0);
  if (scene.textures.exists(dstKey)) scene.textures.remove(dstKey);
  scene.textures.addCanvas(dstKey, canvas);
  return dstKey;
}

export class MyRoomSystem {
  private ctx!: MyRoomCtx;
  parsedRoomConfig: any = null;
  private hasBookcaseField = false;
  private roomItemImages = new Map<string, Phaser.GameObjects.Image>();
  private furnitureDragUI!: any; // FurnitureDragUI
  private arrangeMode = false;
  private previewMode = false;
  private arrangeBtn: Phaser.GameObjects.Text | null = null;
  private resetArrangeBtn: Phaser.GameObjects.Text | null = null;
  private previewBtn: Phaser.GameObjects.Text | null = null;
  private computerPrompt!: Phaser.GameObjects.Text;
  private computerPromptBg!: Phaser.GameObjects.Graphics;
  private nearComputerField = false;
  private bookcasePrompt!: Phaser.GameObjects.Text;
  private bookcasePromptBg!: Phaser.GameObjects.Graphics;
  private nearBookcaseField = false;
  private pet: any = null; // PetSprite

  readonly intro = new RoomIntro();
  readonly toast = new RoomRequestToast();
  private readonly incomingRoomRequestHandler = (rp: string, rn: string) =>
    this.toast.show(rp, rn, this.ctx.chatUI);

  get nearComputer(): boolean { return this.nearComputerField; }
  get nearBookcase(): boolean { return this.nearBookcaseField; }
  get hasBookcase(): boolean { return this.hasBookcaseField; }

  preload(scene: Phaser.Scene, config: { id: string; ownerRoomConfig?: string }): void {
    if (!config.id.startsWith('myroom:')) return;

    // Load PNG-based furniture items
    const furnitureCfg: string[] = (() => {
      if (config.ownerRoomConfig) {
        try { return (JSON.parse(config.ownerRoomConfig) as any).furniture ?? []; } catch { return []; }
      }
      return getRoomConfig().furniture;
    })();
    for (const id of furnitureCfg) {
      if (!PNG_FURNITURE_IDS.has(id as any)) continue;
      const key = `furniture_${id}`;
      const basePath = PNG_FURNITURE_PATHS[id as FurnitureId] ?? `assets/furniture/${id}.png`;
      if (import.meta.env.DEV) {
        if (scene.textures.exists(key)) scene.textures.remove(key);
        const tintedKey = `${key}_tinted`;
        if (scene.textures.exists(tintedKey)) scene.textures.remove(tintedKey);
        scene.load.image(key, `${basePath}?t=${Date.now()}`);
      } else if (!scene.textures.exists(key)) {
        scene.load.image(key, basePath);
      }
    }

    // Load room owner's pet sprites
    let sel: PetSelection = { species: 'none', breed: 1 };
    if (config.ownerRoomConfig) {
      try { sel = (JSON.parse(config.ownerRoomConfig) as any).pet || sel; } catch (_) {}
    } else {
      sel = getPet();
    }
    if (sel.species === 'none') return;
    const prefix = petTexKey(sel);
    const size = PET_FRAME_SIZE[sel.species];
    for (const spec of getAnimSpecs(sel.species)) {
      const texKey = `${prefix}-${spec.key}`;
      if (!scene.textures.exists(texKey)) {
        scene.load.spritesheet(texKey, `pets/${sel.species}-${sel.breed}-${spec.key}.png`, { frameWidth: size, frameHeight: size });
      }
    }
    if (!scene.textures.exists('meow-vfx')) {
      scene.load.spritesheet('meow-vfx', 'pets/meow-vfx.png', { frameWidth: 16, frameHeight: 16 });
    }
  }

  setup(ctx: MyRoomCtx, parsedOwnerConfig?: any): void {
    this.ctx = ctx;
    const { scene, roomId, isOwner, ownerRoomConfig, player, playerName, playerStatusText, computerUI, chatUI } = ctx;

    this.parsedRoomConfig = parsedOwnerConfig ?? (isOwner ? getRoomConfig() : null);
    this.hasBookcaseField = Array.isArray(this.parsedRoomConfig?.furniture) && this.parsedRoomConfig.furniture.includes('bookshelf');

    this.buildForegroundImages(parsedOwnerConfig);
    this.furnitureDragUI = new FurnitureDragUI(scene, () => this.refresh());

    if (import.meta.env.DEV) {
      const reloadPngs = () => {
        const ids = Array.from(this.roomItemImages.keys()).filter(id => PNG_FURNITURE_IDS.has(id as FurnitureId)) as FurnitureId[];
        if (!ids.length) return;
        ids.forEach(id => {
          const path = PNG_FURNITURE_PATHS[id] ?? `assets/furniture/${id}.png`;
          const img = new Image();
          img.onload = () => {
            const key = `furniture_${id}`;
            if (scene.textures.exists(key)) scene.textures.remove(key);
            scene.textures.addImage(key, img);
            const tintedKey = `${key}_tinted`;
            if (scene.textures.exists(tintedKey)) scene.textures.remove(tintedKey);
            const gameImg = this.roomItemImages.get(id);
            if (gameImg) gameImg.setTexture(key);
          };
          img.src = `${path}?t=${Date.now()}`;
        });
      };
      window.addEventListener('focus', reloadPngs);
      scene.events.once('shutdown', () => window.removeEventListener('focus', reloadPngs));
    }

    // Spawn pet
    const petSel: PetSelection = ownerRoomConfig
      ? ((parsedOwnerConfig as any)?.pet ?? { species: 'none', breed: 1 })
      : getPet();
    this.spawnPet(petSel);

    // Computer interaction prompt
    this.computerPromptBg = scene.add.graphics().setDepth(50).setVisible(false);
    this.computerPromptBg.fillStyle(hexToNum(P.bg), 0.9);
    this.computerPromptBg.fillRoundedRect(0, 0, 130, 28, 5);
    this.computerPromptBg.lineStyle(1, hexToNum(P.teal), 0.3);
    this.computerPromptBg.strokeRoundedRect(0, 0, 130, 28, 5);
    this.computerPrompt = scene.add.text(0, 0, '[E] Use Computer', {
      fontFamily: '"Courier New", monospace', fontSize: '11px', color: P.teal, fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.computerPrompt.setInteractive();
    this.computerPrompt.on('pointerdown', () => {
      if (!this.intro.isActive && this.nearComputerField && isOwner) this.openComputer();
    });

    // Bookcase interaction prompt
    this.bookcasePromptBg = scene.add.graphics().setDepth(50).setVisible(false);
    this.bookcasePromptBg.fillStyle(hexToNum(P.bg), 0.9);
    this.bookcasePromptBg.fillRoundedRect(0, 0, 148, 28, 5);
    this.bookcasePromptBg.lineStyle(1, hexToNum(P.purp), 0.3);
    this.bookcasePromptBg.strokeRoundedRect(0, 0, 148, 28, 5);
    this.bookcasePrompt = scene.add.text(0, 0, '[E] Sign the bookcase', {
      fontFamily: '"Courier New", monospace', fontSize: '11px', color: P.purp, fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.bookcasePrompt.setInteractive();
    this.bookcasePrompt.on('pointerdown', () => {
      if (!this.intro.isActive && this.nearBookcaseField) this.openBookcase();
    });

    // E key handler
    scene.input.keyboard?.on('keydown-E', () => {
      if (this.intro.isActive) return;
      if (this.arrangeMode) return;
      if (BookcaseModal.isOpen()) return;
      if (document.activeElement === chatUI.getInput()) return;
      if (this.nearComputerField && isOwner) this.openComputer();
      else if (this.nearBookcaseField) this.openBookcase();
    });

    scene.input.keyboard?.on('keydown-ENTER', () => {
      if (this.arrangeMode) { this.toggleArrangeMode(); return; }
    });

    // Arrange buttons (owner only)
    if (isOwner) {
      this.arrangeBtn = scene.add.text(GAME_WIDTH - 8, 8, '[Arrange]', {
        fontFamily: '"Courier New", monospace', fontSize: '11px',
        color: P.teal, backgroundColor: '#0a001488', padding: { x: 4, y: 2 },
      }).setOrigin(1, 0).setDepth(100).setScrollFactor(0).setInteractive({ cursor: 'pointer' });
      this.arrangeBtn.on('pointerover', () => this.arrangeBtn?.setColor(P.lcream));
      this.arrangeBtn.on('pointerout', () => this.arrangeBtn?.setColor(this.arrangeMode ? P.pink : P.teal));
      this.arrangeBtn.on('pointerup', () => this.toggleArrangeMode());

      this.resetArrangeBtn = scene.add.text(GAME_WIDTH - 8, 28, '[Reset Positions]', {
        fontFamily: '"Courier New", monospace', fontSize: '11px',
        color: P.amber, backgroundColor: '#0a001488', padding: { x: 4, y: 2 },
      }).setOrigin(1, 0).setDepth(100).setScrollFactor(0).setInteractive({ cursor: 'pointer' }).setVisible(false);
      this.resetArrangeBtn.on('pointerup', () => {
        setRoomConfig({ furniturePositions: {}, posterPositions: [null, null, null] });
        this.furnitureDragUI.exit();
        this.furnitureDragUI.enter(getRoomConfig());
        this.refresh();
      });

      this.previewBtn = scene.add.text(GAME_WIDTH - 8, 48, '[Preview]', {
        fontFamily: '"Courier New", monospace', fontSize: '11px',
        color: P.lpurp, backgroundColor: '#0a001488', padding: { x: 4, y: 2 },
      }).setOrigin(1, 0).setDepth(100).setScrollFactor(0).setInteractive({ cursor: 'pointer' }).setVisible(false);
      this.previewBtn.on('pointerup', () => this.togglePreviewMode());

      onNextRoomSync(() => {
        if (!scene.sys.isActive()) return;
        this.refresh();
      });

      setRoomRequestHandler(this.incomingRoomRequestHandler);
    }

    // First-time intro
    if (isOwner && isFirstVisit()) {
      this.intro.start(scene, {
        addSystemMessage: (msg, color) => chatUI.addMessage('system', msg, color),
        openTerminal: () => computerUI.open(
          (newAvatar: any) => {
            if (scene.textures.exists('player_room')) scene.textures.remove('player_room');
            scene.textures.addCanvas('player_room', renderRoomSprite(newAvatar));
            player.setTexture('player_room');
            if (scene.textures.exists('player')) scene.textures.remove('player');
            scene.textures.addCanvas('player', renderHubSprite(newAvatar));
            sendAvatarUpdate();
          },
          (newName: string) => { ctx.registry.set('playerName', newName); playerName.setText(newName.slice(0, 14)); sendNameUpdate(newName); },
          (_newConfig: any) => { this.refresh(); },
          (sel: PetSelection) => { this.switchPet(sel); },
          (newStatus: string) => { playerStatusText.setText(newStatus.slice(0, 30)); playerStatusText.setAlpha(newStatus ? 1 : 0); },
          (trackId: any) => { if (isOwner) sendChat(`/game:music:${trackId}`); },
          ['wardrobe', 'profile', 'room'],
          (newItemId?: string) => {
            computerUI.close();
            this.refresh(() => {
              if (!this.arrangeMode) this.toggleArrangeMode(() => this.openComputer('room'), true, newItemId);
            });
          },
          'room',
        ),
      });
    }
  }

  updateFrame(playerX: number): void {
    const { isOwner } = this.ctx;
    if (isOwner) {
      const near = playerX > 560 && playerX < 740;
      if (near !== this.nearComputerField) this.nearComputerField = near;
      this.setComputerPromptVisible(near && !this.ctx.computerUI.isOpen());
    }
    if (this.hasBookcaseField) {
      const nearShelf = playerX > 715 && playerX < 830;
      if (nearShelf !== this.nearBookcaseField) this.nearBookcaseField = nearShelf;
      this.setBookcasePromptVisible(nearShelf && !BookcaseModal.isOpen());
    }
  }

  handleEsc(): boolean {
    if (!this.ctx) return false;
    if (this.arrangeMode) return true;
    if (BookcaseModal.isOpen()) {
      if (document.getElementById('profile-modal')) return true;
      BookcaseModal.destroy();
      return true;
    }
    if (this.ctx.computerUI.isOpen()) {
      this.ctx.computerUI.close();
      this.setComputerPromptVisible(this.nearComputerField);
      return true;
    }
    return false;
  }

  onTKey(): void {
    const { computerUI, isOwner, registry } = this.ctx;
    if (computerUI.isOpen()) {
      computerUI.close();
      this.setComputerPromptVisible(this.nearComputerField);
      return;
    }
    if (isOwner) {
      this.openComputer();
    } else {
      computerUI.open(
        undefined,
        (newName: string) => { registry.set('playerName', newName); this.ctx.playerName.setText(newName.slice(0, 14)); sendNameUpdate(newName); },
        undefined, undefined, undefined, undefined,
        ['profile'],
      );
    }
  }

  onPlayerJoin(): void {
    const { isOwner, roomId, scene } = this.ctx;
    if (isOwner) {
      scene.time.delayedCall(300, () => sendChat(`/game:music:${SoundEngine.get().myRoomTrack}`));
    }
  }

  onChatCommand(pk: string, text: string): boolean {
    const { roomId, ownerPubkey } = this.ctx;
    if (text.startsWith('/game:music:') && roomId.startsWith('myroom:') && pk === ownerPubkey) {
      const trackId = text.slice('/game:music:'.length) as any;
      SoundEngine.get().applyMyRoomTrack(trackId);
      return true;
    }
    return false;
  }

  shouldBlockKeys(): boolean {
    return BookcaseModal.isOpen() || this.arrangeMode;
  }

  switchPet(sel: PetSelection): void {
    this.pet?.destroy(); this.pet = null;
    if (sel.species === 'none') return;
    const prefix = petTexKey(sel);
    const size = PET_FRAME_SIZE[sel.species];
    const scene = this.ctx.scene;
    let anyToLoad = false;
    for (const spec of getAnimSpecs(sel.species)) {
      const texKey = `${prefix}-${spec.key}`;
      if (!scene.textures.exists(texKey)) {
        scene.load.spritesheet(texKey, `pets/${sel.species}-${sel.breed}-${spec.key}.png`, { frameWidth: size, frameHeight: size });
        anyToLoad = true;
      }
    }
    if (!scene.textures.exists('meow-vfx')) {
      scene.load.spritesheet('meow-vfx', 'pets/meow-vfx.png', { frameWidth: 16, frameHeight: 16 });
      anyToLoad = true;
    }
    if (!anyToLoad) { this.spawnPet(sel); return; }
    scene.load.once('complete', () => { if (!this.pet) this.spawnPet(sel); });
    scene.load.start();
  }

  refresh(onComplete?: () => void): void {
    const { scene, roomId, neonColor, roomBgImage, roomRenderer } = this.ctx;
    const liveConfig = getRoomConfig();
    this.parsedRoomConfig = liveConfig;
    this.hasBookcaseField = Array.isArray(liveConfig?.furniture) && liveConfig.furniture.includes('bookshelf');
    if (!this.hasBookcaseField) this.setBookcasePromptVisible(false);
    const texKey = roomRenderer.render(scene, roomId, neonColor, GAME_WIDTH, GAME_HEIGHT);
    roomBgImage.setTexture(texKey);
    this.buildForegroundImages(undefined, onComplete);
  }

  destroy(): void {
    this.pet?.destroy(); this.pet = null;
    this.intro.destroy();
    this.toast.destroy();
    BookcaseModal.destroy();
    clearRoomRequestHandler(this.incomingRoomRequestHandler);
    if (this.arrangeMode) this.furnitureDragUI.exit();
  }

  private buildForegroundImages(ownerRoomConfig?: RoomConfig, onComplete?: () => void): void {
    const { scene, roomId, roomRenderer, isOwner } = this.ctx;
    const cfg = ownerRoomConfig ?? (isOwner ? getRoomConfig() : this.parsedRoomConfig);

    // Load missing PNG textures BEFORE destroying existing sprites — avoids blank flash
    const missing = ((cfg?.furniture ?? []) as FurnitureId[]).filter(
      id => PNG_FURNITURE_IDS.has(id) && !scene.textures.exists(`furniture_${id}`)
    );
    if (missing.length > 0) {
      for (const id of missing) {
        const basePath = PNG_FURNITURE_PATHS[id] ?? `assets/furniture/${id}.png`;
        scene.load.image(`furniture_${id}`, import.meta.env.DEV ? `${basePath}?t=${Date.now()}` : basePath);
      }
      scene.load.once('complete', () => this.buildForegroundImages(ownerRoomConfig, onComplete));
      scene.load.start();
      return;
    }

    // All textures ready — now safe to destroy and rebuild
    this.roomItemImages.forEach((img: Phaser.GameObjects.Image) => img.destroy());
    this.roomItemImages.clear();

    const items: { id: FurnitureId; texKey: string }[] = roomRenderer.renderAllFurnitureItems(scene, roomId, GAME_WIDTH, GAME_HEIGHT, ownerRoomConfig);
    for (const { id, texKey } of items) {
      const pos = cfg?.furniturePositions?.[id] ?? getDefaultPos(id);
      const bounds = getFurnitureBounds(scene, id);
      if (!pos || !bounds) continue;
      const img = scene.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, texKey).setDepth(pos.y + bounds.h);
      this.roomItemImages.set(id, img);
    }

    for (const id of (cfg?.furniture ?? []) as FurnitureId[]) {
      if (!PNG_FURNITURE_IDS.has(id)) continue;
      const texKey = `furniture_${id}`;
      if (!scene.textures.exists(texKey)) continue;
      const pos = cfg?.furniturePositions?.[id] ?? getDefaultPos(id);
      const bounds = getFurnitureBounds(scene, id);
      if (!pos || !bounds) continue;
      const color = cfg ? getFurnitureColor(cfg, id) : null;
      const depth = PNG_BACKGROUND_IDS.has(id) ? 1 : pos.y + bounds.h;

      let useKey = texKey;
      if (PNG_TINT_WHITE_IDS.has(id) && color && color !== '#ffffff') {
        useKey = applyWhiteTint(scene, texKey, `${texKey}_tinted`, color);
      }

      const img = scene.add.image(pos.x, pos.y, useKey)
        .setOrigin(0, 0)
        .setDepth(depth);
      if (!PNG_TINT_WHITE_IDS.has(id) && color) img.setTint(hexToNum(color));
      this.roomItemImages.set(id, img);
    }

    onComplete?.();
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

  private onArrangeExit: (() => void) | null = null;
  private arrangeTutorialHint: Phaser.GameObjects.Text | null = null;
  private arrangeTutorialBg: Phaser.GameObjects.Graphics | null = null;

  private toggleArrangeMode(onExit?: () => void, showTutorial = false, newItemId?: string): void {
    this.arrangeMode = !this.arrangeMode;
    if (this.arrangeMode) {
      if (onExit) this.onArrangeExit = onExit;
      this.furnitureDragUI.enter(getRoomConfig(), newItemId as any);
      this.arrangeBtn?.setText('[✓ Done]').setColor(P.pink);
      this.resetArrangeBtn?.setVisible(true);
      this.previewBtn?.setVisible(true);
      if (showTutorial) this._showArrangeTutorial();
    } else {
      if (this.previewMode) this.togglePreviewMode();
      this._destroyArrangeTutorial();
      this.furnitureDragUI.exit();
      this.arrangeBtn?.setText('[Arrange]').setColor(P.teal);
      this.resetArrangeBtn?.setVisible(false);
      this.previewBtn?.setVisible(false);
      publishRoomConfig(getRoomConfig());
      const cb = this.onArrangeExit;
      this.onArrangeExit = null;
      cb?.();
    }
  }

  private _showArrangeTutorial(): void {
    const scene = this.ctx.scene;
    const cx = GAME_WIDTH / 2;
    const y  = GAME_HEIGHT - 36;
    const lines = ['Drag to position your item', 'Press ENTER to confirm placement'];

    this.arrangeTutorialBg = scene.add.graphics().setDepth(300).setScrollFactor(0);
    const bg = this.arrangeTutorialBg;
    bg.fillStyle(0x0a0014, 0.78);
    bg.fillRoundedRect(cx - 155, y - 10, 310, 44, 6);
    bg.lineStyle(1, 0x5dcaa5, 0.35);
    bg.strokeRoundedRect(cx - 155, y - 10, 310, 44, 6);

    this.arrangeTutorialHint = scene.add.text(cx, y + 3, lines, {
      fontFamily: '"Courier New", monospace',
      fontSize: '11px',
      color: P.teal,
      align: 'center',
      lineSpacing: 4,
    }).setOrigin(0.5, 0).setDepth(301).setScrollFactor(0).setAlpha(0);

    scene.tweens.add({ targets: this.arrangeTutorialHint, alpha: 1, duration: 500, ease: 'Quad.easeOut' });
    scene.tweens.add({ targets: this.arrangeTutorialBg,  alpha: 1, duration: 500, ease: 'Quad.easeOut' });
  }

  private _destroyArrangeTutorial(): void {
    this.arrangeTutorialHint?.destroy(); this.arrangeTutorialHint = null;
    this.arrangeTutorialBg?.destroy();  this.arrangeTutorialBg  = null;
  }

  private togglePreviewMode(): void {
    this.previewMode = !this.previewMode;
    this.furnitureDragUI.setPreview(this.previewMode);
    this.ctx.player.setVisible(!this.previewMode);
    this.previewBtn?.setText(this.previewMode ? '[✓ Preview]' : '[Preview]')
      .setColor(this.previewMode ? P.pink : P.lpurp);
  }

  private openComputer(startTab?: 'wardrobe' | 'profile' | 'room'): void {
    const { computerUI, player, playerName, playerStatusText, registry, isOwner } = this.ctx;
    if (computerUI.isOpen()) { computerUI.close(); this.setComputerPromptVisible(this.nearComputerField); return; }
    this.setComputerPromptVisible(false);
    const scene = this.ctx.scene;
    computerUI.open(
      (newAvatar: any) => {
        if (scene.textures.exists('player_room')) scene.textures.remove('player_room');
        scene.textures.addCanvas('player_room', renderRoomSprite(newAvatar));
        player.setTexture('player_room');
        if (scene.textures.exists('player')) scene.textures.remove('player');
        scene.textures.addCanvas('player', renderHubSprite(newAvatar));
        sendAvatarUpdate();
      },
      (newName: string) => { registry.set('playerName', newName); playerName.setText(newName.slice(0, 14)); sendNameUpdate(newName); },
      (_newConfig: any) => { this.refresh(); },
      (sel: PetSelection) => { this.switchPet(sel); },
      (newStatus: string) => { playerStatusText.setText(newStatus.slice(0, 30)); playerStatusText.setAlpha(newStatus ? 1 : 0); },
      (trackId: any) => { if (isOwner) sendChat(`/game:music:${trackId}`); },
      undefined,
      (newItemId?: string) => {
        computerUI.close();
        this.refresh(() => {
          if (!this.arrangeMode) this.toggleArrangeMode(() => this.openComputer('room'), false, newItemId);
        });
      },
      startTab,
    );
  }

  private openBookcase(): void {
    if (BookcaseModal.isOpen()) { BookcaseModal.destroy(); return; }
    this.setBookcasePromptVisible(false);
    const ownerPubkey = this.ctx.ownerPubkey || this.ctx.registry.get('playerPubkey');
    BookcaseModal.show(ownerPubkey);
  }

  private spawnPet(sel: PetSelection): void {
    if (sel.species === 'none') return;
    this.pet = new PetSprite();
    this.pet.create(this.ctx.scene, sel);
  }
}

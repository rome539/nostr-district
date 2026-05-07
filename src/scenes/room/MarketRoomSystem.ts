import Phaser from 'phaser';
import { GAME_WIDTH, P, hexToNum } from '../../config/game.config';
import { MarketPanel } from '../../ui/MarketPanel';

export class MarketRoomSystem {
  private shopPrompt!: Phaser.GameObjects.Text;
  private shopPromptBg!: Phaser.GameObjects.Graphics;
  private nearShop = false;

  setup(scene: Phaser.Scene): void {
    this.shopPromptBg = scene.add.graphics().setDepth(50).setVisible(false);
    this.shopPromptBg.fillStyle(hexToNum(P.bg), 0.9);
    this.shopPromptBg.fillRoundedRect(0, 0, 128, 28, 5);
    this.shopPromptBg.lineStyle(1, hexToNum(P.amber), 0.3);
    this.shopPromptBg.strokeRoundedRect(0, 0, 128, 28, 5);
    this.shopPrompt = scene.add.text(0, 0, '[E] Browse Shop', {
      fontFamily: '"Courier New", monospace', fontSize: '11px', color: P.amber, fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.shopPrompt.setInteractive();
    this.shopPrompt.on('pointerdown', () => { if (this.nearShop) MarketPanel.open(); });

    scene.input.keyboard?.on('keydown-E', () => {
      if (this.nearShop) MarketPanel.open();
    });
  }

  setVisible(visible: boolean): void {
    this.shopPrompt.setVisible(visible);
    this.shopPromptBg.setVisible(visible);
    if (visible) {
      this.shopPromptBg.setPosition(GAME_WIDTH / 2 - 64, 200);
      this.shopPrompt.setPosition(GAME_WIDTH / 2, 214);
    }
  }

  update(playerX: number, isIntroActive: boolean): void {
    if (isIntroActive) return;
    const near = playerX > 80 && playerX < GAME_WIDTH - 80;
    if (near !== this.nearShop) this.nearShop = near;
    this.setVisible(near && !MarketPanel.isOpen());
  }

  handleEsc(): boolean {
    if (MarketPanel.isOpen()) {
      MarketPanel.destroy();
      this.setVisible(this.nearShop);
      return true;
    }
    return false;
  }

  destroy(): void {
    // Graphics objects are cleaned up by Phaser scene shutdown
  }
}

import Phaser from 'phaser';
import { GAME_WIDTH, P, hexToNum, fitPromptBubble, positionPromptBubble } from '../../config/game.config';
import { MarketPanel } from '../../ui/MarketPanel';
import { t as ti18n } from '../../i18n/i18n';

export class MarketRoomSystem {
  private shopPrompt!: Phaser.GameObjects.Text;
  private shopPromptBg!: Phaser.GameObjects.Graphics;
  private nearShop = false;

  setup(scene: Phaser.Scene): void {
    this.shopPromptBg = scene.add.graphics().setDepth(50).setVisible(false);
    this.shopPrompt = scene.add.text(0, 0, `[E] ${ti18n('prompt.browse_shop')}`, {
      fontFamily: '"Courier New", monospace', fontSize: '11px', color: P.amber, fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(51).setVisible(false);
    fitPromptBubble(this.shopPromptBg, this.shopPrompt, { minWidth: 128, fill: hexToNum(P.bg), fillAlpha: 0.9, stroke: hexToNum(P.amber), strokeAlpha: 0.3 });
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
      this.shopPrompt.setPosition(GAME_WIDTH / 2, 214);
      positionPromptBubble(this.shopPromptBg, GAME_WIDTH / 2, 200);
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

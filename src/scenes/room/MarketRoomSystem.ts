import Phaser from 'phaser';
import { GAME_WIDTH, P, hexToNum, fitPromptBubble, positionPromptBubble } from '../../config/game.config';
import { MarketPanel } from '../../ui/MarketPanel';
import { t as ti18n } from '../../i18n/i18n';

export class MarketRoomSystem {
  private shopPrompt!: Phaser.GameObjects.Text;
  private shopPromptBg!: Phaser.GameObjects.Graphics;
  private shopPromptArrow!: Phaser.GameObjects.Text;
  private nearShop = false;
  private scene!: Phaser.Scene;
  private shopShown = false;

  setup(scene: Phaser.Scene): void {
    this.scene = scene;
    this.shopPromptBg = scene.add.graphics().setDepth(50).setVisible(false);
    this.shopPrompt = scene.add.text(0, 0, `[E] ${ti18n('prompt.browse_shop')}`, {
      fontFamily: '"Courier New", monospace', fontSize: '11px', color: P.amber, fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.shopPromptArrow = scene.add.text(0, 0, '▼', {
      fontFamily: 'monospace', fontSize: '9px', color: P.amber,
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
    this.shopPromptArrow.setVisible(visible);
    if (visible && !this.shopShown) {
      // Position once on show — let the tween own y from here on
      this.shopPrompt.setPosition(GAME_WIDTH / 2, 209);
      positionPromptBubble(this.shopPromptBg, GAME_WIDTH / 2, 200);
      this.shopPromptArrow.setPosition(GAME_WIDTH / 2, 222);
      this.scene.tweens.killTweensOf(this.shopPromptArrow);
      this.scene.tweens.add({ targets: this.shopPromptArrow, y: 227, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.shopShown = true;
    } else if (!visible) {
      this.scene.tweens.killTweensOf(this.shopPromptArrow);
      this.shopShown = false;
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

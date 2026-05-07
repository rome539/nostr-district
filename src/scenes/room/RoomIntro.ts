import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, P } from '../../config/game.config';
import { markSetupComplete } from '../../stores/roomStore';

export interface RoomIntroCallbacks {
  addSystemMessage: (msg: string, color: string) => void;
  openTerminal: () => void;
}

export class RoomIntro {
  isActive = false;
  private overlay: Phaser.GameObjects.Graphics | null = null;
  private mainText: Phaser.GameObjects.Text | null = null;

  start(scene: Phaser.Scene, callbacks: RoomIntroCallbacks): void {
    this.isActive = true;

    this.overlay = scene.add.graphics().setDepth(500);
    this.overlay.fillStyle(0x0a0014, 0.85);
    this.overlay.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    this.mainText = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30, '', {
      fontFamily: '"Courier New", monospace', fontSize: '18px', color: P.teal,
      align: 'center', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(501).setAlpha(0);

    this.mainText.setText('Welcome home.');
    scene.tweens.add({
      targets: this.mainText, alpha: 1, duration: 1200, ease: 'Quad.easeOut',
      onComplete: () => {
        scene.time.delayedCall(1500, () => {
          const subtitle = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10, "Let's make this place yours.", {
            fontFamily: '"Courier New", monospace', fontSize: '12px', color: P.lpurp, align: 'center',
          }).setOrigin(0.5).setDepth(501).setAlpha(0);

          scene.tweens.add({
            targets: subtitle, alpha: 0.7, duration: 800, ease: 'Quad.easeOut',
            onComplete: () => {
              scene.time.delayedCall(1800, () => {
                scene.tweens.add({
                  targets: [this.overlay, this.mainText, subtitle],
                  alpha: 0, duration: 600, ease: 'Quad.easeIn',
                  onComplete: () => {
                    this.overlay?.destroy();  this.overlay = null;
                    this.mainText?.destroy(); this.mainText = null;
                    subtitle.destroy();
                    this.isActive = false;
                    markSetupComplete();
                    callbacks.addSystemMessage('Terminal opened — customize your room!', P.teal);
                    callbacks.openTerminal();
                  },
                });
              });
            },
          });
        });
      },
    });
  }

  destroy(): void {
    this.overlay?.destroy();  this.overlay = null;
    this.mainText?.destroy(); this.mainText = null;
    this.isActive = false;
  }
}

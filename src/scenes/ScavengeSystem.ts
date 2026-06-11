/**
 * ScavengeSystem.ts — Renders the global scavenge spots that happen to be in the
 * current scene. There are only two spots in the entire game at a time; this just
 * draws whichever ones are here, handles the [E] search, and tells the store to
 * collect (which rerolls that spot to a new random scene/position).
 */
import Phaser from 'phaser';
import { fitPromptBubble, positionPromptBubble, hexToNum, P } from '../config/game.config';
import { getSceneScavengeSpots, collectScavengeSlot, ScavengeSpot, ItemDef } from '../stores/tradeItemStore';

export class ScavengeSystem {
  private markerG: Phaser.GameObjects.Graphics;
  private promptBg: Phaser.GameObjects.Graphics;
  private promptText: Phaser.GameObjects.Text;
  private promptArrow: Phaser.GameObjects.Text;
  private nearSpot: ScavengeSpot | null = null;
  private spots: ScavengeSpot[] = [];
  private isTouch: boolean;

  constructor(
    private scene: Phaser.Scene,
    private sceneId: string,
    private groundY: number,
    private getPlayer: () => { x: number; y: number },
    private accent: string = P.amber,
  ) {
    this.isTouch = scene.sys.game.device.input.touch;
    this.spots = getSceneScavengeSpots(sceneId);
    this.markerG = scene.add.graphics().setDepth(2);
    this.promptBg = scene.add.graphics().setDepth(50).setScrollFactor(0).setVisible(false);
    this.promptText = scene.add.text(0, 0, '', {
      fontFamily: '"Courier New", monospace', fontSize: '10px', color: accent, fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(51).setScrollFactor(0).setVisible(false);
    this.promptArrow = scene.add.text(0, 0, '▼', {
      fontFamily: 'monospace', fontSize: '9px', color: accent,
    }).setOrigin(0.5).setDepth(51).setScrollFactor(0).setVisible(false);
    this.promptBg.on('pointerdown', () => this.tryInteract());
  }

  update(time: number): void {
    const player = this.getPlayer();
    this.markerG.clear();

    let near: ScavengeSpot | null = null;
    for (const spot of this.spots) {
      this.drawMarker(spot, time);
      if (Math.abs(player.x - spot.x) <= 40) near = spot;
    }
    this.nearSpot = near;

    if (near) {
      const ac = near.accent ?? this.accent;
      this.promptText.setText(`${this.isTouch ? '[TAP]' : '[E]'} Search`);
      this.promptText.setColor(ac);
      fitPromptBubble(this.promptBg, this.promptText, {
        minWidth: 100, fill: 0x0a0a14, fillAlpha: 0.92, stroke: hexToNum(ac), strokeAlpha: 0.7,
      });
      const zoom = this.scene.cameras.main.zoom;
      const sx = near.x - this.scene.cameras.main.scrollX;
      const sy = this.groundY - this.scene.cameras.main.scrollY - 70 / zoom;
      positionPromptBubble(this.promptBg, sx, sy - 2);
      this.promptText.setPosition(sx, sy + 7);
      this.promptArrow.setPosition(sx, sy + 19);
      this.promptBg.setVisible(true);
      this.promptText.setVisible(true);
      this.promptArrow.setVisible(true);
    } else {
      this.promptBg.setVisible(false);
      this.promptText.setVisible(false);
      this.promptArrow.setVisible(false);
    }
  }

  /** Call from the scene's E key handler. Returns true if it handled the press. */
  tryInteract(): boolean {
    if (!this.nearSpot) return false;
    const id = this.nearSpot.id;
    // The SERVER rolls what the spot contained and answers with item_minted —
    // the toast + reward chime both come from the mint handler (BaseScene) when
    // the result actually arrives, so nothing fires if the server rejects it.
    collectScavengeSlot(id);
    // Remove the collected spot from this scene's view (it rerolled elsewhere)
    this.spots = this.spots.filter(s => s.id !== id);
    this.nearSpot = null;
    return true;
  }

  destroy(): void {
    this.markerG.destroy();
    this.promptBg.destroy();
    this.promptText.destroy();
    this.promptArrow.destroy();
  }

  private drawMarker(spot: ScavengeSpot, time: number): void {
    const g = this.markerG;
    const cx = spot.x, cy = this.groundY;
    const ac = hexToNum(spot.accent ?? this.accent);
    // Holiday spots glint a touch brighter so they stand out as special
    const boost = spot.accent ? 0.15 : 0;
    const twinkle = 0.18 + boost + Math.sin(time * 0.004 + cx) * 0.12;
    g.fillStyle(ac, twinkle * 0.4);
    g.fillCircle(cx, cy - 4, spot.accent ? 7 : 5);
    g.fillStyle(ac, twinkle + 0.25);
    g.fillRect(cx - 1, cy - 5, 2, 2);
  }
}

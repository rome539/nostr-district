import Phaser from 'phaser';
import { GAME_WIDTH, P, hexToRgb, hexToNum } from '../../config/game.config';
import { popFeedNote, type FeedEvent, resumeFeedService, pauseFeedService } from '../../nostr/feedService';

interface FeedNote {
  npub: string; text: string; color: string;
  y: number; targetY: number; alpha: number; age: number;
  npubText?: Phaser.GameObjects.Text;
  msgText?: Phaser.GameObjects.Text;
}

export class RoomFeedSystem {
  private scene!: Phaser.Scene;
  private notes: FeedNote[] = [];
  private wasActiveFeed = false;
  graphics!: Phaser.GameObjects.Graphics;

  create(scene: Phaser.Scene, roomId: string): void {
    this.scene = scene;
    this.graphics = scene.add.graphics().setDepth(4);
    if (roomId === 'feed') {
      resumeFeedService();
      this.wasActiveFeed = true;
    }
  }

  reset(): void {
    this.notes = [];
  }

  update(time: number, delta: number): void {
    this.graphics.clear();
    const dt = delta / 1000;
    const scrollSpeed = 22;
    const bottomY = 268;
    const topY = 62;
    const contentY = 84;
    const rowH = 22;
    const W = GAME_WIDTH;

    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i];
      n.age += delta;
      n.y -= scrollSpeed * dt;
      if (n.alpha < 1) n.alpha = Math.min(1, n.alpha + delta * 0.005);
      if (n.y < contentY + 20) n.alpha = Math.max(0, (n.y - contentY) / 20);
      if (n.y < topY) {
        n.npubText?.destroy();
        n.msgText?.destroy();
        this.notes.splice(i, 1);
        continue;
      }
      const ey = Math.round(n.y);
      const ta = n.alpha;
      const textVisible = ey >= contentY;
      if (n.npubText) { n.npubText.setPosition(66, ey + 2); n.npubText.setAlpha(textVisible ? ta : 0); }
      if (n.msgText)  { n.msgText.setPosition(160, ey + 2); n.msgText.setAlpha(textVisible ? ta : 0); }
      if (n.alpha > 0) {
        const isEven = Math.round((ey - 84) / rowH) % 2 === 0;
        this.graphics.fillStyle(isEven ? 0x0a0818 : 0x0c0a20, n.alpha * 0.7);
        this.graphics.fillRect(44, ey, W - 88, 18);
        const rgb = hexToRgb(n.color);
        const dc = Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b);
        this.graphics.fillStyle(dc, n.alpha * 0.35);
        this.graphics.fillCircle(55, ey + 9, 4);
        if (n.age < 1200) {
          this.graphics.fillStyle(dc, Math.sin(n.age * 0.006) * 0.08 * n.alpha);
          this.graphics.fillCircle(55, ey + 9, 7);
        }
      }
    }

    // Cover rect — paint over anything that bled into the header zone
    this.graphics.fillStyle(0x0a0818, 1);
    this.graphics.fillRect(30, 48, W - 60, contentY - 48);

    const last = this.notes[this.notes.length - 1];
    if (!last || last.y < bottomY - rowH) {
      const ev = popFeedNote();
      if (ev) this.spawnNote(ev);
    }

    this.graphics.fillStyle(hexToNum(P.red), 0.4 + Math.sin(time * 0.005) * 0.4);
    this.graphics.fillCircle(60, 64, 3);
  }

  private spawnNote(ev: FeedEvent): void {
    const colors = [P.pink, P.purp, P.teal, P.amber];
    const color = colors[Math.abs(ev.pubkey.charCodeAt(0)) % colors.length];
    const ts = { fontFamily: 'monospace', fontSize: '8px', color: '#fff' };
    const startY = 268;
    const msgX = 160;
    const rightPad = 52;
    const maxMsgWidth = GAME_WIDTH - msgX - rightPad;
    const displayContent = this.truncateText(ev.content, { ...ts, color: P.lcream }, maxMsgWidth);
    const n: FeedNote = { npub: ev.npub, text: ev.content, color, y: startY, targetY: startY, alpha: 0, age: 0 };
    n.npubText = this.scene.add.text(66, startY, ev.npub, { ...ts, color, fontStyle: 'bold' }).setDepth(5).setAlpha(0);
    n.msgText  = this.scene.add.text(msgX, startY, displayContent, {
      ...ts, color: P.lcream, fixedWidth: maxMsgWidth, wordWrap: { width: maxMsgWidth, useAdvancedWrap: false },
    }).setDepth(5).setAlpha(0);
    this.notes.push(n);
  }

  private truncateText(text: string, style: Phaser.Types.GameObjects.Text.TextStyle, maxWidth: number): string {
    const probe = this.scene.add.text(-9999, -9999, '', style).setVisible(false);
    if (probe.setText(text).width <= maxWidth) { probe.destroy(); return text; }
    const ellipsis = '...';
    let low = 0, high = text.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      probe.setText(text.slice(0, mid) + ellipsis);
      if (probe.width <= maxWidth) low = mid;
      else high = mid - 1;
    }
    const result = text.slice(0, Math.max(0, low)) + ellipsis;
    probe.destroy();
    return result;
  }

  destroy(): void {
    this.notes.forEach(n => { n.npubText?.destroy(); n.msgText?.destroy(); });
    this.notes = [];
    if (this.wasActiveFeed) pauseFeedService();
  }
}

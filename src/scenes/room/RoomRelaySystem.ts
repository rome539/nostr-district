import Phaser from 'phaser';
import { P, hexToNum } from '../../config/game.config';
import { getRelayManager } from '../../nostr/dmService';
import { DEFAULT_RELAYS } from '../../nostr/relayManager';
import { getEventRate } from '../../nostr/feedService';

export class RoomRelaySystem {
  private lines: { dot: Phaser.GameObjects.Graphics; lat: Phaser.GameObjects.Text }[] = [];
  private headerText: Phaser.GameObjects.Text | null = null;
  private countText: Phaser.GameObjects.Text | null = null;
  private eventsText: Phaser.GameObjects.Text | null = null;
  private updateTimer = 0;

  setup(scene: Phaser.Scene): void {
    const rm = getRelayManager();
    if (rm) rm.pingAll();

    const ts = { fontFamily: 'monospace', fontSize: '9px' };
    const relays = DEFAULT_RELAYS.slice(0, 7);

    const overlay = scene.add.graphics().setDepth(4);
    overlay.fillStyle(0x0a0818, 1);
    overlay.fillRect(461, 40, 289, 24);
    overlay.fillRect(461, 78, 289, relays.length * 26);

    this.headerText = scene.add.text(605, 57, 'RELAY STATUS: CHECKING...', {
      ...ts, fontSize: '11px', color: P.teal, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(5);

    relays.forEach((url, i) => {
      const ry = 78 + i * 26;
      const dot = scene.add.graphics().setDepth(5);
      scene.add.text(484, ry + 14, url.replace('wss://', ''), { ...ts, color: P.lcream }).setAlpha(0.5).setDepth(5);
      const lat = scene.add.text(740, ry + 14, '—', { ...ts, color: P.teal }).setOrigin(1, 0).setAlpha(0.5).setDepth(5);
      this.lines.push({ dot, lat });
    });

    const footOverlay = scene.add.graphics().setDepth(4);
    footOverlay.fillStyle(0x080616, 1);
    footOverlay.fillRect(461, 268, 289, 20);

    this.countText = scene.add.text(530, 282, '...', {
      ...ts, fontSize: '8px', color: P.amber, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(5);

    this.eventsText = scene.add.text(680, 282, '...', {
      ...ts, fontSize: '8px', color: P.pink, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(5);
  }

  update(delta: number, globalPlayerCount: number): void {
    this.updateTimer += delta;
    if (this.updateTimer < 800) return;
    this.updateTimer = 0;

    const rm = getRelayManager();
    const statuses = rm ? rm.getRelayStatuses() : [];
    const statusMap = new Map(statuses.map(s => [s.url, s]));
    const relays = DEFAULT_RELAYS.slice(0, 7);

    let connectedCount = 0;
    relays.forEach((url, i) => {
      const line = this.lines[i];
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

    this.headerText?.setText(`RELAY STATUS: ${connectedCount}/${relays.length} CONNECTED`);
    this.headerText?.setColor(connectedCount > 0 ? P.teal : P.red);
    this.countText?.setText(`${globalPlayerCount} ONLINE`);
    const evRate = getEventRate();
    this.eventsText?.setText(evRate > 0 ? `${evRate.toLocaleString()} EVENTS/HR` : '— EVENTS/HR');
  }

  destroy(): void {
    this.lines.forEach(l => { l.dot.destroy(); l.lat.destroy(); });
    this.lines = [];
    this.headerText?.destroy();  this.headerText = null;
    this.countText?.destroy();   this.countText = null;
    this.eventsText?.destroy();  this.eventsText = null;
  }
}

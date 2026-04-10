/**
 * relayManager.ts — Raw WebSocket relay pool for NIP-17 gift wraps
 *
 * Modeled on NYM's relay architecture:
 * - Dedicated DM relay list (the same relays NYM uses for reliable delivery)
 * - Fan-out publishing: send to DM relays first, then all other connected relays
 * - Auto-reconnect with exponential backoff
 * - 30s keepalive pings to prevent idle disconnects
 * - Reconnect catch-up: re-subscribes for missed gift wraps after reconnection
 * - Staggered publish delays (150ms between events) to avoid relay rate limiting
 */

// ── The relay lists NYM uses for reliable DM delivery ──
export const DM_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://offchain.pub',
  'wss://relay.0xchat.com',
  'wss://nostr21.com',
];

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.mostr.pub',
  'wss://offchain.pub',
  'wss://relay.0xchat.com',
  'wss://nostr21.com',
  'wss://nostr-pub.wellorder.net',
  'wss://relay.nostr.net',
  'wss://nostr.mom',
];

interface ManagedRelay {
  url: string;
  ws: WebSocket | null;
  backoff: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  keepaliveTimer: ReturnType<typeof setInterval> | null;
  isDMRelay: boolean;
  pingSubId?: string;
  pingStart?: number;
  latencyMs?: number;
}

type EventHandler = (event: any, relayUrl: string) => void;
type EoseHandler = (subId: string, relayUrl: string) => void;

export class RelayManager {
  private relays = new Map<string, ManagedRelay>();
  private subscriptions = new Map<string, { filters: any[]; onEvent: EventHandler; onEose?: EoseHandler }>();
  private eventHandlers: EventHandler[] = [];
  private eoseHandlers: EoseHandler[] = [];
  private processedEventIds = new Set<string>();
  private _destroyed = false;

  // Stats
  public connectedCount = 0;
  public lastEventTime = 0;

  constructor(customRelays?: string[]) {
    // If custom relays provided, use only those; otherwise use full default set
    const allUrls = customRelays
      ? new Set(customRelays)
      : new Set([...DM_RELAYS, ...DEFAULT_RELAYS]);
    const dmSet = new Set(DM_RELAYS);

    for (const url of allUrls) {
      this.relays.set(url, {
        url,
        ws: null,
        backoff: 1000,
        reconnectTimer: null,
        keepaliveTimer: null,
        isDMRelay: dmSet.has(url),
      });
    }
  }

  // ════════════════════════════════════════════
  // LIFECYCLE
  // ════════════════════════════════════════════

  /** Connect to all relays */
  connectAll(): void {
    for (const relay of this.relays.values()) {
      this.connectRelay(relay);
    }
  }

  /** Disconnect and clean up everything */
  destroy(): void {
    this._destroyed = true;
    for (const relay of this.relays.values()) {
      if (relay.reconnectTimer) clearTimeout(relay.reconnectTimer);
      if (relay.keepaliveTimer) clearInterval(relay.keepaliveTimer);
      if (relay.ws) {
        relay.ws.onopen = null;
        relay.ws.onmessage = null;
        relay.ws.onerror = null;
        relay.ws.onclose = null;
        relay.ws.close();
      }
    }
    this.relays.clear();
    this.subscriptions.clear();
    this.eventHandlers = [];
    this.eoseHandlers = [];
    this.processedEventIds.clear();
  }

  // ════════════════════════════════════════════
  // CONNECTION
  // ════════════════════════════════════════════

  private connectRelay(relay: ManagedRelay): void {
    if (this._destroyed) return;
    if (relay.ws && relay.ws.readyState === WebSocket.OPEN) return;

    // Clean up existing socket
    if (relay.ws) {
      relay.ws.onopen = null;
      relay.ws.onmessage = null;
      relay.ws.onerror = null;
      relay.ws.onclose = null;
      try { relay.ws.close(); } catch (_) {}
    }

    try {
      relay.ws = new WebSocket(relay.url);
    } catch (e) {
      console.warn(`[Relay] Failed to create WebSocket for ${relay.url}:`, e);
      this.scheduleReconnect(relay);
      return;
    }

    relay.ws.onopen = () => {
      console.log(`[Relay] Connected: ${relay.url}`);
      relay.backoff = 1000; // reset backoff on successful connection
      this.updateConnectedCount();

      // Start keepalive ping every 30s
      if (relay.keepaliveTimer) clearInterval(relay.keepaliveTimer);
      relay.keepaliveTimer = setInterval(() => {
        if (relay.ws?.readyState === WebSocket.OPEN) {
          try {
            const pingId = `kp-${Date.now()}`;
            relay.pingSubId = pingId;
            relay.pingStart = Date.now();
            relay.ws.send(JSON.stringify(['REQ', pingId, { kinds: [0], limit: 0 }]));
            setTimeout(() => {
              if (relay.ws?.readyState === WebSocket.OPEN) {
                try { relay.ws.send(JSON.stringify(['CLOSE', pingId])); } catch (_) {}
              }
            }, 500);
          } catch (_) {}
        }
      }, 30000);

      // Re-send all active subscriptions to this newly connected relay
      for (const [subId, sub] of this.subscriptions) {
        this.sendToRelay(relay, JSON.stringify(['REQ', subId, ...sub.filters]));
      }
    };

    relay.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (!Array.isArray(data)) return;

        if (data[0] === 'EVENT' && data.length >= 3) {
          const nostrEvent = data[2];
          if (!nostrEvent?.id) return;

          // Deduplicate across relays
          if (this.processedEventIds.has(nostrEvent.id)) return;
          this.processedEventIds.add(nostrEvent.id);

          // Cap dedup set
          if (this.processedEventIds.size > 5000) {
            const arr = Array.from(this.processedEventIds);
            this.processedEventIds = new Set(arr.slice(-2500));
          }

          this.lastEventTime = Date.now();

          // Notify subscription-specific handler
          const subId = data[1];
          const sub = this.subscriptions.get(subId);
          if (sub?.onEvent) {
            sub.onEvent(nostrEvent, relay.url);
          }

          // Notify global handlers
          for (const handler of this.eventHandlers) {
            handler(nostrEvent, relay.url);
          }
        } else if (data[0] === 'EOSE' && data.length >= 2) {
          const subId = data[1];
          if (relay.pingSubId === subId && relay.pingStart) {
            relay.latencyMs = Date.now() - relay.pingStart;
            relay.pingSubId = undefined;
            relay.pingStart = undefined;
          }
          const sub = this.subscriptions.get(subId);
          if (sub?.onEose) {
            sub.onEose(subId, relay.url);
          }
          for (const handler of this.eoseHandlers) {
            handler(subId, relay.url);
          }
        } else if (data[0] === 'OK' && data.length >= 4) {
          if (!data[2]) {
            // Publish rejected
            console.warn(`[Relay] ${relay.url} rejected event: ${data[3]}`);
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    relay.ws.onerror = () => {
      // onclose will fire after this, so we handle reconnect there
    };

    relay.ws.onclose = () => {
      console.log(`[Relay] Disconnected: ${relay.url}`);
      if (relay.keepaliveTimer) {
        clearInterval(relay.keepaliveTimer);
        relay.keepaliveTimer = null;
      }
      relay.ws = null;
      this.updateConnectedCount();
      this.scheduleReconnect(relay);
    };
  }

  private scheduleReconnect(relay: ManagedRelay): void {
    if (this._destroyed) return;
    if (relay.reconnectTimer) return; // already scheduled

    const delay = relay.backoff + Math.random() * 1000;
    relay.reconnectTimer = setTimeout(() => {
      relay.reconnectTimer = null;
      relay.backoff = Math.min(relay.backoff * 1.5, 30000); // cap at 30s
      this.connectRelay(relay);
    }, delay);
  }

  private updateConnectedCount(): void {
    let count = 0;
    for (const r of this.relays.values()) {
      if (r.ws?.readyState === WebSocket.OPEN) count++;
    }
    this.connectedCount = count;
  }

  // ════════════════════════════════════════════
  // SUBSCRIPTIONS
  // ════════════════════════════════════════════

  /** Subscribe to events matching filters across all connected relays */
  subscribe(subId: string, filters: any[], onEvent: EventHandler, onEose?: EoseHandler): void {
    this.subscriptions.set(subId, { filters, onEvent, onEose });

    const msg = JSON.stringify(['REQ', subId, ...filters]);
    for (const relay of this.relays.values()) {
      this.sendToRelay(relay, msg);
    }
  }

  /** Close a subscription */
  unsubscribe(subId: string): void {
    this.subscriptions.delete(subId);
    const msg = JSON.stringify(['CLOSE', subId]);
    for (const relay of this.relays.values()) {
      this.sendToRelay(relay, msg);
    }
  }

  /** Add a global event listener (called for all incoming events) */
  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter(h => h !== handler);
    };
  }

  /** Add a global EOSE listener */
  onEose(handler: EoseHandler): () => void {
    this.eoseHandlers.push(handler);
    return () => {
      this.eoseHandlers = this.eoseHandlers.filter(h => h !== handler);
    };
  }

  // ════════════════════════════════════════════
  // PUBLISHING — NYM-style fan-out
  // ════════════════════════════════════════════

  /**
   * Publish an event to all connected relays.
   * DM relays are sent to first (priority), then all others.
   * Returns the number of relays the event was sent to.
   */
  publish(event: any): number {
    const msg = JSON.stringify(['EVENT', event]);
    const sent = new Set<string>();

    // Priority: DM relays first
    for (const relay of this.relays.values()) {
      if (relay.isDMRelay && relay.ws?.readyState === WebSocket.OPEN) {
        relay.ws.send(msg);
        sent.add(relay.url);
      }
    }

    // Then fan out to all other connected relays
    for (const relay of this.relays.values()) {
      if (!sent.has(relay.url) && relay.ws?.readyState === WebSocket.OPEN) {
        relay.ws.send(msg);
        sent.add(relay.url);
      }
    }

    return sent.size;
  }

  /**
   * Publish multiple events with staggered delays (150ms apart)
   * to avoid relay rate limiting. NYM does this for gift wraps.
   */
  async publishStaggered(events: any[]): Promise<number> {
    let totalSent = 0;
    for (let i = 0; i < events.length; i++) {
      totalSent += this.publish(events[i]);
      if (i < events.length - 1) {
        await new Promise(r => setTimeout(r, 150));
      }
    }
    return totalSent;
  }

  /**
   * Catch-up subscription for missed gift wraps after reconnection.
   * NYM does this on every relay reconnect.
   */
  catchUpGiftWraps(pubkey: string, sinceTimestamp: number): void {
    const since = Math.max(
      sinceTimestamp - 300, // 5-min buffer
      Math.floor(Date.now() / 1000) - 604800 // at most 7 days back
    );

    const subId = `catchup-${Date.now()}`;
    const filter = { kinds: [1059], '#p': [pubkey], since, limit: 200 };

    this.subscribe(subId, [filter], (event, relayUrl) => {
      // Events will be handled by the normal gift wrap handler
    });

    // Close catch-up sub after 10s
    setTimeout(() => {
      this.unsubscribe(subId);
    }, 10000);
  }

  // ════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════

  private sendToRelay(relay: ManagedRelay, msg: string): void {
    if (relay.ws?.readyState === WebSocket.OPEN) {
      try {
        relay.ws.send(msg);
      } catch (e) {
        console.warn(`[Relay] Send failed to ${relay.url}:`, e);
      }
    }
  }

  /** Get count of connected relays */
  getConnectedCount(): number {
    this.updateConnectedCount();
    return this.connectedCount;
  }

  /** Check if at least one relay is connected */
  isConnected(): boolean {
    for (const r of this.relays.values()) {
      if (r.ws?.readyState === WebSocket.OPEN) return true;
    }
    return false;
  }

  /** Get per-relay connection status and latency */
  getRelayStatuses(): { url: string; connected: boolean; latencyMs: number }[] {
    return Array.from(this.relays.values()).map(r => ({
      url: r.url,
      connected: r.ws?.readyState === WebSocket.OPEN,
      latencyMs: r.latencyMs ?? 0,
    }));
  }

  /** Trigger immediate latency pings on all connected relays */
  pingAll(): void {
    for (const relay of this.relays.values()) {
      if (relay.ws?.readyState === WebSocket.OPEN) {
        try {
          const pingId = `ping-${relay.url}-${Date.now()}`;
          relay.pingSubId = pingId;
          relay.pingStart = Date.now();
          relay.ws.send(JSON.stringify(['REQ', pingId, { kinds: [0], limit: 0 }]));
          setTimeout(() => {
            if (relay.ws?.readyState === WebSocket.OPEN) {
              try { relay.ws.send(JSON.stringify(['CLOSE', pingId])); } catch (_) {}
            }
          }, 1000);
        } catch (_) {}
      }
    }
  }
}
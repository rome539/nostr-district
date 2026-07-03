/**
 * relayManager.ts — Raw WebSocket relay pool for NIP-17 gift wraps
 *
 * Architectural patterns here are inspired by NYM (https://github.com/Spl0itable/NYM);
 * the implementation in this file is independent and original. Capabilities:
 * - Dedicated DM relay list for reliable gift-wrap delivery
 * - Fan-out publishing: send to DM relays first, then all other connected relays
 * - Auto-reconnect with exponential backoff
 * - 30s keepalive pings to prevent idle disconnects
 * - Reconnect catch-up: re-subscribes for missed gift wraps after reconnection
 * - Staggered publish delays (150ms between events) to avoid relay rate limiting
 * - Cloudflare relay proxy: when VITE_RELAY_PROXY="" is set, connections route
 *   through /api/relay on the current host (Cloudflare Pages Worker) so relay
 *   operators see Cloudflare IPs instead of user IPs. Falls back to direct
 *   connection automatically if the proxy fails.
 */

/**
 * Base URL for the relay proxy, or null for direct connections.
 *
 * Enable the /api/relay Worker proxy by setting `VITE_RELAY_PROXY` to any
 * truthy value (e.g. "1", "true", "on") in your Cloudflare Pages production
 * environment. Leave the variable unset, or set to "0" / "false" / "off"
 * to keep direct relay connections (the same behavior every other Nostr
 * web client uses by default).
 */
const RELAY_PROXY_BASE: string | null = (() => {
  if (!import.meta.env.PROD) return null;
  const raw = (import.meta.env.VITE_RELAY_PROXY as string | undefined) ?? '';
  const flag = raw.trim().toLowerCase();
  const enabled = flag === '1' || flag === 'true' || flag === 'on' || flag === 'yes';
  if (!enabled) return null;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
})();

function proxyUrl(relayWss: string): string {
  if (!RELAY_PROXY_BASE) return relayWss;
  return `${RELAY_PROXY_BASE}/api/relay?relay=${encodeURIComponent(relayWss)}`;
}

// ── Dedicated relay list for reliable DM (NIP-17 gift-wrap) delivery ──
export const DM_RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.0xchat.com',
];

export const DEFAULT_RELAYS = [
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.mostr.pub',
  'wss://relay.0xchat.com',
  'wss://nostr21.com',
  'wss://nostr-pub.wellorder.net',
  'wss://relay.nostr.net',
  'wss://nostr.mom',
  'wss://relay.coinos.io',
  'wss://relay.mostr.pub',
  'wss://relay1.nostrchat.io',
  // yakihonne relays removed — they were flapping (repeated WS disconnects)
  // and spamming the console with reconnect noise without contributing
  // event coverage we don't already get from the others.
  'wss://relay.satlantis.io',
  'wss://relay.fountain.fm',
];

// If a proxied relay opens then closes within this window, treat it as a
// proxy-side rejection (some operators block Cloudflare egress IPs after
// accepting the handshake) and fall back to a direct connection for the
// rest of the session.
const PROXY_FLAP_WINDOW_MS = 3000;

// ── Circuit breaker for chronically-bad relays ──
// A connection that never stays open at least STABLE_MS (or fails to open at
// all) counts as a "strike". After MAX_STRIKES consecutive strikes the relay is
// quarantined: reconnects pause for QUARANTINE_MS, then it gets one fresh shot.
// This stops dead/flapping relays (relay.nostr.net, offchain.pub) from looping
// reconnects forever without removing them from the pool — a stable connection
// clears the strikes and the relay returns to normal.
const STABLE_MS = 45000;     // a connection must hold this long to be "healthy"
const MAX_STRIKES = 5;       // consecutive unstable connects before quarantine
const QUARANTINE_MS = 300000; // 5-minute cooldown before retrying a bad relay

interface ManagedRelay {
  url: string;
  ws: WebSocket | null;
  backoff: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  keepaliveTimer: ReturnType<typeof setInterval> | null;
  stableTimer?: ReturnType<typeof setTimeout> | null; // fires once a connection proves stable → resets backoff + strikes
  isDMRelay: boolean;
  useDirect: boolean; // true after proxy fails — use direct connection
  openedAt?: number;  // timestamp of last successful onopen (for flap detection)
  strikes: number;    // consecutive unstable connects (circuit breaker)
  quarantinedUntil?: number; // timestamp until which reconnects are paused
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
        useDirect: false,
        strikes: 0,
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
      if (relay.stableTimer) clearTimeout(relay.stableTimer);
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

    const connectUrl = (relay.useDirect || !RELAY_PROXY_BASE)
      ? relay.url
      : proxyUrl(relay.url);

    try {
      relay.ws = new WebSocket(connectUrl);
    } catch (e) {
      console.warn(`[Relay] Failed to create WebSocket for ${relay.url}:`, e);
      this.scheduleReconnect(relay);
      return;
    }

    relay.ws.onopen = () => {
      if (import.meta.env.DEV) console.log(`[Relay] Connected: ${relay.url}`);
      relay.openedAt = Date.now();
      this.updateConnectedCount();
      // Reset backoff + strikes only once the connection proves STABLE (stays open
      // STABLE_MS). A relay that connects then drops (flapping, e.g. relay.nostr.net)
      // never reaches this, so its strikes accumulate toward the circuit breaker
      // instead of resetting its backoff on every brief connect.
      if (relay.stableTimer) clearTimeout(relay.stableTimer);
      relay.stableTimer = setTimeout(() => { relay.backoff = 1000; relay.strikes = 0; }, STABLE_MS);

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
      // If we were trying the proxy and it failed, fall back to direct
      if (!relay.useDirect && RELAY_PROXY_BASE) {
        if (import.meta.env.DEV) console.log(`[Relay] Proxy failed for ${relay.url}, falling back to direct`);
        relay.useDirect = true;
      }
      // onclose will fire after this, so we handle reconnect there
    };

    relay.ws.onclose = () => {
      if (import.meta.env.DEV) console.log(`[Relay] Disconnected: ${relay.url}`);
      if (relay.keepaliveTimer) {
        clearInterval(relay.keepaliveTimer);
        relay.keepaliveTimer = null;
      }
      // Cancel the pending "stable → reset backoff" check: the socket dropped before it
      // proved stable, so its backoff must keep escalating rather than reset.
      if (relay.stableTimer) { clearTimeout(relay.stableTimer); relay.stableTimer = null; }

      // Proxy flap detection: if we connected via the proxy and the socket
      // closed almost immediately after opening, the upstream relay is
      // likely rejecting our Cloudflare egress IP. Drop to a direct
      // connection on the next attempt instead of looping forever.
      const everOpened = relay.openedAt !== undefined;
      const openMs = everOpened ? Date.now() - relay.openedAt! : 0;
      const wasProxied = !relay.useDirect && RELAY_PROXY_BASE !== null;
      if (wasProxied && everOpened && openMs < PROXY_FLAP_WINDOW_MS) {
        if (import.meta.env.DEV) console.log(`[Relay] Proxy flap for ${relay.url} (${openMs}ms) — falling back to direct`);
        relay.useDirect = true;
        relay.backoff = 1000; // retry direct immediately, don't punish with backoff
        relay.strikes = 0;    // a proxy flap isn't the relay's fault — don't quarantine it
      } else if (!everOpened || openMs < STABLE_MS) {
        // Circuit breaker: the socket failed to open, or dropped before proving
        // stable. Count a strike; quarantine the relay once it hits MAX_STRIKES.
        relay.strikes += 1;
        if (relay.strikes >= MAX_STRIKES && !relay.quarantinedUntil) {
          relay.quarantinedUntil = Date.now() + QUARANTINE_MS;
          if (import.meta.env.DEV) {
            console.log(`[Relay] Quarantining ${relay.url} for ${QUARANTINE_MS / 60000}min after ${relay.strikes} unstable connects`);
          }
        }
      }

      relay.openedAt = undefined;
      relay.ws = null;
      this.updateConnectedCount();
      this.scheduleReconnect(relay);
    };
  }

  private scheduleReconnect(relay: ManagedRelay): void {
    if (this._destroyed) return;
    if (relay.reconnectTimer) return; // already scheduled

    const now = Date.now();
    const quarantined = relay.quarantinedUntil && relay.quarantinedUntil > now;
    const delay = quarantined
      ? relay.quarantinedUntil! - now + Math.random() * 1000
      : relay.backoff + Math.random() * 1000;

    relay.reconnectTimer = setTimeout(() => {
      relay.reconnectTimer = null;
      if (relay.quarantinedUntil && Date.now() >= relay.quarantinedUntil) {
        // Coming out of quarantine — give the relay a clean slate for one shot.
        relay.quarantinedUntil = undefined;
        relay.strikes = 0;
        relay.backoff = 1000;
      } else {
        relay.backoff = Math.min(relay.backoff * 1.5, 30000); // cap at 30s
      }
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
  // PUBLISHING — DM-priority fan-out
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
   * to avoid relay rate limiting — especially relevant when fanning
   * out a batch of gift wraps.
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
   * Catch-up subscription for missed gift wraps after reconnection —
   * re-queries each relay for events since the last successful read,
   * with a 5-minute overlap to absorb clock skew.
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
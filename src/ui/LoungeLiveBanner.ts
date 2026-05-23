/**
 * LoungeLiveBanner.ts — Top-of-Lounge banner shown when one or more
 * allowlisted streamers are live-broadcasting via NIP-53.
 *
 * Subscribes to {@link subscribeToLiveStream}, swaps the lounge audio over to
 * the active HLS feed via {@link SoundEngine.setLoungeLiveStream}, and shows
 * a compact "🎧 LIVE: <title>" pill with a zap button. When two or more
 * streams are live, a chevron opens a dropdown of all currently-live
 * channels — clicking one swaps the local audio (per-user, no server sync).
 *
 * When the active stream goes off-air, the banner falls back to the auto-
 * picked stream from the service. When NO stream is live, the banner
 * unmounts and the Lounge plays the default Backbay Lounge MP3.
 */
import {
  subscribeToLiveStream, refreshLiveStream,
  getCurrentLiveStream, getAllLiveStreams,
  LiveStream,
} from '../nostr/liveStreamService';
import { SoundEngine } from '../audio/SoundEngine';
import { ZapModal } from './ZapModal';
import { fetchProfile } from '../nostr/nostrService';
import { sendLoungeListening, setLoungeListenersHandler } from '../nostr/presenceService';
import { boltIcon } from './icons';

const BANNER_ID    = 'lounge-live-banner';
const PICKER_ID    = 'lounge-live-picker';
const FAIL_HINT_MS = 6_000;

export class LoungeLiveBanner {
  private el: HTMLDivElement | null = null;
  private pickerEl: HTMLDivElement | null = null;
  private unsub: (() => void) | null = null;
  private resizeHandler: (() => void) | null = null;
  /** Observes the Phaser canvas directly so the banner repositions whenever
   *  the canvas resizes — including devtools open/close, which doesn't
   *  always fire a window `resize` event. */
  private canvasResizeObserver: ResizeObserver | null = null;
  /** Lookup table for resolved streamer names (pubkey hex → display name). */
  private nameCache = new Map<string, string>();
  /** The (pubkey, channel) the user explicitly picked; null = auto-pick. */
  private manualPick: { pubkey: string; channel: string } | null = null;
  /** Streams that errored this session (stale 30311, 404, codec fail, etc.)
   *  — keyed by `pubkey:channel`. Skipped in {@link resolveActive} so we
   *  auto-fall-back to a working stream. Cleared on lounge exit so a stream
   *  that recovers between sessions gets reconsidered. */
  private brokenStreams = new Set<string>();
  /** The most recent stream that errored AND was replaced — used to render
   *  a small "couldn't load X, playing Y" hint above the banner. Cleared
   *  when the banner unmounts, the user picks something manually, or after
   *  {@link FAIL_HINT_MS} so the hint doesn't linger forever. */
  private lastFailedName: string | null = null;
  private failHintTimer: ReturnType<typeof setTimeout> | null = null;
  private docClickHandler: ((e: MouseEvent) => void) | null = null;
  /** streamKey → number of other lounge visitors listening, pushed from
   *  the server's lounge_listeners broadcast. */
  private listenerCounts = new Map<string, number>();
  /** The streamKey we last broadcast to the server. Avoids re-sending the
   *  same value on every render. */
  private lastBroadcastKey: string | null = null;

  async mount(): Promise<void> {
    if (this.el) return;
    this.unsub = subscribeToLiveStream(() => this.render());
    this.resizeHandler = () => this.reposition();
    window.addEventListener('resize', this.resizeHandler);
    // Also watch the canvas directly — covers cases where the window stays
    // the same size but the canvas resizes (devtools panel, browser UI
    // chrome toggling, etc.) and no window resize event fires.
    const canvas = document.querySelector('canvas');
    if (canvas && typeof ResizeObserver !== 'undefined') {
      this.canvasResizeObserver = new ResizeObserver(() => this.reposition());
      this.canvasResizeObserver.observe(canvas);
    }
    // Listen for lounge-wide listener-count updates from the server. We
    // count INCLUDING ourselves — feels more accurate to the user ("3
    // listening" not "2 others") and matches what zap.stream etc. show.
    setLoungeListenersHandler((listeners) => {
      this.listenerCounts.clear();
      for (const key of Object.values(listeners)) {
        this.listenerCounts.set(key, (this.listenerCounts.get(key) ?? 0) + 1);
      }
      if (this.pickerEl) {
        const all = getAllLiveStreams();
        const active = this.resolveActive();
        if (active) this.paintPicker(all, active);
      }
    });
    // Race the first relay poll against a 1.5s timeout — whichever resolves
    // first, render once so the audio source decision is made exactly once.
    await Promise.race([
      refreshLiveStream(),
      new Promise<void>(r => setTimeout(r, 1500)),
    ]);
    this.render();
  }

  unmount(): void {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    if (this.canvasResizeObserver) {
      this.canvasResizeObserver.disconnect();
      this.canvasResizeObserver = null;
    }
    setLoungeListenersHandler(null);
    this.listenerCounts.clear();
    // Tell the server we're no longer listening so other lounge visitors'
    // counts drop us immediately (server also clears on room change, but
    // an explicit signal avoids relying on that path).
    if (this.lastBroadcastKey !== null) {
      sendLoungeListening(null);
      this.lastBroadcastKey = null;
    }
    if (this.docClickHandler) {
      document.removeEventListener('click', this.docClickHandler);
      this.docClickHandler = null;
    }
    this.closePicker();
    if (this.failHintTimer) { clearTimeout(this.failHintTimer); this.failHintTimer = null; }
    if (this.el) { this.el.remove(); this.el = null; }
    this.manualPick     = null;
    this.brokenStreams.clear();
    this.lastFailedName = null;
    // Revert audio when the banner tears down — the user has left the
    // Lounge, so RoomScene's next setRoom will start the appropriate music.
    SoundEngine.get().setLoungeLiveStream(null);
  }

  /**
   * Resolve which stream to actually play right now:
   *   1. The user's manual pick if it's still live AND not in {@link brokenStreams}
   *   2. The service's auto-pick if it's not broken
   *   3. The next-newest live stream that isn't broken
   *   4. null (nobody usable is live)
   */
  private resolveActive(): LiveStream | null {
    const all     = getAllLiveStreams();
    const healthy = all.filter(s => !this.brokenStreams.has(streamKey(s)));

    if (this.manualPick) {
      const pick = healthy.find(s =>
        s.pubkey  === this.manualPick!.pubkey &&
        s.channel === this.manualPick!.channel
      );
      if (pick) return pick;
      // User's pick went off-air OR is broken — clear it and fall through
      // to auto-pick. (If broken, the error handler already recorded the
      // failure name; if just off-air, no "failed" hint is appropriate.)
      this.manualPick = null;
    }

    // Auto-pick already prefers most-recently-started. Filter out broken
    // ones and take the first healthy entry.
    const auto = getCurrentLiveStream();
    if (auto && !this.brokenStreams.has(streamKey(auto))) return auto;
    return healthy[0] ?? null;
  }

  /**
   * Called when the currently-playing stream errors (404, codec fail,
   * stale 30311, network drop). Marks the stream as broken for this
   * session, records its name for the "couldn't load X" hint, and
   * re-renders so the next-best stream takes over.
   */
  private onActiveStreamError(stream: LiveStream): void {
    const key = streamKey(stream);
    if (this.brokenStreams.has(key)) return; // dedupe
    this.brokenStreams.add(key);
    this.lastFailedName = this.nameCache.get(stream.pubkey) || stream.pubkey.slice(0, 8) + '…';
    // Auto-dismiss the hint after a few seconds — long enough to be noticed,
    // short enough not to linger forever.
    if (this.failHintTimer) clearTimeout(this.failHintTimer);
    this.failHintTimer = setTimeout(() => {
      this.failHintTimer = null;
      this.lastFailedName = null;
      if (this.el) this.render();
    }, FAIL_HINT_MS);
    // Force a fresh audio start by resetting the engine's "already started"
    // cache — otherwise setLoungeLiveStream may early-out thinking the
    // current URL is already playing.
    SoundEngine.get().setLoungeLiveStream(null);
    this.render();
  }

  private render(): void {
    const active = this.resolveActive();
    const all    = getAllLiveStreams();

    if (!active) {
      // Nobody usable is live — tear down banner, revert audio to default
      // MP3. Don't clear brokenStreams; if a stream recovers between polls
      // we want to skip it for the rest of the session.
      this.closePicker();
      if (this.el) { this.el.remove(); this.el = null; }
      SoundEngine.get().setLoungeLiveStream(null);
      if (this.lastBroadcastKey !== null) {
        sendLoungeListening(null);
        this.lastBroadcastKey = null;
      }
      return;
    }

    SoundEngine.get().setLoungeLiveStream(
      active.hlsUrl,
      () => this.onActiveStreamError(active),
    );

    // Tell other lounge visitors what we're listening to (so they see the
    // listener count next to this stream in their picker). Skip if it
    // hasn't changed since the last broadcast.
    const myKey = streamKey(active);
    if (this.lastBroadcastKey !== myKey) {
      sendLoungeListening(myKey);
      this.lastBroadcastKey = myKey;
    }

    // Lazy-fetch the streamer's display name once per pubkey.
    if (!this.nameCache.has(active.pubkey)) {
      this.nameCache.set(active.pubkey, active.pubkey.slice(0, 8) + '…');
      const pk = active.pubkey;
      fetchProfile(pk)
        .then(p => {
          const name = p?.display_name || p?.name;
          if (name) this.nameCache.set(pk, name);
          // Re-render if the cached name was used in the current paint.
          const cur = this.resolveActive();
          if (cur?.pubkey === pk && this.el) this.paint(cur, all);
        })
        .catch(() => { /* keep the truncated pubkey */ });
    }
    // Also pre-fetch names for the rest so the picker shows them populated.
    for (const s of all) {
      if (!this.nameCache.has(s.pubkey)) {
        this.nameCache.set(s.pubkey, s.pubkey.slice(0, 8) + '…');
        const pk = s.pubkey;
        fetchProfile(pk).then(p => {
          const name = p?.display_name || p?.name;
          if (name) this.nameCache.set(pk, name);
          if (this.pickerEl) this.paintPicker(all, active);
        }).catch(() => {});
      }
    }

    if (!this.el) {
      this.el = document.createElement('div');
      this.el.id = BANNER_ID;
      document.body.appendChild(this.el);
    }
    this.paint(active, all);
    if (this.pickerEl) this.paintPicker(all, active);
  }

  private paint(active: LiveStream, all: LiveStream[]): void {
    if (!this.el) return;
    const artistName = this.nameCache.get(active.pubkey) || active.pubkey.slice(0, 8) + '…';
    // Show total live count in the chevron — including broken streams, since
    // the picker now exposes them as "retry" rows that the user can manually
    // recover.
    const totalCount = all.length;
    const hasOthers  = totalCount > 1;
    const failHint     = this.lastFailedName
      ? `<div class="llb-fail">couldn't load ${esc(this.lastFailedName)} — playing ${esc(artistName)}</div>`
      : '';
    this.el.innerHTML = `
      ${failHint}
      <div class="llb-main">
        <div class="llb-pulse"></div>
        <div class="llb-text">
          <div class="llb-row">
            <span class="llb-live">LIVE</span>
            <span class="llb-title">${esc(active.title)}</span>
            ${hasOthers ? `<button class="llb-chev" title="Switch stream (${totalCount} live)">▾ ${totalCount}</button>` : ''}
          </div>
          <div class="llb-artist">${esc(artistName)}</div>
        </div>
        <button class="llb-zap" title="Zap the artist">${boltIcon(14, '#f0b040')}</button>
      </div>
      ${this.styleBlock()}
    `;
    this.el.querySelector('.llb-zap')?.addEventListener('click', (e) => {
      e.stopPropagation();
      ZapModal.show(active.pubkey, artistName);
    });
    if (hasOthers) {
      this.el.querySelector('.llb-chev')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePicker(all, active);
      });
    }
    this.reposition();
  }

  /** Show/hide the dropdown listing every currently-live stream. */
  private togglePicker(all: LiveStream[], active: LiveStream): void {
    if (this.pickerEl) { this.closePicker(); return; }
    this.pickerEl = document.createElement('div');
    this.pickerEl.id = PICKER_ID;
    document.body.appendChild(this.pickerEl);
    this.paintPicker(all, active);
    // Outside-click to close.
    setTimeout(() => {
      this.docClickHandler = (e) => {
        const t = e.target as Node;
        if (!this.pickerEl?.contains(t) && !this.el?.contains(t)) this.closePicker();
      };
      document.addEventListener('click', this.docClickHandler);
    }, 0);
  }

  private closePicker(): void {
    if (this.pickerEl) { this.pickerEl.remove(); this.pickerEl = null; }
    if (this.docClickHandler) {
      document.removeEventListener('click', this.docClickHandler);
      this.docClickHandler = null;
    }
  }

  private paintPicker(all: LiveStream[], active: LiveStream): void {
    if (!this.pickerEl) return;
    // Show EVERY live stream — even ones we previously marked broken — so a
    // streamer who fixed their feed mid-session is reachable. Broken rows
    // get a "retry" affordance; clicking them clears the broken flag.
    const rows = all.map(s => {
      const name = this.nameCache.get(s.pubkey) || s.pubkey.slice(0, 8) + '…';
      const isActive = s.pubkey === active.pubkey && s.channel === active.channel;
      const isBroken = this.brokenStreams.has(streamKey(s));
      const listeners = this.listenerCounts.get(streamKey(s)) ?? 0;
      const listenerLabel = listeners > 0
        ? `<span class="llb-pick-listeners" title="${listeners} listening">${listeners} listening</span>`
        : '';
      return `
        <button class="llb-pick-row ${isActive ? 'llb-pick-active' : ''} ${isBroken ? 'llb-pick-broken' : ''}"
                data-pk="${esc(s.pubkey)}" data-ch="${esc(s.channel)}">
          <span class="llb-pick-dot">${isActive ? '●' : isBroken ? '⟳' : '○'}</span>
          <div class="llb-pick-info">
            <div class="llb-pick-title">${esc(s.title)}${isBroken ? ' <span class="llb-pick-tag">retry</span>' : ''}</div>
            <div class="llb-pick-artist">${esc(name)}${listenerLabel ? ' · ' + listenerLabel : ''}</div>
          </div>
        </button>`;
    }).join('');
    this.pickerEl.innerHTML = `<div class="llb-pick-wrap">${rows}</div>${this.pickerStyleBlock()}`;
    this.pickerEl.querySelectorAll('.llb-pick-row').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pk = (btn as HTMLElement).dataset.pk!;
        const ch = (btn as HTMLElement).dataset.ch!;
        if (pk === active.pubkey && ch === active.channel) {
          this.closePicker();
          return;
        }
        // Clear the broken flag for whichever stream the user is choosing —
        // they're explicitly asking us to try again.
        this.brokenStreams.delete(`${pk}:${ch}`);
        this.manualPick     = { pubkey: pk, channel: ch };
        this.lastFailedName = null;
        if (this.failHintTimer) { clearTimeout(this.failHintTimer); this.failHintTimer = null; }
        // Force a fresh start so the engine doesn't early-out on cache hit.
        SoundEngine.get().setLoungeLiveStream(null);
        this.closePicker();
        this.render();
      });
    });
    this.repositionPicker();
  }

  /** Center the banner above the canvas top edge, accounting for scaling. */
  private reposition(): void {
    if (!this.el) return;
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    this.el.style.left = `${rect.left + rect.width / 2}px`;
    this.el.style.top  = `${rect.top + 12}px`;
    this.el.style.transform = 'translateX(-50%)';
    if (this.pickerEl) this.repositionPicker();
  }

  private repositionPicker(): void {
    if (!this.pickerEl || !this.el) return;
    const r = this.el.getBoundingClientRect();
    this.pickerEl.style.left = `${r.left + r.width / 2}px`;
    this.pickerEl.style.top  = `${r.bottom + 6}px`;
    this.pickerEl.style.transform = 'translateX(-50%)';
  }

  private styleBlock(): string {
    return `<style>
      #${BANNER_ID} {
        position: fixed; z-index: 480;
        display: flex; flex-direction: column; gap: 4px;
        padding: 8px 12px;
        background: color-mix(in srgb, #1a0a1f 85%, transparent);
        backdrop-filter: blur(6px);
        border: 1px solid color-mix(in srgb, #ff5b8a 55%, transparent);
        border-radius: 10px;
        color: #f5e2ec;
        font-family: 'Courier New', monospace; font-size: 11px;
        box-shadow: 0 4px 18px rgba(0,0,0,0.45);
        pointer-events: auto;
      }
      #${BANNER_ID} .llb-main { display: flex; align-items: center; gap: 10px; }
      #${BANNER_ID} .llb-fail {
        font-size: 9px; color: #f0a040; opacity: 0.85;
        font-style: italic; padding: 1px 0 2px;
        border-bottom: 1px dashed color-mix(in srgb, #f0a040 35%, transparent);
      }
      #${BANNER_ID} .llb-pulse {
        width: 8px; height: 8px; border-radius: 50%;
        background: #ff5b8a; box-shadow: 0 0 8px #ff5b8a;
        animation: llb-pulse 1.4s ease-in-out infinite; flex-shrink: 0;
      }
      @keyframes llb-pulse {
        0%,100% { opacity: 0.4; transform: scale(0.9); }
        50%     { opacity: 1;   transform: scale(1.1); }
      }
      #${BANNER_ID} .llb-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      #${BANNER_ID} .llb-row  { display: flex; align-items: center; gap: 6px; }
      #${BANNER_ID} .llb-live {
        color: #ff5b8a; font-weight: bold; font-size: 9px; letter-spacing: 0.1em;
        border: 1px solid color-mix(in srgb, #ff5b8a 60%, transparent);
        border-radius: 3px; padding: 1px 4px;
      }
      #${BANNER_ID} .llb-title  { color: #ffd9e6; font-weight: bold; }
      #${BANNER_ID} .llb-artist { color: #c898b0; font-size: 9px; opacity: 0.9; }
      #${BANNER_ID} .llb-chev {
        background: rgba(255,91,138,0.12);
        border: 1px solid color-mix(in srgb, #ff5b8a 40%, transparent);
        color: #ffd9e6; cursor: pointer;
        font-size: 10px; padding: 3px 7px; border-radius: 4px;
        font-family: inherit; transition: background 0.15s;
        min-height: 24px; touch-action: manipulation;
      }
      #${BANNER_ID} .llb-chev:hover { background: rgba(255,91,138,0.28); }
      #${BANNER_ID} .llb-zap {
        background: rgba(0,0,0,0.4);
        border: 1px solid rgba(240,176,64,0.55);
        color: #f0b040; cursor: pointer;
        font-size: 14px; padding: 6px 10px; border-radius: 6px;
        font-family: inherit; transition: background 0.15s, transform 0.1s;
        min-width: 36px; min-height: 32px; touch-action: manipulation;
      }
      #${BANNER_ID} .llb-zap:hover  { background: rgba(240,176,64,0.15); }
      #${BANNER_ID} .llb-zap:active { transform: scale(0.95); }
      @media (max-width: 480px) {
        #${BANNER_ID} {
          max-width: calc(100vw - 24px);
          padding: 6px 9px; gap: 3px;
        }
        #${BANNER_ID} .llb-main  { gap: 7px; }
        #${BANNER_ID} .llb-title { font-size: 10px; word-break: break-word; }
        #${BANNER_ID} .llb-fail  { font-size: 8px; }
      }
    </style>`;
  }

  private pickerStyleBlock(): string {
    return `<style>
      #${PICKER_ID} {
        position: fixed; z-index: 481;
        min-width: 220px; max-width: 320px;
        background: color-mix(in srgb, #1a0a1f 92%, transparent);
        backdrop-filter: blur(8px);
        border: 1px solid color-mix(in srgb, #ff5b8a 45%, transparent);
        border-radius: 8px;
        box-shadow: 0 6px 24px rgba(0,0,0,0.55);
        padding: 4px; pointer-events: auto;
        font-family: 'Courier New', monospace;
      }
      #${PICKER_ID} .llb-pick-wrap { display: flex; flex-direction: column; gap: 2px; }
      #${PICKER_ID} .llb-pick-row {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 11px;
        background: transparent; border: none;
        color: #f5e2ec; cursor: pointer; text-align: left;
        border-radius: 5px; font-family: inherit;
        transition: background 0.12s;
        min-height: 44px; touch-action: manipulation;
      }
      #${PICKER_ID} .llb-pick-row:hover { background: rgba(255,91,138,0.16); }
      #${PICKER_ID} .llb-pick-active   { background: rgba(255,91,138,0.22); }
      #${PICKER_ID} .llb-pick-dot      { color: #ff5b8a; font-size: 12px; }
      #${PICKER_ID} .llb-pick-info     { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      #${PICKER_ID} .llb-pick-title    { color: #ffd9e6; font-size: 11px; font-weight: bold; }
      #${PICKER_ID} .llb-pick-artist   { color: #c898b0; font-size: 9px; }
      #${PICKER_ID} .llb-pick-broken .llb-pick-title,
      #${PICKER_ID} .llb-pick-broken .llb-pick-artist { opacity: 0.55; }
      #${PICKER_ID} .llb-pick-broken .llb-pick-dot    { color: #f0a040; }
      #${PICKER_ID} .llb-pick-tag {
        font-size: 8px; color: #f0a040; font-weight: normal;
        letter-spacing: 0.08em;
        border: 1px solid color-mix(in srgb, #f0a040 50%, transparent);
        border-radius: 3px; padding: 1px 4px; margin-left: 5px;
      }
      #${PICKER_ID} .llb-pick-listeners {
        color: #5dcaa5; font-size: 9px; opacity: 0.85;
      }
      @media (max-width: 480px) {
        #${PICKER_ID} {
          min-width: 0; max-width: calc(100vw - 24px); width: calc(100vw - 24px);
        }
      }
    </style>`;
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Stable identity for a (pubkey, channel) pair — used as broken-set keys. */
function streamKey(s: LiveStream): string {
  return `${s.pubkey}:${s.channel}`;
}

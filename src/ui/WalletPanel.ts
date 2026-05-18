/**
 * WalletPanel.ts — Lightning wallet (Spark)
 *
 * Opens with [W]. Two tabs:
 *   BALANCE  — shows sats balance and Lightning address (for receiving).
 *   RECEIVE  — generate a BOLT11 invoice (optionally with a fixed amount).
 */

import qrcode from 'qrcode-generator';
import { authStore } from '../stores/authStore';
import { boltIcon } from './icons';
import { WalletInfo } from './WalletInfo';
import {
  getSparkBalance,
  createSparkInvoice,
  sendSparkToLightningAddress,
  getSparkHistory,
  getSparkSdk,
  onSparkPayment,
  type SparkPayment,
} from '../nostr/sparkService';

const PANEL_ID = 'wallet-panel';

type Tab = 'balance' | 'receive' | 'send';

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

function makeQrSvg(data: string): string {
  // BOLT11 invoices are long (~250-400 chars). Uppercase them so the QR
  // encoder picks the more-compact alphanumeric mode (BOLT11 is
  // case-insensitive). Use error-correction level L for the most capacity.
  const payload = data.toUpperCase();
  try {
    const qr = qrcode(0, 'L');
    qr.addData(payload);
    qr.make();
    return qr.createSvgTag({ scalable: true, margin: 1 });
  } catch (e) {
    console.warn('[Wallet] QR encode failed:', e);
    return '';
  }
}

export class WalletPanel {
  private static escHandler:  ((e: KeyboardEvent) => void) | null = null;
  private static unsubPayment: (() => void) | null = null;
  private static _tab:        Tab = 'balance';
  private static _balance:    number | null = null;
  private static _lnAddress:  string | null = null;
  private static _invoice:    string | null = null;
  private static _history:    SparkPayment[] | null = null;
  private static _historyLoading: boolean = false;
  private static _busy:       boolean = false;
  private static _toast:      string | null = null;
  private static _toastTimer: ReturnType<typeof setTimeout> | null = null;

  static isOpen(): boolean { return !!document.getElementById(PANEL_ID); }

  static toggle(): void {
    if (WalletPanel.isOpen()) WalletPanel.destroy();
    else WalletPanel.open();
  }

  static open(): void {
    WalletPanel.destroy();
    WalletPanel._tab = 'balance';
    WalletPanel._invoice = null;
    WalletPanel._history = null;
    WalletPanel._historyLoading = false;
    WalletPanel._busy = false;
    WalletPanel._toast = null;
    WalletPanel._render();
    WalletPanel.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') WalletPanel.destroy();
    };
    window.addEventListener('keydown', WalletPanel.escHandler);

    const backdrop = document.createElement('div');
    backdrop.id = 'wp-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:3999;background:rgba(0,0,0,0.4);backdrop-filter:blur(2px);';
    backdrop.addEventListener('click', () => WalletPanel.destroy());
    backdrop.addEventListener('touchend', () => WalletPanel.destroy(), { passive: true });
    document.body.appendChild(backdrop);

    WalletPanel._refresh();
    WalletPanel._refreshHistory();

    // Live-update balance + history whenever a payment event fires
    WalletPanel.unsubPayment = onSparkPayment(() => {
      WalletPanel._refresh();
      WalletPanel._refreshHistory();
    });
  }

  static destroy(): void {
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById('wp-backdrop')?.remove();
    if (WalletPanel.escHandler) {
      window.removeEventListener('keydown', WalletPanel.escHandler);
      WalletPanel.escHandler = null;
    }
    if (WalletPanel.unsubPayment) {
      WalletPanel.unsubPayment();
      WalletPanel.unsubPayment = null;
    }
    if (WalletPanel._toastTimer) { clearTimeout(WalletPanel._toastTimer); WalletPanel._toastTimer = null; }
  }

  private static async _refresh(): Promise<void> {
    const sdk = getSparkSdk();
    if (!sdk) { WalletPanel._render(); return; }
    try {
      const [bal, addr] = await Promise.all([
        getSparkBalance(),
        sdk.getLightningAddress().catch(() => null),
      ]);
      WalletPanel._balance   = bal;
      WalletPanel._lnAddress = addr?.lightningAddress ?? null;
    } catch {}
    WalletPanel._render();
  }

  private static _showToast(msg: string): void {
    WalletPanel._toast = msg;
    if (WalletPanel._toastTimer) clearTimeout(WalletPanel._toastTimer);

    // Update toast in-place (don't re-render the whole panel — that wipes input fields)
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      let toastEl = panel.querySelector('.wp-toast') as HTMLDivElement | null;
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.className = 'wp-toast';
        panel.appendChild(toastEl);
      }
      toastEl.textContent = msg;
    }

    WalletPanel._toastTimer = setTimeout(() => {
      WalletPanel._toast = null;
      const p = document.getElementById(PANEL_ID);
      p?.querySelector('.wp-toast')?.remove();
    }, 2500);
  }

  private static _render(): void {
    document.getElementById(PANEL_ID)?.remove();
    WalletPanel._injectStyles();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:4000;
      background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
      border:1px solid color-mix(in srgb,var(--nd-accent) 35%,transparent);
      border-radius:12px;padding:18px 18px 16px;
      font-family:'Courier New',monospace;
      box-shadow:0 12px 40px rgba(0,0,0,0.7), 0 0 24px color-mix(in srgb,var(--nd-accent) 12%,transparent);
      width:min(360px,94vw);max-height:90dvh;
      display:flex;flex-direction:column;overflow:hidden;
    `;

    const sdk = getSparkSdk();
    const ready = !!sdk;
    const auth = authStore.getState();

    panel.innerHTML = `
      <!-- Header -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-shrink:0;">
        <span style="color:var(--nd-accent);display:inline-flex;align-items:center;">${boltIcon(15)}</span>
        <div style="color:var(--nd-text);font-size:13px;font-weight:bold;letter-spacing:0.12em;">WALLET</div>
        <button id="wp-info" class="wp-icon-btn" title="About this wallet" aria-label="About this wallet">ⓘ</button>
        <div style="flex:1;"></div>
        <button id="wp-close" class="wp-close-btn">×</button>
      </div>

      ${ready ? WalletPanel._renderTabs() : ''}

      ${!ready ? WalletPanel._renderNotReady(auth.isGuest) : WalletPanel._renderBody()}

      ${WalletPanel._toast ? `<div class="wp-toast">${esc(WalletPanel._toast)}</div>` : ''}
    `;

    document.body.appendChild(panel);
    WalletPanel._bindEvents();
  }

  private static _renderTabs(): string {
    const tabs: { key: Tab; label: string }[] = [
      { key: 'balance', label: 'BALANCE' },
      { key: 'receive', label: 'RECEIVE' },
      { key: 'send',    label: 'SEND'    },
    ];
    return `
      <div style="display:flex;gap:6px;margin-bottom:14px;flex-shrink:0;">
        ${tabs.map(t => {
          const active = t.key === WalletPanel._tab;
          return `<button data-wp-tab="${t.key}" class="wp-tab ${active ? 'wp-tab-active' : ''}">${t.label}</button>`;
        }).join('')}
      </div>
    `;
  }

  private static _renderNotReady(isGuest: boolean): string {
    const msg = isGuest
      ? 'Guest accounts don\'t have a wallet.\nCreate an account to get one automatically.'
      : 'Wallet is initializing...\nThis usually takes a few seconds.';
    return `
      <div style="
        padding:28px 12px;text-align:center;color:var(--nd-subtext);
        font-size:11px;line-height:1.8;white-space:pre-line;
      ">${esc(msg)}</div>
    `;
  }

  private static _renderBody(): string {
    if (WalletPanel._tab === 'balance') return WalletPanel._renderBalance();
    if (WalletPanel._tab === 'receive') return WalletPanel._renderReceive();
    return WalletPanel._renderSend();
  }

  private static _renderHistoryRows(): string {
    const items = WalletPanel._history;

    if (items === null) {
      const msg = WalletPanel._historyLoading ? 'Loading...' : '';
      return msg
        ? `<div style="text-align:center;padding:12px;color:var(--nd-subtext);font-size:10px;opacity:0.6;">${esc(msg)}</div>`
        : '';
    }

    if (items.length === 0) {
      return `<div style="text-align:center;padding:12px;color:var(--nd-subtext);font-size:10px;opacity:0.6;">No activity yet</div>`;
    }

    return items.slice(0, 6).map(p => {
      const incoming = p.type === 'receive';
      const arrow    = incoming ? '↓' : '↑';
      const sign     = incoming ? '+' : '−';
      const color    = incoming
        ? 'var(--nd-accent)'
        : (p.status === 'failed' ? '#ff7070' : 'var(--nd-subtext)');
      const ago      = WalletPanel._relativeTime(p.timestamp);
      const feeNote  = (!incoming && p.fees > 0) ? ` · fee ${p.fees}` : '';
      const status   = p.status === 'completed' ? '' : ` · ${p.status}`;
      return `
        <div class="wp-hist-row">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
            <div style="font-size:13px;color:${color};line-height:1;flex-shrink:0;">${arrow}</div>
            <div style="flex:1;min-width:0;">
              <div style="color:var(--nd-text);font-size:11px;font-weight:bold;">${sign}${p.amount.toLocaleString()} sats</div>
              <div style="color:var(--nd-subtext);font-size:9px;margin-top:1px;">${esc(ago)}${esc(feeNote)}${esc(status)}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  private static _relativeTime(unixSec: number): string {
    if (!unixSec) return '';
    const diff = Date.now() / 1000 - unixSec;
    if (diff < 60)        return 'just now';
    if (diff < 3600)      return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)     return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
    const d = new Date(unixSec * 1000);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  private static async _refreshHistory(): Promise<void> {
    if (!getSparkSdk()) return;
    WalletPanel._historyLoading = true;
    WalletPanel._render();
    const items = await getSparkHistory(50);
    WalletPanel._historyLoading = false;
    WalletPanel._history = items ?? [];
    WalletPanel._render();
  }

  private static _renderSend(): string {
    const bal = WalletPanel._balance;
    const balLabel = bal === null ? '—' : `${bal.toLocaleString()} sats`;
    return `
      <div style="display:flex;flex-direction:column;gap:12px;padding:6px 2px;">
        <div>
          <div style="font-size:9px;color:var(--nd-subtext);letter-spacing:0.12em;margin-bottom:5px;">LIGHTNING ADDRESS</div>
          <input id="wp-send-addr" type="text" placeholder="name@domain.com" autocomplete="off" autocapitalize="off" spellcheck="false" class="wp-input" style="width:100%;" />
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
            <div style="font-size:9px;color:var(--nd-subtext);letter-spacing:0.12em;">AMOUNT (SATS)</div>
            <div style="font-size:9px;color:var(--nd-subtext);">balance: ${esc(balLabel)}</div>
          </div>
          <div style="display:flex;gap:6px;">
            <input id="wp-send-amt" type="number" min="1" placeholder="100" class="wp-input" style="flex:1;min-width:0;text-align:center;" />
            <button id="wp-send-max" class="wp-btn" style="flex:0 0 auto;padding:6px 12px;">MAX</button>
          </div>
          <div style="font-size:9px;color:var(--nd-subtext);margin-top:5px;opacity:0.7;line-height:1.4;">
            Lightning fees vary by route — usually 0–5 sats. Network fee is added on top of your amount.
          </div>
        </div>
        <button id="wp-send-go" class="wp-btn wp-btn-accent" ${WalletPanel._busy ? 'disabled' : ''} style="padding:10px;font-size:11px;">
          ${WalletPanel._busy ? 'SENDING...' : 'SEND PAYMENT'}
        </button>
      </div>
    `;
  }

  private static _renderBalance(): string {
    const bal  = WalletPanel._balance;
    const addr = WalletPanel._lnAddress;
    const balDisplay = bal === null ? '—' : bal.toLocaleString();
    return `
      <div style="display:flex;flex-direction:column;gap:14px;overflow-y:auto;min-height:0;padding:6px 2px 4px;">
        <!-- Balance -->
        <div style="text-align:center;position:relative;">
          <div style="
            font-size:32px;font-weight:bold;color:var(--nd-text);
            letter-spacing:0.02em;line-height:1;
          ">${esc(balDisplay)}</div>
          <div style="
            margin-top:5px;font-size:10px;color:var(--nd-subtext);
            letter-spacing:0.18em;display:inline-flex;align-items:center;gap:8px;
          ">
            SATS
            <button id="wp-balance-refresh" class="wp-balance-refresh-btn" title="Refresh balance" aria-label="Refresh balance">↻</button>
          </div>
        </div>

        <!-- Lightning address -->
        ${addr ? `
          <div>
            <div style="font-size:9px;color:var(--nd-subtext);letter-spacing:0.12em;margin-bottom:5px;text-align:center;">LIGHTNING ADDRESS</div>
            <div style="display:flex;gap:6px;align-items:stretch;">
              <div class="wp-pill" style="flex:1;min-width:0;font-size:12px;display:flex;align-items:center;justify-content:center;">${esc(addr)}</div>
              <button class="wp-btn wp-btn-accent" data-wp-copy="${esc(addr)}" style="flex:0 0 auto;padding:6px 12px;">COPY</button>
            </div>
          </div>
        ` : `
          <div style="text-align:center;color:var(--nd-subtext);font-size:11px;padding:4px 0;">
            Lightning address loading...
          </div>
        `}

        <!-- Recent activity -->
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <div style="font-size:9px;color:var(--nd-subtext);letter-spacing:0.12em;">RECENT ACTIVITY</div>
            <div style="flex:1;height:1px;background:color-mix(in srgb,var(--nd-subtext) 15%,transparent);"></div>
            <button id="wp-refresh" style="
              background:none;border:none;cursor:pointer;
              color:var(--nd-subtext);font-family:'Courier New',monospace;
              font-size:10px;letter-spacing:0.08em;padding:6px 8px;opacity:0.6;
              transition:opacity 0.15s, color 0.15s;
              min-height:32px;
            " onmouseover="this.style.opacity='1';this.style.color='var(--nd-accent)';" onmouseout="this.style.opacity='0.6';this.style.color='var(--nd-subtext)';">↻ REFRESH</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            ${WalletPanel._renderHistoryRows()}
          </div>
        </div>
      </div>
    `;
  }

  private static _renderReceive(): string {
    const inv = WalletPanel._invoice;
    const qrSvg = inv ? makeQrSvg(inv) : '';

    if (inv) {
      return `
        <div style="display:flex;flex-direction:column;gap:14px;overflow-y:auto;min-height:0;">
          <div style="display:flex;justify-content:center;">
            <div class="wp-qr-frame" style="background:#fff;padding:10px;border-radius:8px;width:min(220px,72vw);aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;">${qrSvg}</div>
          </div>
          <div class="wp-pill" style="font-size:10px;max-height:60px;overflow-y:auto;word-break:break-all;">${esc(inv)}</div>
          <div style="display:flex;gap:6px;">
            <button class="wp-btn wp-btn-accent" data-wp-copy="${esc(inv)}" style="flex:1;">COPY INVOICE</button>
            <button class="wp-btn" id="wp-new-inv" style="flex:0 0 auto;">NEW</button>
          </div>
        </div>
      `;
    }

    return `
      <div style="display:flex;flex-direction:column;gap:12px;padding:6px 2px;">
        <div>
          <div style="font-size:9px;color:var(--nd-subtext);letter-spacing:0.12em;margin-bottom:5px;">AMOUNT (OPTIONAL)</div>
          <input id="wp-amt" type="number" min="1" placeholder="leave empty for any amount" class="wp-input" style="width:100%;text-align:center;" />
        </div>
        <div>
          <div style="font-size:9px;color:var(--nd-subtext);letter-spacing:0.12em;margin-bottom:5px;">DESCRIPTION (OPTIONAL)</div>
          <input id="wp-desc" type="text" maxlength="200" placeholder="what's this for?" class="wp-input" style="width:100%;" />
        </div>
        <button id="wp-make" class="wp-btn wp-btn-accent" ${WalletPanel._busy ? 'disabled' : ''} style="padding:10px;font-size:11px;margin-top:4px;">
          ${WalletPanel._busy ? 'CREATING...' : 'GENERATE INVOICE'}
        </button>
      </div>
    `;
  }

  private static _injectStyles(): void {
    if (document.getElementById('wallet-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'wallet-panel-styles';
    style.textContent = `
      #wallet-panel .wp-qr-frame svg { width:100%;height:100%;display:block; }
      #wallet-panel .wp-close-btn {
        background:none;border:none;color:var(--nd-subtext);cursor:pointer;
        font-size:22px;line-height:1;width:34px;height:34px;padding:0;
        display:inline-flex;align-items:center;justify-content:center;
        opacity:0.5;transition:opacity 0.15s;
      }
      #wallet-panel .wp-close-btn:hover { opacity:1; }
      #wallet-panel .wp-icon-btn {
        background:none;border:none;color:var(--nd-subtext);cursor:pointer;
        font-size:16px;line-height:1;width:34px;height:34px;padding:0;
        display:inline-flex;align-items:center;justify-content:center;
        opacity:0.55;transition:opacity 0.15s, color 0.15s;
        font-family:'Courier New',monospace;
      }
      #wallet-panel .wp-icon-btn:hover { opacity:1;color:var(--nd-accent); }
      #wallet-panel .wp-balance-refresh-btn {
        background:none;border:none;cursor:pointer;
        color:var(--nd-subtext);font-family:'Courier New',monospace;
        font-size:12px;line-height:1;padding:2px 4px;opacity:0.55;
        transition:opacity 0.15s, color 0.15s, transform 0.4s;
      }
      #wallet-panel .wp-balance-refresh-btn:hover { opacity:1;color:var(--nd-accent); }
      #wallet-panel .wp-balance-refresh-btn:disabled { cursor:wait; }
      #wallet-panel .wp-tab {
        flex:1;padding:11px 10px;border-radius:6px;cursor:pointer;
        background:color-mix(in srgb,var(--nd-subtext) 6%,transparent);
        border:1px solid color-mix(in srgb,var(--nd-subtext) 20%,transparent);
        color:var(--nd-subtext);font-family:'Courier New',monospace;
        font-size:11px;font-weight:bold;letter-spacing:0.1em;
        transition:all 0.15s;min-height:38px;
      }
      #wallet-panel .wp-tab:hover {
        background:color-mix(in srgb,var(--nd-subtext) 12%,transparent);
        color:var(--nd-text);
      }
      #wallet-panel .wp-tab-active {
        background:color-mix(in srgb,var(--nd-accent) 18%,transparent);
        border-color:color-mix(in srgb,var(--nd-accent) 45%,transparent);
        color:var(--nd-accent);
      }
      #wallet-panel .wp-pill {
        padding:8px 10px;border-radius:6px;color:var(--nd-text);
        background:color-mix(in srgb,black 50%,var(--nd-bg));
        border:1px solid color-mix(in srgb,var(--nd-subtext) 18%,transparent);
        font-family:'Courier New',monospace;box-sizing:border-box;
      }
      #wallet-panel .wp-hist-row {
        padding:8px 10px;border-radius:6px;
        background:color-mix(in srgb,var(--nd-subtext) 5%,transparent);
        border:1px solid color-mix(in srgb,var(--nd-subtext) 12%,transparent);
        transition:border-color 0.15s, background 0.15s;
      }
      #wallet-panel .wp-hist-row:hover {
        border-color:color-mix(in srgb,var(--nd-accent) 35%,transparent);
        background:color-mix(in srgb,var(--nd-accent) 5%,transparent);
      }
      #wallet-panel .wp-input {
        padding:8px 10px;border-radius:6px;box-sizing:border-box;
        background:color-mix(in srgb,black 50%,var(--nd-bg));
        border:1px solid color-mix(in srgb,var(--nd-subtext) 22%,transparent);
        color:var(--nd-text);font-family:'Courier New',monospace;font-size:13px;
        outline:none;transition:border-color 0.15s, box-shadow 0.15s;
      }
      #wallet-panel .wp-input:focus {
        border-color:var(--nd-accent);
        box-shadow:0 0 8px color-mix(in srgb,var(--nd-accent) 25%,transparent);
      }
      #wallet-panel .wp-btn {
        padding:10px 14px;border-radius:6px;cursor:pointer;
        background:color-mix(in srgb,var(--nd-subtext) 8%,transparent);
        border:1px solid color-mix(in srgb,var(--nd-subtext) 25%,transparent);
        color:var(--nd-subtext);font-family:'Courier New',monospace;
        font-size:10px;font-weight:bold;letter-spacing:0.08em;
        transition:all 0.15s;min-height:38px;
      }
      #wallet-panel .wp-btn:hover:not(:disabled) {
        background:color-mix(in srgb,var(--nd-subtext) 15%,transparent);
        color:var(--nd-text);
      }
      #wallet-panel .wp-btn:disabled { opacity:0.5;cursor:wait; }
      #wallet-panel .wp-btn-accent {
        background:color-mix(in srgb,var(--nd-accent) 18%,transparent);
        border-color:color-mix(in srgb,var(--nd-accent) 45%,transparent);
        color:var(--nd-accent);
      }
      #wallet-panel .wp-btn-accent:hover:not(:disabled) {
        background:color-mix(in srgb,var(--nd-accent) 28%,transparent);
        border-color:var(--nd-accent);
        box-shadow:0 0 12px color-mix(in srgb,var(--nd-accent) 25%,transparent);
      }
      #wallet-panel .wp-toast {
        position:absolute;bottom:14px;left:14px;right:14px;
        padding:8px 12px;border-radius:6px;
        background:color-mix(in srgb,var(--nd-accent) 22%,var(--nd-bg));
        border:1px solid color-mix(in srgb,var(--nd-accent) 45%,transparent);
        color:var(--nd-accent);font-size:10px;font-weight:bold;letter-spacing:0.08em;
        text-align:center;line-height:1.5;
        pointer-events:none;
        animation:wp-toast-in 0.2s ease-out;
        word-break:break-word;
      }
      @keyframes wp-toast-in {
        from { opacity:0;transform:translateY(8px); }
        to   { opacity:1;transform:translateY(0); }
      }
      #wallet-panel input::-webkit-outer-spin-button,
      #wallet-panel input::-webkit-inner-spin-button {
        -webkit-appearance:none;margin:0;
      }
      #wallet-panel input[type=number] { -moz-appearance:textfield; }

      /* Scrollbars — themed */
      #wallet-panel *::-webkit-scrollbar { width:6px;height:6px; }
      #wallet-panel *::-webkit-scrollbar-track { background:transparent; }
      #wallet-panel *::-webkit-scrollbar-thumb {
        background:color-mix(in srgb,var(--nd-accent) 35%,transparent);
        border-radius:3px;
      }
      #wallet-panel *::-webkit-scrollbar-thumb:hover {
        background:color-mix(in srgb,var(--nd-accent) 55%,transparent);
      }
      #wallet-panel * {
        scrollbar-width:thin;
        scrollbar-color:color-mix(in srgb,var(--nd-accent) 35%,transparent) transparent;
      }
    `;
    document.head.appendChild(style);
  }

  private static _bindEvents(): void {
    document.getElementById('wp-close')?.addEventListener('click', () => WalletPanel.destroy());
    document.getElementById('wp-info')?.addEventListener('click', () => WalletInfo.open());


    // Tab switching
    document.querySelectorAll<HTMLElement>('#wallet-panel [data-wp-tab]').forEach(el => {
      el.addEventListener('click', () => {
        WalletPanel._tab = (el.getAttribute('data-wp-tab') as Tab) || 'balance';
        WalletPanel._render();
      });
    });

    // Copy
    document.querySelectorAll<HTMLElement>('#wallet-panel [data-wp-copy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const text = btn.getAttribute('data-wp-copy') || '';
        navigator.clipboard.writeText(text)
          .then(() => WalletPanel._showToast('Copied'))
          .catch(() => WalletPanel._showToast('Copy failed'));
      });
    });

    // Refresh balance + history
    document.getElementById('wp-refresh')?.addEventListener('click', () => {
      WalletPanel._balance = null;
      WalletPanel._render();
      WalletPanel._refresh();
      WalletPanel._refreshHistory();
    });

    // Manual balance refresh (next to "SATS" label) — useful after VPN/network
    // restored, when initial Spark connect failed and balance shows "—".
    document.getElementById('wp-balance-refresh')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.style.transform = 'rotate(360deg)';
      btn.disabled = true;
      // Reset the wallet init so a retry can re-attempt the Spark connect
      // (`initSparkWallet` is idempotent — already-initialized SDK skips).
      try {
        const state = (await import('../stores/authStore')).authStore.getState();
        const pk = state.pubkey;
        if (pk) {
          const { initSparkWallet } = await import('../nostr/sparkService');
          const { signEvent } = await import('../nostr/nostrService');
          await initSparkWallet(pk, signEvent).catch(() => {});
        }
      } catch {}
      WalletPanel._balance = null;
      WalletPanel._render();
      await WalletPanel._refresh();
      await WalletPanel._refreshHistory();
    });

    // Generate invoice
    document.getElementById('wp-make')?.addEventListener('click', async () => {
      const amtEl  = document.getElementById('wp-amt')  as HTMLInputElement | null;
      const descEl = document.getElementById('wp-desc') as HTMLInputElement | null;
      const raw    = (amtEl?.value || '').trim();
      const amt    = raw ? Math.floor(Number(raw)) : 0;
      const desc   = (descEl?.value || '').trim() || 'Nostr District';

      WalletPanel._busy = true;
      WalletPanel._render();

      const invoice = await createSparkInvoice(amt, desc);
      WalletPanel._busy = false;

      if (!invoice) { WalletPanel._showToast('Failed to create invoice'); WalletPanel._render(); return; }
      WalletPanel._invoice = invoice;
      WalletPanel._render();
    });

    // Enter key triggers generate from any input on receive tab
    document.getElementById('wp-amt')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); document.getElementById('wp-make')?.click(); }
    });
    document.getElementById('wp-desc')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); document.getElementById('wp-make')?.click(); }
    });

    // New invoice — clear and go back to form
    document.getElementById('wp-new-inv')?.addEventListener('click', () => {
      WalletPanel._invoice = null;
      WalletPanel._render();
    });

    // Send payment to a Lightning address
    const trySend = async () => {
      const addrEl = document.getElementById('wp-send-addr') as HTMLInputElement | null;
      const amtEl  = document.getElementById('wp-send-amt')  as HTMLInputElement | null;
      const addr   = (addrEl?.value || '').trim().toLowerCase();
      const amt    = Math.floor(Number(amtEl?.value || 0));

      if (!addr.includes('@')) { WalletPanel._showToast('Enter a Lightning address'); return; }
      if (!amt || amt < 1) { WalletPanel._showToast('Enter an amount'); return; }

      WalletPanel._busy = true;
      WalletPanel._render();
      const result = await sendSparkToLightningAddress(addr, amt);
      WalletPanel._busy = false;
      if (result.ok) {
        const feeMsg = (result.feeSats ?? 0) > 0 ? ` (fee: ${result.feeSats!.toLocaleString()} sats)` : '';
        WalletPanel._showToast(`Sent ${amt.toLocaleString()} sats ⚡${feeMsg}`);
        WalletPanel._tab = 'balance';
        WalletPanel._balance = null;
        WalletPanel._render();
        WalletPanel._refresh();
      } else {
        WalletPanel._showToast(result.error || 'Payment failed');
        WalletPanel._render();
      }
    };
    document.getElementById('wp-send-go')?.addEventListener('click', trySend);
    document.getElementById('wp-send-addr')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); trySend(); }
    });
    document.getElementById('wp-send-amt')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); trySend(); }
    });

    // MAX button — populate amount with balance (user can adjust down if fee is too high)
    document.getElementById('wp-send-max')?.addEventListener('click', () => {
      const bal = WalletPanel._balance;
      const amtEl = document.getElementById('wp-send-amt') as HTMLInputElement | null;
      if (bal === null) { WalletPanel._showToast('Balance loading...'); return; }
      if (amtEl) amtEl.value = String(bal);
    });
  }
}

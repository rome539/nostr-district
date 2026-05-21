/**
 * WalletHUD.ts — Persistent balance pill, top-right corner
 *
 * Auto-shown when a logged-in (non-guest) user has a Spark wallet.
 * Click to open the wallet panel. Pulses on incoming payments.
 * Sits at z-index 100 so full-screen modal backdrops naturally cover it.
 */

import { authStore } from '../stores/authStore';
import { getSparkBalance, onSparkPayment, getSparkSdk } from '../nostr/sparkService';
import { WalletPanel } from './WalletPanel';
import { boltIcon } from './icons';
import { t as ti18n } from '../i18n/i18n';

const HUD_ID = 'wallet-hud';

export class WalletHUD {
  private static el:           HTMLElement | null = null;
  private static balance:      number | null = null;
  private static unsubAuth:    (() => void) | null = null;
  private static unsubPayment: (() => void) | null = null;
  private static pollTimer:    ReturnType<typeof setInterval> | null = null;

  static init(): void {
    if (WalletHUD.unsubAuth) return; // already initialized

    WalletHUD.injectStyles();

    // React to login/logout
    WalletHUD.unsubAuth = authStore.subscribe(() => WalletHUD.sync());
    WalletHUD.sync();
  }

  /** Show/hide based on current auth + sdk state. */
  private static sync(): void {
    const auth   = authStore.getState();
    const loggedIn = !!auth.pubkey && !auth.isGuest;
    if (!loggedIn) { WalletHUD.unmount(); return; }
    WalletHUD.mount();
  }

  private static mount(): void {
    if (WalletHUD.el) return;

    const el = document.createElement('div');
    el.id = HUD_ID;
    el.title = ti18n('hud.open_wallet');
    el.innerHTML = `
      <span class="wh-bolt">${boltIcon(13)}</span>
      <span class="wh-amt">—</span>
      <span class="wh-unit">${ti18n('hud.sats')}</span>
    `;
    el.addEventListener('click', () => WalletPanel.toggle());
    document.body.appendChild(el);
    WalletHUD.el = el;

    // Subscribe to payment events for live refresh + pulse
    WalletHUD.unsubPayment = onSparkPayment(evt => {
      WalletHUD.refresh();
      if (evt.direction === 'received') WalletHUD.pulse();
    });

    // Periodic safety net in case an event is missed (e.g. wallet still warming up)
    WalletHUD.pollTimer = setInterval(() => WalletHUD.refresh(), 30000);

    // Wait for SDK to be ready, then fetch initial balance
    WalletHUD.waitForSdkAndRefresh();
  }

  private static unmount(): void {
    if (WalletHUD.unsubPayment) { WalletHUD.unsubPayment(); WalletHUD.unsubPayment = null; }
    if (WalletHUD.pollTimer)    { clearInterval(WalletHUD.pollTimer); WalletHUD.pollTimer = null; }
    WalletHUD.el?.remove();
    WalletHUD.el = null;
    WalletHUD.balance = null;
  }

  private static async waitForSdkAndRefresh(): Promise<void> {
    // Poll up to ~30s for the SDK to connect
    for (let i = 0; i < 60; i++) {
      if (getSparkSdk()) { WalletHUD.refresh(); return; }
      await new Promise(r => setTimeout(r, 500));
    }
  }

  private static async refresh(): Promise<void> {
    const bal = await getSparkBalance();
    if (bal === null || !WalletHUD.el) return;
    WalletHUD.balance = bal;
    const amtEl = WalletHUD.el.querySelector('.wh-amt');
    if (amtEl) amtEl.textContent = bal.toLocaleString();
  }

  private static pulse(): void {
    if (!WalletHUD.el) return;
    WalletHUD.el.classList.remove('wh-pulse');
    // Force reflow so the animation restarts even on rapid back-to-back receives
    void WalletHUD.el.offsetWidth;
    WalletHUD.el.classList.add('wh-pulse');
  }

  private static injectStyles(): void {
    if (document.getElementById('wallet-hud-styles')) return;
    const style = document.createElement('style');
    style.id = 'wallet-hud-styles';
    style.textContent = `
      #${HUD_ID} {
        position:fixed;top:max(16px,env(safe-area-inset-top,0px));left:max(16px,env(safe-area-inset-left,0px));
        z-index:100;display:inline-flex;align-items:center;gap:6px;
        padding:9px 14px;border-radius:999px;cursor:pointer;
        min-height:36px;
        background:color-mix(in srgb,black 65%,var(--nd-bg));
        border:1px solid color-mix(in srgb,var(--nd-accent) 35%,transparent);
        color:var(--nd-text);font-family:'Courier New',monospace;font-size:12px;
        box-shadow:0 4px 14px rgba(0,0,0,0.45);
        user-select:none;-webkit-user-select:none;
        transition:transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
      }
      #${HUD_ID}:hover {
        border-color:var(--nd-accent);
        box-shadow:0 4px 16px color-mix(in srgb,var(--nd-accent) 25%,transparent);
        transform:translateY(-1px);
      }
      #${HUD_ID} .wh-bolt {
        color:var(--nd-accent);display:inline-flex;align-items:center;
      }
      #${HUD_ID} .wh-amt {
        font-weight:bold;letter-spacing:0.02em;
      }
      #${HUD_ID} .wh-unit {
        color:var(--nd-subtext);font-size:10px;letter-spacing:0.06em;
      }
      @media (max-width: 480px) {
        #${HUD_ID} { padding:8px 12px;font-size:11px;min-height:34px; }
        #${HUD_ID} .wh-unit { display:none; }
      }
      @keyframes wh-pulse-kf {
        0%   { transform:scale(1);   box-shadow:0 4px 14px rgba(0,0,0,0.45); }
        40%  { transform:scale(1.10);box-shadow:0 4px 22px color-mix(in srgb,var(--nd-accent) 55%,transparent); border-color:var(--nd-accent); }
        100% { transform:scale(1);   box-shadow:0 4px 14px rgba(0,0,0,0.45); }
      }
      #${HUD_ID}.wh-pulse {
        animation:wh-pulse-kf 0.6s ease-out;
      }
    `;
    document.head.appendChild(style);
  }
}

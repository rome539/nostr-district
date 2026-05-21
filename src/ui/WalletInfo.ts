/**
 * WalletInfo.ts — Documentation modal for the in-game wallet
 *
 * Honest explanation of what kind of wallet this is, what it isn't,
 * and how to use it responsibly. Opened via the ⓘ button in WalletPanel.
 */

import { t as ti18n } from '../i18n/i18n';

const MODAL_ID = 'wallet-info';

export class WalletInfo {
  private static escHandler: ((e: KeyboardEvent) => void) | null = null;

  static isOpen(): boolean { return !!document.getElementById(MODAL_ID); }

  static open(): void {
    WalletInfo.destroy();
    WalletInfo.injectStyles();

    const backdrop = document.createElement('div');
    backdrop.id = 'wi-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:4099;background:rgba(0,0,0,0.55);backdrop-filter:blur(3px);';
    backdrop.addEventListener('click', () => WalletInfo.destroy());
    backdrop.addEventListener('touchend', () => WalletInfo.destroy(), { passive: true });
    document.body.appendChild(backdrop);

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="wi-header">
        <div class="wi-title">${ti18n('wallet_info.title')}</div>
        <button id="wi-close" class="wi-close" aria-label="Close">×</button>
      </div>
      <div class="wi-body">${ti18n('wallet_info.body')}</div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#wi-close')?.addEventListener('click', () => WalletInfo.destroy());

    WalletInfo.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); WalletInfo.destroy(); }
    };
    window.addEventListener('keydown', WalletInfo.escHandler);
  }

  static destroy(): void {
    document.getElementById(MODAL_ID)?.remove();
    document.getElementById('wi-backdrop')?.remove();
    if (WalletInfo.escHandler) {
      window.removeEventListener('keydown', WalletInfo.escHandler);
      WalletInfo.escHandler = null;
    }
  }

  private static injectStyles(): void {
    if (document.getElementById('wallet-info-styles')) return;
    const style = document.createElement('style');
    style.id = 'wallet-info-styles';
    style.textContent = `
      #${MODAL_ID} {
        position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:4100;
        background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
        border:1px solid color-mix(in srgb,var(--nd-accent) 35%,transparent);
        border-radius:12px;
        font-family:'Courier New',monospace;
        box-shadow:0 12px 40px rgba(0,0,0,0.7), 0 0 24px color-mix(in srgb,var(--nd-accent) 12%,transparent);
        width:min(480px,94vw);max-height:88dvh;
        display:flex;flex-direction:column;overflow:hidden;
      }
      #${MODAL_ID} .wi-header {
        display:flex;align-items:center;gap:8px;
        padding:14px 18px 12px;flex-shrink:0;
        border-bottom:1px solid color-mix(in srgb,var(--nd-subtext) 12%,transparent);
      }
      #${MODAL_ID} .wi-title {
        flex:1;color:var(--nd-text);font-size:13px;font-weight:bold;letter-spacing:0.1em;
      }
      #${MODAL_ID} .wi-close {
        background:none;border:none;color:var(--nd-subtext);cursor:pointer;
        font-size:22px;line-height:1;width:34px;height:34px;padding:0;
        display:inline-flex;align-items:center;justify-content:center;
        opacity:0.55;transition:opacity 0.15s;
      }
      #${MODAL_ID} .wi-close:hover { opacity:1; }
      #${MODAL_ID} .wi-body {
        padding:14px 18px 18px;overflow-y:auto;flex:1;min-height:0;
        color:var(--nd-text);font-size:12px;line-height:1.65;
      }
      #${MODAL_ID} section { margin-bottom:18px; }
      #${MODAL_ID} section:last-child { margin-bottom:0; }
      #${MODAL_ID} h3 {
        color:var(--nd-accent);font-size:11px;letter-spacing:0.12em;
        margin:0 0 6px;font-weight:bold;text-transform:uppercase;
      }
      #${MODAL_ID} p {
        margin:0 0 8px;color:var(--nd-text);
      }
      #${MODAL_ID} p:last-child { margin-bottom:0; }
      #${MODAL_ID} ul {
        margin:0 0 8px;padding-left:18px;color:var(--nd-text);
      }
      #${MODAL_ID} li { margin-bottom:3px; }
      #${MODAL_ID} strong { color:var(--nd-accent);font-weight:bold; }
      #${MODAL_ID} code {
        font-family:'Courier New',monospace;font-size:11px;
        background:color-mix(in srgb,var(--nd-subtext) 12%,transparent);
        padding:1px 5px;border-radius:3px;color:var(--nd-text);
      }
      #${MODAL_ID} .wi-warn {
        background:color-mix(in srgb,var(--nd-accent) 10%,transparent);
        border:1px solid color-mix(in srgb,var(--nd-accent) 30%,transparent);
        border-radius:6px;padding:8px 10px;margin-top:8px;
        font-size:11px;color:var(--nd-accent);
      }
      #${MODAL_ID} a {
        color:var(--nd-accent);text-decoration:none;
        border-bottom:1px dotted color-mix(in srgb,var(--nd-accent) 45%,transparent);
      }
      #${MODAL_ID} a:hover {
        border-bottom-color:var(--nd-accent);
      }
      #${MODAL_ID} .wi-body::-webkit-scrollbar { width:6px; }
      #${MODAL_ID} .wi-body::-webkit-scrollbar-track { background:transparent; }
      #${MODAL_ID} .wi-body::-webkit-scrollbar-thumb {
        background:color-mix(in srgb,var(--nd-accent) 35%,transparent);
        border-radius:3px;
      }
    `;
    document.head.appendChild(style);
  }
}

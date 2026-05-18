/**
 * ExtensionWarning.ts — One-time warning modal for Nostr extensions that
 * don't implement NIP-44 / NIP-17.
 *
 * Triggered after a successful NIP-07 login when the round-trip encrypt/decrypt
 * test in loginWithExtension fails. The user can dismiss; the dismissal is
 * remembered per-pubkey in localStorage so they don't see it every session.
 */

import { authStore } from '../stores/authStore';
import { isTutorialDone } from './TutorialOverlay';

const MODAL_ID = 'ext-warning';
const DISMISS_KEY_PREFIX = 'nd_ext_warn_dismissed_';

export class ExtensionWarning {
  private static deferred = false;

  static isOpen(): boolean { return !!document.getElementById(MODAL_ID); }

  /**
   * Show the modal only if the user hasn't dismissed it for this pubkey yet.
   * Deferred until after the first-time tutorial completes so we don't bury
   * the warning under the tutorial overlay.
   */
  static maybeShow(): void {
    const pk = authStore.getState().pubkey;
    if (!pk) return;
    if (localStorage.getItem(DISMISS_KEY_PREFIX + pk.slice(0, 16))) return;

    // First-time user is still in the tutorial — wait until they finish.
    if (!isTutorialDone()) {
      if (ExtensionWarning.deferred) return; // already waiting
      ExtensionWarning.deferred = true;
      const onDone = () => {
        window.removeEventListener('nd:tutorial-done', onDone);
        ExtensionWarning.deferred = false;
        ExtensionWarning.maybeShow();
      };
      window.addEventListener('nd:tutorial-done', onDone);
      return;
    }

    ExtensionWarning.show();
  }

  static show(): void {
    ExtensionWarning.destroy();
    ExtensionWarning.injectStyles();

    const backdrop = document.createElement('div');
    backdrop.id = 'ext-warning-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:5099;background:rgba(0,0,0,0.6);backdrop-filter:blur(3px);';
    document.body.appendChild(backdrop);

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="ew-header">
        <div class="ew-title">⚠ Limited extension support</div>
      </div>
      <div class="ew-body">
        <p>Your Nostr extension can sign events, but its <strong>encryption support is missing or broken</strong>. This means:</p>
        <ul>
          <li>You won't receive <strong>direct messages</strong></li>
          <li><strong>Closed crew chat</strong> will appear empty</li>
          <li>You can't accept join requests or be promoted to admin</li>
          <li><strong>Crew posts</strong> won't decrypt</li>
        </ul>
        <p>This is a limitation of the extension itself — it doesn't fully implement NIP-44/NIP-17 encryption — not something Nostr District can fix from this side.</p>
        <div class="ew-suggest">
          <strong>Recommended fix:</strong> log out and sign in with your <code>nsec</code> directly, or use a fully-featured extension like <a href="https://getalby.com" target="_blank" rel="noopener noreferrer">Alby</a> or <a href="https://github.com/fiatjaf/nos2x" target="_blank" rel="noopener noreferrer">nos2x</a>.
        </div>
      </div>
      <div class="ew-footer">
        <label class="ew-dismiss"><input type="checkbox" id="ew-dontshow" /> Don't show again</label>
        <button id="ew-close" class="ew-close-btn">Got it</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#ew-close')?.addEventListener('click', () => {
      const dontShow = (modal.querySelector('#ew-dontshow') as HTMLInputElement)?.checked;
      if (dontShow) {
        const pk = authStore.getState().pubkey;
        if (pk) localStorage.setItem(DISMISS_KEY_PREFIX + pk.slice(0, 16), '1');
      }
      ExtensionWarning.destroy();
    });
  }

  static destroy(): void {
    document.getElementById(MODAL_ID)?.remove();
    document.getElementById('ext-warning-backdrop')?.remove();
  }

  private static injectStyles(): void {
    if (document.getElementById('ext-warning-styles')) return;
    const style = document.createElement('style');
    style.id = 'ext-warning-styles';
    style.textContent = `
      #${MODAL_ID} {
        position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:5100;
        background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
        border:1px solid color-mix(in srgb,#f0b040 45%,transparent);
        border-radius:12px;
        font-family:'Courier New',monospace;
        box-shadow:0 12px 40px rgba(0,0,0,0.7), 0 0 24px color-mix(in srgb,#f0b040 18%,transparent);
        width:min(460px,94vw);max-height:88dvh;
        display:flex;flex-direction:column;overflow:hidden;
      }
      #${MODAL_ID} .ew-header {
        padding:14px 18px 12px;flex-shrink:0;
        border-bottom:1px solid color-mix(in srgb,#f0b040 25%,transparent);
      }
      #${MODAL_ID} .ew-title {
        color:#f0b040;font-size:13px;font-weight:bold;letter-spacing:0.1em;
      }
      #${MODAL_ID} .ew-body {
        padding:14px 18px;overflow-y:auto;flex:1;min-height:0;
        color:var(--nd-text);font-size:12px;line-height:1.65;
      }
      #${MODAL_ID} .ew-body p { margin:0 0 10px; }
      #${MODAL_ID} .ew-body p:last-child { margin-bottom:0; }
      #${MODAL_ID} .ew-body ul { margin:0 0 10px;padding-left:18px;color:var(--nd-text); }
      #${MODAL_ID} .ew-body li { margin-bottom:4px; }
      #${MODAL_ID} .ew-body strong { color:#f0b040;font-weight:bold; }
      #${MODAL_ID} .ew-body code {
        font-family:'Courier New',monospace;font-size:11px;
        background:color-mix(in srgb,var(--nd-subtext) 12%,transparent);
        padding:1px 5px;border-radius:3px;
      }
      #${MODAL_ID} .ew-body a {
        color:var(--nd-accent);text-decoration:none;
        border-bottom:1px dotted color-mix(in srgb,var(--nd-accent) 45%,transparent);
      }
      #${MODAL_ID} .ew-body a:hover { border-bottom-color:var(--nd-accent); }
      #${MODAL_ID} .ew-suggest {
        background:color-mix(in srgb,var(--nd-accent) 10%,transparent);
        border:1px solid color-mix(in srgb,var(--nd-accent) 30%,transparent);
        border-radius:6px;padding:10px 12px;margin-top:10px;font-size:11px;
      }
      #${MODAL_ID} .ew-footer {
        display:flex;align-items:center;justify-content:space-between;gap:10px;
        padding:12px 18px 14px;flex-shrink:0;
        border-top:1px solid color-mix(in srgb,var(--nd-subtext) 12%,transparent);
      }
      #${MODAL_ID} .ew-dismiss {
        color:var(--nd-subtext);font-size:11px;display:flex;align-items:center;gap:6px;cursor:pointer;
      }
      #${MODAL_ID} .ew-dismiss input[type="checkbox"] {
        appearance:none;-webkit-appearance:none;
        width:14px;height:14px;margin:0;flex-shrink:0;
        background:rgba(240,176,64,0.08);
        border:1px solid rgba(240,176,64,0.5);
        border-radius:3px;cursor:pointer;
        display:inline-grid;place-content:center;
        transition:background 0.15s,border-color 0.15s;
      }
      #${MODAL_ID} .ew-dismiss input[type="checkbox"]:hover { border-color:#f0b040; }
      #${MODAL_ID} .ew-dismiss input[type="checkbox"]:checked {
        background:rgba(240,176,64,0.2);border-color:#f0b040;
      }
      #${MODAL_ID} .ew-dismiss input[type="checkbox"]:checked::after {
        content:'';width:8px;height:8px;background:#f0b040;
        clip-path:polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0, 43% 62%);
      }
      #${MODAL_ID} .ew-close-btn {
        background:color-mix(in srgb,#f0b040 18%,transparent);
        border:1px solid color-mix(in srgb,#f0b040 45%,transparent);
        color:#f0b040;border-radius:6px;padding:7px 16px;cursor:pointer;
        font-family:inherit;font-size:12px;
      }
      #${MODAL_ID} .ew-close-btn:hover { background:color-mix(in srgb,#f0b040 30%,transparent); }
    `;
    document.head.appendChild(style);
  }
}

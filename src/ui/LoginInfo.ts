/**
 * LoginInfo.ts — Tutorial / explainer modal for the login screen.
 *
 * Opened from the "What is Nostr?" link at the top of the login box and the
 * ⓘ buttons next to each login method. Same visual language as `WalletInfo.ts`
 * so first-time players see a consistent "help" pattern across the app.
 *
 * Topics are addressed by string id so adding new ones (e.g. NWC, lightning
 * address setup) later is just appending to the `TOPICS` map.
 */

import { t as ti18n } from '../i18n/i18n';

export type LoginInfoTopic =
  | 'nostr'        // "What is Nostr?" — global overview
  | 'google'       // Continue with Google — encrypted Drive backup + recovery
  | 'passkey'      // Passkey login (both "Continue as X" and "Save with Passkey")
  | 'connect'     // "Connect with Nostr" overview (shows 3 sub-methods)
  | 'signer'       // NIP-46 remote signer
  | 'extension'    // Browser extension (Alby, nos2x)
  | 'nsec'         // Private key paste — warnings emphasized
  | 'create';      // New account creation flow

const MODAL_ID    = 'login-info';
const BACKDROP_ID = 'login-info-backdrop';

interface TopicContent {
  title: string;
  body:  string; // Trusted HTML — written by us, not user input
}

/**
 * Pull the localized title + body for a topic from the i18n dictionaries.
 * Done at open()-time (not module-init) so the current language is honored
 * and language switches mid-session render the right copy on next open.
 */
function getTopic(topic: LoginInfoTopic): TopicContent | null {
  const title = ti18n(`login_info.${topic}.title`);
  const body  = ti18n(`login_info.${topic}.body`);
  if (!title || title === `login_info.${topic}.title`) return null;
  return { title, body };
}


export class LoginInfo {
  private static escHandler: ((e: KeyboardEvent) => void) | null = null;

  static isOpen(): boolean { return !!document.getElementById(MODAL_ID); }

  static open(topic: LoginInfoTopic): void {
    LoginInfo.destroy();
    LoginInfo.injectStyles();

    const content = getTopic(topic);
    if (!content) return;

    const backdrop = document.createElement('div');
    backdrop.id = BACKDROP_ID;
    // z-index sits above #login-screen (9999) so the modal isn't hidden behind
    // the login UI on the very screen we're launched from.
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:10100;background:rgba(0,0,0,0.55);backdrop-filter:blur(3px);';
    backdrop.addEventListener('click', () => LoginInfo.destroy());
    backdrop.addEventListener('touchend', () => LoginInfo.destroy(), { passive: true });
    document.body.appendChild(backdrop);

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="li-header">
        <div class="li-title">${LoginInfo.escapeHtml(content.title)}</div>
        <button id="li-close" class="li-close" aria-label="Close">×</button>
      </div>
      <div class="li-body">${content.body}</div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#li-close')?.addEventListener('click', () => LoginInfo.destroy());

    LoginInfo.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); LoginInfo.destroy(); }
    };
    window.addEventListener('keydown', LoginInfo.escHandler);
  }

  static destroy(): void {
    document.getElementById(MODAL_ID)?.remove();
    document.getElementById(BACKDROP_ID)?.remove();
    if (LoginInfo.escHandler) {
      window.removeEventListener('keydown', LoginInfo.escHandler);
      LoginInfo.escHandler = null;
    }
  }

  private static escapeHtml(s: string): string {
    const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
  }

  private static injectStyles(): void {
    if (document.getElementById('login-info-styles')) return;
    const style = document.createElement('style');
    style.id = 'login-info-styles';
    style.textContent = `
      #${MODAL_ID} {
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 10101;
        background: linear-gradient(180deg, var(--nd-bg) 0%, var(--nd-navy) 100%);
        border: 1px solid color-mix(in srgb, var(--nd-accent) 35%, transparent);
        border-radius: 12px;
        font-family: 'Courier New', monospace;
        box-shadow: 0 12px 40px rgba(0,0,0,0.7),
                    0 0 24px color-mix(in srgb, var(--nd-accent) 12%, transparent);
        width: min(520px, 94vw); max-height: 88dvh;
        display: flex; flex-direction: column; overflow: hidden;
      }
      #${MODAL_ID} .li-header {
        display: flex; align-items: center; gap: 8px;
        padding: 14px 18px 12px; flex-shrink: 0;
        border-bottom: 1px solid color-mix(in srgb, var(--nd-subtext) 12%, transparent);
      }
      #${MODAL_ID} .li-title {
        flex: 1; color: var(--nd-text); font-size: 13px; font-weight: bold; letter-spacing: 0.1em;
      }
      #${MODAL_ID} .li-close {
        background: none; border: none; color: var(--nd-subtext); cursor: pointer;
        font-size: 22px; line-height: 1; width: 34px; height: 34px; padding: 0;
        display: inline-flex; align-items: center; justify-content: center;
        opacity: 0.55; transition: opacity 0.15s;
      }
      #${MODAL_ID} .li-close:hover { opacity: 1; }
      #${MODAL_ID} .li-body {
        padding: 14px 18px 18px; overflow-y: auto; flex: 1; min-height: 0;
        color: var(--nd-text); font-size: 12px; line-height: 1.65;
      }
      #${MODAL_ID} section { margin-bottom: 18px; }
      #${MODAL_ID} section:last-child { margin-bottom: 0; }
      #${MODAL_ID} h3 {
        color: var(--nd-accent); font-size: 11px; letter-spacing: 0.12em;
        margin: 0 0 6px; font-weight: bold; text-transform: uppercase;
      }
      #${MODAL_ID} p { margin: 0 0 8px; color: var(--nd-text); }
      #${MODAL_ID} p:last-child { margin-bottom: 0; }
      #${MODAL_ID} ul, #${MODAL_ID} ol { margin: 0 0 8px; padding-left: 20px; color: var(--nd-text); }
      #${MODAL_ID} li { margin-bottom: 4px; }
      #${MODAL_ID} strong { color: var(--nd-accent); font-weight: bold; }
      #${MODAL_ID} em { color: var(--nd-text); font-style: italic; }
      #${MODAL_ID} code {
        font-family: 'Courier New', monospace; font-size: 11px;
        background: color-mix(in srgb, var(--nd-subtext) 12%, transparent);
        padding: 1px 5px; border-radius: 3px; color: var(--nd-text);
      }
      #${MODAL_ID} .wi-warn {
        background: color-mix(in srgb, #ff7070 10%, transparent);
        border: 1px solid color-mix(in srgb, #ff7070 35%, transparent);
        border-radius: 6px; padding: 8px 10px; margin-top: 8px;
        font-size: 11px; color: #ffb3b3;
      }
      #${MODAL_ID} a {
        color: var(--nd-accent); text-decoration: none;
        border-bottom: 1px dotted color-mix(in srgb, var(--nd-accent) 45%, transparent);
      }
      #${MODAL_ID} a:hover { border-bottom-color: var(--nd-accent); }
      #${MODAL_ID} .li-body::-webkit-scrollbar { width: 6px; }
      #${MODAL_ID} .li-body::-webkit-scrollbar-track { background: transparent; }
      #${MODAL_ID} .li-body::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, var(--nd-accent) 35%, transparent);
        border-radius: 3px;
      }
    `;
    document.head.appendChild(style);
  }
}

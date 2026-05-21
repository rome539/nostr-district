/**
 * LanguageModal.ts — Full-screen language picker overlay.
 *
 * Opened from the SettingsPanel's "LANGUAGE" row (and could be reused
 * elsewhere). Renders a grid of all available languages; clicking one calls
 * `setLang` and closes the modal. The rest of the UI updates via the
 * `langchange` event subscriptions wired in each panel.
 */

import { t, getCurrentLang, setLang, onLangChange } from '../i18n/i18n';

const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文' },
  { code: 'ar', label: 'العربية' },
];

const OVERLAY_ID = 'lang-modal-overlay';

export class LanguageModal {
  private el: HTMLDivElement | null = null;
  private open = false;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private langUnsub:  (() => void) | null = null;

  show(): void {
    if (!this.el) this.build();
    this.renderContent(); // refresh title + active highlight in case lang changed since last open
    this.el!.style.display = 'flex';
    this.open = true;
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
    };
    window.addEventListener('keydown', this.escHandler, true);
    // Re-render the modal in place when language changes so the user sees the
    // active checkmark move to their new pick instead of feeling like the
    // button is "stuck".
    if (!this.langUnsub) {
      this.langUnsub = onLangChange(() => {
        if (this.open) this.renderContent();
      });
    }
  }

  close(): void {
    if (this.el) this.el.style.display = 'none';
    this.open = false;
    if (this.escHandler) {
      window.removeEventListener('keydown', this.escHandler, true);
      this.escHandler = null;
    }
    if (this.langUnsub) {
      this.langUnsub();
      this.langUnsub = null;
    }
  }

  isOpen(): boolean { return this.open; }

  destroy(): void {
    if (this.escHandler) {
      window.removeEventListener('keydown', this.escHandler, true);
      this.escHandler = null;
    }
    this.el?.remove();
    this.el = null;
    this.open = false;
  }

  private build(): void {
    this.injectStyles();
    this.el = document.createElement('div');
    this.el.id = OVERLAY_ID;
    this.renderContent();
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    document.body.appendChild(this.el);
  }

  private renderContent(): void {
    if (!this.el) return;
    const current = getCurrentLang();

    const escHtml = (s: string) => {
      const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
    };

    const options = LANGUAGES.map(l => {
      const isActive = l.code === current;
      return `
        <button class="lm-opt ${isActive ? 'lm-opt-active' : ''}" data-lang="${l.code}">
          <span class="lm-opt-label">${escHtml(l.label)}</span>
          ${isActive ? '<span class="lm-opt-check">✓</span>' : ''}
        </button>
      `;
    }).join('');

    this.el.innerHTML = `
      <div class="lm-panel">
        <div class="lm-header">
          <div class="lm-title">${escHtml(t('settings.language'))}</div>
          <button class="lm-close" aria-label="Close">×</button>
        </div>
        <div class="lm-grid">
          ${options}
        </div>
      </div>
    `;

    this.el.querySelector('.lm-close')?.addEventListener('click', () => this.close());
    this.el.querySelectorAll<HTMLButtonElement>('.lm-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.lang;
        if (!code) return;
        // Don't close on selection — let the user see the active highlight
        // move to their pick (via the onLangChange subscription re-rendering
        // the modal in place). They close via the × button when satisfied.
        if (code !== getCurrentLang()) setLang(code);
      });
    });
  }

  private injectStyles(): void {
    if (document.getElementById('lang-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'lang-modal-styles';
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed; inset: 0; z-index: 4500;
        background: rgba(0,0,0,0.55); backdrop-filter: blur(3px);
        display: none; align-items: center; justify-content: center;
        font-family: 'Courier New', monospace;
        padding: 16px;
      }
      #${OVERLAY_ID} .lm-panel {
        background: linear-gradient(180deg, var(--nd-bg) 0%, var(--nd-navy) 100%);
        border: 1px solid color-mix(in srgb, var(--nd-accent) 35%, transparent);
        border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.7),
                    0 0 24px color-mix(in srgb, var(--nd-accent) 12%, transparent);
        width: min(520px, 96vw);
        max-height: 88dvh;
        display: flex; flex-direction: column; overflow: hidden;
      }
      #${OVERLAY_ID} .lm-header {
        display: flex; align-items: center;
        padding: 14px 18px 12px;
        border-bottom: 1px solid color-mix(in srgb, var(--nd-subtext) 12%, transparent);
        flex-shrink: 0;
      }
      #${OVERLAY_ID} .lm-title {
        flex: 1; color: var(--nd-text);
        font-size: 13px; font-weight: bold; letter-spacing: 0.1em;
      }
      #${OVERLAY_ID} .lm-close {
        background: none; border: none; color: var(--nd-subtext);
        font-size: 22px; line-height: 1; cursor: pointer;
        width: 32px; height: 32px;
        display: inline-flex; align-items: center; justify-content: center;
        opacity: 0.55; transition: opacity 0.15s;
      }
      #${OVERLAY_ID} .lm-close:hover { opacity: 1; }
      #${OVERLAY_ID} .lm-grid {
        padding: 14px;
        display: grid; gap: 6px;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        overflow-y: auto;
      }
      #${OVERLAY_ID} .lm-opt {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px;
        background: color-mix(in srgb, var(--nd-navy) 60%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-subtext) 14%, transparent);
        border-radius: 6px;
        color: var(--nd-text);
        font-family: inherit; font-size: 13px; letter-spacing: 0.02em;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
        text-align: left;
      }
      #${OVERLAY_ID} .lm-opt:hover {
        border-color: color-mix(in srgb, var(--nd-accent) 50%, transparent);
        background: color-mix(in srgb, var(--nd-accent) 8%, transparent);
        color: var(--nd-accent);
      }
      #${OVERLAY_ID} .lm-opt-active {
        border-color: color-mix(in srgb, var(--nd-accent) 55%, transparent);
        background: color-mix(in srgb, var(--nd-accent) 10%, transparent);
        color: var(--nd-accent);
      }
      #${OVERLAY_ID} .lm-opt-check {
        color: var(--nd-accent); opacity: 0.8; font-size: 12px;
      }
    `;
    document.head.appendChild(style);
  }
}

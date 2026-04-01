/**
 * SettingsPanel.ts — Minimal gear menu (top-right)
 *
 * Contains:
 * - Copy npub to clipboard
 * - Logout (with confirmation)
 */

import { P } from '../config/game.config';
import { authStore } from '../stores/authStore';
import { getNWCUri, setNWCUri, hasWebLN } from '../nostr/nwcService';
import { logout } from '../nostr/nostrService';
import { themeStore, THEMES } from '../stores/themeStore';
import {
  getNostrTheme, isNostrThemeEnabled,
  setNostrThemeEnabled, onNostrThemeChange,
} from '../nostr/nostrThemeService';
import { NostrThemeBrowser } from './NostrThemeBrowser';
import { HotkeyModal } from './HotkeyModal';

const GEAR_ID = 'settings-gear';
const PANEL_ID = 'settings-panel';

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

export class SettingsPanel {
  private gearEl:          HTMLDivElement | null = null;
  private panelEl:         HTMLDivElement | null = null;
  private closeHandler:    ((e: MouseEvent) => void) | null = null;
  private nostrThemeUnsub: (() => void) | null = null;
  private themeBrowser =   new NostrThemeBrowser();
  private hotkeyModal  =   new HotkeyModal();

  create(): void {
    this.destroy();

    this.gearEl = document.createElement('div');
    this.gearEl.id = GEAR_ID;
    this.gearEl.textContent = '\u2699';
    this.gearEl.style.cssText = `
      position: fixed; top: 12px; right: 14px; z-index: 2000;
      width: 34px; height: 34px;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; color: var(--nd-dpurp);
      background: color-mix(in srgb, var(--nd-bg) 80%, transparent); border: 1px solid color-mix(in srgb, var(--nd-dpurp) 33%, transparent);
      border-radius: 6px; cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
      user-select: none;
    `;
    this.gearEl.addEventListener('mouseenter', () => {
      if (this.gearEl) { this.gearEl.style.color = 'var(--nd-accent)'; this.gearEl.style.borderColor = `color-mix(in srgb, var(--nd-accent) 55%, transparent)`; }
    });
    this.gearEl.addEventListener('mouseleave', () => {
      if (this.gearEl && !this.panelEl) { this.gearEl.style.color = 'var(--nd-dpurp)'; this.gearEl.style.borderColor = `color-mix(in srgb, var(--nd-dpurp) 33%, transparent)`; }
    });
    this.gearEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.panelEl) this.closePanel();
      else this.openPanel();
    });
    document.body.appendChild(this.gearEl);
  }

  private openPanel(): void {
    if (this.panelEl) return;

    const state = authStore.getState();
    const npub = state.npub || '';
    const displayNpub = npub ? (npub.slice(0, 20) + '...' + npub.slice(-6)) : 'unknown';
    const method = state.loginMethod || 'unknown';

    this.panelEl = document.createElement('div');
    this.panelEl.id = PANEL_ID;
    this.panelEl.style.cssText = `
      position: fixed; top: 52px; right: 14px; z-index: 2001;
      background: linear-gradient(180deg, var(--nd-bg) 0%, var(--nd-navy) 100%);
      border: 1px solid color-mix(in srgb, var(--nd-dpurp) 44%, transparent); border-radius: 8px;
      padding: 14px 16px; font-family: 'Courier New', monospace;
      box-shadow: 0 4px 20px rgba(0,0,0,0.6);
      width: min(280px, calc(100vw - 28px));
      max-height: calc(100dvh - 66px); overflow-y: auto;
      scrollbar-width: thin; scrollbar-color: color-mix(in srgb,var(--nd-dpurp) 33%,transparent) transparent;
    `;

    // ── Nostr theme section ──
    const nt        = getNostrTheme();
    const ntEnabled = isNostrThemeEnabled();

    const dots = nt
      ? [nt.background, nt.text, nt.primary].map(c =>
          `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;
            background:${esc(c)};border:1px solid rgba(255,255,255,0.15);"></span>`
        ).join('')
      : '';

    const nostrThemeHtml = `
      <div id="sp-nostr-row" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:5px;
        background:var(--nd-navy);border:1px solid color-mix(in srgb,var(--nd-dpurp) 22%,transparent);">
        ${nt
          ? `<div style="display:flex;gap:3px;">${dots}</div>
             <div style="flex:1;min-width:0;">
               <div style="color:var(--nd-text);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                 ${nt.title ? esc(nt.title) : 'Profile theme'}
               </div>
             </div>
             <button id="sp-nostr-toggle" style="
               padding:3px 8px;border-radius:4px;font-family:'Courier New',monospace;font-size:10px;
               cursor:pointer;flex-shrink:0;
               background:${ntEnabled ? 'color-mix(in srgb,var(--nd-accent) 18%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 22%,transparent)'};
               border:1px solid ${ntEnabled ? 'color-mix(in srgb,var(--nd-accent) 44%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 44%,transparent)'};
               color:${ntEnabled ? 'var(--nd-accent)' : 'var(--nd-subtext)'};"
             >${ntEnabled ? 'On' : 'Off'}</button>`
          : `<div style="color:var(--nd-subtext);font-size:11px;flex:1;opacity:0.5;">No theme loaded</div>`
        }
        <button id="sp-nostr-browse" style="
          padding:3px 9px;border-radius:4px;font-family:'Courier New',monospace;font-size:10px;
          cursor:pointer;flex-shrink:0;
          background:color-mix(in srgb,var(--nd-accent) 13%,transparent);
          border:1px solid color-mix(in srgb,var(--nd-accent) 33%,transparent);
          color:var(--nd-accent);">Browse</button>
      </div>
    `;

    const activeId = themeStore.current.id;
    const themeSwatches = THEMES.map(t => {
      const isActive = !ntEnabled && t.id === activeId;
      return `
        <div class="sp-theme-swatch" data-tid="${t.id}" style="
          display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:5px;cursor:pointer;
          border:1px solid ${isActive ? t.accent + '66' : 'transparent'};
          background:${isActive ? t.accent + '11' : 'transparent'};
          transition:background 0.15s,border-color 0.15s;
        ">
          <div style="display:flex;gap:3px;flex-shrink:0;">
            <div style="width:10px;height:10px;border-radius:50%;background:${t.bg};border:1px solid ${t.dpurp}66;"></div>
            <div style="width:10px;height:10px;border-radius:50%;background:${t.purp};"></div>
            <div style="width:10px;height:10px;border-radius:50%;background:${t.accent};"></div>
          </div>
          <span style="color:${isActive ? t.accent : 'var(--nd-subtext)'};font-size:12px;">${t.name}</span>
          ${isActive ? `<span style="color:${t.accent};font-size:10px;margin-left:auto;opacity:0.7;">active</span>` : ''}
        </div>
      `;
    }).join('');

    this.panelEl.innerHTML = `
      <div style="color:var(--nd-text);font-size:13px;font-weight:bold;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid color-mix(in srgb,var(--nd-dpurp) 22%,transparent);">
        ${esc(state.displayName || 'guest')}
        <span style="color:var(--nd-subtext);font-size:11px;font-weight:normal;margin-left:6px;">${esc(method)}</span>
      </div>

      <div id="settings-npub" style="padding:8px 10px;margin-bottom:8px;background:var(--nd-navy);border:1px solid color-mix(in srgb,var(--nd-dpurp) 22%,transparent);border-radius:4px;cursor:pointer;transition:border-color 0.15s;">
        <div style="color:var(--nd-subtext);font-size:10px;margin-bottom:3px;">NPUB</div>
        <div style="color:var(--nd-text);font-size:11px;word-break:break-all;opacity:0.7;">${esc(displayNpub)}</div>
        <div id="settings-copy-hint" style="color:var(--nd-accent);font-size:10px;margin-top:4px;opacity:0.5;">click to copy</div>
      </div>

      <div style="height:1px;background:color-mix(in srgb,var(--nd-dpurp) 22%,transparent);margin:8px 0;"></div>

      <div style="color:var(--nd-subtext);font-size:10px;letter-spacing:0.08em;margin-bottom:6px;padding:0 2px;">NOSTR THEME</div>
      <div style="margin-bottom:10px;">${nostrThemeHtml}</div>

      <div style="height:1px;background:color-mix(in srgb,var(--nd-dpurp) 22%,transparent);margin:8px 0;"></div>
      <div style="color:var(--nd-subtext);font-size:10px;letter-spacing:0.08em;margin-bottom:6px;padding:0 2px;">APPEARANCE${ntEnabled ? ' <span style="opacity:0.45;">(overridden by nostr theme)</span>' : ''}</div>
      <div id="settings-themes" style="display:flex;flex-direction:column;gap:2px;margin-bottom:10px;${ntEnabled ? 'opacity:0.5;' : ''}">
        ${themeSwatches}
      </div>

      <div style="height:1px;background:color-mix(in srgb,var(--nd-dpurp) 22%,transparent);margin:8px 0;"></div>

      <div style="color:var(--nd-subtext);font-size:10px;letter-spacing:0.08em;margin-bottom:6px;padding:0 2px;">LIGHTNING WALLET</div>
      <div id="sp-wallet-row" style="margin-bottom:10px;"></div>

      <div style="height:1px;background:color-mix(in srgb,var(--nd-dpurp) 22%,transparent);margin:8px 0;"></div>

      <button id="sp-hotkeys-btn" style="
        width:100%;padding:8px 10px;margin-bottom:8px;
        background:color-mix(in srgb,var(--nd-dpurp) 12%,transparent);
        border:1px solid color-mix(in srgb,var(--nd-dpurp) 28%,transparent);
        border-radius:5px;cursor:pointer;
        color:var(--nd-subtext);font-family:'Courier New',monospace;font-size:11px;
        text-align:left;display:flex;align-items:center;justify-content:space-between;
        transition:border-color 0.15s,color 0.15s;
      ">
        <span>Hotkeys & Commands</span>
        <span style="opacity:0.5;">↗</span>
      </button>

      <div style="height:1px;background:color-mix(in srgb,var(--nd-dpurp) 22%,transparent);margin:8px 0;"></div>

      <a href="https://github.com/rome539/nostr-district" target="_blank" rel="noopener noreferrer" style="
        display:flex;align-items:center;justify-content:space-between;
        padding:7px 10px;border-radius:5px;text-decoration:none;
        color:var(--nd-subtext);font-family:'Courier New',monospace;font-size:11px;
        transition:color 0.15s;
      " onmouseover="this.style.color='var(--nd-text)'" onmouseout="this.style.color='var(--nd-subtext)'">
        <span>GitHub</span>
        <span style="opacity:0.4;font-size:10px;">rome539/nostr-district ↗</span>
      </a>

      <div style="height:1px;background:color-mix(in srgb,var(--nd-dpurp) 22%,transparent);margin:8px 0;"></div>

      <div id="settings-logout" style="padding:10px 10px;color:${P.red};font-size:13px;cursor:pointer;border-radius:4px;transition:background 0.15s;">
        \u23FB Logout
      </div>

      <div id="settings-confirm" style="display:none;padding:10px;background:${P.red}11;border:1px solid ${P.red}33;border-radius:4px;margin-top:6px;">
        <div style="color:var(--nd-text);font-size:12px;margin-bottom:10px;">Are you sure?</div>
        <div style="display:flex;gap:8px;">
          <button id="settings-confirm-yes" style="flex:1;padding:7px;background:${P.red}33;border:1px solid ${P.red}55;border-radius:4px;color:${P.red};font-family:'Courier New',monospace;font-size:12px;cursor:pointer;font-weight:bold;">Logout</button>
          <button id="settings-confirm-no" style="flex:1;padding:7px;background:none;border:1px solid color-mix(in srgb,var(--nd-dpurp) 44%,transparent);border-radius:4px;color:var(--nd-subtext);font-family:'Courier New',monospace;font-size:12px;cursor:pointer;">Cancel</button>
        </div>
      </div>
    `;

    this.panelEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.panelEl.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(this.panelEl);

    // Hotkeys & commands button
    const hkBtn = this.panelEl.querySelector('#sp-hotkeys-btn') as HTMLElement;
    hkBtn?.addEventListener('mouseenter', () => { hkBtn.style.color = 'var(--nd-text)'; hkBtn.style.borderColor = `color-mix(in srgb,var(--nd-accent) 35%,transparent)`; });
    hkBtn?.addEventListener('mouseleave', () => { hkBtn.style.color = 'var(--nd-subtext)'; hkBtn.style.borderColor = `color-mix(in srgb,var(--nd-dpurp) 28%,transparent)`; });
    hkBtn?.addEventListener('click', () => { this.closePanel(); this.hotkeyModal.show(); });

    // ── Wallet row ──
    const walletRow = this.panelEl.querySelector('#sp-wallet-row') as HTMLElement;
    const renderWalletRow = () => {
      const nwc = getNWCUri();
      const webln = hasWebLN();
      if (nwc) {
        walletRow.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:5px;
            background:color-mix(in srgb,var(--nd-accent) 8%,transparent);
            border:1px solid color-mix(in srgb,var(--nd-accent) 22%,transparent);">
            <span style="color:var(--nd-accent);font-size:11px;flex:1;">✓ Wallet connected</span>
            <button id="sp-wallet-disconnect" style="padding:3px 8px;border-radius:4px;
              font-family:'Courier New',monospace;font-size:10px;cursor:pointer;
              background:color-mix(in srgb,${P.red} 14%,transparent);
              border:1px solid color-mix(in srgb,${P.red} 33%,transparent);
              color:${P.red};">Disconnect</button>
          </div>`;
        walletRow.querySelector('#sp-wallet-disconnect')?.addEventListener('click', () => {
          setNWCUri(''); renderWalletRow();
        });
      } else if (webln) {
        walletRow.innerHTML = `
          <div style="padding:6px 8px;border-radius:5px;
            background:color-mix(in srgb,var(--nd-accent) 8%,transparent);
            border:1px solid color-mix(in srgb,var(--nd-accent) 22%,transparent);
            color:var(--nd-accent);font-size:11px;">✓ Browser wallet detected</div>`;
      } else {
        walletRow.innerHTML = `
          <div style="color:var(--nd-subtext);font-size:10px;line-height:1.5;margin-bottom:6px;opacity:0.7;">
            Nostr Wallet Connect stores your connection secret in browser storage. Set a spending limit in your wallet first.
          </div>
          <label style="display:flex;align-items:center;gap:6px;margin-bottom:8px;cursor:pointer;">
            <input id="sp-nwc-ack" type="checkbox" style="accent-color:var(--nd-accent);cursor:pointer;">
            <span style="color:var(--nd-subtext);font-size:10px;">I understand, I have a spending limit set</span>
          </label>
          <div id="sp-nwc-form" style="display:none;">
            <div style="display:flex;gap:5px;">
              <input id="sp-nwc-input" type="text" placeholder="nostr+walletconnect://…" autocomplete="off" spellcheck="false"
                style="flex:1;min-width:0;background:color-mix(in srgb,var(--nd-dpurp) 14%,transparent);
                border:1px solid color-mix(in srgb,var(--nd-dpurp) 35%,transparent);border-radius:4px;
                color:var(--nd-text);font-family:'Courier New',monospace;font-size:10px;
                padding:5px 7px;outline:none;">
              <button id="sp-nwc-connect" style="padding:5px 10px;border-radius:4px;flex-shrink:0;
                font-family:'Courier New',monospace;font-size:10px;cursor:pointer;
                background:color-mix(in srgb,var(--nd-accent) 13%,transparent);
                border:1px solid color-mix(in srgb,var(--nd-accent) 33%,transparent);
                color:var(--nd-accent);">Connect</button>
            </div>
            <div id="sp-nwc-err" style="color:#f0b040;font-size:10px;margin-top:4px;display:none;">Invalid URI</div>
          </div>`;

        const ack = walletRow.querySelector('#sp-nwc-ack') as HTMLInputElement;
        const form = walletRow.querySelector('#sp-nwc-form') as HTMLElement;
        ack.addEventListener('change', () => { form.style.display = ack.checked ? 'block' : 'none'; });

        const inp = walletRow.querySelector('#sp-nwc-input') as HTMLInputElement;
        inp.addEventListener('keydown', e => e.stopPropagation());
        inp.addEventListener('focus', () => inp.style.borderColor = 'color-mix(in srgb,var(--nd-accent) 55%,transparent)');
        inp.addEventListener('blur',  () => inp.style.borderColor = 'color-mix(in srgb,var(--nd-dpurp) 35%,transparent)');
        walletRow.querySelector('#sp-nwc-connect')?.addEventListener('click', () => {
          const err = walletRow.querySelector('#sp-nwc-err') as HTMLElement;
          const ok = setNWCUri(inp.value.trim());
          if (ok) { renderWalletRow(); }
          else { err.style.display = 'block'; }
        });
      }
    };
    renderWalletRow();

    // Hover effects
    const logoutBtn = this.panelEl.querySelector('#settings-logout') as HTMLElement;
    logoutBtn.addEventListener('mouseenter', () => logoutBtn.style.background = `${P.red}15`);
    logoutBtn.addEventListener('mouseleave', () => logoutBtn.style.background = 'transparent');

    const npubEl = this.panelEl.querySelector('#settings-npub') as HTMLElement;
    npubEl.addEventListener('mouseenter', () => npubEl.style.borderColor = `${P.teal}44`);
    npubEl.addEventListener('mouseleave', () => npubEl.style.borderColor = `${P.dpurp}22`);

    // Copy npub
    npubEl.addEventListener('click', () => {
      if (!npub) return;
      navigator.clipboard.writeText(npub).then(() => {
        const hint = this.panelEl?.querySelector('#settings-copy-hint');
        if (hint) { hint.textContent = 'copied!'; hint.setAttribute('style', `color:var(--nd-accent);font-size:10px;margin-top:4px;opacity:1;`); }
        setTimeout(() => {
          if (hint) { hint.textContent = 'click to copy'; hint.setAttribute('style', `color:var(--nd-accent);font-size:10px;margin-top:4px;opacity:0.5;`); }
        }, 2000);
      }).catch(() => {});
    });

    // Theme swatches
    this.panelEl.querySelectorAll('.sp-theme-swatch').forEach(el => {
      const tid = (el as HTMLElement).dataset.tid!;
      (el as HTMLElement).addEventListener('mouseenter', () => {
        if (tid !== themeStore.current.id) (el as HTMLElement).style.background = 'color-mix(in srgb,var(--nd-dpurp) 15%,transparent)';
      });
      (el as HTMLElement).addEventListener('mouseleave', () => {
        if (tid !== themeStore.current.id) (el as HTMLElement).style.background = 'transparent';
      });
      (el as HTMLElement).addEventListener('click', () => {
        if (isNostrThemeEnabled()) setNostrThemeEnabled(false);
        themeStore.set(tid);
        this.closePanel();
        this.openPanel();
      });
    });

    // Nostr theme toggle
    this.panelEl?.querySelector('#sp-nostr-toggle')?.addEventListener('click', () => {
      setNostrThemeEnabled(!isNostrThemeEnabled());
      this.closePanel();
      this.openPanel();
    });

    // Browse button — open/close the theme browser
    this.panelEl?.querySelector('#sp-nostr-browse')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.themeBrowser.isOpen()) this.themeBrowser.close();
      else this.themeBrowser.open();
    });

    // Re-render only the nostr theme row when theme changes (avoid destroying the browser)
    this.nostrThemeUnsub = onNostrThemeChange(() => {
      if (!this.panelEl) return;
      const nt        = getNostrTheme();
      const ntEnabled = isNostrThemeEnabled();
      const dots = nt
        ? [nt.background, nt.text, nt.primary].map(c =>
            `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;
              background:${esc(c)};border:1px solid rgba(255,255,255,0.15);"></span>`
          ).join('')
        : '';
      const row = this.panelEl.querySelector('#sp-nostr-row') as HTMLElement | null;
      if (!row) return;
      row.innerHTML = nt
        ? `<div style="display:flex;gap:3px;">${dots}</div>
           <div style="flex:1;min-width:0;">
             <div style="color:var(--nd-text);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
               ${nt.title ? esc(nt.title) : 'Profile theme'}
             </div>
           </div>
           <button id="sp-nostr-toggle" style="
             padding:3px 8px;border-radius:4px;font-family:'Courier New',monospace;font-size:10px;
             cursor:pointer;flex-shrink:0;
             background:${ntEnabled ? 'color-mix(in srgb,var(--nd-accent) 18%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 22%,transparent)'};
             border:1px solid ${ntEnabled ? 'color-mix(in srgb,var(--nd-accent) 44%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 44%,transparent)'};
             color:${ntEnabled ? 'var(--nd-accent)' : 'var(--nd-subtext)'};"
           >${ntEnabled ? 'On' : 'Off'}</button>
           <button id="sp-nostr-browse" style="
             padding:3px 9px;border-radius:4px;font-family:'Courier New',monospace;font-size:10px;
             cursor:pointer;flex-shrink:0;
             background:color-mix(in srgb,var(--nd-accent) 13%,transparent);
             border:1px solid color-mix(in srgb,var(--nd-accent) 33%,transparent);
             color:var(--nd-accent);">Browse</button>`
        : `<div style="color:var(--nd-subtext);font-size:11px;flex:1;opacity:0.5;">No theme loaded</div>
           <button id="sp-nostr-browse" style="
             padding:3px 9px;border-radius:4px;font-family:'Courier New',monospace;font-size:10px;
             cursor:pointer;flex-shrink:0;
             background:color-mix(in srgb,var(--nd-accent) 13%,transparent);
             border:1px solid color-mix(in srgb,var(--nd-accent) 33%,transparent);
             color:var(--nd-accent);">Browse</button>`;
      row.querySelector('#sp-nostr-toggle')?.addEventListener('click', () => {
        setNostrThemeEnabled(!isNostrThemeEnabled());
      });
      row.querySelector('#sp-nostr-browse')?.addEventListener('click', () => {
        if (this.themeBrowser.isOpen()) this.themeBrowser.close();
        else this.themeBrowser.open();
      });
    });

    // Logout flow
    logoutBtn.addEventListener('click', () => {
      const confirm = this.panelEl?.querySelector('#settings-confirm') as HTMLElement;
      if (confirm) confirm.style.display = 'block';
      logoutBtn.style.display = 'none';
    });

    this.panelEl.querySelector('#settings-confirm-yes')?.addEventListener('click', () => {
      this.closePanel();
      this.destroy();
      logout();
      window.location.reload();
    });

    this.panelEl.querySelector('#settings-confirm-no')?.addEventListener('click', () => {
      const confirm = this.panelEl?.querySelector('#settings-confirm') as HTMLElement;
      if (confirm) confirm.style.display = 'none';
      logoutBtn.style.display = 'block';
    });

    if (this.gearEl) { this.gearEl.style.color = 'var(--nd-accent)'; this.gearEl.style.borderColor = `color-mix(in srgb, var(--nd-accent) 55%, transparent)`; }

    this.closeHandler = (e: MouseEvent) => {
      if (this.panelEl && !this.panelEl.contains(e.target as Node) && this.gearEl && !this.gearEl.contains(e.target as Node)) {
        this.closePanel();
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', this.closeHandler!), 50);
  }

  private closePanel(): void {
    this.themeBrowser.close();
    if (this.panelEl) { this.panelEl.remove(); this.panelEl = null; }
    if (this.closeHandler) { document.removeEventListener('pointerdown', this.closeHandler); this.closeHandler = null; }
    if (this.nostrThemeUnsub) { this.nostrThemeUnsub(); this.nostrThemeUnsub = null; }
    if (this.gearEl) { this.gearEl.style.color = 'var(--nd-dpurp)'; this.gearEl.style.borderColor = `color-mix(in srgb, var(--nd-dpurp) 33%, transparent)`; }
  }

  toggle(): void {
    if (this.panelEl) this.closePanel();
    else this.openPanel();
  }

  destroy(): void {
    this.closePanel();
    if (this.gearEl) { this.gearEl.remove(); this.gearEl = null; }
  }
}

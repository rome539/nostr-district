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
import { EmojiPackBrowser } from './EmojiPackBrowser';
import { HotkeyModal } from './HotkeyModal';
import { getEmojiCount, getStoredEmojiPacks } from '../nostr/emojiService';

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
  private themeBrowser   = new NostrThemeBrowser();
  private emojiPackBrowser = new EmojiPackBrowser();
  private hotkeyModal    = new HotkeyModal();

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
    const nsec = state.nsec || '';

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
          : `<div style="color:var(--nd-subtext);font-size:11px;flex:1;">No theme loaded</div>`
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
          <span class="sp-active-tag" style="color:${t.accent};font-size:10px;margin-left:auto;opacity:0.7;display:${isActive ? 'inline' : 'none'};">active</span>
        </div>
      `;
    }).join('');

    this.panelEl.innerHTML = `
      <div style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid color-mix(in srgb,var(--nd-dpurp) 22%,transparent);">
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px;">
          <span style="color:var(--nd-text);font-size:13px;font-weight:bold;">${esc(state.displayName || 'guest')}</span>
          <span style="color:var(--nd-subtext);font-size:11px;">${esc(method)}</span>
        </div>
        <button id="sp-keys-btn" style="
          margin-top:5px;padding:0;background:none;border:none;cursor:pointer;
          color:var(--nd-subtext);font-family:'Courier New',monospace;font-size:10px;
          transition:color 0.15s;
        ">Keys</button>
      </div>

      <div id="sp-appearance-header" style="color:var(--nd-subtext);font-size:10px;letter-spacing:0.08em;margin-bottom:6px;padding:0 2px;">APPEARANCE</div>
      <div id="settings-themes" style="display:flex;flex-direction:column;gap:2px;margin-bottom:10px;${ntEnabled ? 'opacity:0.5;' : ''}">
        ${themeSwatches}
      </div>

      <div style="height:1px;background:color-mix(in srgb,var(--nd-dpurp) 22%,transparent);margin:8px 0;"></div>
      <div style="color:var(--nd-subtext);font-size:10px;letter-spacing:0.08em;margin-bottom:6px;padding:0 2px;">NOSTR THEME</div>
      <div style="margin-bottom:10px;">${nostrThemeHtml}</div>

      <div style="height:1px;background:color-mix(in srgb,var(--nd-dpurp) 22%,transparent);margin:8px 0;"></div>

      <div style="color:var(--nd-subtext);font-size:10px;letter-spacing:0.08em;margin-bottom:6px;padding:0 2px;">CUSTOM EMOJIS</div>
      <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:5px;
        background:var(--nd-navy);border:1px solid color-mix(in srgb,var(--nd-dpurp) 22%,transparent);margin-bottom:10px;">
        <div style="flex:1;min-width:0;">
          <div style="color:var(--nd-text);font-size:11px;">${getEmojiCount()} emoji(s) loaded</div>
          <div style="color:var(--nd-subtext);font-size:9px;margin-top:1px;">${getStoredEmojiPacks().length} pack(s) added · use :shortcode: in chat</div>
        </div>
        <button id="sp-emoji-browse" style="
          padding:3px 9px;border-radius:4px;font-family:'Courier New',monospace;font-size:10px;
          cursor:pointer;flex-shrink:0;
          background:color-mix(in srgb,var(--nd-accent) 13%,transparent);
          border:1px solid color-mix(in srgb,var(--nd-accent) 33%,transparent);
          color:var(--nd-accent);">Browse</button>
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

      <a href="https://njump.me/npub12p5753xcjal8034w5czap3fcdvj9qj36h5873g73ea05emw2gznszr0ann" target="_blank" rel="noopener noreferrer" style="
        display:flex;align-items:center;justify-content:space-between;
        padding:7px 10px;border-radius:5px;text-decoration:none;
        color:var(--nd-subtext);font-family:'Courier New',monospace;font-size:11px;
        transition:color 0.15s;
      " onmouseover="this.style.color='var(--nd-text)'" onmouseout="this.style.color='var(--nd-subtext)'">
        <span>Dev <span style="opacity:0.5;font-size:9px;">on Nostr</span></span>
        <span style="opacity:0.4;font-size:10px;">npub12p57…r0ann ↗</span>
      </a>

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

    // Emoji pack browser button (closes theme browser)
    this.panelEl.querySelector('#sp-emoji-browse')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.emojiPackBrowser.isOpen()) { this.emojiPackBrowser.close(); return; }
      this.themeBrowser.close();
      this.emojiPackBrowser.open();
    });

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
        walletRow.querySelector('#sp-wallet-disconnect')?.addEventListener('click', async () => {
          await setNWCUri(''); renderWalletRow();
        });
      } else if (webln) {
        walletRow.innerHTML = `
          <div style="padding:6px 8px;border-radius:5px;
            background:color-mix(in srgb,var(--nd-accent) 8%,transparent);
            border:1px solid color-mix(in srgb,var(--nd-accent) 22%,transparent);
            color:var(--nd-accent);font-size:11px;">✓ Browser wallet detected</div>`;
      } else {
        const method = authStore.getState().loginMethod;
        const storageCopy = method === 'nsec'
          ? 'Your NWC connection URI is encrypted with a key derived from your nsec before being stored locally — useless without your key.'
          : 'Your NWC connection URI is stored in browser storage (encryption requires an nsec login).';
        walletRow.innerHTML = `
          <div style="color:var(--nd-subtext);font-size:10px;line-height:1.5;margin-bottom:6px;opacity:0.7;">
            ${storageCopy} Set a spending limit in your wallet for extra safety.
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
        walletRow.querySelector('#sp-nwc-connect')?.addEventListener('click', async () => {
          const err = walletRow.querySelector('#sp-nwc-err') as HTMLElement;
          const ok = await setNWCUri(inp.value.trim());
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

    const keysBtn = this.panelEl.querySelector('#sp-keys-btn') as HTMLElement;
    keysBtn.addEventListener('mouseenter', () => keysBtn.style.color = 'var(--nd-accent)');
    keysBtn.addEventListener('mouseleave', () => keysBtn.style.color = 'var(--nd-subtext)');
    keysBtn.addEventListener('click', () => this.showKeysModal(npub, nsec));

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

    // Browse button — open/close the theme browser (closes emoji browser)
    this.panelEl?.querySelector('#sp-nostr-browse')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.themeBrowser.isOpen()) { this.themeBrowser.close(); return; }
      this.emojiPackBrowser.close();
      this.themeBrowser.open();
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
        if (this.themeBrowser.isOpen()) { this.themeBrowser.close(); return; }
        this.emojiPackBrowser.close();
        this.themeBrowser.open();
      });

      // Also update the preset swatches active state and overridden label
      const appearanceHeader = this.panelEl?.querySelector('#sp-appearance-header') as HTMLElement | null;
      if (appearanceHeader) {
        appearanceHeader.innerHTML = `APPEARANCE`;
      }
      const themesEl = this.panelEl?.querySelector('#settings-themes') as HTMLElement | null;
      if (themesEl) {
        themesEl.style.opacity = ntEnabled ? '0.5' : '1';
        const activeId = themeStore.current.id;
        themesEl.querySelectorAll<HTMLElement>('.sp-theme-swatch').forEach(el => {
          const tid = el.dataset.tid;
          const t = THEMES.find(x => x.id === tid);
          if (!t) return;
          const isActive = !ntEnabled && tid === activeId;
          el.style.border = `1px solid ${isActive ? t.accent + '66' : 'transparent'}`;
          el.style.background = isActive ? t.accent + '11' : 'transparent';
          const label = el.querySelector('span') as HTMLElement | null;
          if (label) label.style.color = isActive ? t.accent : 'var(--nd-subtext)';
          const activeTag = el.querySelector('.sp-active-tag') as HTMLElement | null;
          if (activeTag) activeTag.style.display = isActive ? 'inline' : 'none';
        });
      }
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

  private showKeysModal(npub: string, nsec: string): void {
    const existing = document.getElementById('sp-keys-modal');
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement('div');
    overlay.id = 'sp-keys-modal';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      display:flex;align-items:center;justify-content:center;
      background:rgba(0,0,0,0.55);backdrop-filter:blur(3px);
    `;

    const displayNpub = npub ? (npub.slice(0, 20) + '...' + npub.slice(-6)) : '';

    overlay.innerHTML = `
      <div style="
        background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
        border:1px solid color-mix(in srgb,var(--nd-dpurp) 44%,transparent);
        border-radius:10px;padding:22px 24px 20px;
        font-family:'Courier New',monospace;
        box-shadow:0 8px 30px rgba(0,0,0,0.7);
        width:min(340px,94vw);
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
          <span style="color:var(--nd-text);font-size:14px;font-weight:bold;">Keys</span>
          <button id="sp-keys-close" style="background:none;border:none;color:var(--nd-subtext);font-size:16px;cursor:pointer;padding:2px 6px;opacity:0.6;">✕</button>
        </div>

        <div style="margin-bottom:14px;">
          <div style="color:var(--nd-subtext);font-size:10px;letter-spacing:0.08em;margin-bottom:6px;">PUBLIC KEY (npub)</div>
          <div style="display:flex;align-items:center;gap:8px;
            background:color-mix(in srgb,black 40%,var(--nd-bg));
            border:1px solid color-mix(in srgb,var(--nd-dpurp) 30%,transparent);
            border-radius:5px;padding:8px 10px;">
            <span id="sp-keys-npub-text" style="flex:1;font-size:10px;color:var(--nd-subtext);word-break:break-all;line-height:1.5;user-select:all;">${esc(npub)}</span>
            <button id="sp-keys-npub-copy" style="
              flex-shrink:0;padding:4px 10px;border-radius:4px;
              background:color-mix(in srgb,var(--nd-accent) 13%,transparent);
              border:1px solid color-mix(in srgb,var(--nd-accent) 27%,transparent);
              color:var(--nd-accent);font-family:'Courier New',monospace;font-size:10px;cursor:pointer;
            ">Copy</button>
          </div>
        </div>

        ${nsec ? `
        <div>
          <div style="color:rgba(240,176,64,0.6);font-size:10px;letter-spacing:0.08em;margin-bottom:6px;">PRIVATE KEY (nsec)</div>
          <div style="
            background:rgba(240,176,64,0.05);
            border:1px solid rgba(240,176,64,0.2);
            border-radius:5px;padding:8px 10px;margin-bottom:8px;
          ">
            <div id="sp-keys-nsec-masked" style="font-size:10px;color:rgba(240,176,64,0.5);letter-spacing:0.15em;">••••••••••••••••••••••••••••••••</div>
            <div id="sp-keys-nsec-text" style="display:none;font-size:10px;color:#f0b040;word-break:break-all;line-height:1.5;user-select:all;">${esc(nsec)}</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button id="sp-keys-nsec-reveal" style="
              flex:1;padding:6px;border-radius:4px;
              background:rgba(240,176,64,0.08);
              border:1px solid rgba(240,176,64,0.2);
              color:#f0b040;font-family:'Courier New',monospace;font-size:10px;cursor:pointer;
            ">Reveal</button>
            <button id="sp-keys-nsec-copy" style="
              flex:1;padding:6px;border-radius:4px;
              background:rgba(240,176,64,0.08);
              border:1px solid rgba(240,176,64,0.2);
              color:#f0b040;font-family:'Courier New',monospace;font-size:10px;cursor:pointer;
            ">Copy</button>
          </div>
          <div style="font-size:9px;color:#e85454;opacity:0.75;margin-top:8px;line-height:1.5;">Keep this safe. Anyone with your private key controls your account.</div>
        </div>` : ''}
      </div>
    `;

    document.body.appendChild(overlay);

    const destroy = () => {
      overlay.remove();
      document.removeEventListener('keydown', escHandler, { capture: true });
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); destroy(); }
    };
    document.addEventListener('keydown', escHandler, { capture: true });

    overlay.querySelector('#sp-keys-close')?.addEventListener('click', destroy);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) destroy(); });

    overlay.querySelector('#sp-keys-npub-copy')?.addEventListener('click', () => {
      navigator.clipboard.writeText(npub).then(() => {
        const btn = overlay.querySelector('#sp-keys-npub-copy') as HTMLButtonElement;
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 2000); }
      }).catch(() => {});
    });

    if (nsec) {
      let revealed = false;
      overlay.querySelector('#sp-keys-nsec-reveal')?.addEventListener('click', () => {
        revealed = !revealed;
        const masked = overlay.querySelector('#sp-keys-nsec-masked') as HTMLElement;
        const text = overlay.querySelector('#sp-keys-nsec-text') as HTMLElement;
        const btn = overlay.querySelector('#sp-keys-nsec-reveal') as HTMLButtonElement;
        masked.style.display = revealed ? 'none' : 'block';
        text.style.display = revealed ? 'block' : 'none';
        btn.textContent = revealed ? 'Hide' : 'Reveal';
      });

      overlay.querySelector('#sp-keys-nsec-copy')?.addEventListener('click', () => {
        navigator.clipboard.writeText(nsec).then(() => {
          const btn = overlay.querySelector('#sp-keys-nsec-copy') as HTMLButtonElement;
          if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 2000); }
        }).catch(() => {});
      });
    }
  }

  private closePanel(): void {
    this.themeBrowser.close();
    this.emojiPackBrowser.close();
    if (this.panelEl) { this.panelEl.remove(); this.panelEl = null; }
    if (this.closeHandler) { document.removeEventListener('pointerdown', this.closeHandler); this.closeHandler = null; }
    if (this.nostrThemeUnsub) { this.nostrThemeUnsub(); this.nostrThemeUnsub = null; }
    if (this.gearEl) { this.gearEl.style.color = 'var(--nd-dpurp)'; this.gearEl.style.borderColor = `color-mix(in srgb, var(--nd-dpurp) 33%, transparent)`; }
  }

  isOpen(): boolean { return !!this.panelEl; }

  toggle(): void {
    if (this.panelEl) this.closePanel();
    else this.openPanel();
  }

  destroy(): void {
    this.closePanel();
    if (this.gearEl) { this.gearEl.remove(); this.gearEl = null; }
  }
}

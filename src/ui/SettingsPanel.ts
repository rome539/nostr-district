/**
 * SettingsPanel.ts — Minimal gear menu (top-right)
 *
 * Contains:
 * - Copy npub to clipboard
 * - Logout (with confirmation)
 */

import { P } from '../config/game.config';
import { authStore } from '../stores/authStore';
import { logout } from '../nostr/nostrService';
import { themeStore, THEMES } from '../stores/themeStore';
import {
  getNostrTheme, isNostrThemeEnabled,
  setNostrThemeEnabled, onNostrThemeChange,
} from '../nostr/nostrThemeService';
import { NostrThemeBrowser } from './NostrThemeBrowser';

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
      min-width: 230px; max-width: 280px;
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
      <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:5px;
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

      <div id="settings-npub" style="padding:8px 10px;margin-bottom:10px;background:var(--nd-navy);border:1px solid color-mix(in srgb,var(--nd-dpurp) 22%,transparent);border-radius:4px;cursor:pointer;transition:border-color 0.15s;">
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

    this.panelEl.addEventListener('mousedown', (e) => e.stopPropagation());
    this.panelEl.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(this.panelEl);

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

    // Re-render panel when nostr theme loads / changes while open
    this.nostrThemeUnsub = onNostrThemeChange(() => {
      if (this.panelEl) { this.closePanel(); this.openPanel(); }
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
    setTimeout(() => document.addEventListener('mousedown', this.closeHandler!), 50);
  }

  private closePanel(): void {
    this.themeBrowser.close();
    if (this.panelEl) { this.panelEl.remove(); this.panelEl = null; }
    if (this.closeHandler) { document.removeEventListener('mousedown', this.closeHandler); this.closeHandler = null; }
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
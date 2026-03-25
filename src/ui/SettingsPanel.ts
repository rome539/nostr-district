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

const GEAR_ID = 'settings-gear';
const PANEL_ID = 'settings-panel';

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

export class SettingsPanel {
  private gearEl: HTMLDivElement | null = null;
  private panelEl: HTMLDivElement | null = null;
  private closeHandler: ((e: MouseEvent) => void) | null = null;

  create(): void {
    this.destroy();

    this.gearEl = document.createElement('div');
    this.gearEl.id = GEAR_ID;
    this.gearEl.textContent = '\u2699';
    this.gearEl.style.cssText = `
      position: fixed; top: 12px; right: 14px; z-index: 2000;
      width: 34px; height: 34px;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; color: ${P.dpurp};
      background: ${P.bg}cc; border: 1px solid ${P.dpurp}33;
      border-radius: 6px; cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
      user-select: none;
    `;
    this.gearEl.addEventListener('mouseenter', () => {
      if (this.gearEl) { this.gearEl.style.color = P.teal; this.gearEl.style.borderColor = `${P.teal}55`; }
    });
    this.gearEl.addEventListener('mouseleave', () => {
      if (this.gearEl && !this.panelEl) { this.gearEl.style.color = P.dpurp; this.gearEl.style.borderColor = `${P.dpurp}33`; }
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
      background: linear-gradient(180deg, ${P.bg} 0%, #0e0828 100%);
      border: 1px solid ${P.dpurp}44; border-radius: 8px;
      padding: 14px 16px; font-family: 'Courier New', monospace;
      box-shadow: 0 4px 20px rgba(0,0,0,0.6);
      min-width: 230px; max-width: 280px;
    `;

    this.panelEl.innerHTML = `
      <div style="color:${P.lcream};font-size:13px;font-weight:bold;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid ${P.dpurp}22;">
        ${esc(state.displayName || 'guest')}
        <span style="color:${P.dpurp};font-size:11px;font-weight:normal;margin-left:6px;">${esc(method)}</span>
      </div>

      <div id="settings-npub" style="padding:8px 10px;margin-bottom:10px;background:${P.navy};border:1px solid ${P.dpurp}22;border-radius:4px;cursor:pointer;transition:border-color 0.15s;">
        <div style="color:${P.dpurp};font-size:10px;margin-bottom:3px;">NPUB</div>
        <div style="color:${P.lcream};font-size:11px;word-break:break-all;opacity:0.7;">${esc(displayNpub)}</div>
        <div id="settings-copy-hint" style="color:${P.teal};font-size:10px;margin-top:4px;opacity:0.5;">click to copy</div>
      </div>

      <div style="height:1px;background:${P.dpurp}22;margin:8px 0;"></div>

      <div id="settings-logout" style="padding:10px 10px;color:${P.red};font-size:13px;cursor:pointer;border-radius:4px;transition:background 0.15s;">
        \u23FB Logout
      </div>

      <div id="settings-confirm" style="display:none;padding:10px;background:${P.red}11;border:1px solid ${P.red}33;border-radius:4px;margin-top:6px;">
        <div style="color:${P.lcream};font-size:12px;margin-bottom:10px;">Are you sure?</div>
        <div style="display:flex;gap:8px;">
          <button id="settings-confirm-yes" style="flex:1;padding:7px;background:${P.red}33;border:1px solid ${P.red}55;border-radius:4px;color:${P.red};font-family:'Courier New',monospace;font-size:12px;cursor:pointer;font-weight:bold;">Logout</button>
          <button id="settings-confirm-no" style="flex:1;padding:7px;background:none;border:1px solid ${P.dpurp}44;border-radius:4px;color:${P.dpurp};font-family:'Courier New',monospace;font-size:12px;cursor:pointer;">Cancel</button>
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
        if (hint) { hint.textContent = 'copied!'; hint.setAttribute('style', `color:${P.teal};font-size:10px;margin-top:4px;opacity:1;`); }
        setTimeout(() => {
          if (hint) { hint.textContent = 'click to copy'; hint.setAttribute('style', `color:${P.teal};font-size:10px;margin-top:4px;opacity:0.5;`); }
        }, 2000);
      }).catch(() => {});
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

    if (this.gearEl) { this.gearEl.style.color = P.teal; this.gearEl.style.borderColor = `${P.teal}55`; }

    this.closeHandler = (e: MouseEvent) => {
      if (this.panelEl && !this.panelEl.contains(e.target as Node) && this.gearEl && !this.gearEl.contains(e.target as Node)) {
        this.closePanel();
      }
    };
    setTimeout(() => document.addEventListener('mousedown', this.closeHandler!), 50);
  }

  private closePanel(): void {
    if (this.panelEl) { this.panelEl.remove(); this.panelEl = null; }
    if (this.closeHandler) { document.removeEventListener('mousedown', this.closeHandler); this.closeHandler = null; }
    if (this.gearEl) { this.gearEl.style.color = P.dpurp; this.gearEl.style.borderColor = `${P.dpurp}33`; }
  }

  destroy(): void {
    this.closePanel();
    if (this.gearEl) { this.gearEl.remove(); this.gearEl = null; }
  }
}
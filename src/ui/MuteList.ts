/**
 * MuteList.ts — Panel showing all muted players with unmute buttons.
 * Open with /mutelist command.
 */

import { mutedPlayers, mutedNames, unmutePlayer } from './PlayerMenu';
import { ProfileModal } from './ProfileModal';
import { fetchProfile } from '../nostr/nostrService';

export class MuteList {
  private panel: HTMLDivElement | null = null;
  private open = false;

  toggle(): void { this.open ? this.close() : this.show(); }

  show(): void {
    if (!this.panel) this.build();
    this.render();
    this.panel!.style.display = 'flex';
    this.open = true;
    this.refreshNames();
  }

  private refreshNames(): void {
    mutedPlayers.forEach(pk => {
      fetchProfile(pk).then(profile => {
        if (!profile) return;
        const name = profile.display_name || profile.name || mutedNames.get(pk) || pk.slice(0, 10) + '…';
        mutedNames.set(pk, name);
        if (this.open) this.render();
      }).catch(() => {});
    });
  }

  close(): void {
    if (this.panel) this.panel.style.display = 'none';
    this.open = false;
  }

  destroy(): void { this.panel?.remove(); this.panel = null; }

  private build(): void {
    this.injectStyles();
    this.panel = document.createElement('div');
    this.panel.id = 'mutelist-overlay';
    document.body.appendChild(this.panel);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open) this.close(); });
  }

  private render(): void {
    if (!this.panel) return;

    const muted = [...mutedPlayers];
    const rows = muted.length === 0
      ? `<div class="ml-empty">No muted players.</div>`
      : muted.map(pk => {
          const name = mutedNames.get(pk) || pk.slice(0, 16) + '…';
          return `
            <div class="ml-row" data-pk="${this.esc(pk)}">
              <span class="ml-name">${this.esc(name)}</span>
              <div class="ml-actions">
                <button class="ml-profile-btn" data-pk="${this.esc(pk)}" data-name="${this.esc(name)}">Profile</button>
                <button class="ml-unmute-btn" data-pk="${this.esc(pk)}" data-name="${this.esc(name)}">Unmute</button>
              </div>
            </div>`;
        }).join('');

    this.panel.innerHTML = `
      <div class="ml-panel">
        <div class="ml-header">
          <span class="ml-title">MUTED PLAYERS</span>
          <button class="ml-close" id="ml-close">✕</button>
        </div>
        <div class="ml-body">
          ${rows}
        </div>
      </div>`;

    this.panel.querySelector('#ml-close')?.addEventListener('click', () => this.close());

    this.panel.querySelectorAll('.ml-unmute-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pk = (btn as HTMLElement).dataset.pk!;
        const name = (btn as HTMLElement).dataset.name!;
        unmutePlayer(pk);
        this.render();
        // Re-render so the row disappears
      });
    });

    this.panel.querySelectorAll('.ml-profile-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pk = (btn as HTMLElement).dataset.pk!;
        const name = (btn as HTMLElement).dataset.name!;
        ProfileModal.show(pk, name);
      });
    });
  }

  private esc(s: string): string {
    const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
  }

  private injectStyles(): void {
    if (document.getElementById('mutelist-styles')) return;
    const style = document.createElement('style');
    style.id = 'mutelist-styles';
    style.textContent = `
      #mutelist-overlay {
        display:none;position:fixed;inset:0;z-index:3500;
        align-items:center;justify-content:center;
        background:rgba(0,0,0,0.55);backdrop-filter:blur(3px);
      }
      .ml-panel {
        background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
        border:1px solid color-mix(in srgb,var(--nd-text) 12%,transparent);
        border-radius:10px;width:min(400px,96vw);max-height:75dvh;
        display:flex;flex-direction:column;
        box-shadow:0 8px 40px rgba(0,0,0,0.75);
        font-family:'Courier New',monospace;
      }
      .ml-header {
        display:flex;align-items:center;justify-content:space-between;
        padding:14px 18px;
        background:color-mix(in srgb,black 52%,var(--nd-bg));
        border-bottom:1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);
        border-radius:10px 10px 0 0;
        flex-shrink:0;
      }
      .ml-title { color:var(--nd-accent);font-size:14px;font-weight:bold;letter-spacing:1px; }
      .ml-close { background:none;border:none;color:var(--nd-subtext);font-size:16px;cursor:pointer;padding:4px 6px; }
      .ml-close:hover { color:var(--nd-text); }
      .ml-body { flex:1;overflow-y:auto;padding:8px 0;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--nd-text) 18%,transparent) transparent; }
      .ml-empty { color:var(--nd-subtext);font-size:13px;text-align:center;padding:32px 20px;opacity:0.6; }
      .ml-row {
        display:flex;align-items:center;justify-content:space-between;
        padding:10px 18px;
        border-bottom:1px solid color-mix(in srgb,var(--nd-text) 7%,transparent);
        transition:background 0.12s;
      }
      .ml-row:hover { background:color-mix(in srgb,var(--nd-text) 4%,transparent); }
      .ml-name { color:var(--nd-text);font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
      .ml-actions { display:flex;gap:8px;flex-shrink:0; }
      .ml-profile-btn {
        padding:5px 10px;border-radius:4px;cursor:pointer;font-size:11px;
        font-family:'Courier New',monospace;
        background:transparent;
        border:1px solid color-mix(in srgb,var(--nd-text) 20%,transparent);
        color:var(--nd-subtext);transition:all 0.12s;
      }
      .ml-profile-btn:hover { color:var(--nd-text);border-color:color-mix(in srgb,var(--nd-text) 40%,transparent); }
      .ml-unmute-btn {
        padding:5px 12px;border-radius:4px;cursor:pointer;font-size:11px;
        font-family:'Courier New',monospace;
        background:color-mix(in srgb,var(--nd-accent) 15%,transparent);
        border:1px solid color-mix(in srgb,var(--nd-accent) 35%,transparent);
        color:var(--nd-accent);transition:background 0.12s;
      }
      .ml-unmute-btn:hover { background:color-mix(in srgb,var(--nd-accent) 25%,transparent); }
    `;
    document.head.appendChild(style);
  }
}

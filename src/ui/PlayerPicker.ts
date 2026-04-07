/**
 * PlayerPicker.ts — Standalone room-picker overlay.
 * Shows "Enter My Room" + a searchable list of online players.
 * Call open() with callbacks; the caller handles navigation.
 */

import { requestOnlinePlayers, setOnlinePlayersHandler } from '../nostr/presenceService';

const esc = (s: string) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

export class PlayerPicker {
  private el: HTMLDivElement | null = null;
  private kbHandler: ((e: KeyboardEvent) => void) | null = null;

  /** onMyRoom: player chose their own room. onVisit: player chose to request someone else's room. */
  open(myPubkey: string, myName: string, onMyRoom: () => void, onVisit: (pubkey: string) => void): void {
    this.close();

    this.el = document.createElement('div');
    this.el.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:3000;background:linear-gradient(180deg,var(--nd-bg),var(--nd-navy));border:1px solid color-mix(in srgb,var(--nd-dpurp) 33%,transparent);border-radius:10px;padding:20px 24px;font-family:'Courier New',monospace;box-shadow:0 8px 30px rgba(0,0,0,0.7);min-width:300px;max-width:360px;`;
    this.el.innerHTML = `
      <div style="color:var(--nd-accent);font-size:15px;font-weight:bold;margin-bottom:14px;text-align:center;">MY ROOM</div>
      <button class="pp-mine" style="width:100%;padding:10px;margin-bottom:12px;background:color-mix(in srgb,var(--nd-accent) 13%,transparent);border:1px solid color-mix(in srgb,var(--nd-accent) 33%,transparent);border-radius:6px;color:var(--nd-accent);font-size:13px;cursor:pointer;font-weight:bold;">Enter ${esc(myName)}'s Room</button>
      <div style="color:var(--nd-subtext);font-size:12px;margin-bottom:10px;text-align:center;">— or visit someone —</div>
      <input class="pp-search" type="text" placeholder="Search..." style="width:100%;padding:8px 12px;margin-bottom:10px;background:color-mix(in srgb,var(--nd-bg) 80%,transparent);border:1px solid color-mix(in srgb,var(--nd-dpurp) 27%,transparent);border-radius:6px;color:var(--nd-text);font-size:13px;outline:none;box-sizing:border-box;"/>
      <div class="pp-list" style="max-height:200px;overflow-y:auto;border:1px solid color-mix(in srgb,var(--nd-dpurp) 13%,transparent);border-radius:6px;"></div>
      <button class="pp-cancel" style="width:100%;padding:8px;margin-top:12px;background:none;border:1px solid color-mix(in srgb,var(--nd-dpurp) 27%,transparent);border-radius:6px;color:var(--nd-subtext);font-size:12px;cursor:pointer;">Cancel</button>
    `;
    document.body.appendChild(this.el);

    this.el.querySelector('.pp-mine')!.addEventListener('click', () => { this.close(); onMyRoom(); });
    this.el.querySelector('.pp-cancel')!.addEventListener('click', () => this.close());

    this.kbHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } };
    document.addEventListener('keydown', this.kbHandler);

    const search = this.el.querySelector('.pp-search') as HTMLInputElement;
    search.addEventListener('keydown', (e) => { e.stopPropagation(); });

    const list = this.el.querySelector('.pp-list') as HTMLDivElement;
    list.innerHTML = `<div style="color:var(--nd-subtext);font-size:12px;text-align:center;padding:12px;">Loading...</div>`;

    let players: { pubkey: string; name: string }[] = [];

    const render = (filter: string) => {
      const filtered = filter ? players.filter(p => p.name.toLowerCase().includes(filter.toLowerCase())) : players;
      if (!filtered.length) {
        list.innerHTML = `<div style="color:var(--nd-subtext);font-size:12px;text-align:center;padding:12px;">${filter ? 'No matches' : 'No players online'}</div>`;
        return;
      }
      list.innerHTML = filtered.map(p => `
        <div class="pp-player" data-pk="${p.pubkey}" style="padding:10px 14px;border-bottom:1px solid color-mix(in srgb,var(--nd-dpurp) 8%,transparent);cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
          <span style="color:var(--nd-text);font-size:13px;">${esc(p.name)}</span>
          <span style="color:var(--nd-accent);font-size:11px;opacity:0.6;">Request →</span>
        </div>
      `).join('');
      list.querySelectorAll('.pp-player').forEach(el => {
        el.addEventListener('mouseenter', () => (el as HTMLElement).style.background = `color-mix(in srgb,var(--nd-dpurp) 10%,transparent)`);
        el.addEventListener('mouseleave', () => (el as HTMLElement).style.background = 'transparent');
        el.addEventListener('click', () => {
          const pk = (el as HTMLElement).dataset.pk;
          if (pk) { this.close(); onVisit(pk); }
        });
      });
    };

    search.addEventListener('input', () => render(search.value));
    setOnlinePlayersHandler((p) => { setOnlinePlayersHandler(null); players = p.filter(p => p.pubkey !== myPubkey); render(search.value); });
    requestOnlinePlayers();
  }

  close(): void {
    if (this.kbHandler) { document.removeEventListener('keydown', this.kbHandler); this.kbHandler = null; }
    if (this.el) { this.el.remove(); this.el = null; }
    setOnlinePlayersHandler(null);
  }

  isOpen(): boolean { return !!this.el; }
}

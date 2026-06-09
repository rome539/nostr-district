/**
 * HotkeyModal.ts — Hotkeys & commands reference overlay.
 */

import { t as ti18n, onLangChange } from '../i18n/i18n';

export class HotkeyModal {
  private el: HTMLDivElement | null = null;
  private open = false;

  toggle(): void { this.open ? this.close() : this.show(); }

  show(): void {
    if (!this.el) this.build();
    else this.rebuild(); // refresh in case language changed since last open
    this.el!.style.display = 'flex';
    this.open = true;
    if (!this._unsubLang) {
      this._unsubLang = onLangChange(() => {
        if (this.open) this.rebuild();
      });
    }
  }

  private _unsubLang: (() => void) | null = null;

  private rebuild(): void {
    this.el?.remove();
    this.el = null;
    this.build();
  }

  close(): void {
    if (this.el) this.el.style.display = 'none';
    this.open = false;
  }

  isOpen(): boolean { return this.open; }

  destroy(): void { this.el?.remove(); this.el = null; }

  private build(): void {
    this.injectStyles();
    this.el = document.createElement('div');
    this.el.id = 'hk-overlay';

    const hotkeys: [string, string][] = [
      ['E / Space', ti18n('hk.enter_room')],
      ['Tab',       ti18n('hk.world_map')],
      ['M',         ti18n('hk.messages')],
      ['G',         ti18n('hk.crews')],
      ['F',         ti18n('hk.follows_list')],
      ['T',         ti18n('hk.terminal')],
      ['B',         ti18n('hk.polls_board')],
      ['U',         ti18n('hk.mute_list')],
      ['W',         ti18n('hk.wallet')],
      ['S',         ti18n('hk.settings')],
      ['Enter',     ti18n('hk.focus_chat')],
      ['Esc',       ti18n('hk.back_close')],
    ];

    const navCmds: [string, string][] = [
      ['/map',          ti18n('hk.world_map')],
      ['/shop',         ti18n('hk.cmd.shop')],
      ['/bazaar',       'Open item market & inventory'],
      ['/wallet',       ti18n('hk.cmd.wallet')],
      ['/tp <room>',    ti18n('hk.cmd.tp')],
      ['/dm <name>',    ti18n('hk.cmd.dm')],
      ['/crew',         ti18n('hk.cmd.crew')],
      ['/visit <name>', ti18n('hk.cmd.visit')],
      ['/zap <name>',   ti18n('hk.cmd.zap')],
      ['/players',      ti18n('hk.cmd.players')],
      ['/follows',      ti18n('hk.cmd.follows')],
      ['/polls',        ti18n('hk.cmd.polls')],

      ['/tutorial',     ti18n('hk.cmd.tutorial')],
      ['/status',       ti18n('hk.cmd.status')],
      ['/mute',         ti18n('hk.cmd.mute')],
      ['/mutelist',     ti18n('hk.cmd.mutelist')],
      ['/filter <w>',   ti18n('hk.cmd.filter')],
      ['/unfilter <w>', ti18n('hk.cmd.unfilter')],
    ];

    const socialCmds: [string, string][] = [
      ['/smoke',    ti18n('hk.cmd.smoke')],
      ['/coffee',   ti18n('hk.cmd.coffee')],
      ['/music',    ti18n('hk.cmd.music')],
      ['/zzz',      ti18n('hk.cmd.zzz')],
      ['/think',    ti18n('hk.cmd.think')],
      ['/hearts',   ti18n('hk.cmd.hearts')],
      ['/angry',    ti18n('hk.cmd.angry')],
      ['/sweat',    ti18n('hk.cmd.sweat')],
      ['/sparkle',  ti18n('hk.cmd.sparkle')],
      ['/confetti', ti18n('hk.cmd.confetti')],
      ['/fire',     ti18n('hk.cmd.fire')],
      ['/ghost',    ti18n('hk.cmd.ghost')],
      ['/rain',     ti18n('hk.cmd.rain')],
    ];

    const gameCmds: [string, string][] = [
      ['/flip',           ti18n('hk.cmd.flip')],
      ['/8ball <q>',      ti18n('hk.cmd.8ball')],
      ['/slots',          ti18n('hk.cmd.slots')],
      ['/ship <n1> <n2>', ti18n('hk.cmd.ship')],
      ['/rps <choice>',   ti18n('hk.cmd.rps')],
    ];

    const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const kRow = ([k, v]: [string, string]) => `
      <div class="hk-row">
        <kbd class="hk-key">${esc(k)}</kbd>
        <span class="hk-desc">${esc(v)}</span>
      </div>`;

    const cRow = ([k, v]: [string, string]) => `
      <div class="hk-row">
        <code class="hk-cmd">${esc(k)}</code>
        <span class="hk-desc">${esc(v)}</span>
      </div>`;

    const section = (label: string, rows: string, first = false) => `
      <div class="hk-section-label${first ? '' : ' hk-section-gap'}">${label}</div>
      ${rows}`;

    this.el.innerHTML = `
      <div class="hk-panel">
        <div class="hk-header">
          <span class="hk-title">${ti18n('hk.title')}</span>
          <button class="hk-close" id="hk-close">✕</button>
        </div>
        <div class="hk-body">
          <div class="hk-col hk-col-full">
            ${section(ti18n('hk.section.hotkeys'),    hotkeys.map(kRow).join(''), true)}
            ${section(ti18n('hk.section.navigation'), navCmds.map(cRow).join(''))}
          </div>
          <div class="hk-divider"></div>
          <div class="hk-col">
            ${section(ti18n('hk.section.social'), socialCmds.map(cRow).join(''), true)}
            ${section(ti18n('hk.section.games'),  gameCmds.map(cRow).join(''))}
          </div>
        </div>
      </div>`;

    this.el.addEventListener('mousedown', e => { if (e.target === this.el) this.close(); });
    this.el.querySelector('#hk-close')?.addEventListener('click', () => this.close());
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.open) { e.stopPropagation(); this.close(); } });
    document.body.appendChild(this.el);
  }

  private injectStyles(): void {
    if (document.getElementById('hk-styles')) return;
    const s = document.createElement('style');
    s.id = 'hk-styles';
    s.textContent = `
      #hk-overlay {
        display:none;position:fixed;inset:0;z-index:4000;
        align-items:center;justify-content:center;
        background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);
      }
      .hk-panel {
        background:linear-gradient(160deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
        border:1px solid color-mix(in srgb,var(--nd-text) 12%,transparent);
        border-radius:10px;width:580px;max-width:95vw;
        box-shadow:0 12px 48px rgba(0,0,0,0.8);
        font-family:'Courier New',monospace;
        overflow:hidden;
      }
      .hk-header {
        display:flex;align-items:center;justify-content:space-between;
        padding:14px 20px;
        background:color-mix(in srgb,black 50%,var(--nd-bg));
        border-bottom:1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);
      }
      .hk-title { color:var(--nd-accent);font-size:14px;font-weight:bold;letter-spacing:1px; }
      .hk-close { background:none;border:none;color:var(--nd-subtext);font-size:16px;cursor:pointer;padding:2px 6px; }
      .hk-close:hover { color:var(--nd-text); }
      .hk-body {
        display:grid;grid-template-columns:1fr 1px 1fr;
        gap:0;padding:20px;
        max-height:70dvh;overflow-y:auto;
        scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--nd-text) 15%,transparent) transparent;
      }
      @media (max-width:520px) {
        .hk-body { grid-template-columns:1fr; padding:14px; }
        .hk-divider { display:none; }
      }
      .hk-col { display:flex;flex-direction:column;gap:4px; }
      .hk-divider { background:color-mix(in srgb,var(--nd-text) 8%,transparent);margin:0 18px; }
      .hk-section-label {
        color:var(--nd-subtext);font-size:10px;letter-spacing:1px;
        opacity:0.6;margin-bottom:6px;
      }
      .hk-section-gap { margin-top:14px; }
      .hk-row {
        display:flex;align-items:center;justify-content:space-between;
        gap:12px;padding:6px 8px;border-radius:5px;
        background:color-mix(in srgb,black 25%,var(--nd-bg));
        margin-bottom:2px;
      }
      .hk-key {
        background:color-mix(in srgb,var(--nd-dpurp) 35%,transparent);
        border:1px solid color-mix(in srgb,var(--nd-dpurp) 55%,transparent);
        border-bottom-width:2px;
        border-radius:4px;padding:2px 8px;
        color:var(--nd-accent);font-size:11px;
        white-space:nowrap;flex-shrink:0;
      }
      .hk-cmd {
        color:var(--nd-accent);font-size:11px;
        white-space:nowrap;flex-shrink:0;
      }
      .hk-desc { color:var(--nd-subtext);font-size:11px;text-align:right; }
    `;
    document.head.appendChild(s);
  }
}

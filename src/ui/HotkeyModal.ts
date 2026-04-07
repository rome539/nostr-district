/**
 * HotkeyModal.ts — Hotkeys & commands reference overlay.
 */

export class HotkeyModal {
  private el: HTMLDivElement | null = null;
  private open = false;

  toggle(): void { this.open ? this.close() : this.show(); }

  show(): void {
    if (!this.el) this.build();
    this.el!.style.display = 'flex';
    this.open = true;
  }

  close(): void {
    if (this.el) this.el.style.display = 'none';
    this.open = false;
  }

  destroy(): void { this.el?.remove(); this.el = null; }

  private build(): void {
    this.injectStyles();
    this.el = document.createElement('div');
    this.el.id = 'hk-overlay';

    const hotkeys: [string, string][] = [
      ['E / Space', 'Enter room / interact'],
      ['M',         'Messages (DMs)'],
      ['G',         'Follows list'],
      ['B',         'Polls board'],
      ['U',         'Mute list'],
      ['S',         'Settings'],
      ['Enter',     'Focus chat'],
      ['Esc',       'Back / close'],
    ];

    const navCmds: [string, string][] = [
      ['/tp <room>',    'Teleport to a room'],
      ['/dm <name>',    'Open direct message'],
      ['/visit <name>', "Visit player's room"],
      ['/players',      'Who\'s online'],
      ['/follows',      'Open follows list'],
      ['/polls',        'Open polls board'],
      ['/status',       'Show your status'],
      ['/mute',         'Mute all chat'],
      ['/mutelist',     'View muted players'],
      ['/filter <w>',   'Filter a word from chat'],
    ];

    const socialCmds: [string, string][] = [
      ['/smoke',    'Light a cigarette'],
      ['/coffee',   'Sip some coffee'],
      ['/music',    'Hum a tune'],
      ['/zzz',      'Fall asleep (AFK)'],
      ['/think',    'Show thought bubble'],
      ['/hearts',   'Float hearts'],
      ['/angry',    'Steam with rage'],
      ['/sweat',    'Nervous sweat drops'],
      ['/sparkle',  'Orbit sparkles'],
      ['/confetti', 'Celebrate with confetti'],
      ['/fire',     'Set yourself on fire'],
      ['/ghost',    'Spooky orbs'],
      ['/rain',     'Personal rain cloud'],
    ];

    const gameCmds: [string, string][] = [
      ['/flip',             'Flip a coin'],
      ['/8ball <q>',        'Ask the magic 8-ball'],
      ['/slots',            'Spin the slot machine'],
      ['/ship <n1> <n2>',  'Compatibility %'],
      ['/rps <choice>',    'Challenge to RPS'],
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
          <span class="hk-title">Hotkeys & Commands</span>
          <button class="hk-close" id="hk-close">✕</button>
        </div>
        <div class="hk-body">
          <div class="hk-col hk-col-full">
            ${section('HOTKEYS', hotkeys.map(kRow).join(''), true)}
            ${section('NAVIGATION', navCmds.map(cRow).join(''))}
          </div>
          <div class="hk-divider"></div>
          <div class="hk-col">
            ${section('SOCIAL', socialCmds.map(cRow).join(''), true)}
            ${section('GAMES', gameCmds.map(cRow).join(''))}
          </div>
        </div>
      </div>`;

    this.el.addEventListener('mousedown', e => { if (e.target === this.el) this.close(); });
    this.el.querySelector('#hk-close')?.addEventListener('click', () => this.close());
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.open) this.close(); });
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

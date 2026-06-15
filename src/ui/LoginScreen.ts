import { P } from '../config/game.config';
import { t, getCurrentLang, setLang, onLangChange } from '../i18n/i18n';
import { getActiveHoliday, holidayYears, getHalvingLiveInfo, onHalvingLiveUpdate, getActiveHolidayTheme } from './holidayBanners';
import { LoginInfo } from './LoginInfo';
import { LoginHolidayFX } from './loginHolidayFX';

interface LoginBuilding {
  x: number; y: number; w: number; h: number; shade: string;
  windows: { x: number; y: number; flicker: number }[];
  sign?: { y: number; w: number; hue: 'accent' | 'purp' | 'pink' };
  far: boolean;
}

interface Star {
  x: number; y: number; r: number; base: number; speed: number; color: string;
}

interface ShootingStar {
  startX: number; startY: number;
  vx: number; vy: number;
  startTime: number; duration: number;
}

export class LoginScreen {
  private container: HTMLDivElement;
  private onExtensionLogin: () => void;
  private onNsecLogin: (nsec: string) => void;
  private onGuestLogin: () => void;
  private onBunkerLogin: (url: string) => void;
  private onBunkerClientFlow: (() => void) | null = null;
  private onBunkerCancel: (() => void) | null = null;
  private onConfirmCreate: ((nsec: string, username: string) => void) | null = null;
  private onCreateWithPasskey: ((username: string) => Promise<string>) | null = null;
  private onPasskeyLogin: ((credentialId: string) => void) | null = null;
  private storedPasskeys: { credentialId: string; displayName: string }[] = [];
  private _primaryPasskeyId: string | null = null;
  private _pendingCreateNsec = '';
  private _pendingCreateUsername = '';

  private _lastLogin: string | null = null;
  private _hasExtension = false;

  private canvas: HTMLCanvasElement | null = null;
  private animFrameId: number | null = null;
  private buildings: LoginBuilding[] = [];
  private stars: Star[] = [];
  private shootingStar: ShootingStar | null = null;
  private shootingStarNext = 0;
  private holidayFX = new LoginHolidayFX();
  // 0=new, 0.25=first quarter, 0.5=full, 0.75=last quarter — random each session
  private handleResize = (): void => {
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.generateBuildings();
    this.holidayFX.resize(window.innerWidth, window.innerHeight);
  };

  constructor(callbacks: {
    onExtensionLogin: () => void;
    onNsecLogin: (nsec: string) => void;
    onGuestLogin: () => void;
    onBunkerLogin: (url: string) => void;
    onBunkerClientFlow?: () => void;
    onBunkerCancel?: () => void;
    onConfirmCreate?: (nsec: string, username: string) => void;
    onCreateWithPasskey?: (username: string) => Promise<string>;
    onPasskeyLogin?: (credentialId: string) => void;
    storedPasskeys?: { credentialId: string; displayName: string }[];
  }) {
    this.onExtensionLogin = callbacks.onExtensionLogin;
    this.onNsecLogin = callbacks.onNsecLogin;
    this.onGuestLogin = callbacks.onGuestLogin;
    this.onBunkerLogin = callbacks.onBunkerLogin;
    this.onBunkerClientFlow = callbacks.onBunkerClientFlow || null;
    this.onBunkerCancel = callbacks.onBunkerCancel || null;
    this.onConfirmCreate = callbacks.onConfirmCreate || null;
    this.onCreateWithPasskey = callbacks.onCreateWithPasskey || null;
    this.onPasskeyLogin = callbacks.onPasskeyLogin || null;
    this.storedPasskeys = callbacks.storedPasskeys || [];
    this._lastLogin = localStorage.getItem('nd_last_login');
    this._hasExtension = typeof (window as any).nostr !== 'undefined';
    const storedPrimary = localStorage.getItem('nd_primary_passkey');
    const firstId = this.storedPasskeys[0]?.credentialId ?? null;
    this._primaryPasskeyId = (storedPrimary && this.storedPasskeys.some(p => p.credentialId === storedPrimary))
      ? storedPrimary : firstId;

    this.container = document.createElement('div');
    this.container.id = 'login-screen';
    this.container.innerHTML = this.getHTML();
    this.applyStyles();
    document.body.appendChild(this.container);
    this.bindEvents();
    this.initSkyline();

    // Re-render the whole login screen when the language changes so every
    // translated string updates in one pass. We re-bind events too because
    // the new innerHTML drops all the existing listeners.
    this.unsubLang = onLangChange(() => this.rerender());

    // Re-render when mempool.space's live halving data arrives so the banner
    // subtitle swaps from "{n} years since the first" → "Xd · Y blocks
    // until block reward halves" without a page refresh.
    this.unsubHalving = onHalvingLiveUpdate(() => this.rerender());
  }

  private unsubLang:    (() => void) | null = null;
  private unsubHalving: (() => void) | null = null;

  /**
   * Surgical re-render on language change. We only swap the `.login-wrapper`
   * subtree (the part with translated strings) and update the dropdown's
   * label + active option in place. Canvas, skyline animation, and the
   * dropdown's own event listeners are preserved — otherwise every language
   * switch would restart the city-skyline animation and look like a page
   * reload.
   */
  private rerender(): void {
    // Build a fresh HTML tree and lift just the new login-wrapper out of it.
    const tmp = document.createElement('div');
    tmp.innerHTML = this.getHTML();
    const newWrapper = tmp.querySelector('.login-wrapper');
    const oldWrapper = this.container.querySelector('.login-wrapper');
    if (newWrapper && oldWrapper) {
      oldWrapper.replaceWith(newWrapper);
      this._bindLoginBoxEvents();
    }

    // Swap the Bitcoin Pizza Day banner too — it sits OUTSIDE .login-wrapper
    // (top-left fixed-position sibling), so the wrapper swap above misses it.
    // Re-bind its click / outside-click / Escape handlers since the new DOM
    // node has no listeners attached.
    const newPizza = tmp.querySelector('#login-pizza-day');
    const oldPizza = this.container.querySelector('#login-pizza-day');
    if (newPizza && oldPizza) {
      oldPizza.replaceWith(newPizza);
      this._bindPizzaDay();
    }

    // Reflect the new active language in the dropdown without rebuilding it
    // (which would also discard our outside-click listener and the open/closed
    // state).
    this._refreshLangDropdownState();
  }

  /**
   * Wire click + keyboard activation on info glyphs inside a dynamically-built
   * subtree (e.g. a passkey row injected after init). The main `getHTML()`
   * pass is covered by `_bindLoginBoxEvents` — this helper handles the
   * after-the-fact insertions.
   */
  private _wireGlyph(root: Element): void {
    root.querySelectorAll<HTMLElement>('.btn-info-glyph').forEach(glyph => {
      glyph.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const topic = glyph.dataset.info as Parameters<typeof LoginInfo.open>[0] | undefined;
        if (topic) LoginInfo.open(topic);
      });
      glyph.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          const topic = glyph.dataset.info as Parameters<typeof LoginInfo.open>[0] | undefined;
          if (topic) LoginInfo.open(topic);
        }
      });
    });
  }

  /** Update the language dropdown's current label + active option in place. */
  private _refreshLangDropdownState(): void {
    const known = LoginScreen.LANGUAGES.find(l => l.code === getCurrentLang())
                ?? LoginScreen.LANGUAGES[0];
    const label = this.container.querySelector<HTMLElement>('#login-lang-current');
    if (label) label.textContent = known.label;

    this.container.querySelectorAll<HTMLLIElement>('.login-lang-opt').forEach(opt => {
      const active = opt.dataset.lang === known.code;
      opt.classList.toggle('is-active', active);
      opt.setAttribute('aria-selected', String(active));
    });
  }

  /**
   * Wire up the custom language dropdown. Builds the option list from
   * `LANGUAGES`, marks the active one, and handles open/close + selection.
   */
  private _bindLangDropdown(): void {
    const wrap   = this.container.querySelector<HTMLElement>('#login-lang-wrap');
    const btn    = this.container.querySelector<HTMLButtonElement>('#login-lang-btn');
    const list   = this.container.querySelector<HTMLUListElement>('#login-lang-list');
    const label  = this.container.querySelector<HTMLElement>('#login-lang-current');
    if (!wrap || !btn || !list || !label) return;

    const current = getCurrentLang();
    const known   = LoginScreen.LANGUAGES.find(l => l.code === current) ?? LoginScreen.LANGUAGES[0];
    label.textContent = known.label;

    // Populate options
    list.innerHTML = LoginScreen.LANGUAGES.map(l => `
      <li role="option" data-lang="${l.code}" class="login-lang-opt ${l.code === current ? 'is-active' : ''}" aria-selected="${l.code === current}">
        ${this.esc(l.label)}
      </li>
    `).join('');

    const close = () => {
      list.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      wrap.classList.remove('is-open');
    };

    const open = () => {
      list.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      wrap.classList.add('is-open');
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (list.hidden) open();
      else close();
    });

    list.querySelectorAll<HTMLLIElement>('.login-lang-opt').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = opt.dataset.lang;
        if (!code) return;
        setLang(code); // triggers onLangChange → full rerender (which rebuilds this dropdown too)
        close();
      });
    });

    // Outside-click to dismiss. Stored on `this` so `rerender()` can detach it.
    this._langDocClickHandler = (e) => {
      if (!list.hidden && !wrap.contains(e.target as Node)) close();
    };
    document.addEventListener('click', this._langDocClickHandler);

    // Escape closes
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); btn.focus(); }
    });
  }

  // ─── HTML ──────────────────────────────────────────────────────────────────

  private esc(s: string): string {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  private getHTML(): string {
    const primaryPk = this.storedPasskeys.find(p => p.credentialId === this._primaryPasskeyId) ?? this.storedPasskeys[0];
    const infoGlyph = (topic: string, label: string) =>
      `<span class="btn-info-glyph" data-info="${this.esc(topic)}" role="button" tabindex="0" aria-label="${this.esc(label)}"><svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="4.4" r="0.95" fill="currentColor"/><rect x="7.05" y="6.6" width="1.9" height="5.6" rx="0.6" fill="currentColor"/></svg></span>`;

    const passkeyBtn = primaryPk ? `
      <div class="passkey-row" id="primary-passkey-row">
        <button class="login-btn login-btn-passkey login-passkey-btn" data-cid="${this.esc(primaryPk.credentialId)}">
          <span class="btn-label">${this.esc(t('login.passkey.continue_as', { name: primaryPk.displayName }))}${infoGlyph('passkey', 'About passkey login')}</span>
          <span class="btn-sub">${this.esc(t('login.passkey.continue_desc'))}</span>
        </button>
        <button class="passkey-manage-trigger" title="${this.esc(t('login.passkey.manage_title'))}">⋮</button>
      </div>
    ` : `
      <div class="passkey-row" id="primary-passkey-row">
        <button id="login-passkey-setup" class="login-btn login-btn-passkey" style="flex:1;text-align:left;">
          <span class="btn-label">${this.esc(t('login.passkey.save'))}${infoGlyph('passkey', 'About passkey login')}</span>
          <span class="btn-sub">${this.esc(t('login.passkey.save_desc'))}</span>
        </button>
        <button class="passkey-manage-trigger" title="${this.esc(t('login.passkey.manage_title'))}">⋮</button>
      </div>
    `;

    return `
      <canvas id="login-canvas"></canvas>
      <div class="login-wrapper">
      <div class="login-box">
        ${this._lastLogin === 'extension' ? `<button id="login-continue-ext" class="login-link bunker-cancel" style="position:absolute;top:8px;left:10px;font-size:11px;padding:6px 10px;">${this.esc(t('login.last_ext'))}</button>` : ''}
        ${this._lastLogin === 'bunker'    ? `<button id="login-continue-bunker" class="login-link bunker-cancel" style="position:absolute;top:8px;left:10px;font-size:11px;padding:6px 10px;">${this.esc(t('login.last_bunker'))}</button>` : ''}
        ${this._lastLogin === 'nsec'      ? `<button id="login-continue-nsec" class="login-link bunker-cancel" style="position:absolute;top:8px;left:10px;font-size:11px;padding:6px 10px;">${this.esc(t('login.last_nsec'))}</button>` : ''}
        <h1 id="login-what-is-nostr" class="login-title" role="button" tabindex="0" title="What is Nostr?">NOSTR DISTRICT</h1>
        <p class="login-subtitle">${this.esc(t('login.subtitle'))}</p>

        <div id="login-main" class="login-methods">
          <button id="login-create" class="login-btn login-btn-create">
            <span class="btn-label">${this.esc(t('login.create_link'))}${infoGlyph('create', 'About creating an account')}</span>
          </button>
          ${passkeyBtn}

          <div id="login-bottom">
            <div class="login-divider"></div>
            <button id="login-bunker" class="login-link">${this.esc(t('login.connect_nostr'))} ${infoGlyph('connect', 'About connecting with Nostr')}</button>
          </div>
        </div>

        <div id="login-bunker-view" class="hidden login-methods">
          <div id="bunker-options">
            <button id="login-bunker-start" class="login-btn login-btn-secondary">
              <span class="btn-label">${this.esc(t('login.bunker.remote_signer'))}${infoGlyph('signer', 'About Remote Signer')}</span>
              <span class="btn-sub">${this.esc(t('login.bunker.remote_signer_desc'))}</span>
            </button>

            <button id="login-extension" class="login-btn login-btn-secondary">
              <span class="btn-label">${this.esc(t('login.bunker.browser_extension'))}${infoGlyph('extension', 'About Browser Extension')}</span>
              <span class="btn-sub">${this.esc(t('login.bunker.browser_extension_desc'))}</span>
            </button>

            <div id="nsec-section" class="nsec-section">
              <button id="nsec-toggle" class="login-link">${this.esc(t('login.bunker.use_nsec'))} ${infoGlyph('nsec', 'About private key login')}</button>
              <div id="nsec-form" class="nsec-form hidden">
                <div class="nsec-warning">
                  <label class="warning-check">
                    <input type="checkbox" id="nsec-accept">
                    <span>${this.esc(t('login.bunker.nsec_warning'))}</span>
                  </label>
                </div>
                <div id="nsec-input-wrap" class="nsec-input-wrap hidden">
                  <input type="password" id="nsec-input" placeholder="${this.esc(t('login.bunker.nsec_placeholder'))}" class="nsec-input" autocomplete="off" spellcheck="false">
                  <button id="nsec-submit" class="login-btn login-btn-nsec">${this.esc(t('login.bunker.nsec_login'))}</button>
                </div>
              </div>
            </div>
          </div>

          <div id="bunker-qr-panel" class="hidden">
            <div class="nostr-method-row">
              <div class="nostr-method-label">${this.esc(t('login.bunker.remote_signer'))} <span class="nostr-method-hint">${this.esc(t('login.bunker.remote_signer_desc'))}</span></div>
              <div id="bunker-qr" class="bunker-qr-small">
                <div class="bunker-qr-loading">Generating...</div>
              </div>
              <div id="bunker-uri-display" class="bunker-uri-row hidden">
                <div id="bunker-uri-text" class="bunker-uri-text"></div>
                <button id="bunker-uri-copy" class="bunker-uri-copy">${this.esc(t('login.bunker.copy'))}</button>
              </div>
              <div id="bunker-status" class="bunker-status-inline">${this.esc(t('login.bunker.waiting'))}</div>
              <div class="bunker-url-row">
                <input type="text" id="bunker-input" placeholder="${this.esc(t('login.bunker.paste_url'))}" class="bunker-url-input" autocomplete="off">
                <button id="bunker-url-submit" class="bunker-url-btn">${this.esc(t('login.bunker.go'))}</button>
              </div>
            </div>
          </div>

          <button id="bunker-cancel" class="login-link bunker-cancel" style="margin-top:4px;">${this.esc(t('login.bunker.back'))}</button>
        </div>

        <div id="login-create-view" class="hidden">
          <div id="create-step-1">
            <p class="create-header">${this.esc(t('login.create.header'))}</p>
            <p class="create-desc">${this.esc(t('login.create.desc'))}</p>
            <input type="text" id="create-username" placeholder="${this.esc(t('login.create.username_placeholder'))}" class="nsec-input create-field" autocomplete="off" spellcheck="false" maxlength="32">
            <button id="create-passkey" class="login-btn login-btn-primary create-generate-btn">${this.esc(t('login.create.button'))}</button>
            <button id="create-guest" class="login-link guest-link" style="font-size:12px;padding:10px 8px;margin-top:14px;">${this.esc(t('login.create.guest_link'))}</button>
          </div>

          <div id="create-step-2" class="hidden">
            <p class="create-header">Save your password (nsec)</p>
            <div class="create-nsec-warning">
              Your password (nsec) has been created for you. Save it somewhere safe — it's the <strong>only</strong> way to log in on another device, and it can <strong>never be changed</strong>. If you lose it, your account is gone forever.
            </div>
            <div class="create-nsec-box">
              <div id="create-nsec-text" class="create-nsec-text"></div>
              <button id="create-nsec-copy" class="create-nsec-copy">Copy</button>
            </div>
            <label class="warning-check create-saved-check">
              <input type="checkbox" id="create-saved">
              <span>${this.esc(t('login.create.saved_check'))}</span>
            </label>
            <button id="create-confirm" class="login-btn login-btn-primary" disabled>${this.esc(t('login.create.confirm'))}</button>
          </div>

          <button id="create-back" class="login-link bunker-cancel">${this.esc(t('login.create.back'))}</button>
        </div>

        <div id="login-status" class="login-status"></div>
      </div>
      <a href="https://github.com/rome539/nostr-district" target="_blank" rel="noopener noreferrer" class="open-source-link">${this.esc(t('login.open_source'))}</a>
      </div>

      <!-- Seasonal holiday banner — pinned top-left when today falls inside
           any holiday's date window. Pizza Day, Whitepaper Day, Genesis
           Block Day, etc. all funnel through holidayBanners.ts so there's
           no per-holiday code here. -->
      ${this.renderHolidayBanner()}

      <!-- Language selector: pinned to the viewport's top-right. We use a
           custom dropdown instead of a native <select> because at the top of
           the page the native picker renders upward and the lower options
           overflow off-screen. -->
      <div class="login-lang-wrap" id="login-lang-wrap">
        <button id="login-lang-btn" class="login-lang-btn" aria-haspopup="listbox" aria-expanded="false" title="${this.esc(t('login.lang_label'))}">
          <span class="login-lang-icon" aria-hidden="true">🌐</span>
          <span id="login-lang-current" class="login-lang-current">English</span>
          <span class="login-lang-chevron" aria-hidden="true">▾</span>
        </button>
        <ul id="login-lang-list" class="login-lang-list" role="listbox" aria-label="${this.esc(t('login.lang_label'))}" hidden></ul>
      </div>
    `;
  }

  /**
   * Render the active holiday banner (or '' if no holiday's in season).
   * All theming is inlined as CSS custom properties so the static rules in
   * applyStyles() can stay generic.
   */
  private renderHolidayBanner(): string {
    const holiday = getActiveHoliday();
    if (!holiday) return '';
    const years = holidayYears(holiday);
    const theme = getActiveHolidayTheme(holiday);
    // Halving has a live subtitle override pulled from mempool.space —
    // shows "Xd · Y blocks until block reward halves" when the API has
    // responded; otherwise falls back to the static "{n} years" sub.
    let subOverride: string | null = null;
    if (holiday.id === 'halving') {
      const live = getHalvingLiveInfo();
      if (live) {
        subOverride = t('login.halving.sub_live', {
          days:   Math.max(0, Math.ceil(live.daysLeft)),
          blocks: live.blocksLeft.toLocaleString(),
        });
      }
    }
    const themeVars = [
      `--hb-bg:${theme.bg}`,
      `--hb-border:${theme.border}`,
      `--hb-emoji-glow:${theme.emojiGlow}`,
      `--hb-title:${theme.titleColor}`,
      `--hb-text:${theme.textColor}`,
      `--hb-sub:${theme.subColor}`,
      `--hb-panel-bg:${theme.panelBg}`,
      `--hb-panel-border:${theme.panelBorder}`,
      `--hb-link:${theme.linkColor}`,
      `--hb-strong:${theme.strongColor}`,
      `--hb-extra:${theme.extraColor}`,
    ].join(';');
    const prefix = holiday.i18nPrefix;
    const link = holiday.externalLink
      ? `<a href="${this.esc(holiday.externalLink)}" target="_blank" rel="noopener noreferrer" class="login-holiday-link">${this.esc(t(`${prefix}.link`))}</a>`
      : '';
    return `
      <div class="login-holiday" id="login-pizza-day" style="${themeVars}" data-holiday="${this.esc(holiday.id)}">
        <button class="login-holiday-trigger" id="login-pizza-trigger" aria-expanded="false" aria-controls="login-pizza-info" aria-label="${this.esc(t(`${prefix}.aria_label`))}">
          <span class="login-holiday-emoji" aria-hidden="true">${holiday.emoji}</span>
          <div class="login-holiday-text">
            <div class="login-holiday-title">${this.esc(t(`${prefix}.title`))}</div>
            <div class="login-holiday-sub">${this.esc(subOverride ?? t(`${prefix}.sub`, { n: years }))}</div>
          </div>
          <span class="login-holiday-chevron" aria-hidden="true">▾</span>
        </button>
        <div id="login-pizza-info" class="login-holiday-info" hidden>
          <p>${t(`${prefix}.p1`)}</p>
          <p>${t(`${prefix}.p2`)}</p>
          <p class="login-holiday-extra">${this.esc(t(`${prefix}.extra`, { n: years }))}</p>
          ${link}
        </div>
      </div>
    `;
  }

  private static readonly LANGUAGES: { code: string; label: string }[] = [
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

  private _langDocClickHandler: ((e: MouseEvent) => void) | null = null;

  // ─── Styles ────────────────────────────────────────────────────────────────

  private applyStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      #login-screen {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: var(--nd-bg);
        display: flex; align-items: center; justify-content: center;
        z-index: 9999; font-family: 'Courier New', monospace; overflow-y: auto;
        padding: 16px 0;
        box-sizing: border-box;
        -webkit-tap-highlight-color: transparent;
      }
      #login-canvas {
        position: fixed; inset: 0; width: 100%; height: 100%;
        pointer-events: none;
      }
      .login-wrapper {
        display: flex; flex-direction: column; align-items: center; gap: 10px;
        align-self: flex-start; margin: auto 0;
        z-index: 1;
      }
      .login-box {
        position: relative;
        width: min(440px, 96vw); padding: clamp(16px, 5vw, 36px) clamp(16px, 5vw, 36px) clamp(8px, 2vw, 16px); text-align: center;
        background: color-mix(in srgb, var(--nd-bg) 82%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-dpurp) 40%, transparent);
        border-radius: 12px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.6), 0 0 60px color-mix(in srgb, var(--nd-accent) 6%, transparent);
        backdrop-filter: blur(6px);
      }
      .open-source-link {
        font-size: 11px; color: var(--nd-accent);
        text-decoration: none; letter-spacing: 0.06em; white-space: nowrap;
        text-shadow:
          0 0 4px var(--nd-accent),
          0 0 10px var(--nd-accent),
          0 0 24px var(--nd-accent),
          0 0 48px var(--nd-accent);
        transition: color 0.2s, text-shadow 0.2s;
        opacity: 0.65;
      }
      .open-source-link:hover {
        opacity: 1;
        text-shadow:
          0 0 4px var(--nd-accent),
          0 0 12px var(--nd-accent),
          0 0 30px var(--nd-accent),
          0 0 60px var(--nd-accent);
      }
      /* ── Holiday banner (top-left, theme-driven via --hb-* vars) ────────── */
      .login-holiday {
        position: fixed; top: 16px; left: 18px; z-index: 50;
        font: inherit;
      }
      .login-holiday-trigger {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 6px 11px 6px 9px;
        background: var(--hb-bg);
        border: 1px solid var(--hb-border);
        border-radius: 6px;
        color: var(--hb-text);
        font: inherit; font-size: 9px;
        letter-spacing: 0.08em; line-height: 1.3;
        cursor: pointer;
        backdrop-filter: blur(4px);
        opacity: 0.85;
        box-shadow:
          0 0 12px var(--hb-emoji-glow),
          inset 0 0 8px var(--hb-emoji-glow);
        animation: holiday-pulse 4s ease-in-out infinite;
        transition: opacity 0.15s, border-color 0.15s;
      }
      .login-holiday-trigger:hover,
      .login-holiday.is-open .login-holiday-trigger {
        opacity: 1;
        border-color: color-mix(in srgb, var(--hb-text) 80%, transparent);
      }
      .login-holiday-emoji {
        font-size: 22px; line-height: 1;
        filter: drop-shadow(0 0 6px var(--hb-emoji-glow));
      }
      .login-holiday-text { display: flex; flex-direction: column; gap: 2px; text-align: left; }
      .login-holiday-title {
        color: var(--hb-title); font-weight: bold; font-size: 10px;
        text-shadow: 0 0 6px var(--hb-emoji-glow);
      }
      .login-holiday-sub {
        color: var(--hb-sub); opacity: 0.85; font-size: 8px; letter-spacing: 0.04em;
      }
      .login-holiday-chevron {
        color: var(--hb-text); font-size: 10px; opacity: 0.8;
        transition: transform 0.2s;
      }
      .login-holiday.is-open .login-holiday-chevron { transform: rotate(180deg); }
      .login-holiday-info {
        margin-top: 6px;
        max-width: 320px;
        padding: 12px 14px;
        background: var(--hb-panel-bg);
        border: 1px solid var(--hb-panel-border);
        border-radius: 6px;
        color: var(--hb-sub);
        font-size: 11px;
        letter-spacing: 0.02em;
        line-height: 1.55;
        backdrop-filter: blur(8px);
        box-shadow: 0 8px 28px rgba(0,0,0,0.6),
                    0 0 14px var(--hb-emoji-glow);
        animation: holiday-info-in 0.25s ease-out;
      }
      .login-holiday-info[hidden] { display: none; }
      .login-holiday-info p { margin: 0 0 8px 0; }
      .login-holiday-info p:last-of-type { margin-bottom: 10px; }
      .login-holiday-info strong { color: var(--hb-strong); }
      .login-holiday-extra { color: var(--hb-extra); font-style: italic; }
      .login-holiday-link {
        display: inline-block; margin-top: 2px;
        color: var(--hb-link); font-size: 10px; letter-spacing: 0.06em;
        text-decoration: none; opacity: 0.85;
        text-shadow: 0 0 6px var(--hb-emoji-glow);
        transition: opacity 0.15s;
      }
      .login-holiday-link:hover { opacity: 1; text-decoration: underline; }
      @keyframes holiday-pulse {
        0%, 100% { box-shadow: 0 0 12px var(--hb-emoji-glow), inset 0 0 8px var(--hb-emoji-glow); }
        50%      { box-shadow: 0 0 20px var(--hb-emoji-glow), inset 0 0 10px var(--hb-emoji-glow); }
      }
      @keyframes holiday-info-in {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0);    }
      }
      .login-lang-wrap {
        position: fixed; top: 16px; right: 18px; z-index: 50;
      }
      .login-lang-btn {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 5px 9px;
        background: color-mix(in srgb, black 45%, var(--nd-bg));
        border: 1px solid color-mix(in srgb, var(--nd-accent) 25%, transparent);
        border-radius: 6px;
        color: var(--nd-accent); font: inherit; font-size: 11px;
        letter-spacing: 0.06em; cursor: pointer;
        opacity: 0.75; transition: opacity 0.2s, border-color 0.2s;
        backdrop-filter: blur(4px);
        text-shadow:
          0 0 4px var(--nd-accent),
          0 0 10px var(--nd-accent);
      }
      .login-lang-btn:hover,
      .login-lang-wrap.is-open .login-lang-btn {
        opacity: 1;
        border-color: color-mix(in srgb, var(--nd-accent) 55%, transparent);
      }
      .login-lang-icon { font-size: 11px; line-height: 1; opacity: 0.85; text-shadow: none; }
      .login-lang-current { min-width: 56px; text-align: left; }
      .login-lang-chevron {
        font-size: 9px; opacity: 0.7; margin-left: 1px;
        transition: transform 0.15s;
      }
      .login-lang-wrap.is-open .login-lang-chevron { transform: rotate(180deg); }

      .login-lang-list {
        position: absolute; top: calc(100% + 4px); right: 0;
        margin: 0; padding: 4px;
        list-style: none;
        background: color-mix(in srgb, black 65%, var(--nd-bg));
        border: 1px solid color-mix(in srgb, var(--nd-accent) 40%, transparent);
        border-radius: 6px;
        min-width: 140px;
        max-height: min(60vh, 380px); overflow-y: auto;
        box-shadow: 0 8px 28px rgba(0,0,0,0.6),
                    0 0 16px color-mix(in srgb, var(--nd-accent) 10%, transparent);
        backdrop-filter: blur(8px);
      }
      .login-lang-list[hidden] { display: none; }
      .login-lang-opt {
        padding: 7px 10px; border-radius: 4px;
        color: var(--nd-text); font-size: 12px;
        cursor: pointer; transition: background 0.12s, color 0.12s;
        letter-spacing: 0.02em;
      }
      .login-lang-opt:hover {
        background: color-mix(in srgb, var(--nd-accent) 18%, transparent);
        color: var(--nd-accent);
      }
      .login-lang-opt.is-active {
        color: var(--nd-accent);
        background: color-mix(in srgb, var(--nd-accent) 10%, transparent);
      }
      .login-lang-opt.is-active::before {
        content: '✓'; margin-right: 6px; opacity: 0.7;
      }
      .login-lang-list::-webkit-scrollbar { width: 5px; }
      .login-lang-list::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, var(--nd-accent) 40%, transparent);
        border-radius: 3px;
      }
      @media (max-width: 480px) {
        .login-lang-wrap { top: 10px; right: 10px; }
        .login-lang-btn { padding: 4px 7px; font-size: 10px; }
        .login-lang-current { min-width: 48px; }
        .login-lang-list { min-width: 130px; max-height: 50vh; }
        .login-holiday { top: 10px; left: 10px; }
        .login-holiday-trigger { padding: 4px 8px 4px 7px; gap: 6px; }
        .login-holiday-emoji { font-size: 18px; }
        .login-holiday-title { font-size: 9px; }
        .login-holiday-sub { font-size: 7px; }
        .login-holiday-info { max-width: calc(100vw - 24px); font-size: 10px; padding: 10px 12px; }
        .login-holiday-link { font-size: 9px; }
      }
      .login-title {
        font-size: clamp(22px, 7vw, 32px); color: var(--nd-accent);
        /* shrink to the text so only "NOSTR DISTRICT" is the click/hover hitbox */
        width: fit-content; max-width: 100%; margin: 14px auto 6px auto; letter-spacing: 3px;
        text-shadow: 0 0 20px color-mix(in srgb, var(--nd-accent) 50%, transparent);
        cursor: pointer; transition: text-shadow 0.2s ease; user-select: none;
      }
      .login-title:hover {
        text-shadow: 0 0 30px color-mix(in srgb, var(--nd-accent) 80%, transparent);
      }
      .login-title:focus-visible {
        outline: 1px dotted color-mix(in srgb, var(--nd-accent) 60%, transparent); outline-offset: 6px;
      }
      .login-subtitle {
        font-size: 13px; color: var(--nd-accent); opacity: 0.8; margin: 0 0 32px 0;
      }
      .login-methods { display: flex; flex-direction: column; gap: 18px; }
      .login-btn {
        display: block; width: 100%; padding: 14px 18px;
        border: none; border-radius: 6px; cursor: pointer;
        font-family: 'Courier New', monospace; text-align: left;
        transition: opacity 0.15s, box-shadow 0.15s;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        min-height: 44px;
      }
      .login-btn:hover {
        opacity: 0.85;
        box-shadow: 0 0 12px color-mix(in srgb, var(--nd-purp) 30%, transparent);
      }
      .login-btn-primary {
        background: var(--nd-navy);
        color: var(--nd-text); border: 1px solid color-mix(in srgb, var(--nd-purp) 50%, transparent);
      }
      .login-btn-secondary {
        background: var(--nd-navy);
        color: var(--nd-text); border: 1px solid color-mix(in srgb, var(--nd-purp) 50%, transparent);
      }
      .login-btn-nsec {
        background: var(--nd-navy); color: #f0b040;
        border: 1px solid var(--nd-dpurp); padding: 10px 18px; text-align: center;
      }
      .btn-label { display: flex; align-items: center; font-size: 14px; font-weight: bold; color: var(--nd-accent); }
      .btn-label .btn-info-glyph { margin-left: auto; }
      .btn-sub { display: block; font-size: 11px; color: rgba(255,255,255,0.65); margin-top: 3px; }
      .login-divider {
        height: 1px; background: var(--nd-dpurp); opacity: 0.3; margin: 6px 0;
      }
      .login-link {
        background: none; border: none; color: var(--nd-subtext);
        font-family: 'Courier New', monospace; font-size: 13px;
        cursor: pointer; padding: 12px 8px; transition: color 0.15s;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        min-height: 44px;
      }
      .login-link:hover { color: var(--nd-accent); }
      .guest-link { color: var(--nd-subtext); font-size: 12px; }
      #bunker-options { display: flex; flex-direction: column; gap: 12px; }
      .nsec-section { text-align: left; }
      .nsec-form { margin-top: 10px; }
      .nsec-warning {
        background: rgba(240,176,64,0.08); border: 1px solid rgba(240,176,64,0.2);
        border-radius: 4px; padding: 10px 12px; margin-bottom: 10px;
      }
      .warning-check {
        display: flex; align-items: flex-start; gap: 8px;
        font-size: 12px; color: #f0b040; cursor: pointer;
      }
      .warning-check input[type="checkbox"] {
        appearance: none; -webkit-appearance: none;
        width: 14px; height: 14px; margin: 2px 0 0; flex-shrink: 0;
        background: rgba(240,176,64,0.08);
        border: 1px solid rgba(240,176,64,0.5);
        border-radius: 3px; cursor: pointer;
        display: inline-grid; place-content: center;
        transition: background 0.15s, border-color 0.15s;
      }
      .warning-check input[type="checkbox"]:hover { border-color: #f0b040; }
      .warning-check input[type="checkbox"]:checked {
        background: rgba(240,176,64,0.2); border-color: #f0b040;
      }
      .warning-check input[type="checkbox"]:checked::after {
        content: ''; width: 8px; height: 8px;
        background: #f0b040;
        clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0, 43% 62%);
      }
      .nsec-input-wrap { display: flex; gap: 6px; }
      .nsec-input {
        flex: 1; background: rgba(0,0,0,0.45);
        border: 1px solid rgba(255,255,255,0.22); border-radius: 4px;
        color: #fff; font-family: 'Courier New', monospace;
        font-size: 16px; padding: 10px; outline: none;
      }
      .nsec-input:focus { border-color: color-mix(in srgb, var(--nd-accent) 55%, transparent); }
      .nsec-input::placeholder { color: rgba(255,255,255,0.45); }
      .hidden { display: none !important; }
      .login-status { margin-top: 6px; font-size: 12px; color: var(--nd-accent); }
      .login-status.error { color: #e85454; }

      /* ── Create account button ── */
      .login-btn-continue {
        background: var(--nd-navy);
        color: var(--nd-text);
        border: 1px solid color-mix(in srgb, var(--nd-accent) 45%, transparent);
        box-shadow: 0 0 10px color-mix(in srgb, var(--nd-accent) 8%, transparent);
      }
      .login-btn-continue:hover {
        box-shadow: 0 0 16px color-mix(in srgb, var(--nd-accent) 20%, transparent) !important;
      }
      .last-used-badge {
        margin-left: 8px;
        font-size: 9px; font-weight: normal; letter-spacing: 0.06em;
        color: var(--nd-accent); opacity: 0.6;
        border: 1px solid color-mix(in srgb, var(--nd-accent) 35%, transparent);
        border-radius: 3px; padding: 1px 5px;
        vertical-align: middle;
        text-transform: uppercase;
      }
      .login-btn-create {
        background: var(--nd-navy);
        color: var(--nd-text); border: 1px solid color-mix(in srgb, var(--nd-purp) 50%, transparent);
      }
      .login-btn-create:hover, .login-btn-primary:hover, .login-btn-secondary:hover {
        box-shadow: 0 0 14px color-mix(in srgb, var(--nd-purp) 35%, transparent);
      }

      /* ── Create account view ── */
      .create-header {
        font-size: 17px; font-weight: bold; color: var(--nd-text); margin: 0 0 8px 0; text-align: left;
      }
      .create-desc {
        font-size: 12px; color: rgba(255,255,255,0.65); margin: 0 0 14px 0; text-align: left; line-height: 1.5;
      }
      .create-field { display: block; width: 100%; box-sizing: border-box; margin-bottom: 8px; }
      .create-generate-btn { margin-top: 6px; text-align: center; }
      .create-nsec-warning {
        background: rgba(240,176,64,0.1); border: 1px solid rgba(240,176,64,0.3);
        border-radius: 6px; padding: 12px 14px; margin: 0 0 12px 0;
        font-size: 12px; color: #f0b040; line-height: 1.6; text-align: left;
      }
      .create-nsec-warning strong { color: #ffcc44; }
      .create-nsec-box {
        display: flex; align-items: center; gap: 8px;
        background: var(--nd-navy); border: 1px solid var(--nd-dpurp);
        border-radius: 6px; padding: 10px 12px; margin-bottom: 10px;
      }
      .create-nsec-text {
        flex: 1; font-size: 11px; color: var(--nd-accent); word-break: break-all;
        line-height: 1.5; text-align: left; user-select: all;
      }
      .create-nsec-copy {
        background: color-mix(in srgb, var(--nd-accent) 13%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-accent) 27%, transparent);
        border-radius: 4px; color: var(--nd-accent);
        font-family: 'Courier New', monospace; font-size: 12px;
        padding: 5px 12px; cursor: pointer; white-space: nowrap; flex-shrink: 0;
      }
      .create-nsec-copy:hover { background: color-mix(in srgb, var(--nd-accent) 22%, transparent); }
      .create-nsec-note {
        font-size: 11px; color: rgba(255,255,255,0.65); margin-bottom: 10px;
        text-align: left; line-height: 1.5;
      }
      .create-nsec-risk {
        background: rgba(155,127,232,0.08); border: 1px solid rgba(155,127,232,0.25);
        border-radius: 6px; padding: 10px 12px; margin-bottom: 12px;
        font-size: 11px; color: rgba(255,255,255,0.65); line-height: 1.6; text-align: left;
      }
      .create-nsec-risk strong { color: var(--nd-purp); }
      .create-saved-check { margin-bottom: 14px; }
      #create-confirm { text-align: center; margin-top: 4px; }
      #create-confirm:disabled { opacity: 0.4; cursor: not-allowed; }

      .nostr-connect-title {
        font-size: 15px; font-weight: bold; color: var(--nd-accent); margin: 0 0 14px 0; text-align: left;
      }
      .nostr-method-row {
        background: color-mix(in srgb, var(--nd-navy) 60%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-dpurp) 30%, transparent);
        border-radius: 8px; padding: 12px; margin-bottom: 4px;
      }
      .nostr-method-label {
        font-size: 13px; font-weight: bold; color: #fff; margin-bottom: 10px;
      }
      .nostr-method-hint {
        font-weight: normal; font-size: 11px; color: rgba(255,255,255,0.65); margin-left: 6px;
      }
      .bunker-qr-small {
        display: flex; justify-content: center; margin-bottom: 8px; min-height: 160px;
      }
      .bunker-qr-loading { color: var(--nd-subtext); opacity: 0.6; font-size: 13px; align-self: center; }
      .bunker-uri-row {
        display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
        background: color-mix(in srgb, var(--nd-bg) 60%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-dpurp) 20%, transparent);
        border-radius: 4px; padding: 8px 10px;
      }
      .bunker-uri-text {
        flex: 1; font-size: 10px; color: rgba(255,255,255,0.65);
        word-break: break-all; max-height: 64px; overflow-y: auto; text-align: left; line-height: 1.4;
        scrollbar-width: thin;
        scrollbar-color: color-mix(in srgb, var(--nd-dpurp) 60%, transparent) transparent;
      }
      .bunker-uri-text::-webkit-scrollbar { width: 4px; }
      .bunker-uri-text::-webkit-scrollbar-track { background: transparent; }
      .bunker-uri-text::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, var(--nd-dpurp) 60%, transparent); border-radius: 2px;
      }
      .bunker-uri-text::-webkit-scrollbar-thumb:hover { background: var(--nd-purp); }
      .bunker-uri-copy {
        background: color-mix(in srgb, var(--nd-accent) 13%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-accent) 27%, transparent);
        border-radius: 4px; color: var(--nd-accent);
        font-family: 'Courier New', monospace; font-size: 11px;
        padding: 4px 10px; cursor: pointer; white-space: nowrap;
      }
      .bunker-uri-copy:hover { background: color-mix(in srgb, var(--nd-accent) 20%, transparent); }
      .bunker-status-inline { color: var(--nd-accent); font-size: 11px; margin-bottom: 8px; min-height: 14px; }
      .bunker-url-row { display: flex; gap: 6px; }
      .bunker-url-input {
        flex: 1; background: rgba(0,0,0,0.45);
        border: 1px solid rgba(255,255,255,0.22);
        border-radius: 4px; color: #fff;
        font-family: 'Courier New', monospace; font-size: 16px;
        padding: 8px 10px; outline: none; box-sizing: border-box;
      }
      .bunker-url-input::placeholder { color: rgba(255,255,255,0.45); }
      .bunker-url-input:focus { border-color: color-mix(in srgb, var(--nd-accent) 55%, transparent); }
      .bunker-url-btn {
        background: var(--nd-purp); border: none; border-radius: 4px;
        color: #fff; font-family: 'Courier New', monospace;
        font-size: 12px; font-weight: bold; padding: 8px 14px;
        cursor: pointer; transition: opacity 0.15s;
      }
      .bunker-url-btn:hover { opacity: 0.85; }
      .bunker-cancel { font-size: 13px; color: var(--nd-subtext); }
      .login-box.view-nostr #bunker-cancel,
      .login-box.view-create #create-back {
        position: absolute; top: 8px; right: 10px;
        margin: 0; padding: 6px 10px; font-size: 11px;
      }
      /* Quick-login (last-used) link only belongs on the main view — hide it
         once we navigate into the Nostr-app or create sub-views. */
      .login-box.view-nostr #login-continue-bunker,
      .login-box.view-nostr #login-continue-nsec,
      .login-box.view-nostr #login-continue-ext,
      .login-box.view-create #login-continue-bunker,
      .login-box.view-create #login-continue-nsec,
      .login-box.view-create #login-continue-ext { display: none; }

      /* ── Inline per-method info glyph ──
         Sits next to the button's title text inside the login button itself.
         Low opacity so it reads as a hint, not a parallel CTA. Click is
         caught before the parent button's handler via stopPropagation, so
         tapping the glyph opens the explainer instead of triggering the
         login flow. */
      .btn-info-glyph {
        display: inline-flex; align-items: center; justify-content: center;
        width: 16px; height: 16px;
        margin-left: 8px;
        flex-shrink: 0;
        vertical-align: middle;
        color: inherit; opacity: 0.55;
        cursor: pointer; user-select: none;
        transition: opacity 0.15s, filter 0.15s;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
      }
      .btn-info-glyph svg { display: block; width: 100%; height: 100%; }
      .btn-info-glyph:hover,
      .btn-info-glyph:focus-visible {
        opacity: 1; outline: none;
        filter: drop-shadow(0 0 4px currentColor);
      }
      /* Touch devices: bigger tap target + brighter default since hover
         doesn't exist. */
      @media (pointer: coarse) {
        .btn-info-glyph {
          width: 28px; height: 28px;
          opacity: 0.7;
        }
      }

      /* "What is Nostr?" is now the clickable title (see .login-title) */

      /* ── Passkey button ── */
      .passkey-row { display: flex; align-items: stretch; gap: 6px; }
      .passkey-row .login-btn-passkey { flex: 1; }
      .passkey-manage-trigger {
        background: var(--nd-navy);
        border: 1px solid color-mix(in srgb, var(--nd-purp) 50%, transparent);
        border-radius: 6px; color: var(--nd-text);
        font-family: 'Courier New', monospace; font-size: 18px; letter-spacing: 0;
        width: 44px; min-height: 44px; flex-shrink: 0; cursor: pointer;
        transition: box-shadow 0.15s, border-color 0.15s;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
      }
      .passkey-manage-trigger:hover {
        border-color: color-mix(in srgb, var(--nd-purp) 70%, transparent);
        box-shadow: 0 0 14px color-mix(in srgb, var(--nd-purp) 35%, transparent);
      }

      /* ── Passkey manager overlay ── */
      .passkey-manager-overlay { align-items: stretch !important; justify-content: stretch !important; padding: 0; display: flex !important; flex-direction: column !important; }
      .pk-mgr-scroll {
        width: 100%; flex: 1; min-height: 0; overflow-y: auto;
        padding: 20px 24px 24px; box-sizing: border-box;
        display: flex; flex-direction: column; gap: 0;
        scrollbar-width: thin;
        scrollbar-color: color-mix(in srgb, var(--nd-dpurp) 60%, transparent) transparent;
      }
      .pk-mgr-scroll::-webkit-scrollbar { width: 4px; }
      .pk-mgr-scroll::-webkit-scrollbar-track { background: transparent; }
      .pk-mgr-scroll::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, var(--nd-dpurp) 60%, transparent);
        border-radius: 2px;
      }
      .pk-mgr-scroll::-webkit-scrollbar-thumb:hover { background: var(--nd-purp); }
      .pk-mgr-header {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 6px;
      }
      .pk-mgr-list { display: flex; flex-direction: column; gap: 6px; margin: 8px 0 14px; }
      .pk-mgr-item {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        background: color-mix(in srgb, var(--nd-navy) 60%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-dpurp) 30%, transparent);
        border-radius: 6px; padding: 10px 12px;
      }
      .pk-mgr-item-left { display: flex; flex-direction: column; gap: 3px; flex: 1; }
      .pk-mgr-name { font-size: 13px; color: var(--nd-text); text-align: left; }
      .pk-mgr-primary-badge { font-size: 10px; color: var(--nd-accent); text-align: left; }
      .pk-mgr-set-primary {
        background: none; border: none; padding: 0;
        font-family: 'Courier New', monospace; font-size: 10px;
        color: rgba(255,255,255,0.65); cursor: pointer; text-align: left;
        transition: color 0.15s;
      }
      .pk-mgr-set-primary:hover { color: var(--nd-accent); }
      .pk-mgr-remove {
        background: none; border: 1px solid rgba(232,84,84,0.35);
        border-radius: 4px; color: #e85454;
        font-family: 'Courier New', monospace; font-size: 11px;
        padding: 4px 10px; cursor: pointer; white-space: nowrap; flex-shrink: 0;
        transition: background 0.15s, border-color 0.15s;
      }
      .pk-mgr-remove:hover { background: rgba(232,84,84,0.1); border-color: rgba(232,84,84,0.6); }
      .pk-mgr-remove-armed { background: rgba(232,84,84,0.15) !important; border-color: #e85454 !important; }
      .pk-mgr-empty { font-size: 12px; color: var(--nd-subtext); opacity: 0.6; text-align: center; padding: 12px 0; }
      .pk-mgr-divider { height: 1px; background: var(--nd-dpurp); opacity: 0.3; margin: 0 0 14px; }
      .pk-mgr-add-btns { display: flex; flex-direction: column; gap: 8px; }
      .pk-mgr-btn { text-align: center; padding: 11px; font-size: 13px; }
      .pk-mgr-form-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
      .pk-mgr-form-title { font-size: 13px; font-weight: bold; color: var(--nd-text); }
      .pk-mgr-form-desc { font-size: 11px; color: rgba(255,255,255,0.65); margin: 0 0 10px; text-align: left; line-height: 1.5; }
      .pk-mgr-input { display: block; width: 100%; box-sizing: border-box; margin-bottom: 6px; flex: none; }
      .pk-mgr-status { font-size: 11px; min-height: 16px; margin-top: 6px; text-align: center; }
      .login-btn-passkey {
        background: var(--nd-navy);
        color: var(--nd-text); border: 1px solid color-mix(in srgb, var(--nd-purp) 50%, transparent);
      }
      .login-btn-passkey:hover {
        box-shadow: 0 0 14px color-mix(in srgb, var(--nd-purp) 35%, transparent);
      }

      /* ── Passkey save prompt overlay ── */
      .passkey-prompt-overlay {
        position: absolute; inset: 0; z-index: 10;
        background: color-mix(in srgb, var(--nd-bg) 90%, transparent);
        backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        border-radius: 12px;
      }
      .passkey-prompt-box {
        width: 100%; padding: 28px 24px; text-align: center;
        display: flex; flex-direction: column; align-items: stretch; gap: 10px;
      }
      .passkey-prompt-title {
        font-size: 16px; font-weight: bold; color: var(--nd-text); margin-bottom: 4px;
      }
      .passkey-prompt-desc {
        font-size: 12px; color: rgba(255,255,255,0.65); line-height: 1.6; margin-bottom: 8px;
      }
      .passkey-prompt-warn {
        background: rgba(240,176,64,0.08); border: 1px solid rgba(240,176,64,0.25);
        border-radius: 4px; padding: 8px 10px; margin-bottom: 12px;
        font-size: 11px; color: #f0b040; line-height: 1.55; text-align: left;
      }

      /* ── Mobile ── */
      @media (max-width: 480px) {
        .login-box { border-radius: 8px; }
        .login-subtitle { margin-bottom: 20px; }
        .login-methods { gap: 12px; }
        .btn-label { font-size: 13px; }
        .nsec-input, .bunker-url-input { font-size: 16px; } /* prevent iOS zoom */
      }
      @media (max-height: 600px) and (orientation: landscape) {
        #login-screen { align-items: flex-start; }
        .login-title { margin-top: 8px; }
        .login-subtitle { margin-bottom: 12px; }
        .login-methods { gap: 8px; }
        .login-btn { padding: 10px 18px; min-height: 40px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Skyline ───────────────────────────────────────────────────────────────

  private initSkyline(): void {
    this.canvas = this.container.querySelector('#login-canvas') as HTMLCanvasElement;
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.generateBuildings();
    this.holidayFX.init(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', this.handleResize);
    const loop = (time: number) => {
      this.drawFrame(time);
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private generateBuildings(): void {
    const W = this.canvas!.width;
    const H = this.canvas!.height;
    // Push buildings to bottom 20% — gives "distant skyline" feel
    const groundY = Math.floor(H * 0.82);
    this.buildings = [];
    this.stars = [];

    // Deterministic LCG so buildings/stars don't change between frames
    let seed = 99991;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };

    // Stars — scattered across upper 75% of screen
    // Palette: mostly white/cream, occasional colored (teal, purple, amber, pink)
    const starPalette = [
      '#ffffff', '#ffffff', '#ffffff',
      '#fff5e6', '#fff5e6',
      '#b8a8f8',
      '#5dcaa5',
      '#f0b040',
      '#ff71ce',
      '#7b68ee',
    ];
    const starCount = Math.floor(W * H / 3000);
    for (let i = 0; i < starCount; i++) {
      this.stars.push({
        x: rand() * W,
        y: rand() * H * 0.75,
        r: 0.3 + rand() * 1.1,
        base: 0.3 + rand() * 0.7,
        speed: 0.3 + rand() * 1.2,
        color: starPalette[Math.floor(rand() * starPalette.length)],
      });
    }

    // Far layer — very small, very dark silhouettes
    let x = -20;
    while (x < W + 20) {
      const w = 10 + rand() * 40;
      const h = 18 + rand() * (groundY * 0.22);
      const shade = (['#02010a', '#04020e', '#030110', '#020108'] as const)[Math.floor(rand() * 4)];
      this.buildings.push({ x, y: groundY - h, w, h, shade, windows: [], far: true });
      x += w + 1 + rand() * 8;
    }

    // Near layer — still small (distant), with sparse windows and rare signs
    seed = 77773;
    x = -30;
    while (x < W + 30) {
      const w = 18 + rand() * 70;
      const h = 40 + rand() * (groundY * 0.42);
      const shade = (['#04030e', '#06051a', '#07061a', '#050416'] as const)[Math.floor(rand() * 4)];

      const windows: LoginBuilding['windows'] = [];
      const floors = Math.floor(h / 16);
      const cols = Math.floor(w / 13);
      for (let f = 1; f < floors - 1; f++) {
        for (let c = 0; c < cols - 1; c++) {
          if (rand() > 0.28) continue; // sparse windows for distance feel
          windows.push({
            x: x + 4 + c * 13,
            y: groundY - h + 10 + f * 16,
            flicker: rand() * Math.PI * 2,
          });
        }
      }

      let sign: LoginBuilding['sign'] | undefined;
      if (rand() > 0.82 && w > 30) { // rare signs at distance
        sign = {
          y: groundY - h + 10 + rand() * (h * 0.3),
          w: 8 + rand() * 22,
          hue: (['accent', 'purp', 'pink'] as const)[Math.floor(rand() * 3)],
        };
      }

      this.buildings.push({ x, y: groundY - h, w, h, shade, windows, sign, far: false });
      x += w + 2 + rand() * 18;
    }
  }

  private drawFrame(time: number): void {
    const canvas = this.canvas!;
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d')!;
    const t = time * 0.001;

    // Theme accent only for tiny neon signs — everything else is fixed night colors
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--nd-accent').trim() || '#5dcaa5';
    const pink = '#ff71ce';
    const purp = '#7b68ee';

    const groundY = Math.floor(H * 0.82);

    ctx.clearRect(0, 0, W, H);

    // ── Fixed starry night sky ──────────────────────────────────────────────
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0,   '#01000a');
    sky.addColorStop(0.4, '#03010f');
    sky.addColorStop(0.75,'#060218');
    sky.addColorStop(1,   '#0a0320');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Stars — each with its own color
    for (const s of this.stars) {
      const twinkle = s.base + Math.sin(t * s.speed + s.x * 0.05) * (1 - s.base) * 0.6;
      ctx.globalAlpha = twinkle;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── Shooting star ────────────────────────────────────────────────────────
    if (!this.shootingStar && time >= this.shootingStarNext) {
      // Angle: 15–35° — mostly horizontal so it reads as a shooting star, not a meteor
      const angle = (Math.PI / 12) + Math.random() * (Math.PI / 9);
      const speed = 420 + Math.random() * 260; // px/s
      this.shootingStar = {
        startX: W * 0.05 + Math.random() * W * 0.5,
        startY: H * 0.03 + Math.random() * H * 0.2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        startTime: time,
        duration: 500 + Math.random() * 400,
      };
      this.shootingStarNext = time + 8000 + Math.random() * 12000;
    }
    if (this.shootingStar) {
      const ss = this.shootingStar;
      const elapsed = time - ss.startTime;
      const progress = elapsed / ss.duration;
      if (progress >= 1) {
        this.shootingStar = null;
      } else {
        const cx = ss.startX + ss.vx * (elapsed / 1000);
        const cy = ss.startY + ss.vy * (elapsed / 1000);

        // Fade in first 15%, full brightness 15–65%, fade out last 35%
        let alpha: number;
        if (progress < 0.15) alpha = progress / 0.15;
        else if (progress > 0.65) alpha = (1 - progress) / 0.35;
        else alpha = 1;

        // Longer trail — 0.22s of movement behind the head
        const trailSecs = 0.22;
        const tx = cx - ss.vx * trailSecs;
        const ty = cy - ss.vy * trailSecs;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.lineCap = 'round';

        // Wide soft glow stroke
        const glow = ctx.createLinearGradient(tx, ty, cx, cy);
        glow.addColorStop(0, 'rgba(200,185,255,0)');
        glow.addColorStop(1, 'rgba(200,185,255,0.35)');
        ctx.strokeStyle = glow;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(cx, cy);
        ctx.stroke();

        // Bright core stroke
        const core = ctx.createLinearGradient(tx, ty, cx, cy);
        core.addColorStop(0, 'rgba(255,245,230,0)');
        core.addColorStop(0.4, 'rgba(210,195,255,0.7)');
        core.addColorStop(1, 'rgba(255,255,255,1)');
        ctx.strokeStyle = core;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(cx, cy);
        ctx.stroke();

        // Bright head dot with glow
        ctx.shadowColor = '#ddd8ff';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // ── Holiday FX (fireworks, bats, moon, etc.) ─────────────────────────────
    this.holidayFX.tick(ctx, time);

    // ── Far buildings (tiny silhouettes) ────────────────────────────────────
    for (const b of this.buildings) {
      if (!b.far) continue;
      ctx.fillStyle = b.shade;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }

    // ── Near buildings with sparse windows and rare neon ────────────────────
    for (const b of this.buildings) {
      if (b.far) continue;
      ctx.fillStyle = b.shade;
      ctx.fillRect(b.x, b.y, b.w, b.h);

      // Lit windows — warm pale amber/white at distance
      for (const w of b.windows) {
        const flicker = Math.sin(t * 0.6 + w.flicker * 3.7) > 0.96 ? 0.05 : 1;
        const a = (0.2 + Math.sin(t * 0.2 + w.flicker) * 0.07) * flicker;
        ctx.fillStyle = `rgba(220,190,130,${a.toFixed(3)})`;
        ctx.fillRect(w.x, w.y, 5, 6);
      }

      // Tiny neon sign (uses theme accent so it feels part of the world)
      if (b.sign) {
        const col = b.sign.hue === 'accent' ? accent : b.sign.hue === 'purp' ? purp : pink;
        const pulse = 0.4 + Math.sin(t * 1.6 + b.x * 0.015) * 0.35;
        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = 6 * pulse;
        ctx.fillStyle = this.rgba(col, pulse * 0.8);
        ctx.fillRect(b.x + 3, b.sign.y, b.sign.w, 3);
        ctx.restore();
      }
    }

    // ── Fog / distance haze — multiple layers ────────────────────────────────
    // Deep fog at horizon blending buildings into darkness
    const fog1 = ctx.createLinearGradient(0, groundY - 80, 0, groundY + 20);
    fog1.addColorStop(0, 'rgba(3,1,14,0)');
    fog1.addColorStop(0.5, 'rgba(4,1,16,0.55)');
    fog1.addColorStop(1, 'rgba(5,2,18,0.88)');
    ctx.fillStyle = fog1;
    ctx.fillRect(0, groundY - 80, W, 100);

    // Mid-distance atmospheric haze over the buildings
    const fog2 = ctx.createLinearGradient(0, groundY - 180, 0, groundY);
    fog2.addColorStop(0, 'rgba(2,0,12,0)');
    fog2.addColorStop(1, 'rgba(3,1,14,0.35)');
    ctx.fillStyle = fog2;
    ctx.fillRect(0, groundY - 180, W, 180);

    // Ground — pure dark below
    ctx.fillStyle = '#020010';
    ctx.fillRect(0, groundY, W, H - groundY);

    // Thin horizon glow — just a breath of color
    const hglow = ctx.createLinearGradient(0, groundY - 4, 0, groundY + 8);
    hglow.addColorStop(0, this.rgba(accent, 0.06));
    hglow.addColorStop(1, 'transparent');
    ctx.fillStyle = hglow;
    ctx.fillRect(0, groundY - 4, W, 12);
  }

  private rgba(hex: string, alpha: number): string {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  }

  // ─── Events ────────────────────────────────────────────────────────────────

  /**
   * Initial event binding from the constructor. Wires both the language
   * dropdown (lives outside `.login-wrapper`, kept across rerenders) and the
   * login-box content. `rerender()` only calls `_bindLoginBoxEvents()` — the
   * dropdown's listeners persist.
   */
  private bindEvents(): void {
    this._bindLangDropdown();
    this._bindPizzaDay();
    this._bindLoginBoxEvents();
  }

  private _pizzaDocClickHandler: ((e: MouseEvent) => void) | null = null;
  private _pizzaEscHandler: ((e: KeyboardEvent) => void) | null = null;

  /**
   * Wire the Bitcoin Pizza Day badge → click-to-expand info panel. Mirrors
   * `_bindLangDropdown`: click toggles, outside-click or Escape collapses.
   */
  private _bindPizzaDay(): void {
    const wrap    = this.container.querySelector<HTMLElement>('#login-pizza-day');
    const trigger = this.container.querySelector<HTMLButtonElement>('#login-pizza-trigger');
    const info    = this.container.querySelector<HTMLElement>('#login-pizza-info');
    if (!wrap || !trigger || !info) return;

    // Detach any prior handlers from a previous rerender.
    if (this._pizzaDocClickHandler) document.removeEventListener('click', this._pizzaDocClickHandler);
    if (this._pizzaEscHandler)      document.removeEventListener('keydown', this._pizzaEscHandler);

    const close = () => {
      info.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      wrap.classList.remove('is-open');
    };
    const open = () => {
      info.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      wrap.classList.add('is-open');
    };

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (info.hidden) open();
      else close();
    });

    this._pizzaDocClickHandler = (e) => {
      if (!info.hidden && !wrap.contains(e.target as Node)) close();
    };
    document.addEventListener('click', this._pizzaDocClickHandler);

    this._pizzaEscHandler = (e) => {
      if (e.key === 'Escape' && !info.hidden) { close(); trigger.focus(); }
    };
    document.addEventListener('keydown', this._pizzaEscHandler);
  }

  private _bindLoginBoxEvents(): void {
    // The "NOSTR DISTRICT" title doubles as the "What is Nostr?" button.
    const titleBtn = this.container.querySelector('#login-what-is-nostr');
    titleBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      LoginInfo.open('nostr');
    });
    titleBtn?.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === 'Enter' || k === ' ') { e.preventDefault(); LoginInfo.open('nostr'); }
    });

    // Per-method info glyphs. Each ⓘ is a <span role="button"> living inside
    // the parent login button. We stop propagation so the click opens the
    // explainer without also firing the login flow. Keyboard activation
    // (Enter / Space) is handled explicitly because spans don't get that for
    // free.
    const openTopic = (el: HTMLElement) => {
      const topic = el.dataset.info as Parameters<typeof LoginInfo.open>[0] | undefined;
      if (topic) LoginInfo.open(topic);
    };
    this.container.querySelectorAll<HTMLElement>('.btn-info-glyph').forEach(glyph => {
      glyph.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openTopic(glyph);
      });
      glyph.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          openTopic(glyph);
        }
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>('.login-passkey-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cid = btn.dataset.cid;
        if (cid && this.onPasskeyLogin) this.onPasskeyLogin(cid);
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>('.passkey-manage-trigger').forEach(btn => {
      btn.addEventListener('click', () => this._showPasskeyManager());
    });

    // Guest link top-right — hide when navigating into sub-views
    this.container.querySelector('#login-guest-top')?.addEventListener('click', () => this.onGuestLogin());

    // New: extension detected on main screen
    this.container.querySelector('#login-extension-direct')?.addEventListener('click', () => {
      localStorage.setItem('nd_last_login', 'extension');
      this.setStatus('Connecting to extension...');
      this.onExtensionLogin();
    });

    // New: continue with extension (last used)
    this.container.querySelector('#login-continue-ext')?.addEventListener('click', () => {
      localStorage.setItem('nd_last_login', 'extension');
      this.setStatus('Connecting to extension...');
      this.onExtensionLogin();
    });

    // New: continue with nsec (last used) — jump straight to nsec input
    this.container.querySelector('#login-continue-nsec')?.addEventListener('click', () => {
      this.container.querySelector<HTMLElement>('#login-guest-top')?.style.setProperty('display', 'none');
      this.el('login-main').classList.add('hidden');
      this.el('login-create-view').classList.add('hidden');
      this.el('login-bunker-view').classList.remove('hidden');
      this.el('bunker-options').classList.remove('hidden');
      this.el('bunker-qr-panel').classList.add('hidden');
      this.container.querySelector('.login-box')!.classList.add('view-nostr');
      this.el('nsec-form').classList.remove('hidden');
      (this.el('nsec-accept') as HTMLInputElement).checked = true;
      this.el('nsec-input-wrap').classList.remove('hidden');
      (this.el('nsec-input') as HTMLInputElement).focus();
      this.setStatus('');
    });

    // New: continue with bunker (last used) — jump straight to QR/URL panel
    this.container.querySelector('#login-continue-bunker')?.addEventListener('click', () => {
      this.container.querySelector<HTMLElement>('#login-guest-top')?.style.setProperty('display', 'none');
      this.el('login-main').classList.add('hidden');
      this.el('login-bunker-view').classList.remove('hidden');
      this.el('bunker-options').classList.add('hidden');
      this.el('bunker-qr-panel').classList.remove('hidden');
      this.container.querySelector('.login-box')!.classList.add('view-nostr');
      this.setStatus('');
      if (this.onBunkerClientFlow) this.onBunkerClientFlow();
    });

    this.el('login-extension').addEventListener('click', () => {
      localStorage.setItem('nd_last_login', 'extension');
      this.setStatus('Connecting to extension...');
      this.onExtensionLogin();
    });

    this.el('login-bunker').addEventListener('click', () => {
      this.el('login-main').classList.add('hidden');
      this.el('login-bunker-view').classList.remove('hidden');
      this.el('bunker-options').classList.remove('hidden');
      this.el('bunker-qr-panel').classList.add('hidden');
      this.container.querySelector('.login-box')!.classList.add('view-nostr');
      this.setStatus('');
    });

    this.el('login-bunker-start').addEventListener('click', () => {
      localStorage.setItem('nd_last_login', 'bunker');
      this.el('bunker-options').classList.add('hidden');
      this.el('bunker-qr-panel').classList.remove('hidden');
      if (this.onBunkerClientFlow) this.onBunkerClientFlow();
    });

    this.el('bunker-cancel').addEventListener('click', () => {
      // Always cancel any in-flight bunker connection before navigating.
      if (this.onBunkerCancel) this.onBunkerCancel();

      // Two-level navigation: if we're on the QR/URL paste sub-panel, step
      // back to the picker (Remote Signer / Browser Extension / nsec) instead
      // of exiting the bunker view entirely.
      const onQrPanel = !this.el('bunker-qr-panel').classList.contains('hidden');
      if (onQrPanel) {
        this.el('bunker-qr-panel').classList.add('hidden');
        this.el('bunker-options').classList.remove('hidden');
        this.setBunkerStatus('');
        (this.el('bunker-input') as HTMLInputElement).value = '';
        this.el('bunker-uri-display').classList.add('hidden');
        return;
      }

      // Otherwise we're already on the picker — back out to the main screen.
      this.el('login-bunker-view').classList.add('hidden');
      this.el('login-main').classList.remove('hidden');
      this.el('bunker-options').classList.remove('hidden');
      this.el('bunker-qr-panel').classList.add('hidden');
      this.el('nsec-form').classList.add('hidden');
      (this.el('nsec-accept') as HTMLInputElement).checked = false;
      this.el('nsec-input-wrap').classList.add('hidden');
      this.container.querySelector('.login-box')!.classList.remove('view-nostr');
      const gt = this.container.querySelector<HTMLElement>('#login-guest-top'); if (gt) gt.style.display = '';
      this.setBunkerStatus('');
      (this.el('bunker-input') as HTMLInputElement).value = '';
      this.el('bunker-uri-display').classList.add('hidden');
      this.setStatus('');
    });

    this.el('bunker-url-submit').addEventListener('click', () => {
      const input = this.el('bunker-input') as HTMLInputElement;
      const url = input.value.trim();
      if (!url) return;
      localStorage.setItem('nd_last_login', 'bunker');
      this.setBunkerStatus('Connecting...');
      this.onBunkerLogin(url);
    });
    (this.el('bunker-input') as HTMLInputElement).addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const input = this.el('bunker-input') as HTMLInputElement;
        const url = input.value.trim();
        if (!url) return;
        localStorage.setItem('nd_last_login', 'bunker');
        this.setBunkerStatus('Connecting...');
        this.onBunkerLogin(url);
      }
    });

    this.el('bunker-uri-copy').addEventListener('click', () => {
      const text = this.el('bunker-uri-text').textContent || '';
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          (this.el('bunker-uri-copy') as HTMLElement).textContent = 'Copied!';
          setTimeout(() => { (this.el('bunker-uri-copy') as HTMLElement).textContent = 'Copy'; }, 2000);
        }).catch(() => {});
      }
    });

    this.el('nsec-toggle').addEventListener('click', () => {
      this.el('nsec-form').classList.toggle('hidden');
    });
    this.el('nsec-accept').addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      if (checked) this.el('nsec-input-wrap').classList.remove('hidden');
      else this.el('nsec-input-wrap').classList.add('hidden');
    });
    const submitNsec = () => {
      const input = this.el('nsec-input') as HTMLInputElement;
      const nsec = input.value.trim();
      input.value = '';
      if (!nsec) return;
      localStorage.setItem('nd_last_login', 'nsec');
      this.setStatus('Logging in...');
      this.onNsecLogin(nsec);
    };
    this.el('nsec-submit').addEventListener('click', submitNsec);
    // Press Enter in the nsec field to log in
    this.el('nsec-input').addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); submitNsec(); }
    });

    // ── Create account ────────────────────────────────────────────────────────
    const goToCreate = () => {
      this.el('login-main').classList.add('hidden');
      this.el('login-create-view').classList.remove('hidden');
      this.container.querySelector('.login-box')!.classList.add('view-create');
      const gt2 = this.container.querySelector<HTMLElement>('#login-guest-top'); if (gt2) gt2.style.display = 'none';
      this.setStatus('');
    };
    this.el('login-create').addEventListener('click', goToCreate);
    this.container.querySelector('#login-passkey-setup')?.addEventListener('click', goToCreate);
    this.el('create-back').addEventListener('click', () => {
      this.el('login-create-view').classList.add('hidden');
      this.el('login-main').classList.remove('hidden');
      this.container.querySelector('.login-box')!.classList.remove('view-create');
      const gt3 = this.container.querySelector<HTMLElement>('#login-guest-top'); if (gt3) gt3.style.display = '';
      this.setStatus('');
      // Reset form state
      this.el('create-step-1').classList.remove('hidden');
      this.el('create-step-2').classList.add('hidden');
      (this.el('create-username') as HTMLInputElement).value = '';
      (this.el('create-saved') as HTMLInputElement).checked = false;
      (this.el('create-confirm') as HTMLButtonElement).disabled = true;
      const cpBtn = this.el('create-passkey') as HTMLButtonElement;
      cpBtn.disabled = false;
      cpBtn.textContent = t('login.create.button');
    });
    this.el('create-passkey').addEventListener('click', () => this._submitCreateWithPasskey());
    this.el('create-nsec-copy').addEventListener('click', () => {
      const text = this._pendingCreateNsec;
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          (this.el('create-nsec-copy') as HTMLElement).textContent = 'Copied!';
          setTimeout(() => { (this.el('create-nsec-copy') as HTMLElement).textContent = 'Copy'; }, 2000);
        }).catch(() => {});
      }
    });
    this.el('create-saved').addEventListener('change', (e) => {
      (this.el('create-confirm') as HTMLButtonElement).disabled = !(e.target as HTMLInputElement).checked;
    });
    this.el('create-confirm').addEventListener('click', () => {
      if (!this._pendingCreateNsec || !this.onConfirmCreate) return;
      this.setStatus('Creating account...');
      this.onConfirmCreate(this._pendingCreateNsec, this._pendingCreateUsername);
    });

    this.el('create-guest').addEventListener('click', () => this.onGuestLogin());
  }

  private async _submitCreateWithPasskey(): Promise<void> {
    const username = (this.el('create-username') as HTMLInputElement).value.trim();
    if (!username) { this.setStatus('Choose a username', true); return; }
    if (username.length < 2) { this.setStatus('Username must be at least 2 characters', true); return; }
    if (!this.onCreateWithPasskey) return;

    const btn = this.el('create-passkey') as HTMLButtonElement;
    const originalText = btn.textContent || 'Create with Passkey';
    btn.disabled = true;
    btn.textContent = 'Authenticating…';
    this.setStatus('');
    try {
      const nsec = await this.onCreateWithPasskey(username);
      this._pendingCreateNsec = nsec;
      this._pendingCreateUsername = username;
      this.el('create-nsec-text').textContent = nsec;
      this.el('create-step-1').classList.add('hidden');
      this.el('create-step-2').classList.remove('hidden');
    } catch (e: any) {
      const notSupported = e?.message === 'PRF_NOT_SUPPORTED' || /prf/i.test(e?.message || '');
      this.setStatus(
        notSupported
          ? 'This passkey manager doesn\'t support encryption (PRF). Try a different one or use a password.'
          : (e?.message || 'Passkey creation failed'),
        true,
      );
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  showConnectUri(uri: string): void {
    const display = this.el('bunker-uri-display');
    const text = this.el('bunker-uri-text');
    if (display && text) {
      text.textContent = uri;
      display.classList.remove('hidden');
    }
  }

  getQRContainer(): HTMLElement | null {
    return this.container.querySelector('#bunker-qr');
  }

  setBunkerStatus(msg: string, isError = false): void {
    const el = this.container.querySelector('#bunker-status') as HTMLElement;
    if (el) {
      el.textContent = msg;
      el.style.color = isError ? '#e85454' : 'var(--nd-accent)';
    }
  }

  setStatus(msg: string, isError = false): void {
    const el = this.el('login-status');
    el.textContent = msg;
    el.className = isError ? 'login-status error' : 'login-status';
  }

  showSavePasskeyPrompt(nsec: string, displayName: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'passkey-prompt-overlay';
      overlay.innerHTML = `
        <div class="passkey-prompt-box">
          <div class="passkey-prompt-title">Save with passkey?</div>
          <div class="passkey-prompt-desc">Next time, log in instantly with Face ID, Touch ID, or your device PIN — no password needed.</div>
          <div class="passkey-prompt-warn">A passkey is a convenience, not a backup. If you lose this device, you'll still need your private key (nsec) to recover your account.</div>
          <button id="pk-save" class="login-btn login-btn-passkey">Save with Passkey</button>
          <button id="pk-skip" class="login-link" style="font-size:12px;">Not now</button>
        </div>
      `;
      this.container.querySelector('.login-box')!.appendChild(overlay);

      overlay.querySelector('#pk-save')!.addEventListener('click', async () => {
        const btn = overlay.querySelector('#pk-save') as HTMLButtonElement;
        const desc = overlay.querySelector('.passkey-prompt-desc') as HTMLElement;
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
          const { saveWithPasskey } = await import('../stores/passkeyStore');
          await saveWithPasskey(nsec, displayName);
          overlay.remove();
          resolve();
        } catch (e: any) {
          const notSupported = e?.message === 'PRF_NOT_SUPPORTED' || /prf/i.test(e?.message || '');
          desc.textContent = notSupported
            ? 'Passkey encryption (PRF) isn\'t supported by this browser yet. Try Chrome, or Safari 17+ on macOS.'
            : (e?.message || 'Passkey save failed.');
          desc.style.color = '#e85454';
          btn.disabled = false;
          btn.textContent = 'Save with Passkey';
        }
      });

      overlay.querySelector('#pk-skip')!.addEventListener('click', () => {
        overlay.remove();
        resolve();
      });
    });
  }

  private _updatePrimaryButton(): void {
    const pk = this.storedPasskeys.find(p => p.credentialId === this._primaryPasskeyId) ?? this.storedPasskeys[0];
    const row = this.container.querySelector('#primary-passkey-row') as HTMLElement | null;
    if (!row) return;

    if (!pk) {
      row.className = 'passkey-row';
      row.innerHTML = `
        <button id="login-passkey-setup" class="login-btn login-btn-passkey" style="flex:1;text-align:left;">
          <span class="btn-label">${this.esc(t('login.passkey.save'))}<span class="btn-info-glyph" data-info="passkey" role="button" tabindex="0" aria-label="About passkey login"><svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="4.4" r="0.95" fill="currentColor"/><rect x="7.05" y="6.6" width="1.9" height="5.6" rx="0.6" fill="currentColor"/></svg></span></span>
          <span class="btn-sub">${this.esc(t('login.passkey.save_desc'))}</span>
        </button>
        <button class="passkey-manage-trigger" title="${this.esc(t('login.passkey.manage_title'))}">⋮</button>`;
      this._wireGlyph(row);
      row.querySelector('#login-passkey-setup')?.addEventListener('click', () => {
        this.el('login-main').classList.add('hidden');
        this.el('login-create-view').classList.remove('hidden');
        this.setStatus('');
      });
      row.querySelector<HTMLButtonElement>('.passkey-manage-trigger')!
        .addEventListener('click', () => this._showPasskeyManager());
      return;
    }

    const existingLoginBtn = row.querySelector<HTMLButtonElement>('.login-passkey-btn');
    if (!existingLoginBtn) {
      row.className = 'passkey-row';
      row.innerHTML = `
        <button class="login-btn login-btn-passkey login-passkey-btn" data-cid="${this.esc(pk.credentialId)}">
          <span class="btn-label">${this.esc(t('login.passkey.continue_as', { name: pk.displayName }))}<span class="btn-info-glyph" data-info="passkey" role="button" tabindex="0" aria-label="About passkey login"><svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="4.4" r="0.95" fill="currentColor"/><rect x="7.05" y="6.6" width="1.9" height="5.6" rx="0.6" fill="currentColor"/></svg></span></span>
          <span class="btn-sub">${this.esc(t('login.passkey.continue_desc'))}</span>
        </button>
        <button class="passkey-manage-trigger" title="${this.esc(t('login.passkey.manage_title'))}">⋮</button>`;
      row.querySelector<HTMLButtonElement>('.login-passkey-btn')!
        .addEventListener('click', () => { if (this.onPasskeyLogin) this.onPasskeyLogin(pk.credentialId); });
      row.querySelector<HTMLButtonElement>('.passkey-manage-trigger')!
        .addEventListener('click', () => this._showPasskeyManager());
      this._wireGlyph(row);
    } else {
      existingLoginBtn.dataset.cid = pk.credentialId;
      // Update just the text node — preserve the trailing info glyph span.
      const label = existingLoginBtn.querySelector('.btn-label');
      const textNode = label?.firstChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        textNode.textContent = t('login.passkey.continue_as', { name: pk.displayName });
      }
    }
  }

  private _addPasskeyButton(pk: { credentialId: string; displayName: string }): void {
    // Inject a new passkey row into the main login list and bind its click handler
    const row = document.createElement('div');
    row.className = 'passkey-row';
    row.innerHTML = `
      <button class="login-btn login-btn-passkey login-passkey-btn" data-cid="${this.esc(pk.credentialId)}">
        <span class="btn-label">${this.esc(t('login.passkey.continue_as', { name: pk.displayName }))}<span class="btn-info-glyph" data-info="passkey" role="button" tabindex="0" aria-label="About passkey login"><svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="4.4" r="0.95" fill="currentColor"/><rect x="7.05" y="6.6" width="1.9" height="5.6" rx="0.6" fill="currentColor"/></svg></span></span>
        <span class="btn-sub">${this.esc(t('login.passkey.continue_desc'))}</span>
      </button>
      <button class="passkey-manage-trigger" title="${this.esc(t('login.passkey.manage_title'))}">⋮</button>
    `;
    const loginBtn = row.querySelector<HTMLButtonElement>('.login-passkey-btn')!;
    loginBtn.addEventListener('click', () => {
      if (this.onPasskeyLogin) this.onPasskeyLogin(pk.credentialId);
    });
    row.querySelector<HTMLButtonElement>('.passkey-manage-trigger')!
      .addEventListener('click', () => this._showPasskeyManager());
    this._wireGlyph(row);

    // Insert before the "Connect with Nostr" button
    const bunker = this.container.querySelector('#login-bunker');
    bunker?.parentElement?.insertBefore(row, bunker);
  }

  private _showPasskeyManager(): void {
    const box = this.container.querySelector('.login-box')!;
    const overlay = document.createElement('div');
    overlay.className = 'passkey-prompt-overlay passkey-manager-overlay';

    // Which add-form is open: null | 'create' | 'link'
    let activeForm: 'create' | 'link' | null = null;

    const renderList = (): string => this.storedPasskeys.length
      ? this.storedPasskeys.map(pk => {
          const isPrimary = pk.credentialId === this._primaryPasskeyId;
          return `
          <div class="pk-mgr-item" data-cid="${this.esc(pk.credentialId)}">
            <div class="pk-mgr-item-left">
              <span class="pk-mgr-name">${this.esc(pk.displayName)}</span>
              ${isPrimary
                ? `<span class="pk-mgr-primary-badge">displayed</span>`
                : `<button class="pk-mgr-set-primary" data-cid="${this.esc(pk.credentialId)}">set as displayed</button>`}
            </div>
            <button class="pk-mgr-remove" data-cid="${this.esc(pk.credentialId)}">Remove</button>
          </div>`;
        }).join('')
      : `<div class="pk-mgr-empty">No passkeys saved on this device.</div>`;

    const MAX_PASSKEYS = 3;

    const renderAddForm = (): string => {
      if (!activeForm) {
        if (this.storedPasskeys.length >= MAX_PASSKEYS) return `
          <p style="font-size:12px;color:rgba(255,255,255,0.5);text-align:center;margin:0;">
            Passkey limit reached (${MAX_PASSKEYS} max). Remove one to add another.
          </p>`;
        return `
        <div class="pk-mgr-add-btns">
          <button id="pk-mgr-open-create" class="login-btn login-btn-passkey pk-mgr-btn">+ Create new passkey</button>
        </div>`;
      }

      return `
        <div class="pk-mgr-form-header">
          <span class="pk-mgr-form-title">Create new passkey</span>
          <button id="pk-mgr-form-cancel" class="login-link" style="font-size:11px;padding:4px 8px;">Cancel</button>
        </div>
        <p class="pk-mgr-form-desc">A brand-new passkey credential will be created and linked to this nsec.</p>
        <input type="password" id="pk-mgr-nsec" placeholder="nsec1..." class="nsec-input pk-mgr-input" autocomplete="off" spellcheck="false">
        <div class="create-nsec-risk" style="margin:8px 0;">
          <strong>Note:</strong> Your nsec is stored encrypted in the passkey, but it is loaded into memory each time you log in. For maximum security, use a browser extension or remote signer instead — they sign events without ever exposing your key.
        </div>
        <button id="pk-mgr-confirm" class="login-btn login-btn-passkey pk-mgr-btn">Create new passkey</button>
        <div id="pk-mgr-add-status" class="pk-mgr-status"></div>`;
    };

    const render = () => {
      overlay.innerHTML = `
        <div class="pk-mgr-scroll">
          <div class="pk-mgr-header">
            <span class="passkey-prompt-title" style="margin:0;">Saved Passkeys</span>
            <button class="pk-mgr-back login-link" style="font-size:11px;padding:6px 10px;">← Back</button>
          </div>
          <p class="passkey-prompt-desc" style="text-align:left;margin:4px 0 10px;">
            Removing one here only forgets it locally — also delete it from your passkey manager to fully revoke it.
          </p>
          <div class="pk-mgr-list">${renderList()}</div>
          <div class="pk-mgr-divider"></div>
          ${renderAddForm()}
        </div>
      `;

      overlay.querySelector('.pk-mgr-back')!.addEventListener('click', () => overlay.remove());

      overlay.querySelectorAll<HTMLButtonElement>('.pk-mgr-remove').forEach(btn => {
        let armed = false;
        btn.addEventListener('click', async () => {
          if (!armed) {
            armed = true;
            btn.textContent = 'Confirm?';
            btn.classList.add('pk-mgr-remove-armed');
            setTimeout(() => { if (armed) { armed = false; btn.textContent = 'Remove'; btn.classList.remove('pk-mgr-remove-armed'); } }, 3000);
            return;
          }
          const cid = btn.dataset.cid!;
          const { clearStoredPasskey } = await import('../stores/passkeyStore');
          clearStoredPasskey(cid);
          this.storedPasskeys = this.storedPasskeys.filter(p => p.credentialId !== cid);
          if (this._primaryPasskeyId === cid) {
            this._primaryPasskeyId = this.storedPasskeys[0]?.credentialId ?? null;
            if (this._primaryPasskeyId) localStorage.setItem('nd_primary_passkey', this._primaryPasskeyId);
            else localStorage.removeItem('nd_primary_passkey');
          }
          this._updatePrimaryButton();
          render();
        });
      });

      overlay.querySelectorAll<HTMLButtonElement>('.pk-mgr-set-primary').forEach(btn => {
        btn.addEventListener('click', () => {
          const cid = btn.dataset.cid!;
          this._primaryPasskeyId = cid;
          localStorage.setItem('nd_primary_passkey', cid);
          this._updatePrimaryButton();
          render();
        });
      });

      overlay.querySelector('#pk-mgr-open-create')?.addEventListener('click', () => { activeForm = 'create'; render(); });
      overlay.querySelector('#pk-mgr-open-link')?.addEventListener('click',   () => { activeForm = 'link';   render(); });
      overlay.querySelector('#pk-mgr-form-cancel')?.addEventListener('click', () => { activeForm = null;     render(); });

      const confirmBtn = overlay.querySelector('#pk-mgr-confirm') as HTMLButtonElement | null;
      if (confirmBtn) {
        const setStatus = (msg: string, isError = false) => {
          const el = overlay.querySelector('#pk-mgr-add-status') as HTMLElement;
          el.textContent = msg;
          el.style.color = isError ? '#e85454' : 'var(--nd-accent)';
        };

        confirmBtn.addEventListener('click', async () => {
          const nsec = (overlay.querySelector('#pk-mgr-nsec') as HTMLInputElement).value.trim();
          if (this.storedPasskeys.length >= MAX_PASSKEYS) { setStatus(`Limit of ${MAX_PASSKEYS} passkeys reached. Remove one first.`, true); return; }
          if (!nsec) { setStatus('Enter your nsec private key to continue', true); return; }
          if (!nsec.startsWith('nsec1')) { setStatus('That doesn\'t look like an nsec — keys must start with nsec1', true); return; }
          if (nsec.length < 60) { setStatus('Key is too short — make sure you copied the full nsec1 key', true); return; }

          confirmBtn.disabled = true;
          setStatus('Fetching profile…');

          let displayName = 'Nostr User';
          try {
            const { nip19 } = await import('nostr-tools');
            const decoded = nip19.decode(nsec);
            if (decoded.type === 'nsec') {
              const { getPublicKey, nip19: n19 } = await import('nostr-tools');
              const pubkey = getPublicKey(decoded.data as Uint8Array);
              const npubShort = n19.npubEncode(pubkey).slice(0, 12) + '…';
              displayName = npubShort;
              try {
                const { fetchProfile } = await import('../nostr/nostrService');
                const profile = await Promise.race([
                  fetchProfile(pubkey),
                  new Promise<null>(r => setTimeout(() => r(null), 4000)),
                ]);
                if (profile) displayName = (profile.display_name || profile.name || npubShort).slice(0, 40);
              } catch { /* keep npubShort fallback */ }
            }
          } catch { /* keep 'Nostr User' fallback */ }

          setStatus('Creating passkey…');

          try {
            const { saveWithPasskey, getStoredPasskeys } = await import('../stores/passkeyStore');
            await saveWithPasskey(nsec, displayName);
            const all = getStoredPasskeys();
            const saved = all[all.length - 1];
            this.storedPasskeys = this.storedPasskeys.filter(p => p.credentialId !== saved.credentialId);
            this.storedPasskeys.push(saved);
            if (!this._primaryPasskeyId) { this._primaryPasskeyId = saved.credentialId; localStorage.setItem('nd_primary_passkey', saved.credentialId); }
            this._updatePrimaryButton();
            activeForm = null;
            render();
          } catch (e: any) {
            const notSupported = e?.message === 'PRF_NOT_SUPPORTED' || /prf/i.test(e?.message || '');
            setStatus(notSupported ? 'This passkey manager doesn\'t support PRF encryption.' : (e?.message || 'Failed'), true);
            confirmBtn.disabled = false;
          }
        });

        overlay.querySelectorAll('input').forEach(inp => inp.addEventListener('keydown', e => e.stopPropagation()));
      }
    };

    render();
    box.appendChild(overlay);
  }

  destroy(): void {
    if (this.animFrameId !== null) cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this.handleResize);
    if (this.unsubLang)    { this.unsubLang();    this.unsubLang    = null; }
    if (this.unsubHalving) { this.unsubHalving(); this.unsubHalving = null; }
    if (this._langDocClickHandler) {
      document.removeEventListener('click', this._langDocClickHandler);
      this._langDocClickHandler = null;
    }
    this.container.remove();
  }

  private el(id: string): HTMLElement {
    return this.container.querySelector(`#${id}`)!;
  }
}

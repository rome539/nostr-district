import { P } from '../config/game.config';

export class LoginScreen {
  private container: HTMLDivElement;
  private onExtensionLogin: () => void;
  private onNsecLogin: (nsec: string) => void;
  private onGuestLogin: () => void;
  private onBunkerLogin: (url: string) => void;
  private onBunkerClientFlow: (() => void) | null = null;
  private onBunkerCancel: (() => void) | null = null;

  constructor(callbacks: {
    onExtensionLogin: () => void;
    onNsecLogin: (nsec: string) => void;
    onGuestLogin: () => void;
    onBunkerLogin: (url: string) => void;
    onBunkerClientFlow?: () => void;
    onBunkerCancel?: () => void;
  }) {
    this.onExtensionLogin = callbacks.onExtensionLogin;
    this.onNsecLogin = callbacks.onNsecLogin;
    this.onGuestLogin = callbacks.onGuestLogin;
    this.onBunkerLogin = callbacks.onBunkerLogin;
    this.onBunkerClientFlow = callbacks.onBunkerClientFlow || null;
    this.onBunkerCancel = callbacks.onBunkerCancel || null;

    this.container = document.createElement('div');
    this.container.id = 'login-screen';
    this.container.innerHTML = this.getHTML();
    this.applyStyles();
    document.body.appendChild(this.container);

    this.bindEvents();
  }

  private getHTML(): string {
    return `
      <div class="login-box">
        <h1 class="login-title">NOSTR DISTRICT</h1>
        <p class="login-subtitle">a pixel art social world</p>

        <!-- ═══ Main view ═══ -->
        <div id="login-main" class="login-methods">
          <button id="login-bunker" class="login-btn login-btn-primary">
            <span class="btn-label">Connect with Nostr</span>
            <span class="btn-sub">NIP-46 Remote Signer — Recommended</span>
          </button>

          <button id="login-extension" class="login-btn login-btn-secondary">
            <span class="btn-label">Browser Extension</span>
            <span class="btn-sub">Alby, nos2x, or similar</span>
          </button>

          <div class="login-divider"></div>

          <div id="nsec-section" class="nsec-section">
            <button id="nsec-toggle" class="login-link">Use private key instead</button>
            <div id="nsec-form" class="nsec-form hidden">
              <div class="nsec-warning">
                <label class="warning-check">
                  <input type="checkbox" id="nsec-accept">
                  <span>I understand my key will be held in memory. This is less secure than the options above.</span>
                </label>
              </div>
              <div id="nsec-input-wrap" class="nsec-input-wrap hidden">
                <input type="password" id="nsec-input" placeholder="nsec1..." class="nsec-input" autocomplete="off" spellcheck="false">
                <button id="nsec-submit" class="login-btn login-btn-nsec">Login</button>
              </div>
            </div>
          </div>

          <div class="login-divider"></div>

          <button id="login-guest" class="login-link guest-link">Just look around (guest mode)</button>
        </div>

        <!-- ═══ Bunker view (hidden by default, replaces main) ═══ -->
        <div id="login-bunker-view" class="hidden">
          <p class="bunker-instruction">Scan with your signer app</p>
          <p class="bunker-apps">Primal, Amber, nsec.app</p>

          <div id="bunker-qr" class="bunker-qr">
            <div class="bunker-qr-loading">Generating...</div>
          </div>

          <div id="bunker-uri-display" class="bunker-uri-row hidden">
            <div id="bunker-uri-text" class="bunker-uri-text"></div>
            <button id="bunker-uri-copy" class="bunker-uri-copy">Copy</button>
          </div>

          <div id="bunker-status" class="bunker-status">Waiting for signer approval...</div>

          <div class="bunker-or">
            <span class="bunker-or-line"></span>
            <span class="bunker-or-text">or paste a bunker:// URL</span>
            <span class="bunker-or-line"></span>
          </div>

          <div class="bunker-url-row">
            <input type="text" id="bunker-input" placeholder="bunker://..." class="bunker-url-input" autocomplete="off">
            <button id="bunker-url-submit" class="bunker-url-btn">Go</button>
          </div>

          <button id="bunker-cancel" class="login-link bunker-cancel">\u2190 Back</button>
        </div>

        <div id="login-status" class="login-status"></div>
      </div>
    `;
  }

  private applyStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      #login-screen {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: ${P.bg};
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        font-family: 'Courier New', monospace;
        overflow-y: auto;
      }
      .login-box {
        width: 440px;
        max-width: 92vw;
        padding: 36px;
        text-align: center;
      }
      .login-title {
        font-size: 32px;
        color: ${P.pink};
        margin: 0 0 6px 0;
        letter-spacing: 3px;
      }
      .login-subtitle {
        font-size: 13px;
        color: ${P.lpurp};
        opacity: 0.6;
        margin: 0 0 32px 0;
      }
      .login-methods {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .login-btn {
        display: block;
        width: 100%;
        padding: 14px 18px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-family: 'Courier New', monospace;
        text-align: left;
        transition: opacity 0.15s;
      }
      .login-btn:hover { opacity: 0.85; }
      .login-btn-primary { background: ${P.purp}; color: #fff; }
      .login-btn-secondary { background: ${P.navy}; color: ${P.lpurp}; border: 1px solid ${P.dpurp}; }
      .login-btn-nsec { background: ${P.navy}; color: ${P.amber}; border: 1px solid ${P.dpurp}; padding: 10px 18px; text-align: center; }
      .btn-label { display: block; font-size: 14px; font-weight: bold; }
      .btn-sub { display: block; font-size: 11px; opacity: 0.6; margin-top: 3px; }
      .login-divider { height: 1px; background: ${P.dpurp}; opacity: 0.3; margin: 6px 0; }
      .login-link {
        background: none; border: none; color: ${P.lpurp};
        font-family: 'Courier New', monospace; font-size: 13px;
        cursor: pointer; padding: 8px; transition: color 0.15s;
      }
      .login-link:hover { color: ${P.teal}; }
      .guest-link { color: ${P.lpurp}; font-size: 12px; }
      .nsec-section { text-align: left; }
      .nsec-form { margin-top: 10px; }
      .nsec-warning {
        background: rgba(240,176,64,0.08); border: 1px solid rgba(240,176,64,0.2);
        border-radius: 4px; padding: 10px 12px; margin-bottom: 10px;
      }
      .warning-check { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; color: ${P.amber}; cursor: pointer; }
      .warning-check input { margin-top: 2px; }
      .nsec-input-wrap { display: flex; gap: 6px; }
      .nsec-input {
        flex: 1; background: ${P.navy}; border: 1px solid ${P.dpurp}; border-radius: 4px;
        color: ${P.lcream}; font-family: 'Courier New', monospace; font-size: 13px; padding: 10px;
      }
      .nsec-input::placeholder { color: ${P.dpurp}; }
      .hidden { display: none !important; }
      .login-status { margin-top: 18px; font-size: 12px; color: ${P.teal}; min-height: 18px; }
      .login-status.error { color: ${P.red}; }

      /* ═══ Bunker view ═══ */
      .bunker-instruction {
        font-size: 18px; color: ${P.lcream}; font-weight: bold;
        margin: 0 0 4px 0;
      }
      .bunker-apps {
        font-size: 13px; color: ${P.lpurp}; opacity: 0.6; margin: 0 0 20px 0;
      }
      .bunker-qr {
        display: flex; justify-content: center; align-items: center;
        margin: 0 auto 20px; min-height: 260px;
      }
      .bunker-qr-loading {
        color: ${P.lpurp}; opacity: 0.6; font-size: 14px;
      }
      .bunker-uri-row {
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 16px; background: ${P.bg};
        border: 1px solid ${P.dpurp}33; border-radius: 6px;
        padding: 10px 12px;
      }
      .bunker-uri-text {
        flex: 1; font-size: 12px; color: ${P.lpurp}; opacity: 0.7;
        word-break: break-all; max-height: 44px; overflow: hidden;
        text-align: left; line-height: 1.4;
      }
      .bunker-uri-copy {
        background: ${P.teal}22; border: 1px solid ${P.teal}44;
        border-radius: 4px; color: ${P.teal};
        font-family: 'Courier New', monospace; font-size: 13px;
        padding: 6px 14px; cursor: pointer; white-space: nowrap;
      }
      .bunker-uri-copy:hover { background: ${P.teal}33; }
      .bunker-status {
        color: ${P.teal}; font-size: 14px; margin-bottom: 18px;
        min-height: 18px;
      }
      .bunker-or {
        display: flex; align-items: center; gap: 10px; margin: 0 0 14px 0;
      }
      .bunker-or-line { flex: 1; height: 1px; background: ${P.dpurp}33; }
      .bunker-or-text { font-size: 12px; color: ${P.lpurp}; opacity: 0.5; white-space: nowrap; }
      .bunker-url-row {
        display: flex; gap: 8px; margin-bottom: 14px;
      }
      .bunker-url-input {
        flex: 1; background: ${P.bg}; border: 1px solid ${P.dpurp}44;
        border-radius: 6px; color: ${P.lcream};
        font-family: 'Courier New', monospace; font-size: 14px;
        padding: 12px 14px; outline: none; box-sizing: border-box;
      }
      .bunker-url-input::placeholder { color: ${P.lpurp}55; }
      .bunker-url-input:focus { border-color: ${P.teal}55; }
      .bunker-url-btn {
        background: ${P.purp}; border: none; border-radius: 6px;
        color: #fff; font-family: 'Courier New', monospace;
        font-size: 14px; font-weight: bold; padding: 12px 20px;
        cursor: pointer; transition: opacity 0.15s;
      }
      .bunker-url-btn:hover { opacity: 0.85; }
      .bunker-cancel {
        font-size: 14px; color: ${P.lpurp}; margin-top: 6px;
      }
    `;
    document.head.appendChild(style);
  }

  private bindEvents(): void {
    // Extension login
    this.el('login-extension').addEventListener('click', () => {
      this.setStatus('Connecting to extension...');
      this.onExtensionLogin();
    });

    // Bunker — swap to bunker view and start client flow
    this.el('login-bunker').addEventListener('click', () => {
      this.el('login-main').classList.add('hidden');
      this.el('login-bunker-view').classList.remove('hidden');
      this.setStatus('');
      if (this.onBunkerClientFlow) this.onBunkerClientFlow();
    });

    // Back — return to main view and cancel pending flow
    this.el('bunker-cancel').addEventListener('click', () => {
      if (this.onBunkerCancel) this.onBunkerCancel();
      this.el('login-bunker-view').classList.add('hidden');
      this.el('login-main').classList.remove('hidden');
      this.setStatus('');
    });

    // Bunker URL paste
    this.el('bunker-url-submit').addEventListener('click', () => {
      const input = this.el('bunker-input') as HTMLInputElement;
      const url = input.value.trim();
      if (!url) return;
      this.setBunkerStatus('Connecting...');
      this.onBunkerLogin(url);
    });
    (this.el('bunker-input') as HTMLInputElement).addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const input = this.el('bunker-input') as HTMLInputElement;
        const url = input.value.trim();
        if (!url) return;
        this.setBunkerStatus('Connecting...');
        this.onBunkerLogin(url);
      }
    });

    // Copy connect URI
    this.el('bunker-uri-copy').addEventListener('click', () => {
      const text = this.el('bunker-uri-text').textContent || '';
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          (this.el('bunker-uri-copy') as HTMLElement).textContent = 'Copied!';
          setTimeout(() => { (this.el('bunker-uri-copy') as HTMLElement).textContent = 'Copy'; }, 2000);
        }).catch(() => {});
      }
    });

    // nsec toggle
    this.el('nsec-toggle').addEventListener('click', () => {
      this.el('nsec-form').classList.toggle('hidden');
    });
    this.el('nsec-accept').addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      if (checked) this.el('nsec-input-wrap').classList.remove('hidden');
      else this.el('nsec-input-wrap').classList.add('hidden');
    });
    this.el('nsec-submit').addEventListener('click', () => {
      const input = this.el('nsec-input') as HTMLInputElement;
      const nsec = input.value.trim();
      input.value = '';
      if (!nsec) return;
      this.setStatus('Logging in...');
      this.onNsecLogin(nsec);
    });

    // Guest
    this.el('login-guest').addEventListener('click', () => {
      this.onGuestLogin();
    });
  }

  /** Show the nostrconnect:// URI for copying */
  showConnectUri(uri: string): void {
    const display = this.el('bunker-uri-display');
    const text = this.el('bunker-uri-text');
    if (display && text) {
      text.textContent = uri;
      display.classList.remove('hidden');
    }
  }

  /** Get the QR container element */
  getQRContainer(): HTMLElement | null {
    return this.container.querySelector('#bunker-qr');
  }

  /** Set the status text inside the bunker view */
  setBunkerStatus(msg: string, isError = false): void {
    const el = this.container.querySelector('#bunker-status') as HTMLElement;
    if (el) {
      el.textContent = msg;
      el.style.color = isError ? P.red : P.teal;
    }
  }

  setStatus(msg: string, isError = false): void {
    const el = this.el('login-status');
    el.textContent = msg;
    el.className = isError ? 'login-status error' : 'login-status';
  }

  destroy(): void {
    this.container.remove();
  }

  private el(id: string): HTMLElement {
    return this.container.querySelector(`#${id}`)!;
  }
}
/**
 * WalletInfo.ts — Documentation modal for the in-game wallet
 *
 * Honest explanation of what kind of wallet this is, what it isn't,
 * and how to use it responsibly. Opened via the ⓘ button in WalletPanel.
 */

const MODAL_ID = 'wallet-info';

export class WalletInfo {
  private static escHandler: ((e: KeyboardEvent) => void) | null = null;

  static isOpen(): boolean { return !!document.getElementById(MODAL_ID); }

  static open(): void {
    WalletInfo.destroy();
    WalletInfo.injectStyles();

    const backdrop = document.createElement('div');
    backdrop.id = 'wi-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:4099;background:rgba(0,0,0,0.55);backdrop-filter:blur(3px);';
    backdrop.addEventListener('click', () => WalletInfo.destroy());
    backdrop.addEventListener('touchend', () => WalletInfo.destroy(), { passive: true });
    document.body.appendChild(backdrop);

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="wi-header">
        <div class="wi-title">About your wallet</div>
        <button id="wi-close" class="wi-close" aria-label="Close">×</button>
      </div>
      <div class="wi-body">
        <section>
          <h3>How it works</h3>
          <p>Your wallet is generated automatically from your Nostr private key (nsec). The same nsec always produces the same wallet, so you don't need a separate backup — as long as you keep your Nostr key, you keep your wallet.</p>
          <p>It's powered by the <strong>Spark protocol</strong>, a Lightning-compatible Bitcoin layer-2.</p>
        </section>

        <section>
          <h3>No separate seed phrase</h3>
          <p>Your wallet is bound to your Nostr key — there's nothing extra to back up. Keep your nsec safe and your wallet is safe. If you lose access to your nsec, you lose access to this wallet.</p>
        </section>

        <section>
          <h3>Self-custodial — with nuance</h3>
          <p>Your sats are <strong>not held by Nostr District</strong>. No one in this app can move your funds, freeze your account, or see your balance.</p>
          <p>However, this wallet is <strong>not the same as cold storage or a hardware wallet</strong>. The Spark protocol relies on a network of operators to keep funds liquid and accessible. Your keys stay yours, but day-to-day access assumes the Spark network is online.</p>
          <p>Think of it like cash in your pocket — convenient and yours, but not the place for your life savings.</p>
        </section>

        <section>
          <h3>Recommended use</h3>
          <ul>
            <li>Receive and send <strong>zaps</strong></li>
            <li>Buy items in the <strong>shop</strong></li>
            <li>Tip other players</li>
            <li>Hold small, everyday amounts</li>
          </ul>
          <p class="wi-warn">For larger amounts, withdraw to a dedicated wallet or cold storage.</p>
        </section>

        <section>
          <h3>Where in-game zaps go</h3>
          <p>When someone zaps you <strong>inside Nostr District</strong>, sats land in this in-game wallet — even if you have a different Lightning address on your Nostr profile.</p>
          <p>Zaps from <strong>other Nostr clients</strong> (Damus, Amethyst, Primal, etc.) still go to whatever's set in your Nostr profile (<code>kind:0</code>). To receive external zaps here too, set this wallet as your Lightning address on your profile.</p>
        </section>

        <section>
          <h3>Security</h3>
          <p>Your wallet is only as secure as your nsec. Anyone with your nsec can derive this wallet — encrypted local storage or not. Protect your Nostr key.</p>
          <ul>
            <li>If you lose your nsec, you lose this wallet — there is no separate recovery phrase to write down.</li>
            <li><strong>nsec / passkey login:</strong> your wallet mnemonic is stored encrypted in your browser, keyed to your Nostr private key. This protects against someone reading your local browser data without also having your nsec.</li>
            <li><strong>Browser extension / bunker login:</strong> your mnemonic is stored unencrypted, because the app never has access to your private key to use as an encryption key. Anyone with access to your browser's local data can read it.</li>
            <li>Either way: treat this as a hot wallet. Fine for in-game amounts, not for savings.</li>
          </ul>
        </section>

        <section>
          <h3>Wallet not loading?</h3>
          <p>If your balance shows <code>0</code> or never finishes loading, the wallet's connection to the Spark network is likely being blocked. Common causes:</p>
          <ul>
            <li><strong>VPN</strong> — many VPNs block the Lightning service or rewrite headers in ways that fail authentication. Try disabling it.</li>
            <li><strong>Ad blocker / privacy extension</strong> — some block <code>lightspark.com</code> by default.</li>
            <li><strong>Corporate or school network</strong> — firewalls often block crypto/Lightning endpoints.</li>
            <li><strong>Lightspark outage</strong> — rare, but possible. Try again in a few minutes.</li>
          </ul>
          <p class="wi-warn">If you see CORS or 403 errors in the browser console mentioning <code>spark.lightspark.com</code>, this is almost always one of the above — not lost sats. Your balance is safe; the app just can't reach the network to display it.</p>
        </section>

        <section>
          <h3>Learn more</h3>
          <p>
            <a href="https://breez.technology/sdk" target="_blank" rel="noopener noreferrer">Breez SDK</a>
          </p>
        </section>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#wi-close')?.addEventListener('click', () => WalletInfo.destroy());

    WalletInfo.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); WalletInfo.destroy(); }
    };
    window.addEventListener('keydown', WalletInfo.escHandler);
  }

  static destroy(): void {
    document.getElementById(MODAL_ID)?.remove();
    document.getElementById('wi-backdrop')?.remove();
    if (WalletInfo.escHandler) {
      window.removeEventListener('keydown', WalletInfo.escHandler);
      WalletInfo.escHandler = null;
    }
  }

  private static injectStyles(): void {
    if (document.getElementById('wallet-info-styles')) return;
    const style = document.createElement('style');
    style.id = 'wallet-info-styles';
    style.textContent = `
      #${MODAL_ID} {
        position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:4100;
        background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
        border:1px solid color-mix(in srgb,var(--nd-accent) 35%,transparent);
        border-radius:12px;
        font-family:'Courier New',monospace;
        box-shadow:0 12px 40px rgba(0,0,0,0.7), 0 0 24px color-mix(in srgb,var(--nd-accent) 12%,transparent);
        width:min(480px,94vw);max-height:88dvh;
        display:flex;flex-direction:column;overflow:hidden;
      }
      #${MODAL_ID} .wi-header {
        display:flex;align-items:center;gap:8px;
        padding:14px 18px 12px;flex-shrink:0;
        border-bottom:1px solid color-mix(in srgb,var(--nd-subtext) 12%,transparent);
      }
      #${MODAL_ID} .wi-title {
        flex:1;color:var(--nd-text);font-size:13px;font-weight:bold;letter-spacing:0.1em;
      }
      #${MODAL_ID} .wi-close {
        background:none;border:none;color:var(--nd-subtext);cursor:pointer;
        font-size:22px;line-height:1;width:34px;height:34px;padding:0;
        display:inline-flex;align-items:center;justify-content:center;
        opacity:0.55;transition:opacity 0.15s;
      }
      #${MODAL_ID} .wi-close:hover { opacity:1; }
      #${MODAL_ID} .wi-body {
        padding:14px 18px 18px;overflow-y:auto;flex:1;min-height:0;
        color:var(--nd-text);font-size:12px;line-height:1.65;
      }
      #${MODAL_ID} section { margin-bottom:18px; }
      #${MODAL_ID} section:last-child { margin-bottom:0; }
      #${MODAL_ID} h3 {
        color:var(--nd-accent);font-size:11px;letter-spacing:0.12em;
        margin:0 0 6px;font-weight:bold;text-transform:uppercase;
      }
      #${MODAL_ID} p {
        margin:0 0 8px;color:var(--nd-text);
      }
      #${MODAL_ID} p:last-child { margin-bottom:0; }
      #${MODAL_ID} ul {
        margin:0 0 8px;padding-left:18px;color:var(--nd-text);
      }
      #${MODAL_ID} li { margin-bottom:3px; }
      #${MODAL_ID} strong { color:var(--nd-accent);font-weight:bold; }
      #${MODAL_ID} code {
        font-family:'Courier New',monospace;font-size:11px;
        background:color-mix(in srgb,var(--nd-subtext) 12%,transparent);
        padding:1px 5px;border-radius:3px;color:var(--nd-text);
      }
      #${MODAL_ID} .wi-warn {
        background:color-mix(in srgb,var(--nd-accent) 10%,transparent);
        border:1px solid color-mix(in srgb,var(--nd-accent) 30%,transparent);
        border-radius:6px;padding:8px 10px;margin-top:8px;
        font-size:11px;color:var(--nd-accent);
      }
      #${MODAL_ID} a {
        color:var(--nd-accent);text-decoration:none;
        border-bottom:1px dotted color-mix(in srgb,var(--nd-accent) 45%,transparent);
      }
      #${MODAL_ID} a:hover {
        border-bottom-color:var(--nd-accent);
      }
      #${MODAL_ID} .wi-body::-webkit-scrollbar { width:6px; }
      #${MODAL_ID} .wi-body::-webkit-scrollbar-track { background:transparent; }
      #${MODAL_ID} .wi-body::-webkit-scrollbar-thumb {
        background:color-mix(in srgb,var(--nd-accent) 35%,transparent);
        border-radius:3px;
      }
    `;
    document.head.appendChild(style);
  }
}

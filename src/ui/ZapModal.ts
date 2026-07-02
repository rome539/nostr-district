/**
 * ZapModal.ts — ⚡ Zap a player
 *
 * Shows amount presets + comment, pays via WebLN → NWC → QR fallback.
 */

import { zapUser, fetchKind0 } from '../nostr/zapService';
import { t as ti18n } from '../i18n/i18n';
import { authStore } from '../stores/authStore';
import { sendChat } from '../nostr/presenceService';
import { SoundEngine } from '../audio/SoundEngine';
import { getSparkBalance, getSparkSdk } from '../nostr/sparkService';
import { boltIcon } from './icons';
import { attachEmojiAutocomplete } from './emojiAutocomplete';
// @ts-ignore — JS module, no types
import { renderQR } from '../../nip46-bunker.js';

const PRESETS = [21, 100, 500, 1000, 5000];
const MODAL_ID = 'zap-modal';

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

// ── Modal ────────────────────────────────────────────────────────────────────

export class ZapModal {
  private static el: HTMLElement | null = null;
  private static closeHandler: ((e: PointerEvent) => void) | null = null;
  private static escHandler: ((e: KeyboardEvent) => void) | null = null;

  static show(recipientPubkey: string, displayName: string): void {
    ZapModal.destroy();

    const auth = authStore.getState();
    const canZap = !!auth.pubkey && !auth.isGuest;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:4000;
      background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
      border:1px solid color-mix(in srgb,var(--nd-dpurp) 33%,transparent);
      border-radius:10px;padding:22px 24px 20px;
      font-family:'Courier New',monospace;
      box-shadow:0 8px 30px rgba(0,0,0,0.75);
      width:min(380px,96vw);max-height:90dvh;overflow-y:auto;
    `;

    modal.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
        <span style="color:var(--nd-accent);display:inline-flex;align-items:center;">${boltIcon(20)}</span>
        <div style="flex:1;">
          <div style="color:var(--nd-text);font-size:14px;font-weight:bold;">${ti18n('zap.title', { name: esc(displayName) })}</div>
          <div id="zap-lnaddr" style="color:var(--nd-subtext);font-size:10px;opacity:0.6;">${ti18n('zap.subtitle')}</div>
        </div>
        <button id="zap-close" style="background:none;border:none;color:var(--nd-subtext);cursor:pointer;font-size:20px;line-height:1;padding:0;opacity:0.6;">×</button>
      </div>

      ${!canZap ? `
        <div style="color:var(--nd-subtext);font-size:12px;text-align:center;padding:16px 0;opacity:0.6;">
          ${ti18n('zap.login_required')}
        </div>
      ` : `
        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="color:var(--nd-subtext);font-size:10px;letter-spacing:0.08em;">${ti18n('zap.amount_label')}</div>
            <div id="zap-balance" style="color:var(--nd-subtext);font-size:9px;opacity:0.7;"></div>
          </div>
          <div id="zap-presets" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
            ${PRESETS.map(s => `
              <button class="zap-preset" data-sats="${s}" style="
                padding:6px 12px;border-radius:5px;cursor:pointer;
                font-family:'Courier New',monospace;font-size:11px;
                background:color-mix(in srgb,var(--nd-dpurp) 16%,transparent);
                border:1px solid color-mix(in srgb,var(--nd-dpurp) 35%,transparent);
                color:var(--nd-subtext);transition:all 0.12s;
              ">${s.toLocaleString()}</button>
            `).join('')}
          </div>
          <input id="zap-amount" type="number" min="1" placeholder="${ti18n('zap.custom_amount')}" style="
            width:100%;box-sizing:border-box;
            background:color-mix(in srgb,var(--nd-dpurp) 14%,transparent);
            border:1px solid color-mix(in srgb,var(--nd-dpurp) 35%,transparent);
            border-radius:5px;color:var(--nd-text);
            font-family:'Courier New',monospace;font-size:12px;
            padding:8px 10px;outline:none;margin-bottom:10px;
          ">
          <input id="zap-comment" type="text" maxlength="140" placeholder="${ti18n('zap.message_placeholder')}" style="
            width:100%;box-sizing:border-box;
            background:color-mix(in srgb,var(--nd-dpurp) 14%,transparent);
            border:1px solid color-mix(in srgb,var(--nd-dpurp) 35%,transparent);
            border-radius:5px;color:var(--nd-text);
            font-family:'Courier New',monospace;font-size:12px;
            padding:8px 10px;outline:none;
          ">
          <div style="font-size:9px;color:var(--nd-subtext);margin-top:8px;opacity:0.7;line-height:1.4;">
            ${ti18n('zap.fee_note')}
          </div>
        </div>

        <div id="zap-status" style="color:var(--nd-subtext);font-size:11px;text-align:center;min-height:16px;margin-bottom:10px;"></div>

        <div id="zap-invoice-section" style="display:none;margin-bottom:12px;flex-direction:column;align-items:center;gap:10px;">
          <div id="zap-invoice-qr" style="
            background:#fff;border-radius:10px;padding:10px;
            display:flex;align-items:center;justify-content:center;
            min-width:200px;min-height:200px;
          "><span style="color:#888;font-size:12px;">Generating…</span></div>
          <div style="display:flex;gap:8px;width:100%;">
            <button id="zap-copy-invoice" style="
              flex:1;padding:8px;border-radius:6px;cursor:pointer;
              font-family:'Courier New',monospace;font-size:11px;font-weight:bold;
              background:color-mix(in srgb,#f0b040 15%,transparent);
              border:1px solid color-mix(in srgb,#f0b040 40%,transparent);
              color:#f0b040;
            ">${ti18n('zap.copy_invoice')}</button>
            <button id="zap-open-wallet" style="
              flex:1;padding:8px;border-radius:6px;cursor:pointer;
              font-family:'Courier New',monospace;font-size:11px;font-weight:bold;
              background:color-mix(in srgb,var(--nd-dpurp) 18%,transparent);
              border:1px solid color-mix(in srgb,var(--nd-dpurp) 35%,transparent);
              color:var(--nd-subtext);
            ">${ti18n('zap.open_wallet')}</button>
          </div>
        </div>

        <button id="zap-send" style="
          width:100%;padding:10px;border-radius:6px;cursor:pointer;
          font-family:'Courier New',monospace;font-size:13px;font-weight:bold;
          background:color-mix(in srgb,var(--nd-accent) 18%,transparent);
          border:1px solid color-mix(in srgb,var(--nd-accent) 44%,transparent);
          color:var(--nd-accent);transition:all 0.12s;
        "><span style="display:inline-flex;align-items:center;gap:6px;">${boltIcon(14)} ${ti18n('zap.send')}</span></button>
      `}
    `;

    modal.addEventListener('pointerdown', e => e.stopPropagation());
    document.body.appendChild(modal);
    ZapModal.el = modal;

    ZapModal.escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); ZapModal.destroy(); } };
    document.addEventListener('keydown', ZapModal.escHandler);

    modal.querySelector('#zap-close')?.addEventListener('click', () => ZapModal.destroy());

    // Show in-game wallet balance if available
    if (getSparkSdk()) {
      const balEl = modal.querySelector('#zap-balance') as HTMLElement | null;
      if (balEl) {
        getSparkBalance().then(bal => {
          if (bal !== null) balEl.textContent = `wallet: ${bal.toLocaleString()} sats`;
        }).catch(() => {});
      }
    }

    // Fetch lightning address and show it in the subtitle (click to copy)
    fetchKind0(recipientPubkey).then(profile => {
      const lnAddrEl = modal.querySelector('#zap-lnaddr') as HTMLElement;
      if (!lnAddrEl) return;
      const addr = profile?.lud16 || profile?.lud06;
      if (addr) {
        lnAddrEl.textContent = addr;
        lnAddrEl.style.cursor = 'pointer';
        lnAddrEl.title = 'Click to copy';
        lnAddrEl.addEventListener('click', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(addr).then(() => {
            lnAddrEl.textContent = 'copied!';
            setTimeout(() => { lnAddrEl.textContent = addr; }, 1500);
          });
        });
      } else {
        lnAddrEl.textContent = 'Send a lightning tip';
      }
    });

    if (!canZap) {
      ZapModal.closeHandler = (e: PointerEvent) => {
        if (!modal.contains(e.target as Node)) ZapModal.destroy();
      };
      setTimeout(() => document.addEventListener('pointerdown', ZapModal.closeHandler!), 100);
      return;
    }

    // Amount input — focus style
    const amountInput = modal.querySelector('#zap-amount') as HTMLInputElement;
    const commentInput = modal.querySelector('#zap-comment') as HTMLInputElement;
    attachEmojiAutocomplete(commentInput);
    [amountInput, commentInput].forEach(inp => {
      inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') ZapModal.destroy(); });
      inp.addEventListener('focus', () => inp.style.borderColor = 'color-mix(in srgb,var(--nd-accent) 55%,transparent)');
      inp.addEventListener('blur',  () => inp.style.borderColor = 'color-mix(in srgb,var(--nd-dpurp) 35%,transparent)');
    });

    // Preset buttons
    let selectedSats = 0;
    const updatePresets = (activeSats: number) => {
      selectedSats = activeSats;
      modal.querySelectorAll('.zap-preset').forEach(btn => {
        const s = parseInt((btn as HTMLElement).dataset.sats || '0', 10);
        const on = s === activeSats;
        (btn as HTMLElement).style.background = on
          ? 'color-mix(in srgb,var(--nd-accent) 22%,transparent)'
          : 'color-mix(in srgb,var(--nd-dpurp) 16%,transparent)';
        (btn as HTMLElement).style.borderColor = on
          ? 'color-mix(in srgb,var(--nd-accent) 55%,transparent)'
          : 'color-mix(in srgb,var(--nd-dpurp) 35%,transparent)';
        (btn as HTMLElement).style.color = on ? 'var(--nd-accent)' : 'var(--nd-subtext)';
      });
      if (!PRESETS.includes(activeSats)) {
        amountInput.value = activeSats > 0 ? String(activeSats) : '';
      } else {
        amountInput.value = '';
      }
    };

    modal.querySelectorAll('.zap-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = parseInt((btn as HTMLElement).dataset.sats || '0', 10);
        updatePresets(s);
      });
    });

    amountInput.addEventListener('input', () => {
      const v = parseInt(amountInput.value, 10);
      if (v > 0) { selectedSats = v; updatePresets(v); }
    });

    // Send button
    const sendBtn = modal.querySelector('#zap-send') as HTMLButtonElement;
    const statusEl = modal.querySelector('#zap-status') as HTMLElement;
    const invoiceSection = modal.querySelector('#zap-invoice-section') as HTMLElement;
    const openWalletBtn = modal.querySelector('#zap-open-wallet') as HTMLButtonElement;
    const copyBtn = modal.querySelector('#zap-copy-invoice') as HTMLButtonElement;

    let currentInvoice = '';

    openWalletBtn?.addEventListener('click', () => {
      if (!currentInvoice) return;
      // _blank avoids navigating away from the game when the OS lightning
      // handler doesn't intercept (matches MarketInvoice's behavior).
      window.open(`lightning:${currentInvoice}`, '_blank');
    });

    copyBtn?.addEventListener('click', () => {
      if (!currentInvoice) return;
      navigator.clipboard.writeText(currentInvoice).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy Invoice'; }, 2000);
      });
    });

    sendBtn.addEventListener('click', async () => {
      const sats = selectedSats || parseInt(amountInput.value, 10) || 0;
      if (sats < 1) { statusEl.textContent = 'Enter an amount'; statusEl.style.color = '#f0b040'; return; }

      sendBtn.disabled = true;
      sendBtn.style.opacity = '0.5';
      invoiceSection.style.display = 'none';
      statusEl.style.color = 'var(--nd-subtext)';

      const result = await zapUser(
        recipientPubkey,
        sats,
        commentInput.value.trim(),
        (msg) => { statusEl.textContent = msg; },
      );

      if (result.status === 'paid') {
        ZapModal.destroy();
        SoundEngine.get().zapSound();
        // Private two-party lightning strike — drawn locally, only if the
        // recipient is standing in the sender's current scene.
        window.dispatchEvent(new CustomEvent('nd-zap-bolt', { detail: { pubkey: recipientPubkey, direction: 'out' } }));
        sendChat(`/zap:${sats}`);
        return;
      }

      if (result.status === 'invoice' && result.invoice) {
        currentInvoice = result.invoice;
        statusEl.textContent = 'Scan QR or use your wallet — payment will settle on its own';
        statusEl.style.color = 'var(--nd-subtext)';
        invoiceSection.style.display = 'flex';
        sendBtn.style.display = 'none';
        const qrWrap = modal.querySelector('#zap-invoice-qr') as HTMLElement;
        if (qrWrap) {
          try { renderQR(qrWrap, result.invoice, { size: 220 }); }
          catch {
            qrWrap.innerHTML = `<span style="color:#888;font-size:11px;word-break:break-all;padding:8px;">${result.invoice.slice(0, 40)}…</span>`;
          }
        }
        return;
      }

      // Error
      statusEl.textContent = result.error || 'Something went wrong';
      statusEl.style.color = '#f0b040';
      sendBtn.disabled = false;
      sendBtn.style.opacity = '1';
    });

    ZapModal.closeHandler = (e: PointerEvent) => {
      if (!modal.contains(e.target as Node)) ZapModal.destroy();
    };
    setTimeout(() => document.addEventListener('pointerdown', ZapModal.closeHandler!), 100);
  }

  static destroy(): void {
    ZapModal.el?.remove();
    ZapModal.el = null;
    if (ZapModal.closeHandler) {
      document.removeEventListener('pointerdown', ZapModal.closeHandler);
      ZapModal.closeHandler = null;
    }
    if (ZapModal.escHandler) {
      document.removeEventListener('keydown', ZapModal.escHandler);
      ZapModal.escHandler = null;
    }
  }
}

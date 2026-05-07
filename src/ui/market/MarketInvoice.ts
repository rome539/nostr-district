/**
 * MarketInvoice.ts — Lightning invoice modal (QR + polling + zap receipt)
 *
 * showInvoiceModal() creates the overlay, handles payment confirmation via
 * LNURL verify polling and Nostr zap receipts, then calls onGrant() on success.
 *
 * Pollers intentionally survive modal close — the user can dismiss the QR and
 * payment will still be detected and granted in the background.
 */

import { MarketItem } from '../../stores/marketStore';
import { watchForPurchaseReceipt } from '../../nostr/zapService';
// @ts-ignore — JS module, no types
import { renderQR } from '../../../nip46-bunker.js';

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

let _pollTimer:       number = 0;
let _cleanupReceipt:  (() => void) | null = null;

function _cancelPending(): void {
  clearInterval(_pollTimer);
  _cleanupReceipt?.();
  _pollTimer      = 0;
  _cleanupReceipt = null;
}

export function showInvoiceModal(
  invoice:      string,
  itemName:     string,
  sats:         number,
  verifyUrl:    string | undefined,
  nostrPubkey:  string | undefined,
  zapEventId:   string | undefined,
  item:         MarketItem,
  onGrant:      () => void,
): void {
  document.getElementById('mp-invoice-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'mp-invoice-modal';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:5000;
    background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);
    display:flex;align-items:center;justify-content:center;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
    border:1px solid color-mix(in srgb,var(--nd-amber,#f0b040) 33%,transparent);
    border-radius:12px;padding:20px;
    font-family:'Courier New',monospace;
    box-shadow:0 8px 40px rgba(0,0,0,0.9);
    width:min(340px,92vw);display:flex;flex-direction:column;align-items:center;gap:14px;
  `;

  modal.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
      <div style="color:var(--nd-text);font-size:13px;font-weight:bold;letter-spacing:0.06em;">PAY INVOICE</div>
      <button id="mp-inv-close" style="background:none;border:none;color:var(--nd-subtext);cursor:pointer;font-size:20px;line-height:1;padding:0;opacity:0.6;">×</button>
    </div>
    <div style="color:var(--nd-subtext);font-size:10px;text-align:center;line-height:1.5;">
      ${esc(itemName)} &mdash; ${sats.toLocaleString()} sats
    </div>
    <div id="mp-inv-qr" style="
      background:#fff;border-radius:10px;padding:10px;
      display:flex;align-items:center;justify-content:center;
      min-width:200px;min-height:200px;
    ">
      <span style="color:#888;font-size:12px;">Generating…</span>
    </div>
    <div style="display:flex;gap:8px;width:100%;">
      <button id="mp-inv-copy" style="
        flex:1;padding:8px;border-radius:6px;cursor:pointer;
        font-family:'Courier New',monospace;font-size:11px;font-weight:bold;
        background:color-mix(in srgb,var(--nd-amber,#f0b040) 15%,transparent);
        border:1px solid color-mix(in srgb,var(--nd-amber,#f0b040) 40%,transparent);
        color:var(--nd-amber,#f0b040);
      ">Copy Invoice</button>
      <button id="mp-inv-open" style="
        flex:1;padding:8px;border-radius:6px;cursor:pointer;
        font-family:'Courier New',monospace;font-size:11px;font-weight:bold;
        background:color-mix(in srgb,var(--nd-dpurp) 18%,transparent);
        border:1px solid color-mix(in srgb,var(--nd-dpurp) 35%,transparent);
        color:var(--nd-subtext);
      ">Open Wallet</button>
    </div>
    <div id="mp-inv-status" style="font-size:9px;color:var(--nd-subtext);opacity:0.5;text-align:center;min-height:14px;">
      ${(verifyUrl || zapEventId) ? 'Waiting for payment confirmation…' : 'Scan QR or copy invoice to pay'}
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const qrWrap = modal.querySelector('#mp-inv-qr') as HTMLElement;
  try {
    renderQR(qrWrap, invoice, { size: 220 });
  } catch {
    qrWrap.innerHTML = `<span style="color:#888;font-size:11px;word-break:break-all;padding:8px;">${invoice.slice(0, 40)}…</span>`;
  }

  modal.querySelector('#mp-inv-copy')!.addEventListener('click', () => {
    navigator.clipboard.writeText(invoice).catch(() => {});
    const btn = modal.querySelector('#mp-inv-copy') as HTMLButtonElement;
    btn.textContent = 'Copied!'; btn.disabled = true;
  });

  modal.querySelector('#mp-inv-open')!.addEventListener('click', () => {
    window.open(`lightning:${invoice}`, '_blank');
  });

  // Cancel any prior pending watchers before starting new ones
  _cancelPending();

  const grantItem = () => {
    _cancelPending();
    overlay.remove();
    onGrant();
  };

  const invoiceEscHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); }
  };
  window.addEventListener('keydown', invoiceEscHandler, true);

  // Closing only dismisses the UI — pollers keep running so payment still settles.
  const close = () => {
    window.removeEventListener('keydown', invoiceEscHandler, true);
    overlay.remove();
  };

  modal.querySelector('#mp-inv-close')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Method 1: LNURL verify URL polling
  if (verifyUrl) {
    const poll = async () => {
      try {
        const r    = await fetch(verifyUrl);
        const data = await r.json() as { settled: boolean };
        if (data.settled) grantItem();
      } catch { /* keep polling */ }
    };
    poll();
    _pollTimer = window.setInterval(poll, 3000);
  }

  // Method 2: Nostr zap receipt (works with WoS + any NIP-57 wallet)
  if (nostrPubkey && zapEventId) {
    _cleanupReceipt = watchForPurchaseReceipt(nostrPubkey, zapEventId, () => grantItem());
  }
}

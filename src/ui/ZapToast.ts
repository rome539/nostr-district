/**
 * ZapToast.ts — Stacking toast notifications for zap events
 *
 * Toasts stack vertically and never overlap.
 * Each auto-dismisses after 5s; multiple zaps queue safely.
 */

import { SoundEngine } from '../audio/SoundEngine';
import { boltIcon } from './icons';
import { t as ti18n } from '../i18n/i18n';

const CONTAINER_ID = 'zap-toast-container';
const TOAST_DURATION = 5000;

// Recent zap-toast registry (incoming only, amount → timestamp ms).
// Used by sparkService to suppress its generic "Lightning" toast when a
// named Nostr zap-receipt toast has already shown for the same payment.
const _recentIncoming = new Map<number, number>();
// Wide enough to cover slow Spark SDK paymentSucceeded events that lag the
// Nostr zap-receipt arrival by many seconds.
const RECENT_WINDOW_MS = 30000;

export function recentNostrZapMatches(amountSats: number, withinMs: number = RECENT_WINDOW_MS): boolean {
  const ts = _recentIncoming.get(amountSats);
  return !!ts && (Date.now() - ts) < withinMs;
}

function getContainer(): HTMLElement {
  let el = document.getElementById(CONTAINER_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = CONTAINER_ID;
    el.style.cssText = `
      position:fixed;bottom:max(80px,calc(60px + env(safe-area-inset-bottom,0px)));left:max(18px,env(safe-area-inset-left,0px));z-index:5000;
      display:flex;flex-direction:column-reverse;gap:8px;
      pointer-events:none;
    `;
    document.body.appendChild(el);
  }
  return el;
}

export function showZapToast(senderName: string, amountSats: number, comment?: string, direction: 'incoming' | 'outgoing' = 'incoming'): void {
  // Track incoming named zaps so the Spark "Lightning" toast can dedupe.
  // We treat anything labelled "Lightning" as the generic Spark toast — don't record it.
  if (direction === 'incoming' && senderName !== 'Lightning') {
    _recentIncoming.set(amountSats, Date.now());
    setTimeout(() => {
      const t = _recentIncoming.get(amountSats);
      if (t && (Date.now() - t) >= RECENT_WINDOW_MS) _recentIncoming.delete(amountSats);
    }, RECENT_WINDOW_MS + 1000);
  }

  SoundEngine.get().zapSound();
  const container = getContainer();

  const toast = document.createElement('div');
  toast.style.cssText = `
    background:linear-gradient(135deg,#1a1008 0%,#0e0a04 100%);
    border:1px solid rgba(240,176,64,0.45);
    border-radius:8px;padding:10px 14px;
    font-family:'Courier New',monospace;
    box-shadow:0 4px 18px rgba(0,0,0,0.7);
    min-width:220px;max-width:300px;
    pointer-events:auto;
    opacity:0;transform:translateX(-16px);
    transition:opacity 0.2s ease,transform 0.2s ease;
  `;

  const sats = amountSats.toLocaleString();
  const icon = `<span style="color:#f0b040;display:inline-flex;vertical-align:middle;margin-right:4px;">${boltIcon(13)}</span>`;
  const label = direction === 'incoming'
    ? `${icon}${ti18n('zap_toast.incoming', { sender: esc(senderName), sats })}`
    : (senderName === 'Lightning' || !senderName
        ? `${icon}${ti18n('zap_toast.sent_lightning', { sats })}`
        : `${icon}${ti18n('zap_toast.sent_to', { recipient: esc(senderName), sats })}`);
  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      <div style="flex:1;min-width:0;">
        <div style="color:#f0b040;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</div>
        ${comment ? `<div style="color:rgba(240,176,64,0.65);font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">"${esc(comment)}"</div>` : ''}
      </div>
    </div>
  `;

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    });
  });

  // Auto-dismiss
  const dismiss = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-16px)';
    setTimeout(() => toast.remove(), 250);
  };

  const timer = setTimeout(dismiss, TOAST_DURATION);
  toast.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
}

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

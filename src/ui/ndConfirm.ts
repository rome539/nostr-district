/**
 * ndConfirm.ts — themed confirm dialog used in place of native window.confirm.
 * Returns a Promise that resolves true on confirm, false on cancel/esc/backdrop.
 */

export interface NdConfirmOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the confirm button uses the destructive (red) style. */
  destructive?: boolean;
}

const MODAL_ID = 'nd-confirm';

let _esc: ((e: KeyboardEvent) => void) | null = null;

function injectStyles(): void {
  if (document.getElementById('nd-confirm-styles')) return;
  const style = document.createElement('style');
  style.id = 'nd-confirm-styles';
  style.textContent = `
    #${MODAL_ID}-backdrop {
      position:fixed;inset:0;z-index:5099;
      background:rgba(0,0,0,0.55);
      backdrop-filter:blur(3px);
    }
    #${MODAL_ID} {
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:5100;
      background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
      border:1px solid color-mix(in srgb,var(--nd-accent) 35%,transparent);
      border-radius:10px;padding:18px 20px 16px;
      font-family:'Courier New',monospace;
      box-shadow:0 12px 40px rgba(0,0,0,0.7);
      width:min(380px,94vw);
      animation:nd-confirm-in 0.16s ease-out;
    }
    @keyframes nd-confirm-in {
      from { opacity:0;transform:translate(-50%,-48%) scale(0.96); }
      to   { opacity:1;transform:translate(-50%,-50%) scale(1); }
    }
    #${MODAL_ID} .ndc-title {
      color:var(--nd-accent);font-size:11px;font-weight:bold;letter-spacing:0.12em;
      text-transform:uppercase;margin-bottom:10px;
    }
    #${MODAL_ID} .ndc-message {
      color:var(--nd-text);font-size:13px;line-height:1.55;margin-bottom:16px;
    }
    #${MODAL_ID} .ndc-buttons {
      display:flex;gap:8px;justify-content:flex-end;
    }
    #${MODAL_ID} button {
      min-height:36px;padding:8px 16px;cursor:pointer;border-radius:6px;
      font-family:'Courier New',monospace;font-size:11px;font-weight:bold;letter-spacing:0.08em;
      transition:all 0.15s;
    }
    #${MODAL_ID} .ndc-cancel {
      background:color-mix(in srgb,var(--nd-subtext) 8%,transparent);
      border:1px solid color-mix(in srgb,var(--nd-subtext) 28%,transparent);
      color:var(--nd-subtext);
    }
    #${MODAL_ID} .ndc-cancel:hover {
      background:color-mix(in srgb,var(--nd-subtext) 16%,transparent);
      color:var(--nd-text);
    }
    #${MODAL_ID} .ndc-ok {
      background:color-mix(in srgb,var(--nd-accent) 22%,transparent);
      border:1px solid color-mix(in srgb,var(--nd-accent) 50%,transparent);
      color:var(--nd-accent);
    }
    #${MODAL_ID} .ndc-ok:hover {
      background:color-mix(in srgb,var(--nd-accent) 32%,transparent);
      border-color:var(--nd-accent);
      box-shadow:0 0 12px color-mix(in srgb,var(--nd-accent) 25%,transparent);
    }
    #${MODAL_ID} .ndc-ok-destructive {
      background:color-mix(in srgb,#ff5555 18%,transparent);
      border:1px solid color-mix(in srgb,#ff5555 45%,transparent);
      color:#ff7777;
    }
    #${MODAL_ID} .ndc-ok-destructive:hover {
      background:color-mix(in srgb,#ff5555 30%,transparent);
      border-color:#ff7777;
      box-shadow:0 0 12px rgba(255,85,85,0.25);
    }
  `;
  document.head.appendChild(style);
}

function teardown(): void {
  document.getElementById(MODAL_ID)?.remove();
  document.getElementById(`${MODAL_ID}-backdrop`)?.remove();
  if (_esc) { window.removeEventListener('keydown', _esc); _esc = null; }
}

export function ndConfirm(opts: NdConfirmOptions): Promise<boolean> {
  // Tear down any open instance so calls don't stack
  teardown();
  injectStyles();

  return new Promise<boolean>(resolve => {
    const settle = (ok: boolean) => { teardown(); resolve(ok); };

    const backdrop = document.createElement('div');
    backdrop.id = `${MODAL_ID}-backdrop`;
    backdrop.addEventListener('click', () => settle(false));
    document.body.appendChild(backdrop);

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const title = opts.title ?? 'Confirm';
    const confirmLabel = opts.confirmLabel ?? 'OK';
    const cancelLabel = opts.cancelLabel ?? 'Cancel';
    const okClass = opts.destructive ? 'ndc-ok ndc-ok-destructive' : 'ndc-ok';
    modal.innerHTML = `
      <div class="ndc-title">${escapeHtml(title)}</div>
      <div class="ndc-message">${escapeHtml(opts.message)}</div>
      <div class="ndc-buttons">
        <button class="ndc-cancel" type="button">${escapeHtml(cancelLabel)}</button>
        <button class="${okClass}" type="button">${escapeHtml(confirmLabel)}</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector<HTMLButtonElement>('.ndc-cancel')!.addEventListener('click', () => settle(false));
    modal.querySelector<HTMLButtonElement>(opts.destructive ? '.ndc-ok-destructive' : '.ndc-ok')!.addEventListener('click', () => settle(true));

    _esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); settle(false); }
      else if (e.key === 'Enter') { e.preventDefault(); settle(true); }
    };
    window.addEventListener('keydown', _esc);

    // Autofocus the confirm button so Enter works as expected
    setTimeout(() => {
      modal.querySelector<HTMLButtonElement>(opts.destructive ? '.ndc-ok-destructive' : '.ndc-ok')?.focus();
    }, 0);
  });
}

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

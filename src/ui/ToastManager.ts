/**
 * ToastManager — listens for `nd-toast` custom events and shows brief overlay toasts.
 * Call ToastManager.init() once. Works independently of any scene.
 */

const TOAST_DURATION = 4000;

export class ToastManager {
  private static container: HTMLElement | null = null;
  private static initialized = false;

  static init(): void {
    if (this.initialized) return;
    this.initialized = true;

    const container = document.createElement('div');
    container.id = 'nd-toast-container';
    container.style.cssText = `
      position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
      display:flex;flex-direction:column;align-items:center;gap:8px;
      z-index:9999;pointer-events:none;
    `;
    document.body.appendChild(container);
    this.container = container;

    window.addEventListener('nd-toast', (e: Event) => {
      const { msg, color } = (e as CustomEvent).detail ?? {};
      if (msg) this.show(msg, color);
    });
  }

  static show(msg: string, color = '#c0a8ff'): void {
    if (!this.container) this.init();

    const toast = document.createElement('div');
    toast.style.cssText = `
      background:rgba(10,10,24,0.92);border:1px solid ${color};
      color:${color};font-family:'Courier New',monospace;font-size:12px;
      padding:8px 16px;border-radius:6px;max-width:360px;text-align:center;
      box-shadow:0 0 16px ${color}44;
      animation:nd-toast-in 0.2s ease;opacity:1;
      transition:opacity 0.4s ease;
    `;
    toast.textContent = msg;

    if (!document.getElementById('nd-toast-style')) {
      const style = document.createElement('style');
      style.id = 'nd-toast-style';
      style.textContent = `@keyframes nd-toast-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`;
      document.head.appendChild(style);
    }

    this.container!.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 400);
    }, TOAST_DURATION);
  }
}

import { sendRoomResponse } from '../../nostr/presenceService';
import { getRoomConfig } from '../../stores/roomStore';
import { P } from '../../config/game.config';
import type { ChatUI } from '../../ui/ChatUI';
import { SoundEngine } from '../../audio/SoundEngine';

export class RoomRequestToast {
  private el: HTMLDivElement | null = null;

  show(requesterPubkey: string, requesterName: string, chatUI: ChatUI): void {
    if (this.el) this.el.remove();
    SoundEngine.get().roomRequest();
    const esc = (s: string) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    this.el = document.createElement('div');
    this.el.style.cssText = `position:fixed;top:20px;right:20px;z-index:3000;background:linear-gradient(180deg,var(--nd-bg) 0%, var(--nd-navy) 100%);border:1px solid color-mix(in srgb,var(--nd-dpurp) 44%, transparent);border-radius:10px;padding:16px 20px;font-family:'Courier New',monospace;box-shadow:0 4px 20px rgba(0,0,0,0.6);max-width:300px;`;
    this.el.innerHTML = `<div style="color:var(--nd-accent);font-size:14px;font-weight:bold;margin-bottom:10px;">Room Request</div><div style="color:var(--nd-text);font-size:13px;margin-bottom:14px;"><strong>${esc(requesterName)}</strong> wants to enter</div><div style="display:flex;gap:8px;"><button id="ta" style="flex:1;padding:8px;background:color-mix(in srgb,var(--nd-accent) 18%, transparent);border:1px solid color-mix(in srgb,var(--nd-accent) 44%, transparent);border-radius:6px;color:var(--nd-accent);font-size:13px;cursor:pointer;font-weight:bold;">Accept</button><button id="td" style="flex:1;padding:8px;background:${P.red}22;border:1px solid ${P.red}44;border-radius:6px;color:${P.red};font-size:13px;cursor:pointer;">Deny</button></div>`;
    document.body.appendChild(this.el);
    this.el.querySelector('#ta')!.addEventListener('click', () => {
      sendRoomResponse(requesterPubkey, true, JSON.stringify(getRoomConfig()));
      this.el?.remove(); this.el = null;
      chatUI.addMessage('system', `Accepted ${requesterName}`, P.teal);
    });
    this.el.querySelector('#td')!.addEventListener('click', () => {
      sendRoomResponse(requesterPubkey, false);
      this.el?.remove(); this.el = null;
    });
    setTimeout(() => {
      if (this.el) { sendRoomResponse(requesterPubkey, false); this.el.remove(); this.el = null; }
    }, 30000);
  }

  destroy(): void {
    if (this.el) { this.el.remove(); this.el = null; }
  }
}

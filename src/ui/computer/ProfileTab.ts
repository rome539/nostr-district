import { P } from '../../config/game.config';
import { authStore } from '../../stores/authStore';
import { publishEvent, signEvent } from '../../nostr/nostrService';
import { getStatus, setStatus } from '../../stores/statusStore';
import { sendStatusUpdate } from '../../nostr/presenceService';
import type { TabCtx } from './types';

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

export class ProfileTab {
  render(body: HTMLElement, ctx: TabCtx): void {
    const state = authStore.getState();
    const profile = state.profile;
    const isGuest = state.loginMethod === 'guest';

    if (isGuest) {
      const currentName = state.displayName || 'guest';
      body.innerHTML = `
        <div style="color:var(--nd-text);font-size:13px;font-weight:bold;margin-bottom:14px;">Display Name</div>
        <div style="margin-bottom:10px;">
          <input id="guest-name" type="text" maxlength="32" value="${esc(currentName)}" style="
            width:100%;padding:8px 10px;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);border-radius:4px;
            color:var(--nd-text);font-family:'Courier New',monospace;font-size:13px;outline:none;box-sizing:border-box;
          "/>
        </div>
        <div style="margin-top:10px;">
          <label style="color:var(--nd-subtext);font-size:11px;display:block;margin-bottom:4px;">Status</label>
          <input id="guest-status" type="text" maxlength="60" value="${esc(getStatus())}" placeholder="vibing, afk, busy..." style="
            width:100%;padding:8px 10px;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);border-radius:4px;
            color:var(--nd-text);font-family:'Courier New',monospace;font-size:12px;outline:none;box-sizing:border-box;
          "/>
        </div>
        <button id="guest-name-save" style="
          width:100%;padding:10px;margin-top:10px;background:color-mix(in srgb,var(--nd-accent) 20%,transparent);border:1px solid color-mix(in srgb,var(--nd-accent) 33%,transparent);border-radius:6px;
          color:var(--nd-accent);font-family:'Courier New',monospace;font-size:13px;cursor:pointer;font-weight:bold;
        ">Save</button>
        <div id="guest-name-status" style="color:var(--nd-dpurp);font-size:11px;margin-top:8px;text-align:center;min-height:16px;"></div>
        <div style="color:var(--nd-subtext);font-size:11px;margin-top:20px;text-align:center;">Login with a Nostr key to set a full profile</div>
      `;
      const statusEl = body.querySelector('#guest-name-status') as HTMLElement;
      body.querySelector('#guest-name-save')?.addEventListener('click', () => {
        const name = ((body.querySelector('#guest-name') as HTMLInputElement).value || '').trim().slice(0, 32);
        const status = ((body.querySelector('#guest-status') as HTMLInputElement).value || '').trim().slice(0, 60);
        if (!name) return;
        localStorage.setItem('nostr_district_guest_name', name);
        setStatus(status);
        authStore.setDisplayName(name);
        ctx.onProfileSave?.(name);
        sendStatusUpdate(status);
        ctx.onStatusUpdate?.(status);
        statusEl.style.color = 'var(--nd-accent)';
        statusEl.textContent = 'Saved!';
      });
      return;
    }

    body.innerHTML = `
      <div style="color:var(--nd-text);font-size:13px;font-weight:bold;margin-bottom:14px;">Edit Nostr Profile</div>
      <div style="margin-bottom:10px;">
        <label style="color:var(--nd-subtext);font-size:11px;display:block;margin-bottom:4px;">Display Name</label>
        <input id="prof-name" type="text" value="${esc(profile.display_name || profile.name || '')}" style="
          width:100%;padding:8px 10px;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);border-radius:4px;
          color:var(--nd-text);font-family:'Courier New',monospace;font-size:13px;outline:none;box-sizing:border-box;
        "/>
      </div>
      <div style="margin-bottom:10px;">
        <label style="color:var(--nd-subtext);font-size:11px;display:block;margin-bottom:4px;">About</label>
        <textarea id="prof-about" rows="3" style="
          width:100%;padding:8px 10px;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);border-radius:4px;
          color:var(--nd-text);font-family:'Courier New',monospace;font-size:12px;outline:none;box-sizing:border-box;resize:vertical;
        ">${esc(profile.about || '')}</textarea>
      </div>
      <div style="margin-bottom:10px;">
        <label style="color:var(--nd-subtext);font-size:11px;display:block;margin-bottom:4px;">Picture URL</label>
        <input id="prof-pic" type="text" value="${esc(profile.picture || '')}" style="
          width:100%;padding:8px 10px;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);border-radius:4px;
          color:var(--nd-text);font-family:'Courier New',monospace;font-size:12px;outline:none;box-sizing:border-box;
        "/>
      </div>
      <div style="margin-bottom:14px;">
        <label style="color:var(--nd-subtext);font-size:11px;display:block;margin-bottom:4px;">Lightning Address</label>
        <input id="prof-lnaddr" type="text" value="${esc(profile.lud16 || '')}" placeholder="you@wallet.com" style="
          width:100%;padding:8px 10px;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);border-radius:4px;
          color:var(--nd-text);font-family:'Courier New',monospace;font-size:12px;outline:none;box-sizing:border-box;
        "/>
      </div>
      <div style="margin-bottom:14px;">
        <label style="color:var(--nd-subtext);font-size:11px;display:block;margin-bottom:4px;">Status</label>
        <input id="prof-status-input" type="text" maxlength="60" value="${esc(getStatus())}" placeholder="vibing, afk, busy..." style="
          width:100%;padding:8px 10px;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);border-radius:4px;
          color:var(--nd-text);font-family:'Courier New',monospace;font-size:12px;outline:none;box-sizing:border-box;
        "/>
        <button id="prof-status-save" style="
          width:100%;margin-top:6px;padding:7px;background:color-mix(in srgb,var(--nd-accent) 20%,transparent);border:1px solid color-mix(in srgb,var(--nd-accent) 33%,transparent);border-radius:4px;
          color:var(--nd-accent);font-family:'Courier New',monospace;font-size:11px;cursor:pointer;
        ">Update Status</button>
      </div>
      <button id="prof-save" style="
        width:100%;padding:10px;background:color-mix(in srgb,var(--nd-accent) 20%,transparent);border:1px solid color-mix(in srgb,var(--nd-accent) 33%,transparent);border-radius:6px;
        color:var(--nd-accent);font-family:'Courier New',monospace;font-size:13px;cursor:pointer;font-weight:bold;
      ">Publish Profile (kind:0)</button>
      <div id="prof-status" style="color:var(--nd-dpurp);font-size:11px;margin-top:8px;text-align:center;min-height:16px;"></div>
    `;

    body.querySelector('#prof-status-save')?.addEventListener('click', () => {
      const status = ((body.querySelector('#prof-status-input') as HTMLInputElement).value || '').trim().slice(0, 60);
      setStatus(status);
      sendStatusUpdate(status);
      ctx.onStatusUpdate?.(status);
      const el = body.querySelector('#prof-status') as HTMLElement;
      if (el) { el.style.color = 'var(--nd-accent)'; el.textContent = 'Status updated!'; setTimeout(() => { el.textContent = ''; }, 2000); }
    });

    body.querySelector('#prof-save')?.addEventListener('click', async () => {
      const statusEl = body.querySelector('#prof-status') as HTMLElement;
      statusEl.style.color = 'var(--nd-accent)';
      statusEl.textContent = 'Publishing...';
      try {
        const name    = (body.querySelector('#prof-name')   as HTMLInputElement).value.trim();
        const about   = (body.querySelector('#prof-about')  as HTMLTextAreaElement).value.trim();
        const picture = (body.querySelector('#prof-pic')    as HTMLInputElement).value.trim();
        const lnaddr  = (body.querySelector('#prof-lnaddr') as HTMLInputElement).value.trim();
        const existing = authStore.getState().profile;
        const content: Record<string, any> = { ...existing };
        if (name) { content.name = name; content.display_name = name; }
        if (about) content.about = about;
        if (picture) content.picture = picture;
        if (lnaddr) { content.lud16 = lnaddr; } else { delete content.lud16; }

        const event: any = {
          kind: 0, created_at: Math.floor(Date.now() / 1000),
          tags: [], content: JSON.stringify(content),
        };

        let signed: any;
        try {
          signed = await signEvent(event);
        } catch (sigErr: any) {
          statusEl.style.color = P.red;
          statusEl.textContent = sigErr.message || 'Signing failed';
          return;
        }

        const ok = await publishEvent(signed);
        if (!ok) {
          statusEl.style.color = P.amber;
          statusEl.textContent = 'No relay confirmed — try again';
          return;
        }

        authStore.updateProfile(content);
        if (name) ctx.onProfileSave?.(name);

        statusEl.style.color = 'var(--nd-accent)';
        statusEl.textContent = 'Published!';
      } catch (e: any) {
        statusEl.style.color = P.red;
        statusEl.textContent = e.message || 'Failed';
      }
    });
  }
}

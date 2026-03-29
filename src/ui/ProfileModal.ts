/**
 * ProfileModal.ts — Shows a player's Nostr profile (kind:0)
 * Shared between HubScene and RoomScene
 *
 * Integrates PubScore API (api.pubscore.space) to show star ratings
 * for non-guest profiles.
 */

import { P } from '../config/game.config';
import { fetchProfile, fetchContactList, signEvent, publishEvent } from '../nostr/nostrService';
import { authStore } from '../stores/authStore';
import type { DMPanel } from './DMPanel';
import { deserializeAvatar, getDefaultAvatar } from '../stores/avatarStore';
import { renderRoomSprite } from '../entities/AvatarRenderer';
import { fetchKind16767, NostrTheme } from '../nostr/nostrThemeService';

// ── Minimal colour helpers (scoped to this file) ──────────────────────────────
function _hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h.slice(0,6).padEnd(6,'0');
  return [parseInt(full.slice(0,2),16)||0, parseInt(full.slice(2,4),16)||0, parseInt(full.slice(4,6),16)||0];
}
function _mix(hex1: string, hex2: string, t: number): string {
  const [r1,g1,b1] = _hexToRgb(hex1); const [r2,g2,b2] = _hexToRgb(hex2);
  const r = Math.round(r1+(r2-r1)*t), g = Math.round(g1+(g2-g1)*t), b = Math.round(b1+(b2-b1)*t);
  return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join('');
}
function _lum(hex: string): number {
  const [r,g,b] = _hexToRgb(hex).map(v => { const c=v/255; return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4); });
  return 0.2126*r+0.7152*g+0.0722*b;
}
function applyThemeToModal(modal: HTMLElement, theme: NostrTheme | null): void {
  const CSS_VARS = ['--nd-bg','--nd-navy','--nd-accent','--nd-purp','--nd-dpurp','--nd-text','--nd-subtext'];
  if (!theme) {
    // Clear any scoped inline vars — viewer's :root preset vars cascade through
    CSS_VARS.forEach(v => modal.style.removeProperty(v));
    // Restore the solid gradient so the modal isn't transparent.
    // Non-!important so the viewer's nostr theme stylesheet !important can win.
    modal.style.background = 'linear-gradient(180deg, var(--nd-bg) 0%, var(--nd-navy) 100%)';
    return;
  }
  let bg = theme.background, text = theme.text, primary = theme.primary;
  if (_lum(bg) > 0.18) { bg = _mix(bg, '#000000', 0.82); }
  if (_lum(bg) > 0.18 && _lum(text) < 0.5) { text = _mix(text, '#ffffff', 0.88); }
  const [br,bg2,bb] = _hexToRgb(bg);
  modal.style.setProperty('--nd-bg',      bg);
  modal.style.setProperty('--nd-navy',    _mix(bg, primary, 0.08));
  modal.style.setProperty('--nd-accent',  primary);
  modal.style.setProperty('--nd-purp',    _mix(bg, primary, 0.45));
  modal.style.setProperty('--nd-dpurp',   _mix(bg, primary, 0.2));
  modal.style.setProperty('--nd-text',    text);
  modal.style.setProperty('--nd-subtext', _mix(text, bg, 0.45));
  if (theme.bgUrl) {
    const safeUrl = theme.bgUrl.replace(/['\"\\]/g, '');
    const isTile  = theme.bgMode === 'tile';
    const repeat  = isTile ? 'repeat' : 'no-repeat';
    const size    = isTile ? 'auto'   : 'cover';
    const alpha1  = isTile ? 0.76 : 0.62;
    const alpha2  = isTile ? 0.70 : 0.52;
    // Use !important to beat the viewer's own nostr theme !important on #profile-modal
    modal.style.setProperty('background',
      `linear-gradient(rgba(${br},${bg2},${bb},${alpha1}),rgba(${br},${bg2},${bb},${alpha2})),url('${safeUrl}') center/${size} ${repeat}`,
      'important');
  } else {
    modal.style.setProperty('background',
      `linear-gradient(180deg,${bg} 0%,${_mix(bg,primary,0.08)} 100%)`,
      'important');
  }
}

const PUBSCORE_URL = 'https://pubscore.space';

const MODAL_ID = 'profile-modal';
const PUBSCORE_API = 'https://api.pubscore.space';

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

/** Check if a pubkey belongs to a guest (ephemeral key, no real identity) */
function isGuestPubkey(pubkey: string, displayName: string): boolean {
  const state = authStore.getState();
  if (state.pubkey === pubkey && state.loginMethod === 'guest') return true;
  if (displayName.startsWith('guest_')) return true;
  return false;
}

/** Convert hex pubkey to npub using nostr-tools (lazy loaded) */
async function hexToNpub(hex: string): Promise<string> {
  try {
    const NT = await import('nostr-tools');
    return NT.nip19.npubEncode(hex);
  } catch (_) {
    return '';
  }
}

/** Fetch PubScore rating for an npub */
async function fetchPubScore(npub: string): Promise<{ avgRating: number; count: number; votes: { trusted: number; neutral: number; avoid: number } } | null> {
  try {
    const res = await fetch(`${PUBSCORE_API}/score?npub=${npub}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.count === 0) return null;
    return data;
  } catch (_) {
    return null;
  }
}

/** Render star rating as HTML */
function renderStars(avgRating: number, fontSize = 13): string {
  const full = Math.floor(avgRating);
  const hasHalf = (avgRating - full) >= 0.3;
  const empty = 5 - full - (hasHalf ? 1 : 0);

  let html = '';
  for (let i = 0; i < full; i++) html += `<span style="color:${P.amber};font-size:${fontSize}px;">\u2605</span>`;
  if (hasHalf) html += `<span style="color:${P.amber};font-size:${fontSize}px;opacity:0.5;">\u2605</span>`;
  for (let i = 0; i < empty; i++) html += `<span style="color:var(--nd-subtext);font-size:${fontSize}px;opacity:0.25;">\u2605</span>`;
  return html;
}


export class ProfileModal {
  private static _dmPanel: DMPanel | null = null;
  static setDMPanel(panel: DMPanel): void { ProfileModal._dmPanel = panel; }

  static async show(pubkey: string, fallbackName: string, avatarSerialized?: string, playerStatus?: string): Promise<void> {
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 3000;
      background: linear-gradient(180deg, var(--nd-bg) 0%, var(--nd-navy) 100%);
      border: 1px solid color-mix(in srgb,var(--nd-dpurp) 33%,transparent); border-radius: 10px;
      padding: 24px 28px 20px; font-family: 'Courier New', monospace;
      box-shadow: 0 8px 30px rgba(0,0,0,0.7); min-width: 400px; max-width: 480px;
      overflow: hidden;
    `;
    modal.innerHTML = `
      <div style="color:var(--nd-accent);font-size:15px;font-weight:bold;margin-bottom:14px;text-align:center;">PROFILE</div>
      <div style="color:var(--nd-subtext);font-size:12px;text-align:center;padding:20px 0;">Loading...</div>
    `;
    document.body.appendChild(modal);

    const closeModal = (e: MouseEvent) => {
      if (!modal.contains(e.target as Node)) { modal.remove(); document.removeEventListener('mousedown', closeModal); }
    };
    setTimeout(() => document.addEventListener('mousedown', closeModal), 300);

    const addCloseBtn = (npubToCopy?: string, npubDisplayShort?: string) => {
      modal.querySelector('#profile-close')?.addEventListener('click', () => {
        modal.remove(); document.removeEventListener('mousedown', closeModal);
      });
      const npubEl = modal.querySelector('#profile-copy-npub') as HTMLElement | null;
      if (npubEl && npubToCopy) {
        npubEl.addEventListener('click', () => {
          navigator.clipboard.writeText(npubToCopy).then(() => {
            npubEl.textContent = '✓ copied';
            npubEl.style.color = 'var(--nd-accent)';
            npubEl.style.opacity = '1';
            setTimeout(() => {
              npubEl.textContent = npubDisplayShort || npubToCopy.slice(0, 10) + '..';
              npubEl.style.color = '';
              npubEl.style.opacity = '';
            }, 2000);
          }).catch(() => {});
        });
      }
    };

    try {
      const isGuest = isGuestPubkey(pubkey, fallbackName);
      const myState = authStore.getState();
      const myPubkey = myState.pubkey;
      const isSelf = !!myPubkey && myPubkey === pubkey;
      const canFollow = !isGuest && !isSelf && !!myPubkey && myState.loginMethod !== 'guest';

      const profilePromise = fetchProfile(pubkey);
      const npubPromise = hexToNpub(pubkey);
      const scorePromise = isGuest
        ? Promise.resolve(null)
        : npubPromise.then(npub => npub ? fetchPubScore(npub) : null);
      const contactPromise = canFollow ? fetchContactList(myPubkey!) : Promise.resolve(null);
      // Fetch theme separately — don't block modal render on it
      const themePromise = pubkey ? fetchKind16767(pubkey) : Promise.resolve(null);

      const [profile, npubFull, score, contactList] = await Promise.all([profilePromise, npubPromise, scorePromise, contactPromise]);

      const displayName = profile?.display_name || profile?.name || fallbackName;
      const about = profile?.about || '';
      const nip05 = profile?.nip05 || '';
      const picture = profile?.picture || '';
      const npub = npubFull || pubkey.slice(0, 16) + '...';
      const npubShort = npub.length > 20 ? npub.slice(0, 12) + '...' + npub.slice(-6) : npub;

      let isFollowing = contactList ? contactList.follows.has(pubkey) : false;
      let contactTags: string[][] = contactList ? contactList.tags : [];

      // Inline score row for the header — subtle, clickable stars that link to pubscore
      let scoreInlineHtml = '';
      if (!isGuest && npubFull) {
        const starsHtml = score
          ? renderStars(score.avgRating)
          : `<span style="color:var(--nd-subtext);font-size:13px;opacity:0.22;">\u2605\u2605\u2605\u2605\u2605</span>`;
        const labelParts: string[] = [];
        if (score) {
          labelParts.push(`${score.avgRating.toFixed(1)}`);
          labelParts.push(`${score.count} review${score.count !== 1 ? 's' : ''}`);
          if (score.votes.trusted > 0) labelParts.push(`\u2713 ${score.votes.trusted}`);
          if (score.votes.avoid > 0)   labelParts.push(`\u2717 ${score.votes.avoid}`);
        } else {
          labelParts.push('no reviews');
        }
        scoreInlineHtml = `
          <a href="${PUBSCORE_URL}/?npub=${npubFull}" target="_blank" rel="noopener" style="
            display:inline-flex;align-items:center;gap:4px;text-decoration:none;
            opacity:0.55;transition:opacity 0.15s;margin-top:2px;
          " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.55'">
            ${starsHtml}
            <span style="color:var(--nd-subtext);font-size:10px;">${labelParts.join(' \u00B7 ')}</span>
          </a>
        `;
      }

      const followBtnHtml = canFollow ? `
        <button id="profile-follow" style="
          flex:1;padding:8px;border-radius:6px;font-family:'Courier New',monospace;font-size:12px;cursor:pointer;
          ${isFollowing
            ? `background:rgba(0,0,0,0.50);border:1px solid #e8545488;color:#e85454;`
            : `background:rgba(0,0,0,0.50);border:1px solid color-mix(in srgb,var(--nd-accent) 55%,transparent);color:var(--nd-accent);`
          }
        ">${isFollowing ? 'Unfollow' : 'Follow'}</button>
      ` : '';

      const npubUnder = npub.length > 10 ? npub.slice(0, 7) + '..' + npub.slice(-4) : npub;

      modal.innerHTML = `
        <div style="
          display:flex;align-items:flex-start;gap:14px;margin:-24px -28px 0;
          padding:18px 22px 16px;
          background:color-mix(in srgb,var(--nd-bg) 72%,transparent);
          backdrop-filter:blur(8px);
          border-bottom:1px solid color-mix(in srgb,var(--nd-dpurp) 22%,transparent);
        ">
          <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:5px;">
            <canvas id="profile-pixel-avatar" width="48" height="104" style="image-rendering:pixelated;border:1px solid color-mix(in srgb,var(--nd-dpurp) 30%,transparent);border-radius:6px;background:color-mix(in srgb,var(--nd-bg) 50%,transparent);"></canvas>
            <div id="profile-copy-npub" style="
              font-size:9px;font-family:'Courier New',monospace;
              color:var(--nd-subtext);cursor:pointer;opacity:0.65;
              white-space:nowrap;text-align:center;
              padding:2px 5px;border-radius:3px;
              background:rgba(0,0,0,0.30);
              transition:opacity 0.15s;
            " title="Click to copy npub">${npubUnder}</div>
          </div>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:5px;padding-top:4px;">
            <div style="display:flex;align-items:center;gap:8px;">
              ${picture ? `<img src="${esc(picture)}" style="width:30px;height:30px;border-radius:5px;border:1px solid color-mix(in srgb,var(--nd-dpurp) 27%,transparent);object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'">` : ''}
              <div style="flex:1;min-width:0;">
                <div style="color:var(--nd-text);font-size:15px;font-weight:bold;text-shadow:0 1px 4px rgba(0,0,0,0.8);">${esc(displayName)}</div>
                ${nip05 ? `<div style="color:var(--nd-accent);font-size:10px;margin-top:1px;">\u2713 ${esc(nip05.length > 28 ? nip05.slice(0, 26) + '..' : nip05)}</div>` : ''}
                ${scoreInlineHtml}
              </div>
              ${!isSelf ? `<button id="profile-dm" title="Send DM" style="background:rgba(0,0,0,0.50);border:1px solid color-mix(in srgb,var(--nd-accent) 55%,transparent);border-radius:6px;color:var(--nd-accent);font-size:12px;font-family:'Courier New',monospace;padding:5px 9px;cursor:pointer;flex-shrink:0;">\u2709 DM</button>` : ''}
            </div>
            ${playerStatus ? `<div style="color:var(--nd-accent);font-size:11px;font-style:italic;opacity:0.9;">\u25CF ${esc(playerStatus)}</div>` : ''}
          </div>
        </div>
        <div style="
          margin:0 -28px -20px;padding:14px 28px 18px;
          background:linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.35) 100%);
        ">
          ${about ? `<div style="color:var(--nd-text);font-size:12px;line-height:1.5;opacity:0.8;margin-bottom:14px;max-height:80px;overflow-y:auto;text-shadow:0 1px 4px rgba(0,0,0,0.8);">${esc(about.slice(0, 300))}</div>` : ''}
          <div style="display:flex;gap:8px;">
            ${followBtnHtml}
            <button id="profile-close" style="flex:1;padding:8px;background:rgba(0,0,0,0.50);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--nd-text);font-family:'Courier New',monospace;font-size:12px;cursor:pointer;">Close</button>
          </div>
        </div>
      `;
      addCloseBtn(npubFull, npubUnder);

      // Apply viewed user's theme when it arrives; if null, reverts to viewer's active theme
      themePromise.then(viewedTheme => {
        if (document.getElementById(MODAL_ID)) applyThemeToModal(modal, viewedTheme);
      });

      // Render pixel avatar
      const pixelCanvas = modal.querySelector('#profile-pixel-avatar') as HTMLCanvasElement | null;
      if (pixelCanvas) {
        const avatarCfg = avatarSerialized ? (deserializeAvatar(avatarSerialized) || getDefaultAvatar()) : getDefaultAvatar();
        const spriteCanvas = renderRoomSprite(avatarCfg);
        const pctx = pixelCanvas.getContext('2d')!;
        pctx.imageSmoothingEnabled = false;
        pctx.drawImage(spriteCanvas, 0, 0, 24, 52, 0, 0, 48, 104);
      }

      modal.querySelector('#profile-dm')?.addEventListener('click', () => {
        const panel = ProfileModal._dmPanel;
        if (panel) { modal.remove(); document.removeEventListener('mousedown', closeModal); panel.open(pubkey); }
      });

      // Follow / Unfollow handler
      const followBtn = modal.querySelector('#profile-follow') as HTMLButtonElement | null;
      if (followBtn) {
        followBtn.addEventListener('click', async () => {
          followBtn.disabled = true;
          followBtn.style.opacity = '0.5';
          try {
            let newTags: string[][];
            if (isFollowing) {
              newTags = contactTags.filter(t => !(t[0] === 'p' && t[1] === pubkey));
            } else {
              newTags = [...contactTags, ['p', pubkey]];
            }
            const unsigned = { kind: 3, tags: newTags, content: '', created_at: Math.floor(Date.now() / 1000) };
            const signed = await signEvent(unsigned);
            const ok = await publishEvent(signed);
            if (ok) {
              isFollowing = !isFollowing;
              contactTags = newTags;
              followBtn.textContent = isFollowing ? 'Unfollow' : 'Follow';
              followBtn.style.background   = isFollowing ? 'none' : `color-mix(in srgb,var(--nd-accent) 13%,transparent)`;
              followBtn.style.border       = isFollowing ? `1px solid #e8545455` : `1px solid color-mix(in srgb,var(--nd-accent) 33%,transparent)`;
              followBtn.style.color        = isFollowing ? '#e85454' : 'var(--nd-accent)';
            }
          } catch (err) {
            console.warn('[ProfileModal] follow/unfollow failed:', err);
          } finally {
            followBtn.disabled = false;
            followBtn.style.opacity = '1';
          }
        });
      }
    } catch (_) {
      modal.innerHTML = `
        <div style="color:var(--nd-accent);font-size:15px;font-weight:bold;margin-bottom:14px;text-align:center;">PROFILE</div>
        <div style="color:var(--nd-text);font-size:13px;text-align:center;margin-bottom:10px;">${esc(fallbackName)}</div>
        <div style="color:var(--nd-subtext);font-size:11px;text-align:center;margin-bottom:14px;">Could not load profile</div>
        <button id="profile-close" style="width:100%;padding:8px;background:none;border:1px solid color-mix(in srgb,var(--nd-dpurp) 27%,transparent);border-radius:6px;color:var(--nd-subtext);font-family:'Courier New',monospace;font-size:12px;cursor:pointer;">Close</button>
      `;
      addCloseBtn();
    }
  }

  static destroy(): void {
    const el = document.getElementById(MODAL_ID);
    if (el) el.remove();
  }
}
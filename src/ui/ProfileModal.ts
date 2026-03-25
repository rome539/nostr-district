/**
 * ProfileModal.ts — Shows a player's Nostr profile (kind:0)
 * Shared between HubScene and RoomScene
 *
 * Integrates PubScore API (api.pubscore.space) to show star ratings
 * for non-guest profiles.
 */

import { P } from '../config/game.config';
import { fetchProfile } from '../nostr/nostrService';
import { authStore } from '../stores/authStore';

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
function renderStars(avgRating: number): string {
  const full = Math.floor(avgRating);
  const hasHalf = (avgRating - full) >= 0.3;
  const empty = 5 - full - (hasHalf ? 1 : 0);

  let html = '';
  for (let i = 0; i < full; i++) html += `<span style="color:${P.amber};font-size:16px;">\u2605</span>`;
  if (hasHalf) html += `<span style="color:${P.amber};font-size:16px;opacity:0.5;">\u2605</span>`;
  for (let i = 0; i < empty; i++) html += `<span style="color:${P.lpurp};font-size:16px;opacity:0.3;">\u2605</span>`;
  return html;
}

/** Render vote breakdown as compact badges */
function renderVotes(votes: { trusted: number; neutral: number; avoid: number }): string {
  const badges: string[] = [];
  if (votes.trusted > 0) badges.push(`<span style="color:${P.teal};font-size:11px;">\u2713 ${votes.trusted} trusted</span>`);
  if (votes.neutral > 0) badges.push(`<span style="color:${P.lpurp};font-size:11px;">\u25CB ${votes.neutral} neutral</span>`);
  if (votes.avoid > 0) badges.push(`<span style="color:${P.red};font-size:11px;">\u2717 ${votes.avoid} avoid</span>`);
  return badges.join(`<span style="color:${P.lpurp};font-size:11px;opacity:0.3;"> \u00B7 </span>`);
}

export class ProfileModal {
  static async show(pubkey: string, fallbackName: string): Promise<void> {
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 3000;
      background: linear-gradient(180deg, ${P.bg} 0%, #0e0828 100%);
      border: 1px solid ${P.dpurp}55; border-radius: 10px;
      padding: 24px 28px; font-family: 'Courier New', monospace;
      box-shadow: 0 8px 30px rgba(0,0,0,0.7); min-width: 320px; max-width: 380px;
    `;
    modal.innerHTML = `
      <div style="color:${P.teal};font-size:15px;font-weight:bold;margin-bottom:14px;text-align:center;">PROFILE</div>
      <div style="color:${P.lpurp};font-size:12px;text-align:center;padding:20px 0;">Loading...</div>
    `;
    document.body.appendChild(modal);

    const closeModal = (e: MouseEvent) => {
      if (!modal.contains(e.target as Node)) { modal.remove(); document.removeEventListener('mousedown', closeModal); }
    };
    setTimeout(() => document.addEventListener('mousedown', closeModal), 300);

    const addCloseBtn = (npubToCopy?: string) => {
      modal.querySelector('#profile-close')?.addEventListener('click', () => {
        modal.remove(); document.removeEventListener('mousedown', closeModal);
      });
      const copyBtn = modal.querySelector('#profile-copy-npub') as HTMLButtonElement | null;
      if (copyBtn && npubToCopy) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(npubToCopy).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
          }).catch(() => {});
        });
      }
    };

    try {
      const isGuest = isGuestPubkey(pubkey, fallbackName);
      const profilePromise = fetchProfile(pubkey);
      const npubPromise = hexToNpub(pubkey);
      const scorePromise = isGuest
        ? Promise.resolve(null)
        : npubPromise.then(npub => npub ? fetchPubScore(npub) : null);

      const [profile, npubFull, score] = await Promise.all([profilePromise, npubPromise, scorePromise]);

      const displayName = profile?.display_name || profile?.name || fallbackName;
      const about = profile?.about || '';
      const nip05 = profile?.nip05 || '';
      const picture = profile?.picture || '';
      const npub = npubFull || pubkey.slice(0, 16) + '...';
      const npubShort = npub.length > 20 ? npub.slice(0, 12) + '...' + npub.slice(-6) : npub;

      let scoreHtml = '';
      if (!isGuest) {
        if (score) {
          scoreHtml = `
            <div style="background:${P.navy};border:1px solid ${P.dpurp}33;border-radius:6px;padding:10px 12px;margin-bottom:14px;">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
                <div>${renderStars(score.avgRating)}</div>
                <span style="color:${P.lcream};font-size:12px;opacity:0.6;">${score.avgRating.toFixed(1)} \u00B7 ${score.count} review${score.count !== 1 ? 's' : ''}</span>
              </div>
              <div>${renderVotes(score.votes)}</div>
            </div>
          `;
        } else {
          scoreHtml = `
            <div style="background:${P.navy};border:1px solid ${P.dpurp}22;border-radius:6px;padding:8px 12px;margin-bottom:14px;">
              <span style="color:${P.lpurp};font-size:11px;">No reviews yet</span>
            </div>
          `;
        }
      }

      modal.innerHTML = `
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
          ${picture
            ? `<img src="${esc(picture)}" style="width:48px;height:48px;border-radius:8px;border:1px solid ${P.dpurp}44;object-fit:cover;" onerror="this.style.display='none'">`
            : `<div style="width:48px;height:48px;border-radius:8px;background:${P.dpurp}33;display:flex;align-items:center;justify-content:center;color:${P.lpurp};font-size:22px;">\uD83D\uDC64</div>`
          }
          <div>
            <div style="color:${P.lcream};font-size:15px;font-weight:bold;">${esc(displayName)}</div>
            ${nip05 ? `<div style="color:${P.teal};font-size:11px;margin-top:3px;">\u2713 ${esc(nip05.length > 30 ? nip05.slice(0, 28) + '...' : nip05)}</div>` : ''}
          </div>
        </div>
        ${scoreHtml}
        ${about ? `<div style="color:${P.lcream};font-size:12px;line-height:1.5;opacity:0.7;margin-bottom:14px;max-height:100px;overflow-y:auto;">${esc(about.slice(0, 300))}</div>` : ''}
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
          <div style="color:${P.lpurp};font-size:11px;flex:1;">${esc(npubShort)}</div>
          <button id="profile-copy-npub" style="background:${P.navy};border:1px solid ${P.dpurp}44;border-radius:4px;color:${P.teal};font-family:'Courier New',monospace;font-size:11px;padding:4px 10px;cursor:pointer;">Copy</button>
        </div>
        <button id="profile-close" style="width:100%;padding:8px;background:none;border:1px solid ${P.dpurp}44;border-radius:6px;color:${P.lpurp};font-family:'Courier New',monospace;font-size:12px;cursor:pointer;">Close</button>
      `;
      addCloseBtn(npubFull);
    } catch (_) {
      modal.innerHTML = `
        <div style="color:${P.teal};font-size:15px;font-weight:bold;margin-bottom:14px;text-align:center;">PROFILE</div>
        <div style="color:${P.lcream};font-size:13px;text-align:center;margin-bottom:10px;">${esc(fallbackName)}</div>
        <div style="color:${P.lpurp};font-size:11px;text-align:center;margin-bottom:14px;">Could not load profile</div>
        <button id="profile-close" style="width:100%;padding:8px;background:none;border:1px solid ${P.dpurp}44;border-radius:6px;color:${P.lpurp};font-family:'Courier New',monospace;font-size:12px;cursor:pointer;">Close</button>
      `;
      addCloseBtn();
    }
  }

  static destroy(): void {
    const el = document.getElementById(MODAL_ID);
    if (el) el.remove();
  }
}
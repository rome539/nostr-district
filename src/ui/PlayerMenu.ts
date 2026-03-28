/**
 * PlayerMenu.ts — Context menu when clicking another player
 * Shared between HubScene and RoomScene
 *
 * Options: View Profile, Send DM, Visit Room, Mute/Unmute
 */

import { P } from '../config/game.config';
import { sendRoomRequest } from '../nostr/presenceService';
import { ProfileModal } from './ProfileModal';

const MENU_ID = 'player-context-menu';

/** Set of pubkeys the local user has muted (persists in memory for the session) */
export const mutedPlayers = new Set<string>();

interface MenuCallbacks {
  onChat: (text: string, color: string) => void;
  getDMPanel?: () => unknown;
}

export function showPlayerMenu(
  pubkey: string,
  name: string,
  screenX: number,
  screenY: number,
  callbacks: MenuCallbacks,
): void {
  // Remove existing
  const existing = document.getElementById(MENU_ID);
  if (existing) existing.remove();

  const isMuted = mutedPlayers.has(pubkey);

  const menu = document.createElement('div');
  menu.id = MENU_ID;
  menu.style.cssText = `
    position: fixed; z-index: 3000;
    left: ${screenX}px; top: ${screenY - 10}px;
    background: linear-gradient(180deg, ${P.bg} 0%, #0e0828 100%);
    border: 1px solid ${P.dpurp}55; border-radius: 8px;
    padding: 6px 0; font-family: 'Courier New', monospace;
    box-shadow: 0 4px 16px rgba(0,0,0,0.6); min-width: 200px;
  `;

  const esc = (s: string) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

  menu.innerHTML = `
    <div style="color:${P.lcream};font-size:13px;font-weight:bold;padding:8px 16px 10px;border-bottom:1px solid ${P.dpurp}22;">${esc(name)}</div>
    <div class="ctx-profile" style="padding:10px 16px;color:${P.lpurp};font-size:13px;cursor:pointer;transition:background 0.15s;">\uD83D\uDC64 View Profile</div>
    <div class="ctx-visit" style="padding:10px 16px;color:${P.pink};font-size:13px;cursor:pointer;transition:background 0.15s;">\uD83D\uDEAA Visit Room</div>
    <div style="height:1px;background:${P.dpurp}22;margin:2px 0;"></div>
    <div class="ctx-mute" style="padding:10px 16px;color:${isMuted ? P.teal : P.amber};font-size:13px;cursor:pointer;transition:background 0.15s;">${isMuted ? '\u{1F50A} Unmute' : '\u{1F507} Mute'}</div>
  `;

  menu.addEventListener('mousedown', (e) => e.stopPropagation());
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.body.appendChild(menu);

  // Hover effects
  menu.querySelectorAll('.ctx-profile,.ctx-visit,.ctx-mute').forEach(el => {
    el.addEventListener('mouseenter', () => (el as HTMLElement).style.background = `${P.dpurp}20`);
    el.addEventListener('mouseleave', () => (el as HTMLElement).style.background = 'transparent');
  });

  const close = () => { menu.remove(); document.removeEventListener('mousedown', closeHandler); };

  // View Profile
  menu.querySelector('.ctx-profile')!.addEventListener('click', () => {
    close();
    ProfileModal.show(pubkey, name);
  });

  // Visit Room
  menu.querySelector('.ctx-visit')!.addEventListener('click', () => {
    close();
    callbacks.onChat(`Requesting access to ${name}'s room...`, P.teal);
    sendRoomRequest(pubkey);
  });

  // Mute/Unmute
  menu.querySelector('.ctx-mute')!.addEventListener('click', () => {
    close();
    if (mutedPlayers.has(pubkey)) {
      mutedPlayers.delete(pubkey);
      callbacks.onChat(`Unmuted ${name}`, P.teal);
    } else {
      mutedPlayers.add(pubkey);
      callbacks.onChat(`Muted ${name}`, P.amber);
    }
  });

  // Close on click outside
  const closeHandler = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  setTimeout(() => document.addEventListener('mousedown', closeHandler), 300);
}

/** Remove any open menu (call on scene shutdown) */
export function destroyPlayerMenu(): void {
  const el = document.getElementById(MENU_ID);
  if (el) el.remove();
}
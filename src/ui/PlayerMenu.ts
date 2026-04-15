/**
 * PlayerMenu.ts — Context menu when clicking another player
 * Shared between HubScene and RoomScene
 *
 * Options: View Profile, Send DM, Visit Room, Mute/Unmute
 */

import { P } from '../config/game.config';
import { sendRoomRequest } from '../nostr/presenceService';
import { ProfileModal } from './ProfileModal';
import { ZapModal } from './ZapModal';
import type { DMPanel } from './DMPanel';

const MENU_ID = 'player-context-menu';

const MUTE_STORAGE_KEY = 'nd_muted_players';

/** Set of pubkeys the local user has muted — persisted in localStorage */
export const mutedPlayers = new Set<string>();

/** Map of pubkey → display name for muted players */
export const mutedNames = new Map<string, string>();

// Load from localStorage on init
try {
  const stored = localStorage.getItem(MUTE_STORAGE_KEY);
  if (stored) {
    const obj = JSON.parse(stored) as Record<string, string>;
    Object.entries(obj).forEach(([pk, name]) => { mutedPlayers.add(pk); mutedNames.set(pk, name); });
  }
} catch (_) {}

function saveMutes(): void {
  try {
    const obj: Record<string, string> = {};
    mutedPlayers.forEach(pk => { obj[pk] = mutedNames.get(pk) || pk.slice(0, 10); });
    localStorage.setItem(MUTE_STORAGE_KEY, JSON.stringify(obj));
  } catch (_) {}
}

export function mutePlayer(pubkey: string, name: string): void {
  mutedPlayers.add(pubkey);
  mutedNames.set(pubkey, name);
  saveMutes();
}

export function unmutePlayer(pubkey: string): void {
  mutedPlayers.delete(pubkey);
  mutedNames.delete(pubkey);
  saveMutes();
}

interface MenuCallbacks {
  onChat: (text: string, color: string) => void;
  getDMPanel?: () => DMPanel | null;
  onMuteChange?: (pubkey: string, muted: boolean) => void;
}

export function showPlayerMenu(
  pubkey: string,
  name: string,
  screenX: number,
  screenY: number,
  callbacks: MenuCallbacks,
  avatar?: string,
  status?: string,
): void {
  // Remove existing
  const existing = document.getElementById(MENU_ID);
  if (existing) existing.remove();

  const isMuted = mutedPlayers.has(pubkey);

  const menu = document.createElement('div');
  menu.id = MENU_ID;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const menuW = Math.min(200, window.innerWidth - 16);
  const clampX = Math.max(8, Math.min(screenX, window.innerWidth - menuW - 8));
  menu.style.cssText = `
    position: fixed; z-index: 3000;
    left: ${clampX}px; top: -9999px;
    background: linear-gradient(180deg, var(--nd-bg) 0%, var(--nd-navy) 100%);
    border: 1px solid color-mix(in srgb,var(--nd-dpurp) 33%,transparent); border-radius: 8px;
    padding: 6px 0; font-family: 'Courier New', monospace;
    box-shadow: 0 4px 16px rgba(0,0,0,0.6); min-width: ${menuW}px;
  `;

  const esc = (s: string) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

  menu.innerHTML = `
    <div style="color:var(--nd-text);font-size:13px;font-weight:bold;padding:8px 16px 10px;border-bottom:1px solid color-mix(in srgb,var(--nd-dpurp) 13%,transparent);">${esc(name)}</div>
    <div class="ctx-profile" style="padding:10px 16px;color:var(--nd-subtext);font-size:13px;cursor:pointer;transition:background 0.15s;">\uD83D\uDC64 View Profile</div>
    <div class="ctx-dm" style="padding:10px 16px;color:var(--nd-accent);font-size:13px;cursor:pointer;transition:background 0.15s;">\u2709 Send DM</div>
    <div class="ctx-zap" style="padding:10px 16px;color:#f0b040;font-size:13px;cursor:pointer;transition:background 0.15s;">\u26A1 Zap</div>
    <div class="ctx-visit" style="padding:10px 16px;color:var(--nd-subtext);font-size:13px;cursor:pointer;transition:background 0.15s;">\uD83D\uDEAA Visit Room</div>
    <div style="height:1px;background:color-mix(in srgb,var(--nd-dpurp) 13%,transparent);margin:2px 0;"></div>
    <div class="ctx-mute" style="padding:10px 16px;color:${isMuted ? 'var(--nd-accent)' : 'var(--nd-subtext)'};font-size:13px;cursor:pointer;transition:background 0.15s;">${isMuted ? '\u{1F50A} Unmute' : '\u{1F507} Mute'}</div>
  `;

  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.body.appendChild(menu);

  // Position vertically after render so we know the real height
  const menuH = menu.offsetHeight;
  const spaceBelow = vh - screenY - 8;
  const topY = spaceBelow >= menuH
    ? screenY - 10                      // fits below tap — open downward
    : Math.max(8, screenY - menuH - 4); // flip above tap point
  menu.style.top = `${topY}px`;

  // Hover effects
  menu.querySelectorAll('.ctx-profile,.ctx-dm,.ctx-zap,.ctx-visit,.ctx-mute').forEach(el => {
    el.addEventListener('mouseenter', () => (el as HTMLElement).style.background = `color-mix(in srgb,var(--nd-dpurp) 13%,transparent)`);
    el.addEventListener('mouseleave', () => (el as HTMLElement).style.background = 'transparent');
  });

  const close = () => { menu.remove(); document.removeEventListener('pointerdown', closeHandler); };

  // View Profile
  menu.querySelector('.ctx-profile')!.addEventListener('click', () => {
    close();
    ProfileModal.show(pubkey, name, avatar, status);
  });

  // Send DM
  menu.querySelector('.ctx-dm')!.addEventListener('click', () => {
    close();
    const dmPanel = callbacks.getDMPanel?.();
    if (dmPanel) dmPanel.toggle(pubkey);
  });

  // Zap
  menu.querySelector('.ctx-zap')!.addEventListener('click', () => {
    close();
    ZapModal.show(pubkey, name);
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
      unmutePlayer(pubkey);
      callbacks.onChat(`Unmuted ${name}`, P.teal);
      callbacks.onMuteChange?.(pubkey, false);
    } else {
      mutePlayer(pubkey, name);
      callbacks.onChat(`Muted ${name}`, P.amber);
      callbacks.onMuteChange?.(pubkey, true);
    }
  });

  // Close on click outside
  const closeHandler = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  setTimeout(() => document.addEventListener('pointerdown', closeHandler), 300);
}

/** Remove any open menu (call on scene shutdown) */
export function destroyPlayerMenu(): void {
  const el = document.getElementById(MENU_ID);
  if (el) el.remove();
}
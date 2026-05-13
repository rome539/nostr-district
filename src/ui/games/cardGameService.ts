import { sendGameMsg, setGameMsgHandler, sendChat, setChatInterceptor } from '../../nostr/presenceService';
import { authStore } from '../../stores/authStore';

export type GameType = 'solitaire' | 'blackjack' | 'war' | 'poker' | 'gofish';

export interface GamePlayer { pubkey: string; name: string; }

interface PendingGame {
  gameId: string;
  gameType: GameType;
  hostPubkey: string;
  hostName: string;
}

type InviteHandler = (joiner: GamePlayer) => void;
type GameMsgHandler = (msg: Record<string, unknown>) => void;

let _inviteHandler: InviteHandler | null = null;
let _gameMsgHandler: GameMsgHandler | null = null;
let _activeGameId: string | null = null;
let _pendingInvite: PendingGame | null = null;
let _inviteBanner: HTMLElement | null = null;
let _roomPlayers: GamePlayer[] = [];
let _initialized = false;

function myPubkey(): string { return authStore.getState().pubkey || ''; }
function myName(): string { return authStore.getState().displayName || 'Player'; }

// Chat message prefixes — kept short to stay under the 200-char server limit.
// gameId uses hyphens (no colons) so parsing is unambiguous.
const PFX_INVITE = '/game:invite:';
const PFX_JOIN   = '/game:join:';
const PFX_START  = '/game:start:';
const PFX_GMSG   = '/game:msg:';   // generic in-game payload routed to _gameMsgHandler

/** Call once when entering a room. Activates invite receiver for all players. */
export function initCardGameService(): void {
  if (_initialized) return;
  _initialized = true;

  // Intercept game protocol messages before they reach the scene's chat log
  setChatInterceptor((pubkey, _name, text) => {
    // Format: /game:invite:<type>:<gameId>:<hostName>
    // gameId uses hyphens so the first two colons are the only separators
    if (text.startsWith(PFX_INVITE) && pubkey !== myPubkey()) {
      const rest = text.slice(PFX_INVITE.length);
      const c1 = rest.indexOf(':');
      if (c1 === -1) return true;
      const gameType = rest.slice(0, c1);
      const rest2 = rest.slice(c1 + 1);
      const c2 = rest2.indexOf(':');
      if (c2 === -1) return true;
      const gameId = rest2.slice(0, c2);
      const hostName = rest2.slice(c2 + 1);
      _pendingInvite = { gameId, gameType: gameType as GameType, hostPubkey: pubkey, hostName };
      showInviteBanner(_pendingInvite);
      return true;
    }

    // Format: /game:join:<gameId>:<playerName>
    if (text.startsWith(PFX_JOIN)) {
      const rest = text.slice(PFX_JOIN.length);
      const colon = rest.indexOf(':');
      if (colon === -1) return true;
      const gameId = rest.slice(0, colon);
      const playerName = rest.slice(colon + 1);
      if (gameId === _activeGameId && pubkey !== myPubkey()) {
        _inviteHandler?.({ pubkey, name: playerName });
      }
      return true;
    }

    // Format: /game:start:<gameId>:<type>
    if (text.startsWith(PFX_START)) {
      const rest = text.slice(PFX_START.length);
      const colon = rest.indexOf(':');
      if (colon === -1) return true;
      const gameId = rest.slice(0, colon);
      const gameType = rest.slice(colon + 1);
      // Only non-hosts need this signal — host already called startGame directly
      if (gameId === _activeGameId && pubkey !== myPubkey()) {
        _gameMsgHandler?.({ action: 'start', gameId, gameType });
      }
      return true;
    }

    // Format: /game:msg:<gameId>:<payload>  — generic in-game state/action channel
    if (text.startsWith(PFX_GMSG)) {
      const rest = text.slice(PFX_GMSG.length);
      const colon = rest.indexOf(':');
      if (colon === -1) return true;
      const gameId = rest.slice(0, colon);
      const payload = rest.slice(colon + 1);
      if (gameId === _activeGameId) {
        _gameMsgHandler?.({ action: 'payload', payload, from: pubkey });
      }
      return true;
    }

    return false; // pass through to scene
  });

  // game_msg handler for in-game state (requires server to have game_msg routing)
  setGameMsgHandler((raw) => {
    const msg = raw as Record<string, unknown>;
    if (typeof msg.action !== 'string') return;
    if (msg.gameId === _activeGameId) {
      _gameMsgHandler?.(msg);
    }
  });
}

/** Reset on room exit so next room entry re-initializes cleanly. */
export function teardownCardGameService(): void {
  _initialized = false;
  _roomPlayers = [];
  _activeGameId = null;
  _inviteHandler = null;
  _gameMsgHandler = null;
  _pendingInvite = null;
  dismissInviteBanner();
  setChatInterceptor(null);
  setGameMsgHandler(null);
}

export function setRoomPlayers(players: GamePlayer[]): void { _roomPlayers = players; }
export function getRoomPlayers(): GamePlayer[] { return _roomPlayers; }
export function setActiveGameId(id: string | null): void { _activeGameId = id; }
export function setInviteHandler(fn: InviteHandler | null): void { _inviteHandler = fn; }
export function setGameMsgReceiver(fn: GameMsgHandler | null): void { _gameMsgHandler = fn; }

/** Broadcast an invite to all players in the room via chat. */
export function sendInvite(gameType: GameType, gameId: string): void {
  sendChat(`${PFX_INVITE}${gameType}:${gameId}:${myName()}`);
}

/** Tell all joiners the game is starting — also via chat. */
export function sendStart(gameId: string, gameType: GameType): void {
  sendChat(`${PFX_START}${gameId}:${gameType}`);
}

/** Send a compact game state/action string via chat. Always works — no server restart needed. */
export function sendGamePayload(gameId: string, payload: string): void {
  sendChat(`${PFX_GMSG}${gameId}:${payload}`);
}

/** Notify other players you're leaving the active game. */
export function sendQuitGame(gameId: string, asHost: boolean): void {
  sendChat(`${PFX_GMSG}${gameId}:${asHost ? 'QUIT' : 'LEFT'}`);
}

/** Respond to an invite — also via chat so the host hears it. */
export function sendJoin(gameId: string): void {
  sendChat(`${PFX_JOIN}${gameId}:${myName()}`);
  _activeGameId = gameId;
}

/** Send game state / actions via game_msg (needs updated server for routing). */
export function sendGameAction(msg: Record<string, unknown>): void {
  sendGameMsg(msg);
}

export function cancelInvite(gameId: string): void {
  sendGameMsg({ action: 'cancel', gameId });
  _activeGameId = null;
}

function showInviteBanner(game: PendingGame): void {
  dismissInviteBanner();
  const names: Record<GameType, string> = {
    solitaire: 'Solitaire', blackjack: 'Blackjack',
    war: 'War', poker: 'Poker', gofish: 'Go Fish',
  };
  const banner = document.createElement('div');
  banner.id = 'ct-invite-banner';
  // Match the room request toast: top-right, CSS vars for theme
  banner.style.cssText = `
    position:fixed;top:20px;right:20px;z-index:9100;
    background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
    border:1px solid color-mix(in srgb,var(--nd-dpurp) 44%,transparent);
    border-radius:10px;padding:16px 20px;font-family:'Courier New',monospace;
    box-shadow:0 4px 20px rgba(0,0,0,0.6);max-width:300px;
  `;
  banner.innerHTML = `
    <div style="color:var(--nd-accent);font-size:14px;font-weight:bold;margin-bottom:10px;">Card Table Invite</div>
    <div style="color:var(--nd-text);font-size:13px;margin-bottom:14px;"><b>${game.hostName}</b> is starting <b>${names[game.gameType] ?? game.gameType}</b></div>
    <div style="display:flex;gap:8px;">
      <button id="ct-join-btn" style="flex:1;padding:8px;background:color-mix(in srgb,var(--nd-accent) 18%,transparent);border:1px solid color-mix(in srgb,var(--nd-accent) 44%,transparent);border-radius:6px;color:var(--nd-accent);font-size:13px;cursor:pointer;font-weight:bold;">Join</button>
      <button id="ct-decline-btn" style="flex:1;padding:8px;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.14);border-radius:6px;color:var(--nd-subtext);font-size:13px;cursor:pointer;">Decline</button>
    </div>
  `;
  document.body.appendChild(banner);
  _inviteBanner = banner;

  banner.querySelector('#ct-join-btn')?.addEventListener('click', () => {
    dismissInviteBanner();
    if (_pendingInvite) {
      sendJoin(_pendingInvite.gameId);
      window.dispatchEvent(new CustomEvent('ct:join-game', { detail: _pendingInvite }));
      _pendingInvite = null;
    }
  });

  banner.querySelector('#ct-decline-btn')?.addEventListener('click', () => {
    dismissInviteBanner();
    _pendingInvite = null;
  });

  setTimeout(() => { if (_inviteBanner === banner) dismissInviteBanner(); }, 30000);
}

export function dismissInviteBanner(): void {
  _inviteBanner?.remove();
  _inviteBanner = null;
}

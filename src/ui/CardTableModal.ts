import { authStore } from '../stores/authStore';
import { cardUrl, GameOptions, setCardBack, getCardBackName } from './games/cardTypes';
import { SolitaireGame } from './games/SolitaireGame';
import { BlackjackGame } from './games/BlackjackGame';
import { WarGame } from './games/WarGame';
import { PokerGame } from './games/PokerGame';
import { GoFishGame } from './games/GoFishGame';
import {
  GameType, GamePlayer,
  setActiveGameId, setInviteHandler, setGameMsgReceiver,
  sendInvite, sendGameAction, sendStart, sendGamePayload, sendQuitGame, cancelInvite, getRoomPlayers,
} from './games/cardGameService';

type Phase = 'pick' | 'lobby' | 'game';

interface GameMeta { id: GameType; label: string; icon: string; desc: string; multiplayer: boolean; }
const GAMES: GameMeta[] = [
  { id: 'solitaire', label: 'Solitaire', icon: '🃏', desc: 'Classic Klondike — solo', multiplayer: false },
  { id: 'blackjack', label: 'Blackjack', icon: '🎲', desc: 'Beat the dealer — solo or vs room', multiplayer: true },
  { id: 'war', label: 'War', icon: '⚔️', desc: 'High card wins — vs CPU or room', multiplayer: true },
  { id: 'poker', label: 'Poker', icon: '♠️', desc: '5-card draw vs dealer AI', multiplayer: false },
  { id: 'gofish', label: 'Go Fish', icon: '🐟', desc: 'Collect sets of 4 vs AI', multiplayer: false },
];

const GAME_MODULES = {
  solitaire: SolitaireGame,
  blackjack: BlackjackGame,
  war: WarGame,
  poker: PokerGame,
  gofish: GoFishGame,
};

let overlay: HTMLElement | null = null;
let box: HTMLElement | null = null;
let phase: Phase = 'pick';
let activeGameType: GameType | null = null;
let activeGameId: string | null = null;
let isHost = false;
let lobbyPlayers: GamePlayer[] = [];

function myPubkey() { return authStore.getState().pubkey || `guest_${Math.random().toString(36).slice(2, 8)}`; }
function myName() { return authStore.getState().displayName || 'Player'; }

function makeGameId(type: GameType): string {
  return `${type}-${myPubkey().slice(0, 8)}-${Date.now()}`;
}

let _boardColor: 'green' | 'blue' = 'green';

function matUrl(): string { return cardUrl(_boardColor === 'blue' ? 'Mat_blue.png' : 'Mat_green.png'); }
function matBg(): string  { return _boardColor === 'blue' ? '#07101a' : '#07180f'; }

function injectStyles(): void {
  if (document.getElementById('ct-style')) return;
  const style = document.createElement('style');
  style.id = 'ct-style';
  style.textContent = `
    .ct-card { width:90px;height:122px;overflow:hidden;image-rendering:pixelated;cursor:pointer;border-radius:4px;flex-shrink:0; }
    .ct-card img { display:block;image-rendering:pixelated;max-width:none;pointer-events:none; }
    .ct-sel { outline:2px solid var(--nd-accent);outline-offset:1px;box-shadow:0 0 10px color-mix(in srgb,var(--nd-accent) 45%,transparent); }
    .ct-dn { cursor:default; }
    .ct-slot { width:90px;height:122px;border:1px dashed rgba(255,255,255,0.18);border-radius:6px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.25);font-size:22px;box-sizing:border-box; }
    .ct-col { cursor:default; }
    .ct-btn:hover { border-color:var(--nd-accent)!important;color:var(--nd-accent)!important; }
    #ct-box { transition:background-color 0.3s ease; }
  `;
  document.head.appendChild(style);
}

function syncHeaderButtons(): void {
  if (!box) return;
  const enabled = phase === 'pick';
  ([
    box.querySelector('#ct-deck-toggle') as HTMLButtonElement | null,
    box.querySelector('#ct-mat-toggle') as HTMLButtonElement | null,
  ]).forEach(btn => {
    if (!btn) return;
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? '1' : '0.3';
    btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
  });
}

function renderPickScreen(): void {
  if (!box) return;
  const content = box.querySelector('#ct-content') as HTMLElement;
  content.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;">
      ${GAMES.map(g => `
        <div class="ct-game-btn" data-game="${g.id}" style="
          padding:16px 12px;border-radius:8px;cursor:pointer;text-align:center;
          background:rgba(0,0,0,0.4);border:1px solid color-mix(in srgb,var(--nd-accent) 20%,transparent);
          transition:border-color 0.15s,background 0.15s;
        ">
          <div style="font-size:28px;margin-bottom:8px;">${g.icon}</div>
          <div style="color:var(--nd-text);font-size:13px;font-weight:bold;letter-spacing:0.03em;">${g.label}</div>
          <div style="color:var(--nd-subtext);font-size:10px;margin-top:5px;">${g.desc}</div>
          ${g.multiplayer ? `<div style="color:var(--nd-accent);font-size:9px;margin-top:6px;opacity:0.75;">✦ multiplayer</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;

  content.querySelectorAll('.ct-game-btn').forEach(el => {
    (el as HTMLElement).addEventListener('mouseenter', () => { (el as HTMLElement).style.background = 'rgba(0,0,0,0.55)'; (el as HTMLElement).style.borderColor = 'color-mix(in srgb,var(--nd-accent) 55%,transparent)'; });
    (el as HTMLElement).addEventListener('mouseleave', () => { (el as HTMLElement).style.background = 'rgba(0,0,0,0.4)'; (el as HTMLElement).style.borderColor = 'color-mix(in srgb,var(--nd-accent) 20%,transparent)'; });
    (el as HTMLElement).addEventListener('click', () => {
      const gameId = (el as HTMLElement).dataset.game as GameType;
      const meta = GAMES.find(g => g.id === gameId)!;
      if (meta.multiplayer) {
        renderModeScreen(meta);
      } else {
        startGame(gameId, false);
      }
    });
  });
  syncHeaderButtons();
}

function renderModeScreen(meta: GameMeta): void {
  if (!box) return;
  const content = box.querySelector('#ct-content') as HTMLElement;
  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:22px;">
      <button id="ct-back" style="background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--nd-subtext);cursor:pointer;font-size:15px;padding:4px 10px;line-height:1;">←</button>
      <div style="color:var(--nd-text);font-size:15px;font-weight:bold;letter-spacing:0.06em;">${meta.icon} ${meta.label}</div>
    </div>
    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
      <div id="ct-solo-btn" style="padding:22px 32px;border-radius:10px;cursor:pointer;text-align:center;background:rgba(0,0,0,0.4);border:1px solid color-mix(in srgb,var(--nd-accent) 20%,transparent);transition:border-color 0.15s,background 0.15s;">
        <div style="font-size:28px;margin-bottom:10px;">🤖</div>
        <div style="color:var(--nd-text);font-size:13px;font-weight:bold;">Solo vs CPU</div>
        <div style="color:var(--nd-subtext);font-size:10px;margin-top:5px;">Just you and the dealer</div>
      </div>
      <div id="ct-mp-btn" style="padding:22px 32px;border-radius:10px;cursor:pointer;text-align:center;background:rgba(0,0,0,0.4);border:1px solid color-mix(in srgb,var(--nd-accent) 20%,transparent);transition:border-color 0.15s,background 0.15s;">
        <div style="font-size:28px;margin-bottom:10px;">👥</div>
        <div style="color:var(--nd-text);font-size:13px;font-weight:bold;">Invite Room</div>
        <div style="color:var(--nd-subtext);font-size:10px;margin-top:5px;">Play with others here</div>
      </div>
    </div>
  `;

  content.querySelector('#ct-back')?.addEventListener('click', renderPickScreen);
  ['#ct-solo-btn', '#ct-mp-btn'].forEach(id => {
    const el = content.querySelector(id) as HTMLElement | null;
    if (!el) return;
    el.addEventListener('mouseenter', () => { el.style.background = 'rgba(0,0,0,0.55)'; el.style.borderColor = 'color-mix(in srgb,var(--nd-accent) 55%,transparent)'; });
    el.addEventListener('mouseleave', () => { el.style.background = 'rgba(0,0,0,0.4)'; el.style.borderColor = 'color-mix(in srgb,var(--nd-accent) 20%,transparent)'; });
  });
  content.querySelector('#ct-solo-btn')?.addEventListener('click', () => startGame(meta.id, false));
  content.querySelector('#ct-mp-btn')?.addEventListener('click', () => startLobby(meta.id));
}

function startLobby(gameType: GameType): void {
  activeGameType = gameType;
  activeGameId = makeGameId(gameType);
  isHost = true;
  lobbyPlayers = [{ pubkey: myPubkey(), name: myName() }];
  phase = 'lobby';
  syncHeaderButtons();
  setActiveGameId(activeGameId);
  sendInvite(gameType, activeGameId);
  renderLobby();

  // Receives a GamePlayer each time someone joins
  setInviteHandler((joiner) => {
    if (!lobbyPlayers.find(p => p.pubkey === joiner.pubkey)) {
      lobbyPlayers.push(joiner);
    }
    renderLobby();
  });
}

function renderLobby(): void {
  if (!box) return;
  const meta = GAMES.find(g => g.id === activeGameType)!;
  const content = box.querySelector('#ct-content') as HTMLElement;
  const roomPlayers = getRoomPlayers();
  const pendingPlayers = roomPlayers.filter(p => !lobbyPlayers.find(l => l.pubkey === p.pubkey));

  content.innerHTML = `
    <div style="color:var(--nd-text);font-size:14px;font-weight:bold;letter-spacing:0.06em;text-align:center;margin-bottom:16px;">${meta.icon} ${meta.label} — Lobby</div>

    <div style="margin-bottom:14px;">
      <div style="color:var(--nd-subtext);font-size:9px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">In this game</div>
      ${lobbyPlayers.map((p, i) => `
        <div style="color:var(--nd-text);font-size:12px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
          ${i === 0 ? '👑' : '●'} ${p.name}${p.pubkey === myPubkey() ? ` <span style="color:var(--nd-accent);font-size:10px;opacity:0.7;">(you)</span>` : ''}
        </div>`).join('')}
    </div>

    ${roomPlayers.length === 0
      ? `<div style="color:var(--nd-subtext);font-size:11px;text-align:center;margin-bottom:14px;opacity:0.7;">No other players in the room yet.<br>Invite sent — they'll see a banner when they arrive.</div>`
      : pendingPlayers.length > 0
        ? `<div style="margin-bottom:14px;">
            <div style="color:var(--nd-subtext);font-size:9px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">In this room</div>
            ${pendingPlayers.map(p => `
              <div style="color:var(--nd-subtext);font-size:12px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                ○ ${p.name} <span style="font-size:10px;opacity:0.5;">(waiting for invite banner)</span>
              </div>`).join('')}
          </div>`
        : `<div style="color:var(--nd-accent);font-size:11px;text-align:center;margin-bottom:14px;opacity:0.7;">All room players have joined!</div>`
    }

    <div style="display:flex;gap:10px;justify-content:center;margin-top:12px;">
      <button id="ct-start-btn" style="padding:10px 24px;border-radius:6px;cursor:pointer;font-family:'Courier New',monospace;font-size:11px;font-weight:bold;background:color-mix(in srgb,var(--nd-accent) 18%,transparent);border:1px solid color-mix(in srgb,var(--nd-accent) 50%,transparent);color:var(--nd-accent);">▶ Start (${lobbyPlayers.length})</button>
      <button id="ct-cancel-btn" style="padding:10px 18px;border-radius:6px;cursor:pointer;font-family:'Courier New',monospace;font-size:11px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.14);color:var(--nd-subtext);">Cancel</button>
    </div>
  `;

  content.querySelector('#ct-start-btn')?.addEventListener('click', () => {
    if (!activeGameType || !activeGameId) return;
    sendStart(activeGameId, activeGameType); // broadcasts via chat so all clients receive it
    startGame(activeGameType, true);         // host starts immediately
  });

  content.querySelector('#ct-cancel-btn')?.addEventListener('click', () => {
    if (activeGameId) cancelInvite(activeGameId);
    activeGameId = null; activeGameType = null;
    setInviteHandler(null);
    renderPickScreen();
  });
}

function startGame(gameType: GameType, multiplayer: boolean): void {
  if (!box) return;
  activeGameType = gameType;
  if (!activeGameId) activeGameId = makeGameId(gameType);
  phase = 'game';
  syncHeaderButtons();
  setActiveGameId(activeGameId);
  setInviteHandler(null);

  const content = box.querySelector('#ct-content') as HTMLElement;
  const meta = GAMES.find(g => g.id === gameType)!;

  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
      <button id="ct-back-game" style="background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--nd-subtext);cursor:pointer;font-size:15px;padding:4px 10px;line-height:1;">←</button>
      <div style="color:var(--nd-text);font-size:14px;font-weight:bold;letter-spacing:0.06em;">${meta.icon} ${meta.label}</div>
      ${multiplayer ? '<div style="color:var(--nd-accent);font-size:9px;margin-left:auto;opacity:0.7;letter-spacing:0.06em;">● LIVE</div>' : ''}
    </div>
    <div id="ct-game"></div>
  `;

  const gameContainer = content.querySelector('#ct-game') as HTMLElement;
  const players = multiplayer ? lobbyPlayers : [{ pubkey: myPubkey(), name: myName() }];

  const opts: GameOptions = {
    container: gameContainer,
    multiplayer,
    myPubkey: myPubkey(),
    myName: myName(),
    isHost,
    players,
    gameId: activeGameId,
    send: (msg) => sendGameAction({ ...msg, pubkey: myPubkey() }),
    sendPayload: (payload) => sendGamePayload(activeGameId!, payload),
    onDone: () => {},
  };

  setGameMsgReceiver((msg) => {
    // Handle quit signals before passing to game module
    if (msg.action === 'payload' && msg.payload === 'LEFT' && multiplayer) {
      // A joiner left — show a brief notification but keep playing
      const name = lobbyPlayers.find(p => p.pubkey === msg.from)?.name ?? 'A player';
      lobbyPlayers = lobbyPlayers.filter(p => p.pubkey !== (msg.from as string));
      showGameNotification(`${name} left the game.`);
      return;
    }
    if (msg.action === 'payload' && msg.payload === 'QUIT' && multiplayer) {
      // Host quit — close and return to picker
      GAME_MODULES[gameType]?.destroy();
      setGameMsgReceiver(null);
      setActiveGameId(null);
      activeGameId = null; activeGameType = null;
      isHost = false; lobbyPlayers = []; phase = 'pick';
      renderPickScreen();
      showGameNotification('Host ended the game.');
      return;
    }
    GAME_MODULES[gameType].receiveMsg(msg);
  });

  GAME_MODULES[gameType].start(opts);

  content.querySelector('#ct-back-game')?.addEventListener('click', () => {
    if (multiplayer && activeGameId) sendQuitGame(activeGameId, isHost);
    GAME_MODULES[gameType].destroy();
    setGameMsgReceiver(null);
    setActiveGameId(null);
    activeGameId = null; activeGameType = null;
    isHost = false; lobbyPlayers = [];
    phase = 'pick';
    renderPickScreen();
  });
}

function joinGame(detail: { gameId: string; gameType: GameType; hostPubkey: string; hostName?: string }): void {
  activeGameId = detail.gameId;
  activeGameType = detail.gameType;
  isHost = false;
  lobbyPlayers = [{ pubkey: myPubkey(), name: myName() }];
  phase = 'lobby';

  const hostPlayer: GamePlayer = { pubkey: detail.hostPubkey, name: detail.hostName ?? 'Host' };

  if (!overlay) CardTableModal.show();

  if (!box) return;
  const content = box.querySelector('#ct-content') as HTMLElement;
  const meta = GAMES.find(g => g.id === detail.gameType)!;
  content.innerHTML = `
    <div style="color:var(--nd-text);font-size:15px;font-weight:bold;letter-spacing:0.06em;text-align:center;margin-bottom:10px;">${meta.icon} ${meta.label}</div>
    <div style="color:var(--nd-subtext);font-size:11px;text-align:center;margin-bottom:10px;">Waiting for <b style="color:var(--nd-text);">${hostPlayer.name}</b> to start...</div>
    <div style="text-align:center;color:var(--nd-accent);font-size:11px;opacity:0.7;">● You joined</div>
  `;

  // start / quit arrive via chat interceptor → _gameMsgHandler
  setGameMsgReceiver((msg) => {
    if (msg.action === 'start' && msg.gameId === activeGameId) {
      lobbyPlayers = [hostPlayer, { pubkey: myPubkey(), name: myName() }];
      startGame(detail.gameType, true);
      return;
    }
    // Host ended the game
    if (msg.action === 'payload' && msg.payload === 'QUIT') {
      GAME_MODULES[detail.gameType]?.destroy();
      setGameMsgReceiver(null);
      setActiveGameId(null);
      activeGameId = null; activeGameType = null;
      isHost = false; lobbyPlayers = []; phase = 'pick';
      renderPickScreen();
      showGameNotification(`${hostPlayer.name} ended the game.`);
      return;
    }
    GAME_MODULES[detail.gameType]?.receiveMsg(msg);
  });
}

/**
 * Called by RoomScene.onBeforeRemoveOtherPlayer — fires for any exit (tab close,
 * disconnect, or graceful leave), so it's more reliable than the chat-based quit signal.
 */
export function notifyGamePlayerLeft(pubkey: string): void {
  if (phase !== 'game' || !activeGameId) return;

  const leavingPlayer = lobbyPlayers.find(p => p.pubkey === pubkey);
  if (!leavingPlayer) return; // not part of this game

  const isLeavingHost = !isHost && lobbyPlayers.indexOf(leavingPlayer) === 0;

  if (isLeavingHost) {
    // The host left — joiner should end the game
    if (activeGameType) GAME_MODULES[activeGameType]?.destroy();
    setGameMsgReceiver(null);
    setActiveGameId(null);
    activeGameId = null; activeGameType = null;
    isHost = false; lobbyPlayers = []; phase = 'pick';
    if (overlay && box) renderPickScreen();
    showGameNotification(`${leavingPlayer.name} ended the game.`);
  } else {
    // A joiner left — keep playing, notify host
    lobbyPlayers = lobbyPlayers.filter(p => p.pubkey !== pubkey);
    showGameNotification(`${leavingPlayer.name} left the game.`);
  }
}

function showGameNotification(text: string): void {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed;top:20px;right:20px;z-index:9200;
    background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
    border:1px solid color-mix(in srgb,var(--nd-dpurp) 44%,transparent);
    border-radius:10px;padding:12px 18px;font-family:'Courier New',monospace;
    color:var(--nd-text);font-size:13px;
    box-shadow:0 4px 20px rgba(0,0,0,0.6);max-width:280px;
    pointer-events:none;
  `;
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

export const CardTableModal = {
  isOpen(): boolean { return !!overlay; },

  show(): void {
    if (overlay) return;
    injectStyles();

    overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9000;
      background:rgba(4,2,10,0.92);
      display:flex;align-items:center;justify-content:center;
      font-family:"Courier New",monospace;
    `;

    box = document.createElement('div');
    box.id = 'ct-box';
    box.style.cssText = `
      width:min(820px,96vw);max-height:92vh;overflow-y:auto;
      position:relative;border:1px solid color-mix(in srgb,var(--nd-accent) 35%,transparent);border-radius:12px;
      background-color:${matBg()};background-image:url(${matUrl()});background-size:cover;background-position:center;
      box-shadow:0 24px 80px rgba(0,0,0,0.8),inset 0 0 0 1px rgba(255,255,255,0.04);
      padding:20px 22px 22px;box-sizing:border-box;
    `;
    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);">
        <div style="color:var(--nd-accent);font-size:11px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;opacity:0.8;">♠ Card Table</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button id="ct-deck-toggle" title="Switch card back" style="
            background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.14);border-radius:6px;
            color:rgba(255,255,255,0.55);font-family:'Courier New',monospace;font-size:11px;
            padding:4px 10px;cursor:pointer;letter-spacing:0.04em;
          ">${getCardBackName() === 'Pocket_back01.png' ? '🂠 Deck 2' : '🂠 Deck 1'}</button>
          <button id="ct-mat-toggle" title="Switch table color" style="
            background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.14);border-radius:6px;
            color:rgba(255,255,255,0.55);font-family:'Courier New',monospace;font-size:11px;
            padding:4px 10px;cursor:pointer;letter-spacing:0.04em;
          ">${_boardColor === 'green' ? '🟦 Blue' : '🟩 Green'}</button>
          <button id="ct-close" style="
            background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.14);border-radius:6px;
            color:rgba(255,255,255,0.55);font-family:'Courier New',monospace;font-size:16px;
            line-height:1;padding:4px 10px;cursor:pointer;
          ">×</button>
        </div>
      </div>
      <div id="ct-content"></div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    box.querySelector('#ct-close')?.addEventListener('click', () => CardTableModal.destroy());
    box.querySelector('#ct-deck-toggle')?.addEventListener('click', () => {
      const next = getCardBackName() === 'Pocket_back01.png' ? 'Pocket_back02.png' : 'Pocket_back01.png';
      setCardBack(next);
      (box!.querySelector('#ct-deck-toggle') as HTMLButtonElement).textContent =
        next === 'Pocket_back01.png' ? '🂠 Deck 2' : '🂠 Deck 1';
    });
    box.querySelector('#ct-mat-toggle')?.addEventListener('click', () => {
      _boardColor = _boardColor === 'green' ? 'blue' : 'green';
      box!.style.backgroundColor = matBg();
      box!.style.backgroundImage = `url(${matUrl()})`;
      box!.style.backgroundSize = 'cover';
      box!.style.backgroundPosition = 'center';
      (box!.querySelector('#ct-mat-toggle') as HTMLButtonElement).textContent =
        _boardColor === 'green' ? '🟦 Blue' : '🟩 Green';
    });
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') CardTableModal.destroy(); e.stopPropagation(); });
    overlay.tabIndex = -1;
    overlay.focus();

    renderPickScreen();
  },

  destroy(): void {
    // Notify other players before disconnecting
    if (phase === 'game' && activeGameId && lobbyPlayers.length > 1) {
      sendQuitGame(activeGameId, isHost);
    }
    if (activeGameType) {
      GAME_MODULES[activeGameType]?.destroy();
    }
    setGameMsgReceiver(null);
    setInviteHandler(null);
    setActiveGameId(null);
    activeGameId = null; activeGameType = null;
    isHost = false; lobbyPlayers = []; phase = 'pick';

    overlay?.remove(); overlay = null; box = null;
    document.getElementById('ct-style')?.remove();
  },
};

// Always listen — joinGame opens the modal itself if it isn't already open
window.addEventListener('ct:join-game', (e: Event) => {
  joinGame((e as CustomEvent).detail);
});

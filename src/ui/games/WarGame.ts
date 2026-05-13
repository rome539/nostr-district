import { Card, Suit, CW, CH, cardUrl, imgStyle, mkDeck, shuffle, rl, GameOptions, CardGame, getCardBackUrl } from './cardTypes';

interface WarState {
  myPile:    Card[];
  oppPile:   Card[];
  pot:       Card[];
  myFlipped:  Card | null;
  oppFlipped: Card | null;
  phase:    'flip' | 'war' | 'done';
  myReady:  boolean;
  oppReady: boolean;
  message:  string;
  round:    number;
}

// ── Compact encoding ──────────────────────────────────────────────────────────
// Format (always from HOST perspective):
//   <hostCount>/<guestCount>/<potCount>/<hostCard>/<guestCard>/<phase><round>/<msgCode>
//
// msgCode: N=none  +=host won round  -=guest won round  W=war
//          G=game over host wins     L=game over guest wins  T=tie
//
// Non-host decodes by SWAPPING the perspective.

const RANK_CHARS = '0A23456789TJQK';

function encCard(c: Card | null): string {
  if (!c) return '-';
  return RANK_CHARS[c.rank] + c.suit[0] + (c.up ? '.' : '!');
}

function decCard(s: string): Card | null {
  if (s === '-') return null;
  const suitMap: Record<string, Suit> = { s: 'spades', h: 'hearts', c: 'clubs', d: 'diamonds' };
  return { rank: RANK_CHARS.indexOf(s[0]) as Card['rank'], suit: suitMap[s[1]], up: s[2] === '.' };
}

function msgCode(s: WarState): string {
  if (s.phase === 'done') {
    if (s.message.includes('YOU WIN'))       return 'G';
    if (s.message.includes('OPPONENT WINS')) return 'L';
    return 'T';
  }
  if (s.message.includes('You won'))       return '+';
  if (s.message.includes('Opponent won'))  return '-';
  if (s.message.includes('WAR'))           return 'W';
  return 'N';
}

function decodeMsg(code: string, asHost: boolean): string {
  // asHost=false → swap winner labels
  const w = asHost;
  if (code === '+') return w ? 'You won the round! 🎉'  : 'Opponent won the round!';
  if (code === '-') return w ? 'Opponent won the round!' : 'You won the round! 🎉';
  if (code === 'W') return '⚔️ WAR!';
  if (code === 'G') return w ? 'YOU WIN! 🎉'   : 'Opponent wins!';
  if (code === 'L') return w ? 'Opponent wins!' : 'YOU WIN! 🎉';
  if (code === 'T') return "It's a Draw!";
  return '';
}

function encState(s: WarState): string {
  const ph = s.phase === 'flip' ? 'F' : s.phase === 'war' ? 'W' : 'X';
  return `${s.myPile.length}/${s.oppPile.length}/${s.pot.length}/${encCard(s.myFlipped)}/${encCard(s.oppFlipped)}/${ph}${s.round}/${msgCode(s)}`;
}

function placeholder(n: number): Card[] {
  return Array(n).fill(0).map(() => ({ suit: 'spades' as Suit, rank: 1 as Card['rank'], up: false }));
}

function decState(enc: string, prev: WarState | null, isHost: boolean): WarState {
  const parts = enc.split('/');
  const hostCount  = parseInt(parts[0]) || 0;
  const guestCount = parseInt(parts[1]) || 0;
  const potCount   = parseInt(parts[2]) || 0;
  const hostCard   = decCard(parts[3] ?? '-');
  const guestCard  = decCard(parts[4] ?? '-');
  const phChar = parts[5]?.[0] ?? 'F';
  const phase  = phChar === 'W' ? 'war' : phChar === 'X' ? 'done' : 'flip';
  const round  = parseInt(parts[5]?.slice(1) ?? '0');
  const code   = parts[6] ?? 'N';

  if (isHost) {
    return {
      myPile:    prev?.myPile  ?? placeholder(hostCount),
      oppPile:   prev?.oppPile ?? placeholder(guestCount),
      pot:       placeholder(potCount),
      myFlipped:  hostCard,
      oppFlipped: guestCard,
      myReady:   !!hostCard,
      oppReady:  !!guestCard,
      phase, round,
      message: decodeMsg(code, true),
    };
  }

  // Non-host — swap so "my" = guest side, "opp" = host side.
  // Always use fresh placeholders from decoded counts; prev pile data is meaningless here.
  return {
    myPile:    placeholder(guestCount),
    oppPile:   placeholder(hostCount),
    pot:       placeholder(potCount),
    myFlipped:  guestCard,   // guest's card = "my" card
    oppFlipped: hostCard,    // host's card  = "opp" card
    myReady:   !!guestCard,
    oppReady:  !!hostCard,
    phase, round,
    message: decodeMsg(code, false),
  };
}

// ── Logic ─────────────────────────────────────────────────────────────────────

function cardStrength(c: Card): number { return c.rank === 1 ? 14 : c.rank; }

function aiFlip(s: WarState): WarState {
  if (!s.oppPile.length) return s;
  const card = s.oppPile[s.oppPile.length - 1];
  return { ...s, oppPile: s.oppPile.slice(0, -1), oppFlipped: { ...card, up: true }, oppReady: true };
}

function resolve(s: WarState): WarState {
  if (!s.myFlipped || !s.oppFlipped) return s;
  const myStr  = cardStrength(s.myFlipped);
  const oppStr = cardStrength(s.oppFlipped);
  const pot    = [...s.pot, s.myFlipped, s.oppFlipped];

  if (myStr > oppStr) {
    const won    = shuffle(pot);
    const myPile = [...s.myPile, ...won];
    const isDone = !s.oppPile.length;
    return { ...s, myPile, oppPile: s.oppPile, pot: [], myFlipped: null, oppFlipped: null,
      myReady: false, oppReady: false,
      phase: isDone ? 'done' : 'flip',
      message: isDone ? 'YOU WIN! 🎉' : `You won the round! (+${won.length} cards)`,
      round: s.round + 1 };
  }
  if (oppStr > myStr) {
    const won     = shuffle(pot);
    const oppPile = [...s.oppPile, ...won];
    const isDone  = !s.myPile.length;
    return { ...s, myPile: s.myPile, oppPile, pot: [], myFlipped: null, oppFlipped: null,
      myReady: false, oppReady: false,
      phase: isDone ? 'done' : 'flip',
      message: isDone ? 'OPPONENT WINS' : `Opponent won the round! (+${won.length} cards)`,
      round: s.round + 1 };
  }

  // Tie → WAR
  const myWar  = s.myPile.splice(-Math.min(3, s.myPile.length));
  const oppWar = s.oppPile.splice(-Math.min(3, s.oppPile.length));
  if (!s.myPile.length || !s.oppPile.length) {
    const result = s.myPile.length > 0 ? 'YOU WIN! 🎉' : s.oppPile.length > 0 ? 'OPPONENT WINS' : "DRAW!";
    return { ...s, pot: [...pot, ...myWar, ...oppWar], myFlipped: null, oppFlipped: null,
      myReady: false, oppReady: false, phase: 'done', message: result, round: s.round + 1 };
  }
  return { ...s, pot: [...pot, ...myWar, ...oppWar], myFlipped: null, oppFlipped: null,
    myReady: false, oppReady: false, phase: 'flip',
    message: `⚔️ WAR! ${pot.length + myWar.length + oppWar.length} cards in the pot!`,
    round: s.round + 1 };
}

function dealState(opts: GameOptions): WarState {
  const deck = shuffle(mkDeck());
  const half = Math.floor(deck.length / 2);
  return {
    myPile:  deck.slice(0, half).map(c => ({ ...c, up: false })),
    oppPile: deck.slice(half).map(c => ({ ...c, up: false })),
    pot: [], myFlipped: null, oppFlipped: null,
    phase: 'flip', myReady: false, oppReady: false,
    message: opts.multiplayer ? 'Both players press Flip!' : 'Press Flip to battle!',
    round: 0,
  };
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderPileCard(c: Card | null, label: string): string {
  if (!c) {
    return `<div style="text-align:center;">
      <div style="color:rgba(240,230,208,0.3);font-size:10px;margin-bottom:6px;">${label}</div>
      <div class="ct-slot" style="margin:0 auto;"></div>
    </div>`;
  }
  return `<div style="text-align:center;">
    <div style="color:rgba(240,230,208,0.7);font-size:10px;margin-bottom:6px;">${label}: ${rl(c.rank)} of ${c.suit}</div>
    <div class="ct-card" style="margin:0 auto;"><img src="${cardUrl(`Pocket_${c.suit}.png`)}" style="${imgStyle(c.rank)}" alt=""></div>
  </div>`;
}

function faceDownPile(count: number, label: string): string {
  if (count === 0) return `<div style="text-align:center;"><div style="color:rgba(240,230,208,0.5);font-size:10px;margin-bottom:6px;">${label}: 0</div><div class="ct-slot" style="margin:0 auto;color:rgba(255,255,255,0.2);font-size:11px;">EMPTY</div></div>`;
  return `<div style="text-align:center;">
    <div style="color:rgba(240,230,208,0.7);font-size:10px;margin-bottom:6px;">${label}: ${count}</div>
    <div class="ct-card ct-dn" style="margin:0 auto;"><img src="${getCardBackUrl()}" style="width:${CW}px;height:${CH}px;" alt=""></div>
  </div>`;
}

// ── Module state ──────────────────────────────────────────────────────────────

let _state: WarState | null = null;
let _opts:  GameOptions | null = null;
let _el:    HTMLElement | null = null;

function rerender() {
  if (!_el || !_state || !_opts) return;
  const s       = _state;
  const isMP    = _opts.multiplayer;
  const oppName = isMP ? (_opts.players.find(p => p.pubkey !== _opts!.myPubkey)?.name ?? 'Opponent') : 'CPU';

  let h = `<div style="text-align:center;margin-bottom:4px;color:rgba(240,230,208,0.5);font-size:10px;">Round ${s.round}</div>`;

  // Pile counts
  h += `<div style="display:flex;justify-content:space-around;align-items:center;gap:12px;margin-bottom:20px;">`;
  h += faceDownPile(s.oppPile.length, oppName);
  h += `<div style="text-align:center;color:rgba(240,230,208,0.4);font-size:10px;">POT<br>${s.pot.length}</div>`;
  h += faceDownPile(s.myPile.length, 'You');
  h += `</div>`;

  // Battle cards — always present so height stays fixed
  h += `<div style="display:flex;justify-content:space-around;align-items:center;gap:20px;margin-bottom:20px;">`;
  h += renderPileCard(s.oppFlipped, oppName);
  h += `<div style="font-size:28px;color:rgba(240,230,208,0.25);">VS</div>`;
  h += renderPileCard(s.myFlipped,  'You');
  h += `</div>`;

  const msgColor = s.message.includes('WIN') || s.message.includes('🎉') ? '#5dcaa5'
    : s.message.includes('WAR') ? '#ffd700'
    : s.message.includes('Opponent wins') ? '#ff7070'
    : 'rgba(240,230,208,0.7)';
  h += `<div style="text-align:center;color:${msgColor};font-size:14px;margin-bottom:16px;min-height:22px;">${s.message}</div>`;
  _el.innerHTML = h;

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;';

  if (s.phase === 'done') {
    if (!isMP || _opts.isHost) {
      const btn = document.createElement('button');
      btn.className = 'ct-btn';
      btn.textContent = 'New Game';
      btn.style.cssText = 'padding:9px 20px;border-radius:5px;cursor:pointer;font-family:"Courier New",monospace;font-size:11px;font-weight:bold;background:rgba(0,0,0,0.35);border:1px solid rgba(93,202,165,0.42);color:#d8fff0;';
      btn.addEventListener('click', restartGame);
      btnRow.appendChild(btn);
    } else {
      const msg = document.createElement('div');
      msg.style.cssText = 'color:rgba(255,255,255,0.4);font-size:11px;';
      msg.textContent = 'Waiting for host to start a new game...';
      btnRow.appendChild(msg);
    }
  } else if (s.phase === 'flip' && !s.myReady) {
    const btn = document.createElement('button');
    btn.className = 'ct-btn';
    btn.textContent = s.myPile.length ? '⚔️ Flip!' : 'No cards left';
    btn.disabled = !s.myPile.length;
    btn.style.cssText = 'padding:11px 28px;border-radius:5px;cursor:pointer;font-family:"Courier New",monospace;font-size:13px;font-weight:bold;background:rgba(0,0,0,0.35);border:1px solid rgba(93,202,165,0.42);color:#d8fff0;';
    btn.addEventListener('click', doFlip);
    btnRow.appendChild(btn);
  } else if (s.myReady && !s.oppReady) {
    const msg = document.createElement('div');
    msg.style.cssText = 'color:rgba(255,255,255,0.4);font-size:11px;';
    msg.textContent = `Waiting for ${oppName} to flip...`;
    btnRow.appendChild(msg);
  } else if (!s.myReady && s.oppReady) {
    const btn = document.createElement('button');
    btn.className = 'ct-btn';
    btn.textContent = `${oppName} flipped! ⚔️ Your turn!`;
    btn.style.cssText = 'padding:11px 28px;border-radius:5px;cursor:pointer;font-family:"Courier New",monospace;font-size:13px;font-weight:bold;background:rgba(0,0,0,0.35);border:1px solid rgba(93,202,165,0.52);color:#ffd700;';
    btn.addEventListener('click', doFlip);
    btnRow.appendChild(btn);
  }

  _el.appendChild(btnRow);
}

function applyState(s: WarState) {
  _state = s;
  rerender();
  if (_opts?.multiplayer && _opts.isHost) {
    _opts.sendPayload(encState(s));
  }
}

function restartGame() {
  if (!_opts) return;
  applyState(dealState(_opts));
}

function doFlip() {
  if (!_state || !_opts) return;

  if (_opts.multiplayer && !_opts.isHost) {
    // Non-host: send flip signal and wait for host to confirm with actual card
    _opts.sendPayload('F');
    _state = { ..._state, myReady: true, message: 'Waiting for result...' };
    rerender();
    return;
  }

  // Host or solo
  let s: WarState = JSON.parse(JSON.stringify(_state));
  if (!s.myPile.length) return;
  const myCard = s.myPile.pop()!;
  s.myFlipped = { ...myCard, up: true };
  s.myReady = true;

  if (!_opts.multiplayer) {
    s = aiFlip(s);
  }

  if (s.myReady && s.oppReady) {
    applyState(s);
    setTimeout(() => applyState(resolve(s)), 900);
  } else {
    s.message = 'Waiting for opponent to flip...';
    applyState(s);
  }
}

// ── CardGame interface ────────────────────────────────────────────────────────

export const WarGame: CardGame = {
  start(opts: GameOptions) {
    _opts = opts;
    _el   = opts.container;

    if (opts.multiplayer && !opts.isHost) {
      // Non-host waits for the host to broadcast the initial deal
      _state = { myPile: [], oppPile: [], pot: [], myFlipped: null, oppFlipped: null,
        phase: 'flip', myReady: false, oppReady: false,
        message: 'Waiting for host to deal...', round: 0 };
      rerender();
    } else {
      _state = dealState(opts);
      // Host broadcasts the initial deal so both players see the same pile counts
      applyState(_state);
    }
  },

  receiveMsg(msg: Record<string, unknown>) {
    if (!_opts || !_state) return;
    if (msg.action !== 'payload' || typeof msg.payload !== 'string') return;

    const payload = msg.payload as string;

    if (_opts.isHost && payload === 'F') {
      // Guest flipped — host resolves
      let s: WarState = JSON.parse(JSON.stringify(_state));
      if (!s.oppPile.length) return;
      const oppCard = s.oppPile.pop()!;
      s.oppFlipped = { ...oppCard, up: true };
      s.oppReady   = true;
      if (s.myReady && s.oppReady) {
        applyState(s);
        setTimeout(() => applyState(resolve(s)), 900);
      } else {
        s.message = 'Opponent flipped! Your turn.';
        applyState(s);
      }
      return;
    }

    if (!_opts.isHost && msg.from !== _opts.myPubkey) {
      // Non-host receives new state from host — decode with swapped perspective
      const decoded = decState(payload, _state, false);
      _state = decoded;
      rerender();
    }
  },

  destroy() {
    _state = null; _opts = null; _el = null;
  },
};

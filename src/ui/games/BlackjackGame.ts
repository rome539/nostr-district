import { Card, Suit, CW, CH, cardUrl, imgStyle, mkDeck, shuffle, rl, GameOptions, CardGame, getCardBackUrl } from './cardTypes';

// ── Card compact encoding (3 chars each: rank + suit + face) ─────────────────
// Rank chars: A 2 3 4 5 6 7 8 9 T J Q K
// Suit chars: s h c d
// Face: . = up, ! = down
const RANK_CHARS = '0A23456789TJQK';

function encCard(c: Card): string {
  return RANK_CHARS[c.rank] + c.suit[0] + (c.up ? '.' : '!');
}

function decCard(s: string): Card {
  const rank = RANK_CHARS.indexOf(s[0]) as Card['rank'];
  const suitMap: Record<string, Suit> = { s: 'spades', h: 'hearts', c: 'clubs', d: 'diamonds' };
  return { rank, suit: suitMap[s[1]], up: s[2] === '.' };
}

function encHand(cards: Card[]): string { return cards.map(encCard).join(''); }
function decHand(s: string): Card[] {
  const cards: Card[] = [];
  for (let i = 0; i + 2 < s.length; i += 3) cards.push(decCard(s.slice(i, i + 3)));
  return cards;
}

// ── Game types ────────────────────────────────────────────────────────────────

interface BjPlayer {
  pubkey: string;
  name: string;
  hand: Card[];
  status: 'playing' | 'stood' | 'bust' | 'blackjack';
  result: 'win' | 'lose' | 'push' | null;
}

interface BjState {
  deck: Card[];
  dealer: Card[];
  players: BjPlayer[];
  phase: 'playing' | 'dealer' | 'done';
  currentIdx: number;
}

// ── Compact state encode/decode ───────────────────────────────────────────────
// Format: <phase><idx>|<dealerCards>|<p0hand>/<p0status>/<p0result>|<p1hand>/...
// phase: P=playing D=dealer X=done
// status: P=playing S=stood B=bust K=blackjack
// result: W=win L=lose U=push N=null

function encState(s: BjState, players: { pubkey: string; name: string }[]): string {
  const ph = s.phase === 'playing' ? 'P' : s.phase === 'dealer' ? 'D' : 'X';
  const dealer = encHand(s.dealer);
  const pp = s.players.map(p => {
    const st = p.status === 'playing' ? 'P' : p.status === 'stood' ? 'S' : p.status === 'bust' ? 'B' : 'K';
    const rs = p.result === 'win' ? 'W' : p.result === 'lose' ? 'L' : p.result === 'push' ? 'U' : 'N';
    return `${encHand(p.hand)}/${st}/${rs}`;
  }).join('|');
  return `${ph}${s.currentIdx}|${dealer}|${pp}`;
}

function decState(enc: string, players: { pubkey: string; name: string }[]): BjState {
  const parts = enc.split('|');
  const header = parts[0];
  const ph = header[0] === 'P' ? 'playing' : header[0] === 'D' ? 'dealer' : 'done';
  const currentIdx = parseInt(header[1]) || 0;
  const dealer = decHand(parts[1] ?? '');
  const bjPlayers: BjPlayer[] = (parts.slice(2) ?? []).map((chunk, i) => {
    const [handStr, stChar, rsChar] = chunk.split('/');
    const hand = decHand(handStr ?? '');
    const status = stChar === 'S' ? 'stood' : stChar === 'B' ? 'bust' : stChar === 'K' ? 'blackjack' : 'playing';
    const result = rsChar === 'W' ? 'win' : rsChar === 'L' ? 'lose' : rsChar === 'U' ? 'push' : null;
    return { pubkey: players[i]?.pubkey ?? '', name: players[i]?.name ?? '', hand, status, result };
  });
  return { deck: [], dealer, players: bjPlayers, phase: ph, currentIdx };
}

// ── Blackjack logic ───────────────────────────────────────────────────────────

function handVal(cards: Card[]): number {
  let val = 0, aces = 0;
  for (const c of cards) {
    if (c.rank === 1) { aces++; val += 11; }
    else val += Math.min(c.rank, 10);
  }
  while (val > 21 && aces > 0) { val -= 10; aces--; }
  return val;
}

function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handVal(cards) === 21;
}

function dealInitial(players: { pubkey: string; name: string }[], deck: Card[]): BjState {
  const bjPlayers: BjPlayer[] = players.map(p => ({ ...p, hand: [], status: 'playing', result: null }));
  const dealer: Card[] = [];
  for (let i = 0; i < 2; i++) {
    for (const p of bjPlayers) p.hand.push({ ...deck.pop()!, up: true });
    dealer.push({ ...deck.pop()!, up: i === 0 });
  }
  for (const p of bjPlayers) {
    if (isBlackjack(p.hand)) p.status = 'blackjack';
  }
  const firstActive = bjPlayers.findIndex(p => p.status === 'playing');
  return { deck, dealer, players: bjPlayers, phase: firstActive === -1 ? 'dealer' : 'playing', currentIdx: Math.max(0, firstActive) };
}

function resolveDealer(s: BjState): BjState {
  const st: BjState = JSON.parse(JSON.stringify(s));
  st.dealer.forEach(c => c.up = true);
  while (handVal(st.dealer) < 17) st.dealer.push({ ...st.deck.pop()!, up: true });
  const dv = handVal(st.dealer);
  const dBust = dv > 21;
  for (const p of st.players) {
    if (p.status === 'bust') { p.result = 'lose'; continue; }
    const pv = handVal(p.hand);
    if (p.status === 'blackjack') p.result = dBust || !isBlackjack(st.dealer) ? 'win' : 'push';
    else if (dBust || pv > dv) p.result = 'win';
    else if (pv === dv) p.result = 'push';
    else p.result = 'lose';
  }
  st.phase = 'done';
  return st;
}

function nextTurn(s: BjState): BjState {
  const st: BjState = JSON.parse(JSON.stringify(s));
  let next = st.currentIdx + 1;
  while (next < st.players.length && st.players[next].status !== 'playing') next++;
  if (next >= st.players.length) return resolveDealer({ ...st, phase: 'dealer' });
  st.currentIdx = next;
  return st;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderCards(cards: Card[], highlight = false): string {
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;">${cards.map(c =>
    c.up
      ? `<div class="ct-card${highlight ? ' ct-sel' : ''}" style="flex-shrink:0;"><img src="${cardUrl(`Pocket_${c.suit}.png`)}" style="${imgStyle(c.rank)}" alt="${rl(c.rank)}${c.suit}"></div>`
      : `<div class="ct-card ct-dn" style="flex-shrink:0;"><img src="${getCardBackUrl()}" style="width:${CW}px;height:${CH}px;" alt=""></div>`
  ).join('')}</div>`;
}

function renderState(s: BjState, myPubkey: string): string {
  const dv = s.phase === 'done' ? handVal(s.dealer) : handVal(s.dealer.filter(c => c.up));
  const dLabel = s.phase === 'done' ? `${dv}${dv > 21 ? ' BUST' : ''}` : `${dv}+?`;
  let h = `<div style="text-align:center;margin-bottom:20px;">
    <div style="color:rgba(240,230,208,0.7);font-size:11px;margin-bottom:8px;">DEALER — ${dLabel}</div>
    ${renderCards(s.dealer)}
  </div>`;
  h += `<div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-bottom:20px;">`;
  for (const p of s.players) {
    const isMe = p.pubkey === myPubkey;
    const pv = handVal(p.hand);
    const statusColor = p.result === 'win' ? '#5dcaa5' : p.result === 'lose' ? '#ff7070' : p.result === 'push' ? '#f0e6d0' : 'rgba(240,230,208,0.7)';
    const label = p.result === 'win' ? 'WIN' : p.result === 'lose' ? 'LOSE' : p.result === 'push' ? 'PUSH' : p.status === 'bust' ? 'BUST' : p.status === 'blackjack' ? 'BLACKJACK' : p.status === 'stood' ? `STOOD: ${pv}` : `${pv}`;
    h += `<div style="text-align:center;">
      <div style="color:${statusColor};font-size:10px;margin-bottom:6px;">${isMe ? '▶ ' : ''}${p.name}${isMe ? ' (you)' : ''} — ${label}</div>
      ${renderCards(p.hand, isMe && s.players[s.currentIdx]?.pubkey === myPubkey && s.phase === 'playing')}
    </div>`;
  }
  h += `</div>`;
  return h;
}

// ── Module state ──────────────────────────────────────────────────────────────

let _state: BjState | null = null;
let _opts: GameOptions | null = null;
let _el: HTMLElement | null = null;

function rerender() {
  if (!_el || !_state || !_opts) return;
  const s = _state;
  const myPubkey = _opts.myPubkey;
  const isMyTurn = s.phase === 'playing' && s.players[s.currentIdx]?.pubkey === myPubkey;

  _el.innerHTML = renderState(s, myPubkey);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-top:8px;';

  if (s.phase === 'done') {
    const newBtn = document.createElement('button');
    newBtn.className = 'ct-btn';
    newBtn.textContent = 'New Hand';
    newBtn.style.cssText = 'padding:9px 20px;border-radius:5px;cursor:pointer;font-family:"Courier New",monospace;font-size:11px;font-weight:bold;background:rgba(0,0,0,0.35);border:1px solid rgba(93,202,165,0.42);color:#d8fff0;';
    newBtn.addEventListener('click', () => startRound());
    btnRow.appendChild(newBtn);
  } else if (isMyTurn) {
    const hit = document.createElement('button');
    hit.className = 'ct-btn';
    hit.textContent = 'Hit';
    hit.style.cssText = 'padding:9px 20px;border-radius:5px;cursor:pointer;font-family:"Courier New",monospace;font-size:11px;font-weight:bold;background:rgba(0,0,0,0.35);border:1px solid rgba(93,202,165,0.42);color:#d8fff0;';
    hit.addEventListener('click', doHit);

    const stand = document.createElement('button');
    stand.className = 'ct-btn';
    stand.textContent = 'Stand';
    stand.style.cssText = 'padding:9px 20px;border-radius:5px;cursor:pointer;font-family:"Courier New",monospace;font-size:11px;font-weight:bold;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.16);color:rgba(255,255,255,0.7);';
    stand.addEventListener('click', doStand);

    btnRow.appendChild(hit);
    btnRow.appendChild(stand);
  } else if (s.phase === 'playing') {
    const w = document.createElement('div');
    w.style.cssText = 'color:rgba(255,255,255,0.4);font-size:11px;text-align:center;margin-top:8px;';
    w.textContent = `Waiting for ${s.players[s.currentIdx]?.name ?? ''}...`;
    _el.appendChild(w);
  }

  _el.appendChild(btnRow);
}

// Broadcast state to all players via compact chat payload
function broadcastState(s: BjState) {
  if (!_opts?.multiplayer || !_opts.isHost) return;
  _opts.sendPayload(encState(s, _opts.players));
}

function applyState(s: BjState) {
  _state = s;
  rerender();
  broadcastState(s);
}

function startRound() {
  if (!_opts) return;
  const deck = shuffle(mkDeck());
  applyState(dealInitial(_opts.players, deck));
}

function doHit() {
  if (!_state || !_opts) return;
  if (_opts.multiplayer && !_opts.isHost) {
    // Non-host: send action to host via chat
    _opts.sendPayload('H');
    return;
  }
  const s: BjState = JSON.parse(JSON.stringify(_state));
  const p = s.players[s.currentIdx];
  if (!p || p.status !== 'playing') return;
  p.hand.push({ ...s.deck.pop()!, up: true });
  if (handVal(p.hand) > 21) { p.status = 'bust'; applyState(nextTurn(s)); }
  else if (handVal(p.hand) === 21) { p.status = 'stood'; applyState(nextTurn(s)); }
  else applyState(s);
}

function doStand() {
  if (!_state || !_opts) return;
  if (_opts.multiplayer && !_opts.isHost) {
    _opts.sendPayload('S');
    return;
  }
  const s: BjState = JSON.parse(JSON.stringify(_state));
  const p = s.players[s.currentIdx];
  if (!p || p.status !== 'playing') return;
  p.status = 'stood';
  applyState(nextTurn(s));
}

// ── CardGame interface ────────────────────────────────────────────────────────

export const BlackjackGame: CardGame = {
  start(opts: GameOptions) {
    _opts = opts;
    _el = opts.container;
    startRound();
  },

  receiveMsg(msg: Record<string, unknown>) {
    if (!_opts || !_state) return;

    // Chat-based compact payload
    if (msg.action === 'payload' && typeof msg.payload === 'string') {
      const payload = msg.payload as string;
      const from = msg.from as string;

      if (_opts.isHost) {
        // Host receives actions from other players
        if (payload === 'H') doHit();
        else if (payload === 'S') doStand();
      } else {
        // Non-host receives state from host
        if (from !== _opts.myPubkey) {
          _state = decState(payload, _opts.players);
          rerender();
        }
      }
      return;
    }
  },

  destroy() {
    _state = null; _opts = null; _el = null;
  },
};

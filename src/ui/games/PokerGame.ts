import { Card, CW, CH, cardUrl, imgStyle, mkDeck, shuffle, rl, GameOptions, CardGame, getCardBackUrl } from './cardTypes';

interface HandResult { rank: number; name: string; key: number[]; }

function evalHand(cards: Card[]): HandResult {
  const ranks = cards.map(c => c.rank === 1 ? 14 : c.rank);
  const suits = cards.map(c => c.suit);
  const isFlush = new Set(suits).size === 1;

  const sorted = [...ranks].sort((a, b) => b - a);
  const straight = sorted[0] - sorted[4] === 4 && new Set(sorted).size === 5;
  const wheel = sorted[0] === 14 && sorted[1] === 5 && sorted[2] === 4 && sorted[3] === 3 && sorted[4] === 2;

  const cnt: Record<number, number> = {};
  for (const r of ranks) cnt[r] = (cnt[r] || 0) + 1;
  // Sort cards by frequency desc then rank desc for proper tiebreaking
  const key = Object.entries(cnt)
    .sort(([ra, ca], [rb, cb]) => ca !== cb ? cb - ca : +rb - +ra)
    .flatMap(([r, c]) => Array(c).fill(+r));
  const groups = Object.values(cnt).sort((a, b) => b - a);

  if (isFlush && (straight || wheel)) {
    return { rank: 8, name: straight && sorted[0] === 14 ? 'Royal Flush' : 'Straight Flush', key: wheel ? [5, 4, 3, 2, 1] : sorted };
  }
  if (groups[0] === 4) return { rank: 7, name: 'Four of a Kind', key };
  if (groups[0] === 3 && groups[1] === 2) return { rank: 6, name: 'Full House', key };
  if (isFlush) return { rank: 5, name: 'Flush', key: sorted };
  if (straight) return { rank: 4, name: 'Straight', key: sorted };
  if (wheel) return { rank: 4, name: 'Straight', key: [5, 4, 3, 2, 1] };
  if (groups[0] === 3) return { rank: 3, name: 'Three of a Kind', key };
  if (groups[0] === 2 && groups[1] === 2) return { rank: 2, name: 'Two Pair', key };
  if (groups[0] === 2) return { rank: 1, name: 'One Pair', key };
  return { rank: 0, name: 'High Card', key: sorted };
}

function compareHands(a: HandResult, b: HandResult): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.min(a.key.length, b.key.length); i++) {
    if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
  }
  return 0;
}

function aiDiscardMask(hand: Card[]): boolean[] {
  const ranks = hand.map(c => c.rank);
  const suits = hand.map(c => c.suit);
  const cnt: Record<number, number> = {};
  for (const r of ranks) cnt[r] = (cnt[r] || 0) + 1;
  const groups = Object.values(cnt).sort((a, b) => b - a);

  // Keep made hands
  if (groups[0] >= 4 || (groups[0] === 3 && groups[1] === 2)) return hand.map(() => false);

  const suitCnt: Record<string, number> = {};
  for (const s of suits) suitCnt[s] = (suitCnt[s] || 0) + 1;
  const maxSuit = Math.max(...Object.values(suitCnt));
  if (maxSuit === 4 && groups[0] < 3) {
    const dominantSuit = Object.entries(suitCnt).find(([, c]) => c === 4)![0];
    return hand.map(c => c.suit !== dominantSuit);
  }

  const sorted = hand.map(c => c.rank === 1 ? 14 : c.rank).sort((a, b) => b - a);
  const isStraight = sorted[0] - sorted[4] === 4 && new Set(sorted).size === 5;
  if (isStraight) return hand.map(() => false);

  // Keep pairs/trips, discard rest
  return hand.map(c => (cnt[c.rank] ?? 0) < 2);
}

interface PokerState {
  deck: Card[];
  playerHand: Card[];
  aiHand: Card[];
  discardMask: boolean[];
  phase: 'discard' | 'result';
  playerResult: HandResult | null;
  aiResult: HandResult | null;
  winner: 'player' | 'ai' | 'tie' | null;
}

let _state: PokerState | null = null;
let _opts: GameOptions | null = null;
let _el: HTMLElement | null = null;

function newHand(): PokerState {
  const deck = shuffle(mkDeck());
  const playerHand = Array.from({ length: 5 }, () => ({ ...deck.pop()!, up: true }));
  const aiHand = Array.from({ length: 5 }, () => ({ ...deck.pop()!, up: false }));
  return { deck, playerHand, aiHand, discardMask: Array(5).fill(false), phase: 'discard', playerResult: null, aiResult: null, winner: null };
}

function doDiscard() {
  if (!_state) return;
  const s: PokerState = JSON.parse(JSON.stringify(_state));
  // Player draws
  s.playerHand = s.playerHand.map((c, i) => s.discardMask[i] ? { ...s.deck.pop()!, up: true } : c);
  s.discardMask = Array(5).fill(false);

  // AI discards and draws
  const aiMask = aiDiscardMask(s.aiHand);
  s.aiHand = s.aiHand.map((c, i) => aiMask[i] ? { ...s.deck.pop()!, up: true } : c);

  // Evaluate
  s.playerResult = evalHand(s.playerHand);
  s.aiResult = evalHand(s.aiHand);
  const cmp = compareHands(s.playerResult, s.aiResult);
  s.winner = cmp > 0 ? 'player' : cmp < 0 ? 'ai' : 'tie';
  s.phase = 'result';
  _state = s;
  rerender();
}

function rerender() {
  if (!_el || !_state) return;
  const s = _state;

  let h = '';

  // AI hand
  h += `<div style="text-align:center;margin-bottom:16px;">`;
  h += `<div style="color:rgba(240,230,208,0.6);font-size:11px;margin-bottom:8px;">DEALER${s.phase === 'result' && s.aiResult ? ` — ${s.aiResult.name}` : ''}</div>`;
  h += `<div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">`;
  for (const c of s.aiHand) {
    if (s.phase === 'result') {
      h += `<div class="ct-card" style="flex-shrink:0;"><img src="${cardUrl(`Pocket_${c.suit}.png`)}" style="${imgStyle(c.rank)}" alt=""></div>`;
    } else {
      h += `<div class="ct-card ct-dn" style="flex-shrink:0;"><img src="${getCardBackUrl()}" style="width:${CW}px;height:${CH}px;" alt=""></div>`;
    }
  }
  h += `</div></div>`;

  if (s.phase === 'result' && s.winner) {
    const msg = s.winner === 'player' ? 'YOU WIN! 🎉' : s.winner === 'ai' ? 'DEALER WINS' : "IT'S A TIE";
    const col = s.winner === 'player' ? '#5dcaa5' : s.winner === 'ai' ? '#ff7070' : '#f0e6d0';
    h += `<div style="text-align:center;color:${col};font-size:18px;font-weight:bold;margin:12px 0;">${msg}</div>`;
  }

  // Player hand
  h += `<div style="text-align:center;margin-bottom:16px;">`;
  h += `<div style="color:rgba(240,230,208,0.6);font-size:11px;margin-bottom:8px;">YOUR HAND${s.phase === 'result' && s.playerResult ? ` — ${s.playerResult.name}` : ''}${s.phase === 'discard' ? ' — Click cards to discard' : ''}</div>`;
  h += `<div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;" id="ct-player-hand">`;
  for (let i = 0; i < s.playerHand.length; i++) {
    const c = s.playerHand[i];
    const selected = s.discardMask[i];
    const outline = selected ? ' ct-sel' : '';
    const opacity = selected ? 'opacity:0.5;' : '';
    h += `<div class="ct-card${outline}" data-discard="${i}" style="flex-shrink:0;cursor:${s.phase === 'discard' ? 'pointer' : 'default'};${opacity};"><img src="${cardUrl(`Pocket_${c.suit}.png`)}" style="${imgStyle(c.rank)}" alt="${rl(c.rank)}${c.suit}"></div>`;
  }
  h += `</div>`;
  if (s.phase === 'discard') {
    const cnt = s.discardMask.filter(Boolean).length;
    h += `<div style="color:rgba(240,230,208,0.4);font-size:10px;margin-top:6px;">${cnt > 0 ? `${cnt} card${cnt > 1 ? 's' : ''} to discard` : 'Click cards to mark for discard'}</div>`;
  }
  h += `</div>`;

  _el.innerHTML = h;

  // Bind discard clicks
  if (s.phase === 'discard') {
    _el.querySelectorAll('[data-discard]').forEach(el => {
      el.addEventListener('click', () => {
        const i = +(el as HTMLElement).dataset.discard!;
        if (!_state) return;
        _state.discardMask[i] = !_state.discardMask[i];
        rerender();
      });
    });
  }

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-top:8px;';

  if (s.phase === 'discard') {
    const drawBtn = document.createElement('button');
    drawBtn.className = 'ct-btn';
    const cnt = s.discardMask.filter(Boolean).length;
    drawBtn.textContent = cnt > 0 ? `Discard ${cnt} & Draw` : 'Keep Hand & Draw';
    drawBtn.style.cssText = 'padding:9px 20px;border-radius:5px;cursor:pointer;font-family:"Courier New",monospace;font-size:11px;font-weight:bold;background:rgba(0,0,0,0.35);border:1px solid rgba(93,202,165,0.42);color:#d8fff0;';
    drawBtn.addEventListener('click', doDiscard);
    btnRow.appendChild(drawBtn);
  } else {
    const newBtn = document.createElement('button');
    newBtn.className = 'ct-btn';
    newBtn.textContent = 'New Hand';
    newBtn.style.cssText = 'padding:9px 20px;border-radius:5px;cursor:pointer;font-family:"Courier New",monospace;font-size:11px;font-weight:bold;background:rgba(0,0,0,0.35);border:1px solid rgba(93,202,165,0.42);color:#d8fff0;';
    newBtn.addEventListener('click', () => { _state = newHand(); rerender(); });
    btnRow.appendChild(newBtn);
  }
  _el.appendChild(btnRow);
}

export const PokerGame: CardGame = {
  start(opts: GameOptions) {
    _opts = opts;
    _el = opts.container;
    _state = newHand();
    rerender();
  },

  receiveMsg(_msg: Record<string, unknown>) {},

  destroy() {
    _state = null; _opts = null; _el = null;
  },
};

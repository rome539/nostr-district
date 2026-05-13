import { Card, Suit, SUITS, mkDeck, shuffle, rl, GameOptions, CardGame } from './cardTypes';

interface GfState {
  myHand: Card[];
  aiHand: Card[];
  deck: Card[];
  myBooks: number;
  aiBooks: number;
  phase: 'myTurn' | 'aiTurn' | 'done';
  message: string;
  pendingAsk: number | null; // rank player is waiting on
}

function collectBooks(hand: Card[]): { hand: Card[]; books: number } {
  const cnt: Record<number, number> = {};
  for (const c of hand) cnt[c.rank] = (cnt[c.rank] || 0) + 1;
  const books = Object.values(cnt).filter(c => c === 4).length;
  const newHand = books > 0 ? hand.filter(c => cnt[c.rank] < 4) : hand;
  return { hand: newHand, books };
}

function uniqueRanks(hand: Card[]): number[] {
  return [...new Set(hand.map(c => c.rank))].sort((a, b) => a - b);
}

function aiPick(hand: Card[]): number {
  const cnt: Record<number, number> = {};
  for (const c of hand) cnt[c.rank] = (cnt[c.rank] || 0) + 1;
  return +Object.entries(cnt).sort(([, a], [, b]) => b - a)[0][0];
}

function newState(): GfState {
  const deck = shuffle(mkDeck());
  const myHand = Array.from({ length: 7 }, () => ({ ...deck.pop()!, up: true }));
  const aiHand = Array.from({ length: 7 }, () => ({ ...deck.pop()!, up: false }));
  const myB = collectBooks(myHand);
  const aiB = collectBooks(aiHand);
  return {
    myHand: myB.hand, aiHand: aiB.hand, deck,
    myBooks: myB.books, aiBooks: aiB.books,
    phase: 'myTurn', message: 'Your turn! Ask for a rank you hold.', pendingAsk: null,
  };
}

function checkDone(s: GfState): boolean {
  return !s.myHand.length && !s.aiHand.length && !s.deck.length;
}

let _state: GfState | null = null;
let _opts: GameOptions | null = null;
let _el: HTMLElement | null = null;

function rerender() {
  if (!_el || !_state) return;
  const s = _state;
  const ranks = uniqueRanks(s.myHand);

  const msgColor = s.message.includes('WIN') ? '#5dcaa5' : s.message.includes('LOSE') || s.message.includes('CPU wins') ? '#ff7070' : s.message.includes('Book!') ? '#ffd700' : 'rgba(240,230,208,0.8)';

  let h = `
    <div style="display:flex;justify-content:space-between;margin-bottom:12px;padding:0 4px;">
      <div style="text-align:center;">
        <div style="color:rgba(240,230,208,0.5);font-size:9px;">CPU HAND</div>
        <div style="color:#f0e6d0;font-size:18px;">${s.aiHand.length} cards</div>
        <div style="color:rgba(240,230,208,0.5);font-size:9px;">Books: ${s.aiBooks}</div>
      </div>
      <div style="text-align:center;">
        <div style="color:rgba(240,230,208,0.5);font-size:9px;">DECK</div>
        <div style="color:#f0e6d0;font-size:18px;">${s.deck.length}</div>
      </div>
      <div style="text-align:center;">
        <div style="color:rgba(240,230,208,0.5);font-size:9px;">YOUR BOOKS</div>
        <div style="color:#5dcaa5;font-size:18px;">${s.myBooks}</div>
        <div style="color:rgba(240,230,208,0.5);font-size:9px;">${s.myHand.length} cards</div>
      </div>
    </div>
    <div style="text-align:center;color:${msgColor};font-size:13px;min-height:36px;margin-bottom:14px;padding:0 8px;">${s.message}</div>
  `;

  if (s.phase === 'myTurn' && ranks.length > 0) {
    h += `<div style="color:rgba(240,230,208,0.5);font-size:10px;text-align:center;margin-bottom:8px;">Ask CPU for:</div>`;
    h += `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:16px;" id="ct-rank-btns">`;
    for (const rank of ranks) {
      h += `<button class="ct-btn gf-ask" data-rank="${rank}" style="padding:8px 14px;border-radius:5px;cursor:pointer;font-family:'Courier New',monospace;font-size:13px;font-weight:bold;background:rgba(0,0,0,0.35);border:1px solid rgba(93,202,165,0.42);color:#d8fff0;min-width:44px;">${rl(rank)}</button>`;
    }
    h += `</div>`;
  }

  h += `<div style="margin-top:8px;">
    <div style="color:rgba(240,230,208,0.5);font-size:9px;text-align:center;margin-bottom:6px;">YOUR HAND</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;">
  `;
  for (const c of s.myHand) {
    h += `<div style="text-align:center;font-family:'Courier New',monospace;font-size:11px;color:#f0e6d0;">
      <div style="width:28px;height:40px;background:rgba(255,255,255,0.9);border-radius:3px;display:flex;align-items:center;justify-content:center;color:${c.suit === 'hearts' || c.suit === 'diamonds' ? '#cc2222' : '#111'};font-weight:bold;font-size:13px;">${rl(c.rank)}</div>
    </div>`;
  }
  h += `</div></div>`;

  if (s.phase === 'done') {
    const newBtn = `<div style="text-align:center;margin-top:16px;"><button class="ct-btn" id="ct-gf-new" style="padding:9px 20px;border-radius:5px;cursor:pointer;font-family:'Courier New',monospace;font-size:11px;font-weight:bold;background:rgba(0,0,0,0.35);border:1px solid rgba(93,202,165,0.42);color:#d8fff0;">New Game</button></div>`;
    h += newBtn;
  }

  _el.innerHTML = h;

  _el.querySelectorAll('.gf-ask').forEach(btn => {
    btn.addEventListener('click', () => {
      const rank = +(btn as HTMLElement).dataset.rank!;
      doAsk(rank);
    });
  });

  _el.querySelector('#ct-gf-new')?.addEventListener('click', () => { _state = newState(); rerender(); });
}

function doAsk(rank: number) {
  if (!_state || _state.phase !== 'myTurn') return;
  let s: GfState = JSON.parse(JSON.stringify(_state));

  const matching = s.aiHand.filter(c => c.rank === rank);
  if (matching.length > 0) {
    s.aiHand = s.aiHand.filter(c => c.rank !== rank);
    s.myHand.push(...matching.map(c => ({ ...c, up: true })));
    const b = collectBooks(s.myHand);
    const newBooks = b.books;
    s.myHand = b.hand;
    s.myBooks += newBooks;
    const msg = newBooks > 0
      ? `Got ${matching.length} ${rl(rank)}(s) from CPU! Book collected! 📚 Ask again!`
      : `Got ${matching.length} ${rl(rank)}(s) from CPU! Ask again!`;
    s.message = msg;
    s.phase = checkDone(s) ? 'done' : 'myTurn';
  } else {
    if (s.deck.length) {
      const drawn = { ...s.deck.pop()!, up: true };
      s.myHand.push(drawn);
      const b = collectBooks(s.myHand);
      s.myHand = b.hand;
      s.myBooks += b.books;
      const bookMsg = b.books > 0 ? ' Book collected! 📚' : '';
      s.message = `Go Fish! Drew: ${rl(drawn.rank)}${bookMsg}`;
    } else {
      s.message = `Go Fish! Deck is empty.`;
    }
    s.phase = checkDone(s) ? 'done' : 'aiTurn';
  }

  if (s.phase === 'done') {
    s.message = s.myBooks > s.aiBooks ? '🎉 YOU WIN!' : s.myBooks < s.aiBooks ? 'CPU wins!' : "It's a tie!";
  }

  _state = s;
  rerender();

  if (s.phase === 'aiTurn') setTimeout(doAiTurn, 900);
}

function doAiTurn() {
  if (!_state || _state.phase !== 'aiTurn') return;
  let s: GfState = JSON.parse(JSON.stringify(_state));

  if (!s.aiHand.length) {
    s.phase = checkDone(s) ? 'done' : 'myTurn';
    s.message = s.phase === 'done'
      ? (s.myBooks > s.aiBooks ? '🎉 YOU WIN!' : s.myBooks < s.aiBooks ? 'CPU wins!' : "It's a tie!")
      : 'CPU has no cards. Your turn!';
    _state = s;
    rerender();
    return;
  }

  const rank = aiPick(s.aiHand);
  const matching = s.myHand.filter(c => c.rank === rank);

  if (matching.length > 0) {
    s.myHand = s.myHand.filter(c => c.rank !== rank);
    s.aiHand.push(...matching.map(c => ({ ...c, up: false })));
    const b = collectBooks(s.aiHand);
    s.aiHand = b.hand;
    s.aiBooks += b.books;
    const bookMsg = b.books > 0 ? ' Got a book!' : '';
    s.message = `CPU asked for ${rl(rank)}s and got ${matching.length}!${bookMsg} CPU goes again.`;
    s.phase = checkDone(s) ? 'done' : 'aiTurn';
  } else {
    if (s.deck.length) {
      const drawn = s.deck.pop()!;
      s.aiHand.push({ ...drawn, up: false });
      const b = collectBooks(s.aiHand);
      s.aiHand = b.hand;
      s.aiBooks += b.books;
      s.message = `CPU asked for ${rl(rank)}s — Go Fish! Your turn.`;
    } else {
      s.message = `CPU asked for ${rl(rank)}s — deck empty. Your turn.`;
    }
    s.phase = checkDone(s) ? 'done' : 'myTurn';
  }

  if (s.phase === 'done') {
    s.message = s.myBooks > s.aiBooks ? '🎉 YOU WIN!' : s.myBooks < s.aiBooks ? 'CPU wins!' : "It's a tie!";
  }

  _state = s;
  rerender();

  if (s.phase === 'aiTurn') setTimeout(doAiTurn, 900);
}

export const GoFishGame: CardGame = {
  start(opts: GameOptions) {
    _opts = opts;
    _el = opts.container;
    _state = newState();
    rerender();
  },

  receiveMsg(_msg: Record<string, unknown>) {},

  destroy() {
    _state = null; _opts = null; _el = null;
  },
};

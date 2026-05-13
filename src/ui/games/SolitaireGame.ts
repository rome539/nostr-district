import { Card, Suit, SUITS, SYM, CW, CH, cardUrl, imgStyle, mkDeck, shuffle, GameOptions, CardGame, getCardBackUrl } from './cardTypes';

const GAP = 10;
const FD = 18;
const FU = 35;

interface Sel { area: 'stock' | 'waste' | 'foundation' | 'tableau'; pile: number; idx: number; }
interface GS {
  stock: Card[]; waste: Card[];
  found: [Card[], Card[], Card[], Card[]];
  tab: Card[][];
  sel: Sel | null;
  moves: number; won: boolean;
}

function si(s: Suit) { return SUITS.indexOf(s); }
function red(s: Suit) { return s === 'hearts' || s === 'diamonds'; }
function canFound(c: Card, f: Card[]) {
  return f.length === 0 ? c.rank === 1 : f[f.length - 1].suit === c.suit && c.rank === f[f.length - 1].rank + 1;
}
function canTab(c: Card, p: Card[]) {
  if (!p.length) return c.rank === 13;
  const t = p[p.length - 1];
  return t.up && red(c.suit) !== red(t.suit) && c.rank === t.rank - 1;
}

function newGame(): GS {
  const d = shuffle(mkDeck());
  const tab: Card[][] = [];
  let i = 0;
  for (let col = 0; col < 7; col++) {
    const p: Card[] = [];
    for (let row = 0; row <= col; row++) p.push({ ...d[i++], up: row === col });
    tab.push(p);
  }
  return { stock: d.slice(i).map(c => ({ ...c, up: false })), waste: [], found: [[], [], [], []], tab, sel: null, moves: 0, won: false };
}

function cp(g: GS): GS {
  return {
    stock: g.stock.map(c => ({ ...c })), waste: g.waste.map(c => ({ ...c })),
    found: g.found.map(f => f.map(c => ({ ...c }))) as GS['found'],
    tab: g.tab.map(p => p.map(c => ({ ...c }))),
    sel: g.sel ? { ...g.sel } : null, moves: g.moves, won: g.won,
  };
}

function getCards(g: GS, sel: Sel): Card[] {
  if (sel.area === 'waste') return g.waste.length ? [g.waste[g.waste.length - 1]] : [];
  if (sel.area === 'foundation') { const f = g.found[sel.pile]; return f.length ? [f[f.length - 1]] : []; }
  if (sel.area === 'tableau') return g.tab[sel.pile].slice(sel.idx);
  return [];
}

function rmCards(s: GS, sel: Sel, n: number) {
  if (sel.area === 'waste') s.waste.splice(-n, n);
  else if (sel.area === 'foundation') s.found[sel.pile].splice(-n, n);
  else if (sel.area === 'tableau') {
    s.tab[sel.pile].splice(sel.idx, n);
    const p = s.tab[sel.pile];
    if (p.length && !p[p.length - 1].up) p[p.length - 1].up = true;
  }
}

function drawStock(g: GS): GS {
  const s = cp(g);
  if (!s.stock.length) {
    s.stock = [...s.waste].reverse().map(c => ({ ...c, up: false }));
    s.waste = [];
  } else {
    const c = s.stock.pop()!;
    c.up = true; s.waste.push(c); s.moves++;
  }
  s.sel = null;
  return s;
}

function moveFound(g: GS, sel: Sel): GS | null {
  const cards = getCards(g, sel);
  if (cards.length !== 1) return null;
  const fi = si(cards[0].suit);
  if (!canFound(cards[0], g.found[fi])) return null;
  const s = cp(g);
  rmCards(s, sel, 1);
  s.found[fi].push({ ...cards[0], up: true });
  s.sel = null; s.moves++;
  s.won = s.found.every(f => f.length === 13);
  return s;
}

function moveTab(g: GS, sel: Sel, tgt: number): GS | null {
  const cards = getCards(g, sel);
  if (!cards.length || !canTab(cards[0], g.tab[tgt])) return null;
  const s = cp(g);
  rmCards(s, sel, cards.length);
  s.tab[tgt].push(...cards.map(c => ({ ...c, up: true })));
  s.sel = null; s.moves++;
  return s;
}

function colH(p: Card[]) {
  if (!p.length) return CH;
  return p.slice(0, -1).reduce((h, c) => h + (c.up ? FU : FD), 0) + CH;
}

function renderHTML(g: GS): string {
  let h = `<div style="display:flex;gap:${GAP}px;align-items:flex-start;margin-bottom:18px;">`;

  if (g.stock.length) {
    h += `<div class="ct-card" data-area="stock" data-pile="0" data-idx="0" style="cursor:pointer;flex-shrink:0;"><img src="${getCardBackUrl()}" style="width:${CW}px;height:${CH}px;" alt=""></div>`;
  } else {
    h += `<div class="ct-slot" data-area="stock" data-pile="0" style="cursor:pointer;flex-shrink:0;">↺</div>`;
  }

  if (g.waste.length) {
    const c = g.waste[g.waste.length - 1];
    h += `<div class="ct-card${g.sel?.area === 'waste' ? ' ct-sel' : ''}" data-area="waste" data-pile="0" data-idx="${g.waste.length - 1}" style="flex-shrink:0;"><img src="${cardUrl(`Pocket_${c.suit}.png`)}" style="${imgStyle(c.rank)}" alt=""></div>`;
  } else {
    h += `<div class="ct-slot" style="flex-shrink:0;"></div>`;
  }

  h += `<div style="flex:1;"></div>`;

  SUITS.forEach((suit, fi) => {
    const f = g.found[fi];
    if (f.length) {
      const c = f[f.length - 1];
      h += `<div class="ct-card" data-area="foundation" data-pile="${fi}" data-idx="${f.length - 1}" style="flex-shrink:0;"><img src="${cardUrl(`Pocket_${suit}.png`)}" style="${imgStyle(c.rank)}" alt=""></div>`;
    } else {
      h += `<div class="ct-slot" data-area="foundation" data-pile="${fi}" style="flex-shrink:0;">${SYM[suit]}</div>`;
    }
  });

  h += '</div><div style="display:flex;gap:10px;align-items:flex-start;">';

  for (let col = 0; col < 7; col++) {
    const pile = g.tab[col];
    h += `<div class="ct-col" data-area="tableau" data-pile="${col}" style="position:relative;width:${CW}px;height:${colH(pile)}px;flex:0 0 ${CW}px;">`;
    if (!pile.length) {
      h += `<div class="ct-slot" data-area="tableau" data-pile="${col}" style="position:absolute;inset:0;border-radius:6px;"></div>`;
    } else {
      let top = 0;
      pile.forEach((card, ci) => {
        const isSel = g.sel?.area === 'tableau' && g.sel.pile === col && ci >= g.sel.idx && card.up;
        h += card.up
          ? `<div class="ct-card${isSel ? ' ct-sel' : ''}" data-area="tableau" data-pile="${col}" data-idx="${ci}" style="position:absolute;top:${top}px;left:0;"><img src="${cardUrl(`Pocket_${card.suit}.png`)}" style="${imgStyle(card.rank)}" alt=""></div>`
          : `<div class="ct-card ct-dn" data-area="tableau" data-pile="${col}" data-idx="${ci}" style="position:absolute;top:${top}px;left:0;"><img src="${getCardBackUrl()}" style="width:${CW}px;height:${CH}px;" alt=""></div>`;
        top += card.up ? FU : FD;
      });
    }
    h += '</div>';
  }
  h += '</div>';
  return h;
}

let _gs: GS | null = null;
let _el: HTMLElement | null = null;
let _opts: GameOptions | null = null;

function rerender() {
  if (!_el || !_gs) return;
  const mv = _el.parentElement?.querySelector('#ct-moves') as HTMLElement | null;
  if (mv) mv.textContent = `Moves: ${_gs.moves}`;
  if (_gs.won) {
    _el.innerHTML = `<div style="text-align:center;color:#5dcaa5;font-size:24px;padding:60px 0;letter-spacing:0.06em;">YOU WIN!<br><br><span style="font-size:14px;color:rgba(255,255,255,0.55);">${_gs.moves} moves</span></div>`;
    return;
  }
  _el.innerHTML = renderHTML(_gs);
}

function onClick(e: MouseEvent) {
  if (!_gs) return;
  const el = (e.target as HTMLElement).closest('[data-area]') as HTMLElement | null;
  if (!el) return;
  const area = el.dataset.area as Sel['area'];
  const pile = +(el.dataset.pile ?? 0);
  const idx = +(el.dataset.idx ?? 0);
  if (area === 'stock') { _gs = drawStock(_gs); rerender(); return; }
  const sel = _gs.sel;
  if (!sel) {
    if (area === 'tableau' && _gs.tab[pile][idx]?.up) { _gs = { ...cp(_gs), sel: { area, pile, idx } }; rerender(); }
    else if (area === 'waste' && _gs.waste.length) { _gs = { ...cp(_gs), sel: { area, pile: 0, idx: _gs.waste.length - 1 } }; rerender(); }
    else if (area === 'foundation' && _gs.found[pile].length) { _gs = { ...cp(_gs), sel: { area, pile, idx: _gs.found[pile].length - 1 } }; rerender(); }
    return;
  }
  if (sel.area === area && sel.pile === pile && sel.idx === idx) { _gs = { ...cp(_gs), sel: null }; rerender(); return; }
  if (area === 'foundation') {
    const next = moveFound(_gs, sel);
    if (next) { _gs = next; rerender(); return; }
    if (_gs.found[pile].length) { _gs = { ...cp(_gs), sel: { area, pile, idx: _gs.found[pile].length - 1 } }; rerender(); }
    return;
  }
  if (area === 'tableau') {
    const next = moveTab(_gs, sel, pile);
    if (next) { _gs = next; rerender(); return; }
    if (_gs.tab[pile][idx]?.up) { _gs = { ...cp(_gs), sel: { area, pile, idx } }; rerender(); return; }
  }
  if (area === 'waste' && _gs.waste.length) { _gs = { ...cp(_gs), sel: { area, pile: 0, idx: _gs.waste.length - 1 } }; rerender(); return; }
  _gs = { ...cp(_gs), sel: null }; rerender();
}

function onDbl(e: MouseEvent) {
  if (!_gs) return;
  const el = (e.target as HTMLElement).closest('[data-area]') as HTMLElement | null;
  if (!el) return;
  const area = el.dataset.area as Sel['area'];
  const pile = +(el.dataset.pile ?? 0);
  const idx = +(el.dataset.idx ?? 0);
  if (area === 'waste' || area === 'tableau') {
    const next = moveFound(_gs, { area, pile, idx });
    if (next) { _gs = next; rerender(); }
  }
}

export const SolitaireGame: CardGame = {
  start(opts: GameOptions) {
    _opts = opts;
    _el = opts.container;
    _gs = newGame();

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
    header.innerHTML = `<span id="ct-moves" style="color:rgba(240,230,208,0.55);font-size:10px;">Moves: 0</span><button id="ct-new" class="ct-btn" style="padding:5px 12px;border-radius:4px;cursor:pointer;font-family:'Courier New',monospace;font-size:10px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.16);color:rgba(255,255,255,0.7);">New Game</button>`;
    opts.container.before(header);

    rerender();
    opts.container.addEventListener('click', onClick);
    opts.container.addEventListener('dblclick', onDbl);
    header.querySelector('#ct-new')?.addEventListener('click', () => { _gs = newGame(); rerender(); });
  },

  receiveMsg(_msg: Record<string, unknown>) {},

  destroy() {
    _el?.removeEventListener('click', onClick);
    _el?.removeEventListener('dblclick', onDbl);
    _el?.previousElementSibling?.remove();
    _gs = null; _el = null; _opts = null;
  },
};

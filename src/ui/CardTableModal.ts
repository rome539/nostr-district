const CARD_ASSET_DIR = 'assets/furniture/lounge/cards/Pocket-Cards';
const CARD_W = 45;
const CARD_H = 61;
const CARD_SCALE = 3;

let overlay: HTMLElement | null = null;

const SUITS = ['spades', 'hearts', 'clubs', 'diamonds'] as const;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function assetUrl(file: string): string {
  const base = import.meta.env.BASE_URL || './';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${CARD_ASSET_DIR}/${file}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
}

function randomHand(): Array<{ suit: typeof SUITS[number]; rank: string; index: number }> {
  const deck = SUITS.flatMap(suit => RANKS.map((rank, index) => ({ suit, rank, index })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, 5);
}

function cardHtml(card: { suit: typeof SUITS[number]; rank: string; index: number }): string {
  const src = assetUrl(`Pocket_${card.suit}.png`);
  return `
    <div class="ct-card" title="${esc(card.rank)} ${esc(card.suit)}">
      <img src="${src}" alt="" onerror="this.parentElement.dataset.missing=this.src;this.remove();" style="
        width:${CARD_W * 13 * CARD_SCALE}px;height:${CARD_H * CARD_SCALE}px;
        transform:translateX(-${card.index * CARD_W * CARD_SCALE}px);
      ">
    </div>
  `;
}

function backHtml(): string {
  const src = assetUrl('Pocket_back01.png');
  return `
    <div class="ct-card">
      <img src="${src}" alt="" onerror="this.parentElement.dataset.missing=this.src;this.remove();" style="width:${CARD_W * CARD_SCALE}px;height:${CARD_H * CARD_SCALE}px;">
    </div>
  `;
}

export const CardTableModal = {
  isOpen(): boolean { return !!overlay; },

  show(): void {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9000;
      background:rgba(4,2,10,0.88);
      display:flex;align-items:center;justify-content:center;
      font-family:"Courier New",monospace;
    `;

    const style = document.createElement('style');
    style.id = 'card-table-modal-style';
    style.textContent = `
      .ct-card {
        width:${CARD_W * CARD_SCALE}px;height:${CARD_H * CARD_SCALE}px;
        overflow:hidden;
        position:relative;
        image-rendering:pixelated;
        filter:drop-shadow(0 7px 0 rgba(0,0,0,0.28));
        flex:0 0 auto;
      }
      .ct-card img {
        display:block;
        image-rendering:pixelated;
        max-width:none;
      }
      .ct-card[data-missing]::after {
        content:'missing';
        position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        color:#ff7070;font-size:9px;background:rgba(80,0,0,0.24);border:1px solid rgba(255,112,112,0.45);
      }
      .ct-btn:hover { border-color:#5dcaa5 !important;color:#5dcaa5 !important; }
    `;
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.style.cssText = `
      width:min(760px,94vw);min-height:430px;position:relative;
      border:1px solid rgba(93,202,165,0.35);border-radius:10px;
      background:#07180f url(${assetUrl('Mat_green.png')}) center/cover;
      box-shadow:0 20px 70px rgba(0,0,0,0.75), inset 0 0 0 1px rgba(255,255,255,0.04);
      padding:22px;box-sizing:border-box;overflow:hidden;
    `;

    box.innerHTML = `
      <button id="ct-close" class="ct-btn" style="
        position:absolute;top:10px;right:12px;background:rgba(0,0,0,0.35);
        border:1px solid rgba(255,255,255,0.14);border-radius:4px;color:rgba(255,255,255,0.6);
        font-family:'Courier New',monospace;font-size:16px;line-height:1;padding:4px 9px;cursor:pointer;
      ">×</button>
      <div style="color:#f0e6d0;font-size:16px;font-weight:bold;letter-spacing:0.08em;text-align:center;margin-top:4px;">CARD TABLE</div>
      <div style="color:rgba(240,230,208,0.62);font-size:10px;text-align:center;margin-top:6px;">pocket cards test table</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin:34px auto 24px;min-height:${CARD_H * CARD_SCALE}px;">
        <div id="ct-hand" style="display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:nowrap;"></div>
      </div>
      <div style="display:flex;justify-content:center;gap:10px;">
        <button id="ct-draw" class="ct-btn" style="
          padding:9px 18px;border-radius:5px;cursor:pointer;
          font-family:'Courier New',monospace;font-size:11px;font-weight:bold;
          background:rgba(0,0,0,0.35);border:1px solid rgba(93,202,165,0.42);color:#d8fff0;
        ">Draw Hand</button>
        <button id="ct-deck" class="ct-btn" style="
          padding:9px 18px;border-radius:5px;cursor:pointer;
          font-family:'Courier New',monospace;font-size:11px;font-weight:bold;
          background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.16);color:rgba(255,255,255,0.7);
        ">Show Deck</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const hand = box.querySelector('#ct-hand') as HTMLElement;
    const draw = () => { hand.innerHTML = randomHand().map(cardHtml).join(''); };
    const showDeck = () => { hand.innerHTML = Array.from({ length: 5 }, backHtml).join(''); };
    showDeck();

    box.querySelector('#ct-draw')?.addEventListener('click', draw);
    box.querySelector('#ct-deck')?.addEventListener('click', showDeck);
    box.querySelector('#ct-close')?.addEventListener('click', () => CardTableModal.destroy());
    overlay.addEventListener('click', e => { if (e.target === overlay) CardTableModal.destroy(); });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') CardTableModal.destroy();
      e.stopPropagation();
    });
    overlay.tabIndex = -1;
    overlay.focus();
  },

  destroy(): void {
    overlay?.remove();
    overlay = null;
    document.getElementById('card-table-modal-style')?.remove();
  },
};

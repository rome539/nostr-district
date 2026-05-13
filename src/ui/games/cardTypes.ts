export type Suit = 'spades' | 'hearts' | 'clubs' | 'diamonds';
export const SUITS: Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
export const SYM: Record<Suit, string> = { spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦' };

export interface Card { suit: Suit; rank: number; up: boolean; }

const ASSET_DIR = 'assets/furniture/lounge/cards/Pocket-Cards';

export function cardUrl(f: string): string {
  const b = (import.meta.env.BASE_URL || './').replace(/\/?$/, '/');
  return `${b}${ASSET_DIR}/${f}`;
}

export const CW = 90;
export const CH = 122;

let _cardBack: 'Pocket_back01.png' | 'Pocket_back02.png' = 'Pocket_back01.png';
export function setCardBack(b: 'Pocket_back01.png' | 'Pocket_back02.png'): void { _cardBack = b; }
export function getCardBackUrl(): string { return cardUrl(_cardBack); }
export function getCardBackName(): 'Pocket_back01.png' | 'Pocket_back02.png' { return _cardBack; }

export function imgStyle(rank: number): string {
  return `width:${45 * 13 * 2}px;height:${CH}px;transform:translateX(-${(rank - 1) * CW}px);`;
}

export function faceUp(card: Card, cls = '', attrs = ''): string {
  return `<div class="ct-card${cls ? ' ' + cls : ''}" ${attrs}><img src="${cardUrl(`Pocket_${card.suit}.png`)}" style="${imgStyle(card.rank)}" alt=""></div>`;
}

export function faceDown(cls = '', attrs = ''): string {
  return `<div class="ct-card ct-dn${cls ? ' ' + cls : ''}" ${attrs}><img src="${getCardBackUrl()}" style="width:${CW}px;height:${CH}px;" alt=""></div>`;
}

export function slot(label = '', cls = '', attrs = ''): string {
  return `<div class="ct-slot${cls ? ' ' + cls : ''}" ${attrs}>${label}</div>`;
}

export function mkDeck(): Card[] {
  return SUITS.flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ suit, rank: i + 1, up: false })));
}

export function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export function rl(rank: number): string {
  return [, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][rank]!;
}

export function red(s: Suit): boolean { return s === 'hearts' || s === 'diamonds'; }

export interface GameOptions {
  container: HTMLElement;
  multiplayer: boolean;
  myPubkey: string;
  myName: string;
  isHost: boolean;
  players: { pubkey: string; name: string }[];
  gameId: string;
  send: (msg: Record<string, unknown>) => void; // legacy game_msg (needs server restart)
  sendPayload: (payload: string) => void;        // chat-based, always works
  onDone: () => void;
}

export interface CardGame {
  start(opts: GameOptions): void;
  receiveMsg(msg: Record<string, unknown>): void;
  destroy(): void;
}

/**
 * TarotModal.ts — Full 78-card tarot deck, 3-card spread (Past | Present | Future).
 * Uses pixel art asset pack from public/assets/Tarot/
 */
import { SoundEngine } from '../audio/SoundEngine';
import { signEvent, publishEvent } from '../nostr/nostrService';
import { authStore } from '../stores/authStore';

type Suit = 'major' | 'wands' | 'cups' | 'swords' | 'pentacles';

interface TarotCard {
  name: string;
  suit: Suit;
  number: string;
  file: string;   // resolved asset path
  upright: string;
  reversed: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSET PATHS
// ─────────────────────────────────────────────────────────────────────────────
const MAJOR_BASE  = '/assets/Tarot/Pixel Tarot Deck - Major Arcana/';
const MINOR_BASE  = '/assets/Tarot/Pixel Tarot Deck - Minor Arcana/';
const CARD_BACK   = `${MAJOR_BASE}back_of_card_2.png`;

// Minor Arcana number → filename prefix
function minorPrefix(number: string): string {
  return number === 'Ace' ? 'ace' : number.toLowerCase();
}

function minorPath(number: string, suit: string): string {
  return `${MINOR_BASE}${minorPrefix(number)}_of_${suit}.png`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DECK DATA
// ─────────────────────────────────────────────────────────────────────────────
function maj(name: string, number: string, file: string, upright: string, reversed: string): TarotCard {
  return { name, suit: 'major', number, file: MAJOR_BASE + file, upright, reversed };
}
function min(name: string, suit: Suit, number: string, upright: string, reversed: string): TarotCard {
  return { name, suit, number, file: minorPath(number, suit), upright, reversed };
}

const MAJOR: TarotCard[] = [
  maj('The Fool',          '0',     'the_fool.png',         'New beginnings, innocence, spontaneity, a free spirit',          'Recklessness, taken advantage of, inconsideration'),
  maj('The Magician',      'I',     'magician.png',         'Manifestation, resourcefulness, power, inspired action',          'Manipulation, poor planning, untapped talents'),
  maj('The High Priestess','II',    'priestess.png',        'Intuition, sacred knowledge, divine feminine, the subconscious',  'Secrets, disconnected from intuition, withdrawal'),
  maj('The Empress',       'III',   'empress.png',          'Femininity, beauty, nature, nurturing, abundance',                'Creative block, dependence on others, emptiness'),
  maj('The Emperor',       'IV',    'emperor.png',          'Authority, establishment, structure, a father figure',            'Domination, excessive control, inflexibility'),
  maj('The Hierophant',    'V',     'hierophant.png',       'Spiritual wisdom, religious beliefs, tradition, conformity',      'Personal beliefs, freedom, challenging the status quo'),
  maj('The Lovers',        'VI',    'the_lovers.png',       'Love, harmony, relationships, values alignment, choices',         'Self-love, disharmony, imbalance, misaligned values'),
  maj('The Chariot',       'VII',   'chariot.png',          'Control, willpower, success, determination, a journey',           'Self-discipline, opposition, lack of direction'),
  maj('Strength',          'VIII',  'strength.png',         'Strength, courage, persuasion, influence, compassion',            'Inner strength, self-doubt, low energy, raw emotion'),
  maj('The Hermit',        'IX',    'the_hermit.png',       'Soul-searching, introspection, being alone, inner guidance',      'Isolation, loneliness, withdrawal, lost your way'),
  maj('Wheel of Fortune',  'X',     'wheel_of_fortune.png', 'Good luck, karma, life cycles, destiny, a turning point',        'Bad luck, resistance to change, breaking cycles'),
  maj('Justice',           'XI',    'justice.png',          'Justice, fairness, truth, cause and effect, law',                 'Unfairness, lack of accountability, dishonesty'),
  maj('The Hanged Man',    'XII',   'hanged_man.png',       'Pause, surrender, letting go, new perspectives',                  'Delays, resistance, stalling, indecision'),
  maj('Death',             'XIII',  'death.png',            'Endings, change, transformation, transition',                     'Resistance to change, personal transformation, inner purging'),
  maj('Temperance',        'XIV',   'temperance.png',       'Balance, moderation, patience, purpose, meaning',                 'Imbalance, excess, self-healing, realignment'),
  maj('The Devil',         'XV',    'the_devil.png',        'Shadow self, attachment, addiction, restriction, sexuality',      'Releasing limiting beliefs, exploring dark thoughts, detachment'),
  maj('The Tower',         'XVI',   'the_tower.png',        'Sudden change, upheaval, chaos, revelation, awakening',          'Personal transformation, fear of change, averting disaster'),
  maj('The Star',          'XVII',  'the_star.png',         'Hope, faith, purpose, renewal, spirituality',                    'Lack of faith, despair, self-trust, disconnection'),
  maj('The Moon',          'XVIII', 'the_moon.png',         'Illusion, fear, the unconscious, intuition, confusion',           'Release of fear, repressed emotion, inner confusion'),
  maj('The Sun',           'XIX',   'the_sun.png',          'Positivity, fun, warmth, success, vitality',                     'Inner child, feeling down, overly optimistic'),
  maj('Judgement',         'XX',    'judgement.png',        'Judgement, rebirth, inner calling, absolution',                  'Self-doubt, inner critic, ignoring the call'),
  maj('The World',         'XXI',   'the_world.png',        'Completion, integration, accomplishment, travel',                 'Seeking personal closure, short-cuts, delays'),
];

const WANDS: TarotCard[] = [
  min('Ace of Wands',   'wands','Ace',   'Creation, willpower, inspiration, desire',              'Lack of energy, lack of passion, boredom'),
  min('Two of Wands',   'wands','2',     'Future planning, progress, decisions, discovery',        'Fear of change, playing safe, bad planning'),
  min('Three of Wands', 'wands','3',     'Progress, expansion, foresight, overseas opportunities', 'Playing small, lack of foresight, delays'),
  min('Four of Wands',  'wands','4',     'Celebration, harmony, marriage, home, community',        'Personal celebration, conflict at home'),
  min('Five of Wands',  'wands','5',     'Disagreements, competition, tension, diversity',         'Avoiding conflict, respecting differences'),
  min('Six of Wands',   'wands','6',     'Success, public recognition, progress, confidence',      'Private achievement, fall from grace'),
  min('Seven of Wands', 'wands','7',     'Challenge, competition, protection, perseverance',       'Exhaustion, giving up, overwhelmed'),
  min('Eight of Wands', 'wands','8',     'Movement, fast change, action, alignment',               'Delays, frustration, resisting change'),
  min('Nine of Wands',  'wands','9',     'Resilience, courage, persistence, test of faith',        'Inner resources, struggle, overwhelm'),
  min('Ten of Wands',   'wands','10',    'Burden, extra responsibility, hard work, completion',    'Doing it all, delegation needed'),
  min('Page of Wands',  'wands','Page',  'Inspiration, ideas, discovery, limitless potential',     'Newly-formed ideas, self-limiting beliefs'),
  min('Knight of Wands','wands','Knight','Energy, passion, inspired action, adventure',            'Haste, scattered energy, delays'),
  min('Queen of Wands', 'wands','Queen', 'Courage, determination, joy, vibrancy, assurance',       'Self-confidence lacking, introverted'),
  min('King of Wands',  'wands','King',  'Natural-born leader, vision, entrepreneur, honour',      'Impulsiveness, high expectations, ruthless'),
];
const CUPS: TarotCard[] = [
  min('Ace of Cups',   'cups','Ace',   'Love, new relationships, compassion, creativity',         'Self-love, repressed emotions'),
  min('Two of Cups',   'cups','2',     'Unified love, partnership, mutual attraction',             'Break-ups, disharmony, distrust'),
  min('Three of Cups', 'cups','3',     'Celebration, friendship, creativity, community',           'Alone time, hardcore partying'),
  min('Four of Cups',  'cups','4',     'Meditation, contemplation, apathy, reevaluation',          'Retreat, checking in for alignment'),
  min('Five of Cups',  'cups','5',     'Regret, failure, disappointment, pessimism',               'Self-forgiveness, moving on'),
  min('Six of Cups',   'cups','6',     'Revisiting the past, childhood memories, innocence',       'Living in the past, forgiveness'),
  min('Seven of Cups', 'cups','7',     'Opportunities, choices, wishful thinking, illusion',       'Alignment, overwhelmed by choices'),
  min('Eight of Cups', 'cups','8',     'Disappointment, abandonment, withdrawal, escapism',        'Trying one more time, indecision'),
  min('Nine of Cups',  'cups','9',     'Contentment, satisfaction, gratitude, wish fulfilled',     'Inner happiness, materialism'),
  min('Ten of Cups',   'cups','10',    'Divine love, blissful relationships, harmony',              'Disconnection, misaligned values'),
  min('Page of Cups',  'cups','Page',  'Creative opportunities, intuitive messages, curiosity',    'Emotional immaturity, disappointment'),
  min('Knight of Cups','cups','Knight','Creativity, romance, charm, imagination, beauty',          'Unrealistic, jealousy, overactive imagination'),
  min('Queen of Cups', 'cups','Queen', 'Compassionate, caring, emotionally stable, intuitive',     'Self-care needed, codependency'),
  min('King of Cups',  'cups','King',  'Emotionally balanced, compassionate, diplomatic',           'Moodiness, emotionally manipulative'),
];
const SWORDS: TarotCard[] = [
  min('Ace of Swords',   'swords','Ace',   'Breakthrough, clarity, sharp mind, truth, justice',   'Inner clarity, clouded judgement'),
  min('Two of Swords',   'swords','2',     'Difficult decisions, weighing options, indecision',    'Information overload, stalemate'),
  min('Three of Swords', 'swords','3',     'Heartbreak, emotional pain, sorrow, grief, hurt',      'Releasing pain, optimism, forgiveness'),
  min('Four of Swords',  'swords','4',     'Rest, relaxation, meditation, contemplation',           'Burn-out, deep contemplation, stagnation'),
  min('Five of Swords',  'swords','5',     'Conflict, disagreements, competition, defeat',          'Reconciliation, making amends'),
  min('Six of Swords',   'swords','6',     'Transition, change, rite of passage, releasing baggage','Resistance to change, unfinished business'),
  min('Seven of Swords', 'swords','7',     'Betrayal, deception, getting away with something',     'Imposter syndrome, self-deceit'),
  min('Eight of Swords', 'swords','8',     'Negative thoughts, self-imposed restriction',           'Self-limiting beliefs, releasing negativity'),
  min('Nine of Swords',  'swords','9',     'Anxiety, worry, fear, depression, nightmares',         'Inner turmoil, releasing worry'),
  min('Ten of Swords',   'swords','10',    'Painful endings, deep wounds, betrayal, loss',          'Recovery, regeneration, resisting the end'),
  min('Page of Swords',  'swords','Page',  'New ideas, curiosity, thirst for knowledge',            'Manipulative, cynical, all talk'),
  min('Knight of Swords','swords','Knight','Ambitious, action-oriented, fast-thinking',             'Restless, impulsive, burn-out'),
  min('Queen of Swords', 'swords','Queen', 'Independent, unbiased judgement, clear boundaries',    'Overly-emotional, easily influenced'),
  min('King of Swords',  'swords','King',  'Mental clarity, intellectual power, authority, truth', 'Misuse of power, manipulation'),
];
const PENTACLES: TarotCard[] = [
  min('Ace of Pentacles',   'pentacles','Ace',   'A new financial or career opportunity, manifestation','Lost opportunity, scarcity mindset'),
  min('Two of Pentacles',   'pentacles','2',     'Multiple priorities, time management, adaptability',  'Over-committed, disorganisation'),
  min('Three of Pentacles', 'pentacles','3',     'Teamwork, collaboration, learning, implementation',   'Disharmony, misalignment, working alone'),
  min('Four of Pentacles',  'pentacles','4',     'Saving money, security, conservatism, scarcity',      'Over-spending, greed, self-protection'),
  min('Five of Pentacles',  'pentacles','5',     'Financial loss, poverty, lack mindset, isolation',    'Recovery from financial loss'),
  min('Six of Pentacles',   'pentacles','6',     'Giving, receiving, sharing wealth, generosity',       'Self-care, unpaid debts, one-sided charity'),
  min('Seven of Pentacles', 'pentacles','7',     'Long-term view, sustainable results, perseverance',   'Lack of long-term vision, limited reward'),
  min('Eight of Pentacles', 'pentacles','8',     'Apprenticeship, repetitive tasks, mastery, skill',    'Perfectionism, misdirected activity'),
  min('Nine of Pentacles',  'pentacles','9',     'Abundance, luxury, self-sufficiency, independence',   'Over-investment in work, hustling'),
  min('Ten of Pentacles',   'pentacles','10',    'Wealth, financial security, family, long-term success','Financial failure, dark side of wealth'),
  min('Page of Pentacles',  'pentacles','Page',  'Manifestation, financial opportunity, skill development','Procrastination, learn from failure'),
  min('Knight of Pentacles','pentacles','Knight','Hard work, productivity, routine, conservatism',      'Boredom, feeling stuck, perfectionism'),
  min('Queen of Pentacles', 'pentacles','Queen', 'Nurturing, practical, providing financially',          'Financial independence, work-home conflict'),
  min('King of Pentacles',  'pentacles','King',  'Wealth, business, leadership, security, discipline',  'Obsessed with wealth, stubborn'),
];

const DECK: TarotCard[] = [...MAJOR, ...WANDS, ...CUPS, ...SWORDS, ...PENTACLES];

// ─────────────────────────────────────────────────────────────────────────────
// SUIT STYLE
// ─────────────────────────────────────────────────────────────────────────────
const SUIT_STYLE: Record<Suit,{border:string;label:string}> = {
  major:     { border:'#c0a0ff', label:'#d4b8ff' },
  wands:     { border:'#e07030', label:'#f0a060' },
  cups:      { border:'#4088cc', label:'#70b8ee' },
  swords:    { border:'#8899bb', label:'#aabbdd' },
  pentacles: { border:'#60a040', label:'#90c860' },
};

const SPREAD_LABELS = ['PAST', 'PRESENT', 'FUTURE'];

// ─────────────────────────────────────────────────────────────────────────────
// DRAW 3 UNIQUE CARDS — persisted for 24 hours
// ─────────────────────────────────────────────────────────────────────────────
const TAROT_KEY = 'nd_daily_tarot';
const MS_24H    = 24 * 60 * 60 * 1000;

interface StoredDraw { indices: number[]; reversed: boolean[]; ts: number; }

function getDailyDraw(): { card: TarotCard; reversed: boolean; fresh: boolean }[] {
  try {
    const stored: StoredDraw = JSON.parse(localStorage.getItem(TAROT_KEY) || 'null');
    if (stored && Date.now() - stored.ts < MS_24H) {
      return stored.indices.map((idx, i) => ({ card: DECK[idx], reversed: stored.reversed[i], fresh: false }));
    }
  } catch {}
  const shuffled = [...DECK].sort(() => Math.random() - 0.5).slice(0, 3);
  const draw = shuffled.map(card => ({ card, reversed: Math.random() < 0.35, fresh: true }));
  const toStore: StoredDraw = {
    indices: draw.map(d => DECK.indexOf(d.card)),
    reversed: draw.map(d => d.reversed),
    ts: Date.now(),
  };
  localStorage.setItem(TAROT_KEY, JSON.stringify(toStore));
  return draw;
}

function timeUntilReset(key: string): string {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || 'null');
    if (!stored?.ts) return '';
    const ms = MS_24H - (Date.now() - stored.ts);
    if (ms <= 0) return '';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `next reading in ${h}h ${m}m`;
  } catch { return ''; }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOSTR SHARE  (NIP-96 upload cascade + NIP-98 auth)
// ─────────────────────────────────────────────────────────────────────────────

// Free NIP-96 hosts tried in order; first success wins
const NIP96_HOSTS = [
  'https://nostr.build/api/v2/upload/files',
  'https://nostrcheck.me/api/v2/media',
];

/** Render card to canvas at 4× nearest-neighbor, optionally rotated 180° for reversed. */
function upscaleCard(cardFile: string, reversed: boolean): Promise<Blob | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = 4;
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      if (reversed) { ctx.translate(w, h); ctx.rotate(Math.PI); }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(resolve, 'image/png');
    };
    img.onerror = () => resolve(null);
    img.src = cardFile;
  });
}

/** POST blob to one NIP-96 host with NIP-98 auth. Returns CDN URL or null. */
async function tryNip96(uploadUrl: string, blob: Blob): Promise<string | null> {
  try {
    const authEvent = await signEvent({
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['u', uploadUrl], ['method', 'POST']],
      content: '',
    });
    const form = new FormData();
    form.append('file', blob, 'tarot.png');
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: { Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}` },
      body: form,
    });
    if (!res.ok) return null;
    const json = await res.json();
    // Handle nostr.build format, NIP-96 standard format, and direct url field
    return (
      json?.data?.[0]?.url ??
      json?.data?.url ??
      json?.nip94_event?.tags?.find((t: string[]) => t[0] === 'url')?.[1] ??
      null
    );
  } catch { return null; }
}

/** Upload one card image: upscale → try each NIP-96 host → fallback to origin URL. */
async function uploadCard(cardFile: string, reversed: boolean): Promise<string> {
  const fallback = encodeURI(`${window.location.origin}${cardFile}`);
  const blob = await upscaleCard(cardFile, reversed);
  if (!blob) return fallback;
  for (const host of NIP96_HOSTS) {
    const url = await tryNip96(host, blob);
    if (url) return url;
  }
  return fallback;
}

function buildTarotNote(draw: { card: TarotCard; reversed: boolean }[], imageUrls: string[]): string {
  const labels = ['PAST', 'PRESENT', 'FUTURE'];
  const lines: string[] = ['🔮 My tarot spread — Past · Present · Future', ''];

  draw.forEach(({ card, reversed }, i) => {
    const cardName = card.suit === 'major' ? `${card.number} · ${card.name}` : card.name;
    lines.push(`✦ ${labels[i]} — ${cardName} (${reversed ? 'Reversed' : 'Upright'})`);
    lines.push(reversed ? card.reversed : card.upright);
    lines.push('');
  });

  // Bare image URLs on their own lines → inline previews in Damus, Nostur, Snort, etc.
  imageUrls.forEach(url => lines.push(url));

  lines.push('');
  lines.push('#tarot #nostrdistrict');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL
// ─────────────────────────────────────────────────────────────────────────────
let overlay: HTMLElement | null = null;

export const TarotModal = {
  show(): void {
    if (overlay) return;
    const draw = getDailyDraw();
    const isFresh = draw[0].fresh;
    SoundEngine.get().tarotCardFlip();
    // Stop 2s after last card flips (last flip at 600 + 2*180 = 960ms)
    setTimeout(() => SoundEngine.get().stopFileSounds(), 960 + 2000);

    const isTouch = 'ontouchstart' in window;
    // Cards must fit 3-across in available width. Landscape phones use height as
    // the limiting dimension; portrait phones use width.
    const avail = isTouch ? Math.min(window.innerWidth, window.innerHeight) : 780;
    const cardW = Math.min(130, Math.max(72, Math.floor((avail - 80) / 3)));
    const cardH = Math.round(cardW * (210 / 130));

    overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:9000;
      background:rgba(2,1,14,0.95);
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      font-family:"Courier New",monospace;
      animation:trFade 0.35s ease;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes trFade { from{opacity:0} to{opacity:1} }
      @keyframes trDeal { from{opacity:0;transform:translateY(-24px) scale(0.92)} to{opacity:1;transform:translateY(0) scale(1)} }
      @keyframes trFlip {
        0%   { transform: rotateY(0deg) }
        49%  { transform: rotateY(90deg) }
        50%  { transform: rotateY(90deg) }
        100% { transform: rotateY(0deg) }
      }
    `;
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.style.cssText = `
      width:max-content; max-width:calc(100vw - 16px);
      max-height:calc(100vh - 24px); overflow-y:auto;
      background:linear-gradient(160deg,#0e0828 0%,#130c34 60%,#0a0620 100%);
      border:1px solid #5533aa66;
      border-radius:12px; padding:28px 24px 22px;
      text-align:center; position:relative; overflow-x:hidden;
      box-shadow:0 18px 48px rgba(0,0,0,0.45);
    `;

    // ✕ button at top-right — always reachable even before scrolling
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `position:sticky;top:0;float:right;margin:-8px -8px 0 0;background:none;border:1px solid #5533aa44;border-radius:4px;color:#8866cc;font-family:"Courier New",monospace;font-size:13px;padding:4px 9px;cursor:pointer;z-index:1;-webkit-tap-highlight-color:transparent;touch-action:manipulation;`;
    closeBtn.addEventListener('click', () => TarotModal.destroy());
    box.appendChild(closeBtn);

    // Title
    const title = document.createElement('div');
    title.textContent = '✦ THE CARDS SPEAK ✦';
    title.style.cssText = 'color:#c0a0ff;font-size:10px;letter-spacing:3px;margin-bottom:6px;opacity:0.8;';
    box.appendChild(title);

    // 24h reset hint (shown only for cached readings)
    if (!isFresh) {
      const resetHint = document.createElement('div');
      resetHint.textContent = timeUntilReset(TAROT_KEY);
      resetHint.style.cssText = 'color:#6644aa;font-size:8px;letter-spacing:1px;margin-bottom:14px;opacity:0.7;';
      box.appendChild(resetHint);
    } else {
      const spacer = document.createElement('div');
      spacer.style.cssText = 'margin-bottom:14px;';
      box.appendChild(spacer);
    }

    // Cards row
    const cardsRow = document.createElement('div');
    cardsRow.style.cssText = 'display:flex;gap:16px;align-items:flex-start;justify-content:center;flex-wrap:wrap;';

    draw.forEach(({ card, reversed }, i) => {
      const st = SUIT_STYLE[card.suit];

      const slot = document.createElement('div');
      slot.style.cssText = `
        display:flex; flex-direction:column; align-items:center; width:${cardW}px;
        animation: trDeal 0.45s ${0.08 + i * 0.18}s ease both;
      `;

      // Position label above card
      const posLabel = document.createElement('div');
      posLabel.textContent = SPREAD_LABELS[i];
      posLabel.style.cssText = `font-size:8px;letter-spacing:3px;color:${st.label};opacity:0.55;margin-bottom:6px;`;
      slot.appendChild(posLabel);

      // Card image wrapper (handles reversed flip)
      const imgWrap = document.createElement('div');
      imgWrap.style.cssText = `
        width:${cardW}px; height:${cardH}px; position:relative; border-radius:8px; overflow:hidden;
        background:${st.border}22;
        border:2px solid ${st.border}99;
        box-shadow:inset 0 0 0 1px ${st.border}55, 0 0 16px 4px ${st.border}1a, 0 4px 24px rgba(0,0,0,0.6);
        ${reversed ? 'transform:rotate(180deg);' : ''}
      `;

      // Start face-down, flip to face after deal delay
      const back = document.createElement('img');
      back.src = CARD_BACK;
      back.style.cssText = 'width:calc(100% - 4px);height:calc(100% - 4px);display:block;image-rendering:pixelated;object-fit:cover;position:absolute;inset:2px;border-radius:6px;';
      imgWrap.appendChild(back);

      const face = document.createElement('img');
      face.src = card.file;
      face.style.cssText = 'width:calc(100% - 4px);height:calc(100% - 4px);display:block;image-rendering:pixelated;object-fit:cover;position:absolute;inset:2px;border-radius:6px;opacity:0;transition:opacity 0.3s;';
      face.onerror = () => { face.style.display = 'none'; };
      imgWrap.appendChild(face);

      // Flip reveal after deal animation finishes
      setTimeout(() => {
        face.style.opacity = '1'; back.style.opacity = '0';
      }, 600 + i * 180);

      slot.appendChild(imgWrap);

      // Upright / reversed indicator
      const posIndicator = document.createElement('div');
      posIndicator.style.cssText = `font-size:8px;letter-spacing:1px;color:${st.label};opacity:0.5;margin-top:6px;`;
      posIndicator.textContent = reversed ? '▼ REVERSED' : '▲ UPRIGHT';
      slot.appendChild(posIndicator);

      // Card name
      const name = document.createElement('div');
      name.style.cssText = `font-size:10px;font-weight:bold;color:${st.label};margin-top:3px;text-align:center;line-height:1.3;`;
      name.textContent = card.suit === 'major' ? `${card.number} · ${card.name}` : card.name;
      slot.appendChild(name);

      // Suit tag
      const suitTag = document.createElement('div');
      suitTag.style.cssText = `font-size:8px;color:${st.label};opacity:0.4;letter-spacing:1px;margin-top:1px;text-transform:uppercase;`;
      suitTag.textContent = card.suit === 'major' ? 'Major Arcana' : card.suit;
      slot.appendChild(suitTag);

      // Meaning text (typewritten)
      const meaning = document.createElement('div');
      meaning.style.cssText = `font-size:9px;color:#9898c0;line-height:1.6;margin-top:6px;text-align:center;min-height:52px;padding:0 2px;`;
      slot.appendChild(meaning);

      cardsRow.appendChild(slot);

      setTimeout(() => typewrite(meaning, reversed ? card.reversed : card.upright, 20), 700 + i * 200);
    });

    box.appendChild(cardsRow);

    // Dismiss
    const hr = document.createElement('div');
    hr.style.cssText = 'width:100%;max-width:460px;border-top:1px solid #3322664a;margin:20px auto 10px;';
    box.appendChild(hr);

    // Share to Nostr button (logged-in non-guest only)
    const { isLoggedIn, isGuest } = authStore.getState();
    if (isLoggedIn && !isGuest) {
      const shareBtn = document.createElement('button');
      shareBtn.textContent = '✦ Share reading to Nostr';
      shareBtn.disabled = true;
      shareBtn.style.cssText = `
        background:transparent; border:1px solid #5533aa44; border-radius:6px;
        color:#7755aa88; font-family:"Courier New",monospace; font-size:9px;
        letter-spacing:1px; cursor:default; padding:6px 14px; margin-bottom:10px;
        transition:border-color 0.2s, color 0.2s;
      `;
      // Enable once all card flips + typewriters finish (last flip at 960ms, last typewriter starts at 1100ms)
      setTimeout(() => {
        shareBtn.disabled = false;
        shareBtn.style.borderColor = '#5533aa88';
        shareBtn.style.color = '#a080ee';
        shareBtn.style.cursor = 'pointer';
        shareBtn.onmouseenter = () => { shareBtn.style.borderColor = '#9966ff'; shareBtn.style.color = '#c0a0ff'; };
        shareBtn.onmouseleave = () => { shareBtn.style.borderColor = '#5533aa88'; shareBtn.style.color = '#a080ee'; };
      }, 2000);
      shareBtn.onclick = async () => {
        if (shareBtn.disabled) return;
        shareBtn.disabled = true;
        shareBtn.textContent = '↑ uploading cards...';
        try {
          // Upload all 3 cards in parallel (upscaled 4×, reversed cards rotated 180°)
          const imageUrls = await Promise.all(
            draw.map(d => uploadCard(d.card.file, d.reversed))
          );
          shareBtn.textContent = '✦ publishing...';
          const event = await signEvent({
            kind: 1,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ['t', 'tarot'],
              ['t', 'nostrdistrict'],
              ['client', 'Nostr District'],
              // NIP-92 imeta — Primal uses these for inline image rendering
              ...imageUrls.map(url => ['imeta', `url ${url}`, 'm image/png']),
            ],
            content: buildTarotNote(draw, imageUrls),
          });
          const ok = await publishEvent(event);
          shareBtn.textContent = ok ? '✓ shared!' : '✗ relay error';
          shareBtn.style.color = ok ? '#80ee80' : '#ee8080';
        } catch {
          shareBtn.textContent = '✗ failed';
          shareBtn.style.color = '#ee8080';
        }
      };
      box.appendChild(shareBtn);
    }

    const hint = document.createElement('div');
    hint.textContent = '[ESC] or click to close';
    hint.style.cssText = 'color:#8b78be;font-size:9px;letter-spacing:1px;cursor:pointer;margin-top:10px;';
    hint.onclick = () => TarotModal.destroy();
    box.appendChild(hint);

    overlay.appendChild(box);

    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) TarotModal.destroy(); });
    document.body.appendChild(overlay);
  },

  destroy(): void {
    if (!overlay) return;
    SoundEngine.get().stopFileSounds();
    overlay.style.transition = 'opacity 0.25s';
    overlay.style.opacity = '0';
    setTimeout(() => { overlay?.remove(); overlay = null; }, 250);
  },

  isOpen(): boolean { return overlay !== null; },
};

function typewrite(el: HTMLElement, text: string, ms: number): void {
  el.textContent = ''; let i = 0;
  const tick = () => { if (i < text.length) { el.textContent += text[i++]; setTimeout(tick, ms); } };
  tick();
}

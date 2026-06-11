/**
 * BountyBoardPanel.ts — the oracle's weekly wanted poster (alley).
 *
 * Burn commons/junk → mint a rare. The SERVER is the authority for the weekly
 * board (deterministic from week number) and for claims (global cap, relay-marker
 * backed). This panel just renders the board, picks which owned instances to turn
 * in, and shows the result. Turn-in is a two-step inline confirm — the items are
 * CONSUMED, so no accidental single-click burns.
 */
import { t as ti18n } from '../i18n/i18n';
import { ToastManager } from './ToastManager';
import { SoundEngine } from '../audio/SoundEngine';
import { fetchBounties, claimBountyRequest, BountyInfo } from '../nostr/presenceService';
import { ITEM_CATALOG, getInventory, ItemDef } from '../stores/tradeItemStore';

let overlay: HTMLElement | null = null;
let armed: string | null = null;   // bountyId whose TURN IN is in the "are you sure" state
let claiming = false;

function def(itemId: string): ItemDef | undefined {
  return ITEM_CATALOG.find(d => d.id === itemId);
}

// Owned, unlisted instances for one want — oldest first so turn-ins spend the
// stalest copies and keep the newest (the "NEW"-badged ones) in the bag.
function ownedInstancesFor(itemId: string): string[] {
  return getInventory()
    .filter(i => i.itemId === itemId)
    .sort((a, b) => a.acquiredAt - b.acquiredAt)
    .map(i => i.instanceId);
}

// Pick the exact instances to burn for a bounty, or null if we can't cover it.
function pickInstances(b: BountyInfo): string[] | null {
  const picked: string[] = [];
  for (const w of b.wants) {
    const have = ownedInstancesFor(w.itemId);
    if (have.length < w.qty) return null;
    picked.push(...have.slice(0, w.qty));
  }
  return picked;
}

function timeLeft(endsAt: number): string {
  const ms = endsAt - Date.now();
  if (ms <= 0) return '';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

// One pinned parchment poster. Ink-on-paper styling — the panel is a wooden
// noticeboard, each bounty a slightly-crooked tacked-up sheet.
function rowHtml(b: BountyInfo, idx: number): string {
  const reward  = def(b.rewardItemId);
  const canPick = !!pickInstances(b);
  const tilt    = [-0.8, 0.6, -0.5][idx % 3];
  const inactive = b.claimedByMe; // one claim per resident — no global cap

  const wantsHtml = b.wants.map(w => {
    const d = def(w.itemId);
    const have = Math.min(ownedInstancesFor(w.itemId).length, w.qty);
    const ok = have >= w.qty;
    return `<div style="font-size:12px;color:#2e2214;margin:2px 0;">
      ${w.qty}× ${d?.emoji ?? '❔'} <b>${d?.name ?? w.itemId}</b>
      <span style="font-size:9px;color:${ok ? '#4a6b3a' : '#7a5a3a'};font-weight:bold;margin-left:4px;">${ok ? '✓' : `${have}/${w.qty}`}</span>
    </div>`;
  }).join('');

  let btn: string;
  if (armed === b.id) {
    btn = `<button data-claim="${b.id}" style="width:100%;padding:8px 0;background:#6e2a1e;border:1px solid #4a1c12;border-radius:3px;color:#e8d4b8;font-family:inherit;font-size:10px;font-weight:bold;letter-spacing:1px;cursor:pointer;">${ti18n('bounty.confirm_burn')}</button>`;
  } else if (canPick && !inactive) {
    btn = `<button data-claim="${b.id}" style="width:100%;padding:8px 0;background:#3a2c1a;border:1px solid #2e2214;border-radius:3px;color:#d8c8a8;font-family:inherit;font-size:10px;font-weight:bold;letter-spacing:2px;cursor:pointer;">${ti18n('bounty.turn_in')}</button>`;
  } else if (!inactive) {
    btn = `<div style="width:100%;padding:8px 0;border:1px dashed #7a6a50;border-radius:3px;color:#6e5e44;font-size:10px;letter-spacing:1px;text-align:center;">${ti18n('bounty.need_items')}</div>`;
  } else {
    btn = '';
  }

  // Big diagonal stamp across posters you've already turned in
  const stamp = b.claimedByMe
    ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
         <div style="transform:rotate(-14deg);border:3px solid #3e5e34cc;border-radius:4px;color:#3e5e34cc;font-size:17px;font-weight:bold;letter-spacing:4px;padding:3px 14px;">${ti18n('bounty.claimed')}</div>
       </div>`
    : '';

  return `
    <div style="position:relative;transform:rotate(${tilt}deg);${inactive ? 'opacity:0.78;' : ''}">
      <div style="position:absolute;top:-4px;left:50%;transform:translateX(-50%);width:8px;height:8px;border-radius:50%;background:radial-gradient(circle at 35% 30%,${b.holiday ? '#3a8a4a,#14401e' : '#a8402a,#5e1c10'});box-shadow:0 1px 2px rgba(0,0,0,0.6);z-index:2;"></div>
      <div style="background:linear-gradient(172deg,${b.holiday ? '#9a8460 0%,#8e7650 55%,#7a6440 100%' : '#8e8470 0%,#837862 55%,#716650 100%'});border-radius:2px;box-shadow:0 3px 10px rgba(0,0,0,0.6), inset 0 0 26px rgba(48,34,76,0.30)${b.tier === 'legendary' ? ', 0 0 20px rgba(190,150,50,0.30)' : ''};padding:13px 16px 14px;text-align:center;${b.tier === 'legendary' ? 'outline:1px solid #8a6a2a66;' : ''}">
        <div style="font-size:${b.holiday ? '13px' : '15px'};font-weight:bold;letter-spacing:${b.holiday ? '4px' : '7px'};color:#2e2214;border-top:2px solid #2e2214;border-bottom:2px solid #2e2214;padding:3px 0;margin:0 8px ${b.holiday ? '4px' : '9px'};">${b.holiday ? `✦ ${ti18n('bounty.festive')} ✦` : ti18n('bounty.wanted')}</div>
        ${b.holiday ? `<div style="font-size:9px;letter-spacing:1px;color:#6e4a1e;margin-bottom:7px;">${ti18n('bounty.poster_down', { time: timeLeft(b.endsAt) })}</div>` : ''}
        ${wantsHtml}
        <div style="border-top:1px dashed #2e221455;margin:9px 14px 8px;"></div>
        <div style="font-size:9px;letter-spacing:2px;color:#5a4a34;margin-bottom:2px;">${ti18n('bounty.reward').toUpperCase()}</div>
        <div style="font-size:13px;color:#2e2214;margin-bottom:3px;">
          ${reward?.emoji ?? '❔'} <b>${reward?.name ?? b.rewardItemId}</b>
          ${b.tier === 'legendary'
            ? `<span style="display:inline-block;transform:rotate(-3deg);font-size:8px;letter-spacing:2px;color:#7a5410;border:1.5px solid #7a5410bb;border-radius:3px;padding:1px 5px;margin-left:5px;">LEGENDARY</span>`
            : `<span style="display:inline-block;transform:rotate(-3deg);font-size:8px;letter-spacing:2px;color:#4a2e7e;border:1.5px solid #4a2e7eaa;border-radius:3px;padding:1px 5px;margin-left:5px;">RARE</span>`}
        </div>
        ${b.claimed > 0 ? `<div style="font-size:9px;letter-spacing:1px;color:#6e5e44;margin-bottom:${btn ? '10px' : '0'};">${ti18n('bounty.claimed_count', { n: String(b.claimed) })}</div>` : ''}
        ${btn ? `<div style="margin-top:${b.claimed > 0 ? '0' : '8px'};">${btn}</div>` : ''}
      </div>
      ${stamp}
    </div>`;
}

async function render(): Promise<void> {
  const body = overlay?.querySelector('.bb-body') as HTMLElement | null;
  if (!body) return;
  const bounties = await fetchBounties();
  if (!overlay) return; // closed while fetching
  if (!bounties.length) {
    body.innerHTML = `<div style="color:#a08a70;font-size:11px;text-align:center;padding:20px 0;">${ti18n('bounty.offline')}</div>`;
    return;
  }
  const ends = timeLeft(bounties[0].endsAt);
  const hdr = overlay!.querySelector('.bb-ends') as HTMLElement | null;
  if (hdr && ends) hdr.textContent = ti18n('bounty.new_in', { time: ends });

  body.innerHTML = bounties.map((b, i) => rowHtml(b, i)).join('');
  body.querySelectorAll('button[data-claim]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = (el as HTMLElement).dataset.claim!;
      const bounty = bounties.find(b => b.id === id);
      if (!bounty || claiming) return;
      if (armed !== id) { armed = id; render(); return; } // step 1: arm
      armed = null;
      const instanceIds = pickInstances(bounty);
      if (!instanceIds) { render(); return; } // inventory changed under us
      claiming = true;
      (el as HTMLButtonElement).disabled = true;
      el.textContent = '…';
      const r = await claimBountyRequest(id, instanceIds);
      claiming = false;
      if (r.ok) {
        const rw = def(bounty.rewardItemId);
        SoundEngine.get().itemReward();
        ToastManager.show(ti18n('bounty.success', { item: `${rw?.emoji ?? ''} ${rw?.name ?? ''}` }), '#e8c070');
      } else {
        const reasons: Record<string, string> = {
          bounty_full:     ti18n('bounty.err.full'),
          already_claimed: ti18n('bounty.err.already'),
          wrong_items:     ti18n('bounty.err.items'),
          expired:         ti18n('bounty.err.expired'),
          offline:         ti18n('bz.err.offline'),
          timeout:         ti18n('bounty.err.timeout'),
        };
        ToastManager.show(reasons[r.reason ?? ''] ?? ti18n('bounty.err.generic'), '#ff9070');
      }
      render();
    });
  });
}

export const BountyBoardPanel = {
  isOpen(): boolean { return !!overlay; },

  show(): void {
    if (overlay) return;
    armed = null;
    overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:8000;
      background:rgba(7,4,16,0.84);
      display:flex; align-items:center; justify-content:center;
      font-family:"Courier New",monospace;
    `;
    const style = document.createElement('style');
    style.textContent = `
      .bb-board { scrollbar-width: thin; scrollbar-color: #463a66 transparent; }
      .bb-board::-webkit-scrollbar { width: 6px; }
      .bb-board::-webkit-scrollbar-track { background: transparent; }
      .bb-board::-webkit-scrollbar-thumb { background: #463a6688; border-radius: 3px; }
      .bb-board::-webkit-scrollbar-thumb:hover { background: #5a4a86aa; }
    `;
    overlay.appendChild(style);

    const box = document.createElement('div');
    box.className = 'bb-board';
    // A weathered noticeboard under the alley's night light: dark purple-stained
    // planks, dimmed parchment — matches the scene palette instead of glowing tan.
    box.style.cssText = `
      width:400px; max-width:94vw; max-height:86vh; overflow-y:auto;
      background:
        repeating-linear-gradient(90deg, #15101f 0px, #181226 38px, #110c1a 40px, #15101f 42px),
        #15101f;
      border:6px solid #0c0814; border-radius:6px; outline:1px solid #2a2240;
      padding:16px 20px 14px; color:#b8a8d8;
      box-shadow:0 8px 60px rgba(0,0,0,0.75), 0 0 44px rgba(110,80,200,0.10);
    `;
    box.innerHTML = `
      <div style="display:flex;align-items:baseline;justify-content:space-between;">
        <div style="color:#c0a8ff;font-size:14px;font-weight:bold;letter-spacing:4px;text-shadow:0 1px 0 #000;">${ti18n('bounty.title')}</div>
        <div style="color:#8a7fb0;font-size:16px;cursor:pointer;padding:0 2px;line-height:1;" class="bb-close">×</div>
      </div>
      <div style="color:#8a7fb0;font-size:9px;letter-spacing:1px;margin:3px 0 1px;">${ti18n('bounty.subtitle')}</div>
      <div class="bb-ends" style="color:#665c8a;font-size:9px;margin-bottom:14px;"></div>
      <div class="bb-body" style="display:flex;flex-direction:column;gap:16px;padding:0 4px;">
        <div style="color:#8a7fb0;font-size:11px;text-align:center;padding:20px 0;">…</div>
      </div>
      <div style="color:#544a72;font-size:8.5px;margin-top:14px;line-height:1.5;">${ti18n('bounty.footnote')}</div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) BountyBoardPanel.destroy(); });
    (box.querySelector('.bb-close') as HTMLElement).onclick = () => BountyBoardPanel.destroy();
    render();
  },

  destroy(): void {
    overlay?.remove();
    overlay = null;
    armed = null;
  },
};

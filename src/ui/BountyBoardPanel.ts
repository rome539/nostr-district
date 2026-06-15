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
let burnModal: HTMLElement | null = null; // the burn picker stacked on top of the board, if open

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

// Pick the exact instances to burn for a specific-item (holiday) bounty, or null
// if we can't cover it. "burn any N" bounties don't use this — the player picks.
function pickInstances(b: BountyInfo): string[] | null {
  const picked: string[] = [];
  for (const w of b.wants) {
    const have = ownedInstancesFor(w.itemId);
    if (have.length < w.qty) return null;
    picked.push(...have.slice(0, w.qty));
  }
  return picked;
}

// Owned instances of the given rarities, oldest first — the pool a "burn any N"
// poster draws from. The player chooses which of these to feed it.
function qualifyingInstances(rarities: ('common' | 'rare')[]): { instanceId: string; itemId: string }[] {
  return getInventory()
    .filter(i => { const r = def(i.itemId)?.rarity; return !!r && (rarities as string[]).includes(r); })
    .sort((a, b) => a.acquiredAt - b.acquiredAt)
    .map(i => ({ instanceId: i.instanceId, itemId: i.itemId }));
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
  const tilt    = [-0.8, 0.6, -0.5][idx % 3];
  const inactive = b.claimedByMe; // one claim per resident — no global cap

  // The specific wanted items (always shown), plus — when the poster has a burnAny
  // quota — a "+ pick N more of your choice" line. Regular/legendary posters carry
  // both; the holiday poster is wants-only.
  const wantsList = b.wants.map(w => {
    const d = def(w.itemId);
    const have = Math.min(ownedInstancesFor(w.itemId).length, w.qty);
    const ok = have >= w.qty;
    return `<div style="font-size:12px;color:#2e2214;margin:2px 0;">
      ${w.qty}× ${d?.emoji ?? '❔'} <b>${d?.name ?? w.itemId}</b>
      <span style="font-size:9px;color:${ok ? '#4a6b3a' : '#7a5a3a'};font-weight:bold;margin-left:4px;">${ok ? '✓' : `${have}/${w.qty}`}</span>
    </div>`;
  }).join('');

  let wantsHtml: string;
  let canPick: boolean;
  if (b.burnAny) {
    // Wants covered, AND enough OTHER items of the rarity (beyond those spent on
    // the wants) to fill the free-choice quota.
    const wantsOk = !!pickInstances(b);
    const wantsTotal = b.wants.reduce((s, w) => s + w.qty, 0);
    const anyPool = qualifyingInstances(b.burnAny.rarities).length - wantsTotal;
    canPick = wantsOk && anyPool >= b.burnAny.count;
    const choiceKey = b.burnAny.rarities.length > 1 ? 'bounty.plus_choose_any'
      : b.burnAny.rarities[0] === 'rare' ? 'bounty.plus_choose_rares' : 'bounty.plus_choose_commons';
    wantsHtml = wantsList
      + `<div style="font-size:12px;color:#2e2214;margin:2px 0;font-weight:bold;">${ti18n(choiceKey, { n: String(b.burnAny.count) })}</div>`;
  } else {
    canPick = !!pickInstances(b);
    wantsHtml = wantsList;
  }

  let btn: string;
  if (inactive) {
    btn = '';
  } else if (b.burnAny) {
    // Player-pick flow: the button opens an inventory picker (its own confirm).
    btn = canPick
      ? `<button data-pick="${b.id}" style="width:100%;padding:8px 0;background:#3a2c1a;border:1px solid #2e2214;border-radius:3px;color:#d8c8a8;font-family:inherit;font-size:10px;font-weight:bold;letter-spacing:1px;cursor:pointer;">${ti18n('bounty.choose_burn', { n: String(b.burnAny.count) })}</button>`
      : `<div style="width:100%;padding:8px 0;border:1px dashed #7a6a50;border-radius:3px;color:#6e5e44;font-size:10px;letter-spacing:1px;text-align:center;">${ti18n('bounty.need_items')}</div>`;
  } else if (armed === b.id) {
    btn = `<button data-claim="${b.id}" style="width:100%;padding:8px 0;background:#6e2a1e;border:1px solid #4a1c12;border-radius:3px;color:#e8d4b8;font-family:inherit;font-size:10px;font-weight:bold;letter-spacing:1px;cursor:pointer;">${ti18n('bounty.confirm_burn')}</button>`;
  } else if (canPick) {
    btn = `<button data-claim="${b.id}" style="width:100%;padding:8px 0;background:#3a2c1a;border:1px solid #2e2214;border-radius:3px;color:#d8c8a8;font-family:inherit;font-size:10px;font-weight:bold;letter-spacing:2px;cursor:pointer;">${ti18n('bounty.turn_in')}</button>`;
  } else {
    btn = `<div style="width:100%;padding:8px 0;border:1px dashed #7a6a50;border-radius:3px;color:#6e5e44;font-size:10px;letter-spacing:1px;text-align:center;">${ti18n('bounty.need_items')}</div>`;
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
            : `<span style="display:inline-block;transform:rotate(-3deg);font-size:8px;letter-spacing:2px;color:#2a4e8a;border:1.5px solid #2a4e8aaa;border-radius:3px;padding:1px 5px;margin-left:5px;">RARE</span>`}
        </div>
        ${b.holiday && b.claimed > 0 ? `<div style="font-size:9px;letter-spacing:1px;color:#6e5e44;margin-bottom:${btn ? '10px' : '0'};">${ti18n('bounty.claimed_count', { n: String(b.claimed) })}</div>` : ''}
        ${btn ? `<div style="margin-top:${b.holiday && b.claimed > 0 ? '0' : '8px'};">${btn}</div>` : ''}
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
  // Specific-item (holiday) posters: two-step arm → confirm with auto-picked items.
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
      applyClaimResult(r, bounty);
      render();
    });
  });
  // "Burn any N" posters: open the inventory picker so the player chooses what to feed it.
  body.querySelectorAll('button[data-pick]').forEach(el => {
    el.addEventListener('click', () => {
      const bounty = bounties.find(b => b.id === (el as HTMLElement).dataset.pick!);
      if (bounty && !claiming) openBurnPicker(bounty);
    });
  });
}

// Toast the outcome of a claim (shared by both the auto-pick and picker flows).
function applyClaimResult(r: { ok: boolean; reason?: string }, bounty: BountyInfo): void {
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
}

// Inventory picker: auto-includes the poster's specific wants, then lets the
// player choose `burnAny.count` MORE items of the rarity from what's left.
function openBurnPicker(b: BountyInfo): void {
  if (!b.burnAny || !overlay) return;
  const need = b.burnAny.count;
  const rarities = b.burnAny.rarities;
  const reward = def(b.rewardItemId);

  // The specific required items (auto-picked, oldest first). Bail if the player no
  // longer owns them (inventory changed since the button was shown).
  const wantInstances = pickInstances(b);
  if (!wantInstances) { render(); return; }
  const wantSet = new Set(wantInstances);

  // The free-choice pool = qualifying items NOT already spent on the wants.
  const groups: { itemId: string; instances: string[] }[] = [];
  const byId = new Map<string, string[]>();
  for (const it of qualifyingInstances(rarities)) {
    if (wantSet.has(it.instanceId)) continue;
    let arr = byId.get(it.itemId);
    if (!arr) { arr = []; byId.set(it.itemId, arr); groups.push({ itemId: it.itemId, instances: arr }); }
    arr.push(it.instanceId);
  }
  const chosen = new Map<string, number>(); // itemId → qty selected
  const total = () => [...chosen.values()].reduce((s, n) => s + n, 0);
  const burnTotal = b.wants.reduce((s, w) => s + w.qty, 0) + need; // required + free-choice

  const requiredHtml = b.wants.map(w => {
    const d = def(w.itemId);
    return `<div style="display:flex;align-items:center;gap:8px;background:#181030;border:1px solid #2a2240;border-radius:5px;padding:6px 9px;opacity:0.92;">
      <span style="font-size:15px;">${d?.emoji ?? '❔'}</span>
      <div style="flex:1;min-width:0;color:#cabbf0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${w.qty}× ${d?.name ?? w.itemId}</div>
      <span style="color:#7ac77a;font-size:11px;font-weight:bold;">✓</span>
    </div>`;
  }).join('');

  let filter = '';
  const showSearch = groups.length > 6; // only worth a search box once the list is long

  const modal = document.createElement('div');
  modal.style.cssText = `position:fixed;inset:0;z-index:8100;background:rgba(7,4,16,0.82);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;font-family:"Courier New",monospace;`;

  const pstyle = document.createElement('style');
  pstyle.textContent = `
    .bp-scroll { scrollbar-width:thin; scrollbar-color:#463a66 transparent; -webkit-overflow-scrolling:touch; }
    .bp-scroll::-webkit-scrollbar { width:6px; }
    .bp-scroll::-webkit-scrollbar-thumb { background:#463a6688; border-radius:3px; }
    .bp-step { width:34px;height:34px;flex-shrink:0;border-radius:6px;border:1px solid #3a2f5a;background:#241a40;color:#c0a8ff;font-family:inherit;font-size:18px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;touch-action:manipulation; }
    .bp-step:disabled { background:#181226;color:#473e66;cursor:default; }
    .bp-row { display:flex;align-items:center;gap:10px;background:#1a1430;border:1px solid #2a2240;border-radius:6px;padding:8px 10px;margin-bottom:5px; }
    .bp-burn { width:100%;padding:13px 0;border-radius:5px;border:1px solid #6e2a1e;background:#6e2a1e;color:#e8d4b8;font-family:inherit;font-size:12px;font-weight:bold;letter-spacing:2px;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation; }
    .bp-burn:disabled { border-color:#2e2440;background:#181226;color:#56507a;cursor:default; }
  `;
  modal.appendChild(pstyle);

  // Box: a flex column with a FIXED header, a single SCROLLING item list, and a
  // STICKY footer — so the count + Burn button stay on screen no matter how many
  // items you own, and only the list scrolls (no nested-scroll, mobile-safe).
  const box = document.createElement('div');
  box.style.cssText = `width:380px;max-width:100%;max-height:88vh;display:flex;flex-direction:column;background:#15101f;border:4px solid #0c0814;border-radius:8px;outline:1px solid #2a2240;color:#b8a8d8;box-shadow:0 8px 60px rgba(0,0,0,0.75);overflow:hidden;`;
  modal.appendChild(box);

  const header = document.createElement('div');
  header.style.cssText = `flex-shrink:0;padding:14px 16px 10px;border-bottom:1px solid #221a3a;`;
  header.innerHTML = `
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:3px;">
      <div style="color:#c0a8ff;font-size:13px;font-weight:bold;letter-spacing:2px;">${ti18n('bounty.pick_title', { n: String(need) })}</div>
      <div style="color:#8a7fb0;font-size:22px;cursor:pointer;line-height:1;padding:0 2px;" class="bp-close">×</div>
    </div>
    <div style="color:#7e74a6;font-size:9px;letter-spacing:1px;">${ti18n('bounty.pick_for', { item: `${reward?.emoji ?? ''} ${reward?.name ?? ''}` })}</div>
    ${requiredHtml ? `<div style="color:#7e74a6;font-size:8.5px;letter-spacing:1px;margin:10px 0 4px;">${ti18n('bounty.required_label')}</div><div style="display:flex;flex-direction:column;gap:4px;">${requiredHtml}</div>` : ''}
    <div style="color:#7e74a6;font-size:8.5px;letter-spacing:1px;margin:10px 0 ${showSearch ? '6px' : '0'};">${ti18n('bounty.pick_more', { n: String(need) })}</div>
    ${showSearch ? `<input class="bp-search" placeholder="${ti18n('bounty.search')}" style="width:100%;box-sizing:border-box;background:#0e0a1c;border:1px solid #2a2240;color:#cabbf0;font-family:inherit;font-size:12px;padding:8px 10px;border-radius:5px;outline:none;" />` : ''}`;
  box.appendChild(header);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'bp-scroll';
  bodyEl.style.cssText = `flex:1;overflow-y:auto;padding:10px 16px;min-height:90px;`;
  box.appendChild(bodyEl);

  const footer = document.createElement('div');
  footer.style.cssText = `flex-shrink:0;padding:8px 16px 14px;border-top:1px solid #221a3a;`;
  footer.innerHTML = `
    <div class="bp-progress" style="text-align:center;font-size:11px;font-weight:bold;letter-spacing:1px;margin:4px 0 9px;"></div>
    <button class="bp-burn"></button>`;
  box.appendChild(footer);

  // Footer + per-row controls update in place (no list rebuild) so taps don't
  // steal focus from the search box or make rows jump under your finger.
  const updateFooter = () => {
    const t = total();
    const prog = footer.querySelector('.bp-progress') as HTMLElement;
    prog.textContent = ti18n('bounty.pick_progress', { n: String(t), total: String(need) });
    prog.style.color = t === need ? '#9aff9a' : '#8a7fb0';
    const burn = footer.querySelector('.bp-burn') as HTMLButtonElement;
    burn.textContent = ti18n('bounty.burn_claim', { n: String(burnTotal) });
    burn.disabled = !(t === need && !claiming);
  };
  const refreshControls = () => {
    const t = total();
    bodyEl.querySelectorAll('.bp-row').forEach(row => {
      const id = (row as HTMLElement).dataset.id!;
      const sel = chosen.get(id) ?? 0;
      const max = byId.get(id)!.length;
      (row.querySelector('.bp-count') as HTMLElement).textContent = String(sel);
      (row.querySelector('.bp-dec') as HTMLButtonElement).disabled = sel <= 0;
      (row.querySelector('.bp-inc') as HTMLButtonElement).disabled = sel >= max || t >= need;
    });
    updateFooter();
  };

  const renderList = () => {
    const f = filter.trim().toLowerCase();
    const list = groups
      .filter(g => !f || (def(g.itemId)?.name ?? g.itemId).toLowerCase().includes(f))
      .sort((a, c) => {
        const sa = (chosen.get(a.itemId) ?? 0) > 0 ? 0 : 1; // selected float to the top
        const sc = (chosen.get(c.itemId) ?? 0) > 0 ? 0 : 1;
        if (sa !== sc) return sa - sc;
        if (c.instances.length !== a.instances.length) return c.instances.length - a.instances.length; // then the ones you own the MOST of
        return (def(a.itemId)?.name ?? '').localeCompare(def(c.itemId)?.name ?? '');
      });
    if (!list.length) {
      bodyEl.innerHTML = `<div style="color:#6a608c;font-size:11px;text-align:center;padding:26px 0;">${ti18n('bounty.no_matches')}</div>`;
      return;
    }
    const t = total();
    bodyEl.innerHTML = list.map(g => {
      const d = def(g.itemId);
      const sel = chosen.get(g.itemId) ?? 0;
      const max = g.instances.length;
      return `<div class="bp-row" data-id="${g.itemId}">
        <span style="font-size:17px;flex-shrink:0;">${d?.emoji ?? '❔'}</span>
        <div style="flex:1;min-width:0;">
          <div style="color:#cabbf0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d?.name ?? g.itemId}</div>
          <div style="color:#6a608c;font-size:9px;">${ti18n('bounty.own_count', { n: String(max) })}</div>
        </div>
        <button class="bp-step bp-dec" ${sel <= 0 ? 'disabled' : ''}>−</button>
        <span class="bp-count" style="min-width:16px;text-align:center;color:#e0d4ff;font-size:13px;font-weight:bold;">${sel}</span>
        <button class="bp-step bp-inc" ${(sel >= max || t >= need) ? 'disabled' : ''}>+</button>
      </div>`;
    }).join('');
    bodyEl.querySelectorAll('.bp-row').forEach(row => {
      const id = (row as HTMLElement).dataset.id!;
      row.querySelector('.bp-inc')!.addEventListener('click', () => {
        const max = byId.get(id)!.length;
        if (total() < need && (chosen.get(id) ?? 0) < max) { chosen.set(id, (chosen.get(id) ?? 0) + 1); refreshControls(); }
      });
      row.querySelector('.bp-dec')!.addEventListener('click', () => {
        const cur = chosen.get(id) ?? 0;
        if (cur > 0) { chosen.set(id, cur - 1); refreshControls(); }
      });
    });
  };

  const closePicker = () => { modal.remove(); burnModal = null; };
  (header.querySelector('.bp-close') as HTMLElement).onclick = closePicker;
  const searchEl = header.querySelector('.bp-search') as HTMLInputElement | null;
  if (searchEl) searchEl.addEventListener('input', () => { filter = searchEl.value; renderList(); });
  (footer.querySelector('.bp-burn') as HTMLButtonElement).onclick = async () => {
    if (total() !== need || claiming) return;
    const instanceIds: string[] = [...wantInstances]; // required items…
    for (const [id, qty] of chosen) instanceIds.push(...byId.get(id)!.slice(0, qty)); // …plus the free-choice picks
    claiming = true;
    const burn = footer.querySelector('.bp-burn') as HTMLButtonElement;
    burn.disabled = true; burn.textContent = '…';
    const r = await claimBountyRequest(b.id, instanceIds);
    claiming = false;
    closePicker();
    applyClaimResult(r, b);
    render();
  };

  modal.addEventListener('mousedown', e => { if (e.target === modal) closePicker(); });
  renderList();
  updateFooter();
  document.body.appendChild(modal);
  burnModal = modal; // so ESC peels the picker before the board (see closeTopModal)
}

export const BountyBoardPanel = {
  isOpen(): boolean { return !!overlay; },

  // Close the burn picker stacked on top of the board, if open. Lets ESC peel the
  // picker first instead of tearing down the whole board (checked before isOpen).
  closeTopModal(): boolean {
    if (burnModal) { burnModal.remove(); burnModal = null; return true; }
    return false;
  },

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
    burnModal?.remove();
    burnModal = null;
    overlay?.remove();
    overlay = null;
    armed = null;
  },
};

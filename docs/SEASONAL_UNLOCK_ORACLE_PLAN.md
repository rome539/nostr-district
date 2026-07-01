# Seasonal Unlock → Oracle-Signed Grants (Plan)

**Status:** scoped, not started. Parked for later.
**Goal:** make window/streak-earned cosmetics *provably earned* instead of self-attested,
so a nameplate color/aura can't be forged.

---

## Problem

Seasonal cosmetics (holiday name colors, streak auras) are currently granted by the
**client self-signing** a `kind:30078` unlock event via `unlockStore.unlockItem()` /
`unlockAura()`. Reading them back queries `authors: [ownPubkey]` — your own event. There is:

- **no oracle signature**, and
- **no signature verification** on the client read path.

So anyone can hand-craft a `kind:30078` with `content: { items: ["nameColor:liberty", ...] }`,
sign it with their own key, publish it, and their client loads it as legitimately unlocked.
The `isJuly4thWindow()` (and sibling) checks are **client-side UI only** — a forger bypasses
`tryGrant*()` entirely and publishes the event directly. Nothing stops it.

This is distinct from the **item** economy (`nditem`), which *is* oracle-gated and safe:
items are authored by the oracle and can't be self-minted. Seasonal cosmetics never got
that treatment because they're cosmetic-only (deferred trade-off, see `[[project_unlock_forgery]]`).

### Why hashing/HMAC does NOT solve it
Hashing only helps if there's a secret the forger lacks. The client is open JS — any hash
or HMAC-with-embedded-secret it can compute, an attacker reading the bundle can compute too.
Security-by-obscurity, not security. The only real fix routes trust through a secret the
user never sees = the **oracle key on the server**.

---

## Design: stateless oracle grants (clone of `ndfishrec`)

The legendary-catch record (`server.ts` ~264-324) is the exact template and is already
battle-tested: oracle-signed, per-pubkey `d`-tag, file-backed + relay-durable, client trusts
only the oracle copy.

**Grant record:** `kind:30078`, `d: ndunlock_<pubkey>`, `#p: <pubkey>`, `#t: ndunlock`,
authored by `ORACLE_PUBKEY`, `content: { unlocks: [ "nameColor:liberty", ... ] }` (accumulates).

**Flow:**
1. Client, on login during a window, sends WS `seasonal_unlock_request { unlockId }`.
2. Server validates `unlockId` and checks **its own clock** is inside that unlock's window.
3. Server loads the durable record (re-read relay copy first — see redeploy note), adds the id,
   writes the local file, and publishes the oracle-signed event to `PUBLISH_RELAYS`.
4. Client fetches the oracle-authored record, **`verifyEvent()`s the oracle signature**, and
   exposes `hasSeasonalUnlock(id)`.

**Security property:** outside the window the oracle refuses to sign; the client rejects
anything not oracle-signed. A forger can't self-sign it and can't get the oracle to sign it
out of season. Identity at request time is *not* security-critical (worst case: you "gift"
someone a color they'd earn anyway by logging in) — which is what keeps it stateless.

---

## Scope

Decided: **all seasonal unlocks** (per owner). Splits into two phases by difficulty.

### Phase 1 — Window-earned colors (STATELESS, do first)
Server only checks its clock. 5 name colors (chat color is bundled with name color):

| unlock key            | window             | current store                 |
|-----------------------|--------------------|-------------------------------|
| `nameColor:liberty`   | Jul 1–7            | `july4UnlockStore.ts`         |
| `nameColor:nostrich`  | Nostr Day (Nov 7–13)| `nostrBirthdayUnlockStore.ts`|
| `nameColor:halloween` | Halloween (Oct 27–31)| `halloweenUnlockStore.ts`   |
| `nameColor:midautumn` | Mid-Autumn (lunar) | `midAutumnUnlockStore.ts`     |
| `nameColor:halving`   | Halving (April drift)| `halvingUnlockStore.ts`     |

Note: seasonal **auras** (e.g. Mid-Autumn) are **set-completion** auras (possession-based off
oracle items via `collectionUnlocks`) — already oracle-backed, nothing to migrate.

### Phase 2 — Streak auras (STATEFUL, do after)
`ice` (7-day) and `void` (30-day) auras depend on login streak. The streak counter itself
(`loginStreak`/`lastLoginDate`) lives in the self-signed event today → **double forgeable**.
Making these provable requires the **server to authoritatively track login dates per pubkey**
(same `ndfishrec` relay-as-storage pattern, but real streak logic). Deferred to keep Phase 1
reviewable.

---

## Files to touch (Phase 1, ~9)

**Server (`server.ts`)**
- `SEASONAL_UNLOCK_WINDOWS` table: reuse `SCAV_HOLIDAY_DROPS` windows for july4/nostr_day/
  halloween/mid_autumn; add a small entry for `halving` (April windows — halving has no items,
  so it isn't in `SCAV_HOLIDAY_DROPS`).
- `grantSeasonalUnlock(pubkey, id)`: validate id, clock-check window, load durable record
  (don't clobber), append, write `.seasonal-unlocks.json`, publish oracle event. Mirror
  `recordLegendaryCatch` + `loadFishRecord` + `publishFishRecord`.
- WS handler: `type: 'seasonal_unlock_request'`.

**Client**
- `presenceService.ts`: `sendSeasonalUnlockRequest(id)` (mirror `sendFishCatchRequest`).
- **New** `seasonalUnlockStore.ts`: fetch oracle-authored `ndunlock_<pubkey>`, **`verifyEvent()`**
  the oracle sig, expose `hasSeasonalUnlock(id)` + a change event for toasts. Trust set =
  existing oracle pubkeys (`getOraclePubkeys()`).
- 5 `*UnlockStore.ts`: swap `unlockItem(KEY)` → `sendSeasonalUnlockRequest(KEY)`; guards
  read `hasSeasonalUnlock` instead of `hasItem`; toast on newly-observed grant.
- `marketStore.ts:638` — the **one read-path redirect**: `if (hasUnlockedItem(key))` →
  consult the oracle-grant set for seasonal colors. This is the single gate that decides
  "can equip this color," so it's the linchpin.

---

## Oracle handling: reuse, don't change

Verified the oracle's event machinery is already correct; we lean on it rather than reworking it:

- **Sign → publish** to `PUBLISH_RELAYS` (`server.ts:13,49`); client reads the same set
  (`ITEM_RELAYS`, kept in sync — client comment says "must match PUBLISH_RELAYS").
- **Newest-wins** dedup via `newestPerD()` (`server.ts:1187`) — replaceable event per d-tag.
- **Re-read durable relay copy before mutating** (`loadFishRecord`, `server.ts:302`) — Railway
  has no volume, so the local `.json` is wiped on every redeploy. **Must mirror** or a redeploy
  clobbers grants. (Easy to forget — call it out in review.)
- **Server already verifies sigs** where it matters (`server.ts:1009-1011`): *"never trust a
  pubkey field alone (relays don't re-verify on read)."* The **client** does NOT — that's the
  hole. New client reader must `verifyEvent()` the same way.
- Trust anchor: oracle **pubkey** already ships to client via `VITE_ORACLE_PUBKEYS`; no secret
  leaves the server.

**Bonus:** adding client-side `verifyEvent()` in the grant reader is the same fix the item
inventory path needs — the client currently trusts `pubkey` + relay honesty when reading
`nditem` events (no local sig check in `fetchInventoryFromRelays` / `receiveMintedEvent`).
Consider factoring a shared `verifyOracleEvent(ev)` helper and applying it to both.

---

## Migration

Decided: **no backfill** (effectively no live users yet). Client trusts only oracle grants;
any pre-existing self-signed unlock simply stops counting and is re-earned by being online
in-window. No migration code.

---

## Open items / decisions for build time

- [ ] `halving` window on the server (client uses live block-height; server needs a static
      date table — the April `specificDates` are fine as an approximation, or query height).
- [ ] Toast UX: fire the "Unlocked" toast when the oracle grant is first *observed* on the
      client (not on request), so it reflects the authoritative grant.
- [ ] Rate-limit / debounce `seasonal_unlock_request` (a client could spam it in-window;
      harmless but wasteful — the oracle re-signs each time). Mirror fishing bucket if needed.
- [ ] Decide whether to keep `unlockStore` self-signed path for anything non-seasonal
      (fishing item unlocks still use `unlockItem`; they're achievement-gated, separate issue).
- [ ] Shared `verifyOracleEvent()` helper + apply to `nditem` read path (closes the item gap).

---

## Related

- `[[project_unlock_forgery]]` — the original deferred note this supersedes for seasonal cosmetics.
- `[[project_bazaar_launch]]` — oracle key rotation history.
- Template code: `server.ts` legendary-catch record (`ndfishrec`, ~264-356).

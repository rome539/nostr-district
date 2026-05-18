# Crew Multi-Admin Authority — Plan

Status: **proposal, not yet implemented**

The current crew model gives only the founder cryptographic authority over the crew definition (because `kind:30078` replaceable events are keyed by author pubkey). Admins can take social actions in chat but can't update the canonical crew state. This plan introduces a **shared admin keypair** so multiple admins can update the crew while preserving a founder-controlled recovery path.

---

## Goal

- Any admin (not just the founder) can publish authoritative crew-def updates: kicks, unkicks, role changes, edits.
- All clients see the same canonical state regardless of which admin acted.
- Founder retains a cryptographic "nuclear option" to recover from a rogue admin (rotate the crew key).
- No new third-party dependencies; only NIP-44 (encryption) and NIP-17 (gift-wrap) — both already in use.

---

## Architecture

Two events represent each crew, instead of one:

### 1. Crew pointer (`kind:30078`, signed by founder's personal nsec)

The pointer is the **source of truth for "which keypair currently controls this crew."** Only the founder can change it.

```json
{
  "kind": 30078,
  "pubkey": "<founderPubkey>",
  "tags": [
    ["d", "nostr-district:crew-ptr:<crewId>"],
    ["t", "nostr-district"]
  ],
  "content": "{ \"crewPk\": \"<currentCrewPubkey>\", \"founderPubkey\": \"<founderPubkey>\" }"
}
```

- `crewId` is a stable UUID generated at creation; never changes.
- `crewPk` is the **crew identity keypair's** public key; may change on key rotation.
- Replaceable per `(founderPubkey, kind, d-tag)` — only the founder can replace it.

### 2. Crew definition (`kind:30078`, signed by `crewSk`)

The actual mutable crew state — name, emblem, members, roles, kicked list, encrypted chat key. Any admin who holds `crewSk` can sign and replace it.

```json
{
  "kind": 30078,
  "pubkey": "<crewPk>",
  "tags": [
    ["d", "nostr-district:crew:<crewId>"],
    ["t", "nostr-district"]
  ],
  "content": "{
    \"name\": ...,
    \"about\": ...,
    \"emblem\": ...,
    \"color\": ...,
    \"isOpen\": ...,
    \"founderPubkey\": ...,
    \"memberRoles\": { ... },
    \"kickedPubkeys\": [...],
    \"pendingReinvites\": { ... },
    \"wrappedChatKey\": \"<NIP-44 self-encrypt to crewPk>\"
  }"
}
```

- Replaceable per `(crewPk, kind, d-tag)` — any holder of `crewSk` can replace it.
- The `founderPubkey` field is informational only (UI shows it); cryptographic founder authority lives in the pointer event.

### 3. Key custody

- `crewSk` is held by founder + every current admin. Distributed via gift-wrapped DMs (NIP-17 → NIP-44 inside).
- Each holder caches it locally per pubkey: encrypted at rest with HKDF-from-nsec for nsec/passkey users, plaintext for extension/bunker (same trade-off as Spark wallet / chatKey cache).
- New cache module `src/nostr/crewSkCache.ts`, mirroring `crewKeyCache.ts`.

### 4. Chat key changes

For closed crews, `wrappedChatKey` becomes a **NIP-44 self-encrypt to `crewPk`** rather than to the founder's personal pubkey. Any admin with `crewSk` can recover the `chatKey` directly from the crew def — no separate gift-wrap to admins required. Regular members still receive their `chatKey` via the existing gift-wrap-on-accept flow.

---

## Flows

### Creating a crew

1. Founder generates fresh `(crewSk, crewPk)` via `generateSecretKey`.
2. Founder generates `chatKey` (closed crews only); wraps with NIP-44 from `crewSk` to `crewPk` → `wrappedChatKey`.
3. Founder signs and publishes the crew def with `crewSk`.
4. Founder signs and publishes the pointer event with their personal nsec.
5. Founder caches `crewSk` and `chatKey` locally.

### Promoting a member to admin

1. Founder (or any existing admin) updates `memberRoles[<pubkey>]` to `{ role: 'admin' }` in the crew def. Signs with `crewSk`, publishes.
2. Sends a NIP-17 gift-wrapped DM to the new admin containing `crewSk` (`nd-crew-sk:<crewId>:<crewSkHex>`).
3. New admin's client intercepts the DM (like the existing `nd-key:` handler), caches `crewSk`, can now sign crew-def updates.

### Demoting an admin (cryptographic revocation)

Only the **founder** can do a full cryptographic demotion:

1. Founder generates fresh `(crewSk2, crewPk2)`.
2. Founder re-publishes the crew def under `crewPk2`, with the demoted admin removed from `memberRoles`. Wraps the existing `chatKey` to `crewPk2`.
3. Founder publishes a new pointer event (signed with their personal nsec) updating `crewPk` to `crewPk2`.
4. Founder gift-wraps `crewSk2` to all remaining admins.
5. The chat key is preserved (still the same `chatKey` value), so regular members don't need any redistribution.

The demoted admin retains a copy of the old `crewSk`. They can still sign defs under the **old** `crewPk`, but the founder's pointer event now points at `crewPk2`, so well-behaved clients ignore the old def. This is the cryptographic safety net.

### Soft demotion (UI-only, no rotation)

Any admin can simply update `memberRoles[<pubkey>]` to `{ role: 'member' }` and republish. The demoted user still has `crewSk` cached cryptographically, but the UI no longer treats them as an admin. This is fine for routine "you're not staff anymore, please don't grief" scenarios — same trust model as Discord, Slack, etc.

Use cryptographic demotion (full rotation) only when the admin is actively abusing the role.

### Kicking a member

Any admin (or founder) can:

1. Update `kickedPubkeys` in the crew def, sign with `crewSk`, publish.
2. For closed crews: rotate the `chatKey` (generate new, update `wrappedChatKey`), gift-wrap the new chatKey to remaining members.
3. NIP-29 `kind:9001` removal (existing flow, unchanged).

The rotation of `chatKey` here is independent of `crewSk` rotation. Chat keys rotate on every kick (forward exclusion of kicked member's chat access). Crew keys rotate only on demotion.

### Unkicking

Any admin: update `kickedPubkeys`, sign with `crewSk`, publish.

The unkicked member can re-request to join through the normal flow; the new chatKey is sent at re-approval.

### Editing crew metadata

Any admin: update name/about/emblem/color/isOpen, sign with `crewSk`, publish.

### Founder transfer (optional, future)

Founder publishes a new pointer event with a different `founderPubkey` field. The new founder accepts by republishing the pointer themselves — this proves they have the new identity's nsec. Until they republish, the old founder can rescind. (Defer this; mention in plan only.)

---

## Discovery / lookup

### Finding a crew by ID

1. Client looks up the pointer: `query { kinds: [30078], '#d': ['nostr-district:crew-ptr:<crewId>'] }`.
2. Reads `crewPk` from pointer's content.
3. Fetches the crew def: `query { kinds: [30078], '#d': ['nostr-district:crew:<crewId>'], authors: [crewPk] }`.

### Browsing all crews (Find a Crew tab)

Query pointers: `{ kinds: [30078], '#t': ['nostr-district'] }` filtered to those whose d-tag starts with `nostr-district:crew-ptr:`. For each pointer, extract `crewId` and `crewPk`, then fetch the corresponding def.

A single relay round-trip can fetch many pointers in parallel; we already do similar two-stage lookups for member events. Acceptable cost.

### Caching

Pointer events are tiny (~200 bytes). Cache aggressively in memory + localStorage; refresh on a TTL or on explicit user action. Stale pointers only matter when the founder has rotated, which is rare.

### What if a client follows the wrong `crewPk`?

If the founder rotates and a client hasn't refreshed the pointer, they'll see the old `crewPk`'s def (with the old admin set, etc.). On next pointer refresh they'll switch. Document this as eventual consistency. Same trade-off as DNS TTL.

---

## Migration

Existing crews use the old model (def signed by founder, no pointer). We have three options:

### Option A — coexistence (recommended)

- Existing crews keep working with the old model. The code maintains both code paths for fetching/updating crew defs: "v1 crews" (founder-signed def, no pointer) and "v2 crews" (pointer + crewSk-signed def).
- New crews always use v2.
- Founder of a v1 crew can opt into "Upgrade to v2 authority" via a button in the manage modal. The upgrade generates `(crewSk, crewPk)`, publishes the v2 pointer + def, and stops updating the v1 def (which then becomes a stale snapshot).
- Members don't need to do anything; their client sees both and picks v2 when present.

### Option B — hard cut

- All crews are v2. Existing v1 crews are republished by the founder on next login.
- Simplest code but disruptive if anyone uses the app between deploy and re-publish.

### Option C — auto-migrate on founder login

- Founder's client detects a v1 crew they own and silently performs the upgrade.
- Hidden to user.
- Risk: if the upgrade fails partway, the crew is in a broken state.

Recommendation: **Option A**. Two code paths is annoying but the safest for users; the upgrade button gives founders explicit control.

---

## Code changes

| File | Change |
|---|---|
| `src/nostr/crewService.ts` | Crew creation, fetching, role updates, kick/unkick refactored to use crewPk. Both v1 and v2 paths supported. |
| `src/nostr/crewSkCache.ts` *(new)* | Per-crew `crewSk` cache, mirrors `crewKeyCache.ts`. HKDF-from-nsec encryption at rest. |
| `src/nostr/dmService.ts` (intercept) | Add `nd-crew-sk:<crewId>:<sk>` handler alongside the existing `nd-key:` handler. |
| `src/nostr/nostrService.ts` | `signEvent` accepts an optional signing key arg (or new `signWithKey(key, event)`) so we can sign defs with `crewSk` rather than the user's personal key. |
| `src/ui/CrewPanel.ts` | Manage modal: promote/demote both update `memberRoles` + gift-wrap (promote) or rotate (founder cryptographic demote). Upgrade-to-v2 button for founders. |
| `src/ui/CrewPanel.ts` (display) | Read founder identity from pointer's `founderPubkey` (not the def's author). |

### New helpers

- `genCrewKeypair()` → `{ crewSk, crewPk }`
- `signWithKey(secretKey, event)` — signs an event with an arbitrary key instead of the logged-in user's
- `publishCrewPointer(crewId, crewPk, founderPubkey)` — founder-signed pointer event
- `fetchCrewPointer(crewId)` → `{ crewPk, founderPubkey }` (cached)
- `distributeCrewSk(crewId, recipientPubkey)` — gift-wrap DM the crewSk to a new admin
- `rotateCrewKey(crewId)` — founder-only: generate new keypair, republish def + pointer, distribute to remaining admins

---

## Risks and trade-offs

### Cryptographic

- **Admins can grief.** Any holder of `crewSk` can: kick anyone (including the founder), edit any crew metadata, promote new admins. We accept this — same as Discord/Slack. Founder's recourse is a full rotation.
- **No revocation without rotation.** Demoting an admin via `memberRoles` alone is honor-system. They still have `crewSk` cached locally; nothing stops them from continuing to sign defs. The founder must do a full rotation to actually revoke.
- **Crew key compromise = full crew compromise.** If any admin's `crewSk` cache is exfiltrated (XSS, malicious extension), the attacker can do anything admins can do. Mitigated by HKDF-from-nsec encryption at rest for nsec users; plaintext for extension/bunker (existing trade-off).

### Architectural

- **Two events per crew.** Pointer + def. Discovery costs ~2x relay queries; caching mitigates.
- **Eventual consistency on rotation.** Clients seeing the old pointer follow the old `crewPk`. They converge on refresh. Document explicitly.
- **`crewSk` distribution is N gift-wraps on admin add.** Same per-DM signing prompt issue we hit with crew chat — but admin adds are rare (one signing prompt per promotion).
- **Rotation is expensive.** New def under new `crewPk`, new pointer, N gift-wraps to remaining admins, possibly `chatKey` re-wrap for closed crews. Founder pays this cost; only happens on cryptographic demote.

### Migration

- **Code maintains two paths indefinitely** unless we force a cutover. Most crews will be v2 within months; can sunset v1 reads eventually.
- **Confusion if v1 founder rotates `crewSk`** — wait, they can't, v1 doesn't have `crewSk`. Not a real risk.

---

## Open questions

1. **Do we ever expire pointer events?** Replaceable events on relays live until replaced; old crews' pointers persist forever. Probably fine — Nostr-design.
2. **What if multiple admins try to update the def simultaneously?** Last-write-wins per relay. Could land in a state where each relay has a different latest event. Standard Nostr distributed-state risk; same as before. Mitigate via deterministic conflict resolution if it becomes a real problem.
3. **Should the pointer also include the `chatKey` somehow?** No — chatKey is closed-crew-only, lives in the def. Keep pointer minimal.
4. **What about the NIP-29 group identity?** Unchanged. `groupId = "nostr-district:crew:" + crewId` stays stable across rotations. NIP-29 relay-side membership/admin lists are independent of our keypair scheme.
5. **Backwards compat with kicked members from v1 crews?** Their `kickedPubkeys` list is in the v1 def. On upgrade, we copy it forward into the v2 def.

---

## Test plan

### Unit
- `genCrewKeypair()` produces matching pub/sk and unique values per call.
- `signWithKey()` produces valid signatures verifiable by `crewPk`.
- `wrappedChatKey` round-trips: founder writes → admin reads via `crewSk` decrypt.

### Integration (closed crew, 3 admins + 5 members)
1. Founder creates crew → pointer + def published, founder has crewSk + chatKey locally.
2. Founder promotes Admin A → A receives gift-wrap, caches crewSk; A can decrypt wrappedChatKey from def.
3. Admin A promotes Admin B → B receives crewSk from A; works identically to founder-issued promotion.
4. Admin B kicks Member X → def updated with X in kickedPubkeys, signed by crewSk. Other clients (founder, A, regular members) see the kick. New chatKey rotated, distributed.
5. Member X attempts to read chat → encrypted with new chatKey they don't have → message skipped (existing flow).
6. Founder cryptographic-demotes Admin B → new crewSk2 generated, def re-published, pointer updated, crewSk2 gift-wrapped to A only.
7. Demoted Admin B attempts to publish a def under the old crewPk → published, but well-behaved clients ignore (they follow the new pointer).

### Edge cases
- Two admins kicking different people simultaneously: last-write-wins at the relay, both kicks should propagate in the final state.
- Founder rotates while admins are mid-action: admin's def under old crewPk is orphaned, action lost. Acceptable.
- Member views crew while founder is rotating: brief inconsistency, resolves on next pointer refresh.
- Existing v1 crew: founder logs in, sees an "Upgrade to v2 authority" prompt in manage modal.

---

## Out of scope (for v1)

- **Multiple owners / "founder transfer".** A future feature could let two pubkeys both sign pointer events (multi-sig pointer). For now, founder is singular.
- **MLS-style forward secrecy.** Same as crews now — leaked nsec = exposed history. Not addressed by this plan.
- **Federated admin sets across multiple crews.** Each crew has its own keypair; no cross-crew identity.

---

## Order of operations (when we build)

1. `crewSkCache` module (mirrors crewKeyCache).
2. `genCrewKeypair`, `signWithKey` helpers.
3. Crew def fetch path: try v2 (pointer → def) first, fall back to v1 (founder-signed def).
4. Crew creation: write v2 events.
5. Promote flow: gift-wrap crewSk.
6. Kick/unkick: sign with crewSk if available, else fall back to founder personal key for v1 crews.
7. Founder rotation flow + Upgrade-to-v2 button.
8. Documentation + WalletInfo-style modal explaining the new trust model to crew creators.

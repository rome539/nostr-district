# Crew Chat + NIP-44 v3 Hardening — Plan

Status: **proposal, not yet implemented**

Two related-but-independent changes:

1. **Crew chat rewrite**: replace the public-`chatKey` scheme with per-recipient NIP-17 gift-wrap fan-out.
2. **NIP-44 v3 adoption** for our pairwise crypto (DMs, NWC), wherever we control the key directly.

These are split because the crew chat fix is a real bug (the chat is currently decryptable by anyone on Nostr), while the v3 work is forward-looking hardening.

---

## Part 1 — Crew chat: per-recipient wrapped chatKey (closed crews only)

### Decision

After looking at the actual code we split open and closed crews:

- **Open crews**: keep current "chatKey in plaintext crew def" model. It is **not real encryption** — anyone can join freely and decrypt all history. But it does prevent passive relay scraping from random Nostr users who never join. We document this honestly in the code (`crewService.ts` comment above `encryptContent`) instead of claiming privacy we don't deliver.
- **Closed crews**: build a real approval gate + per-recipient key distribution (Phases 2–4 below).

### Current state (the problem the audit found)

- Crew definition is published as `kind:30078` with a `t=nostr-district` tag. Anyone can fetch it.
- The crew def's JSON `content` includes `chatKey: <32-byte-hex>` in **plaintext**.
- Crew chat messages are `kind:9` events, NIP-44 v2 encrypted with that shared chatKey, tagged with the crew's `h` tag.
- **Anyone** who fetches the crew def gets the chatKey and can decrypt every crew chat message and post on the relays. It's obfuscation, not encryption.
- For open crews this is accepted as "obfuscation against scrapers." For closed crews it's a real bug that defeats the closed model's purpose.

### What already exists (good news from the code audit)

Closed crew membership is already gated by a real two-sided approval flow:

1. Requester publishes a `kind:9` join request with `t=nd-joinreq`.
2. Founder + admins + officers all see the request and can Accept or Decline.
3. Approving sends a signed DM (`nd-invite:<crewId>:<crewName>:<token>`).
4. Requester sees the invite card in their DMs and clicks Accept.
5. `joinCrew()` is called with the token → membership event is published.

So there is already a real "founder/admin/officer is the gatekeeper" model for closed crews. What was missing — and what the audit flagged — is that **even with this gate, the chatKey is still public in the crew def**, so anyone who bypasses the membership flow (or simply scrapes the public crew def) can read every chat message.

### What's still missing (the real fix — Phase 3 + 4)

- **Take the chatKey out of the closed crew def.** Replace plaintext `chatKey` with `wrappedChatKey: <founder-self-encrypted-chatKey>` so only the founder can recover it from the def.
- **Distribute the chatKey to approved members.** When a founder/admin/officer accepts a join request, in addition to sending the invite DM, send a NIP-17 gift wrap containing the chatKey to the new member.
- **Member-side cache.** Members subscribe to a gift-wrap inbox filtered for crew-chatKey events, decrypt on arrival, cache the chatKey locally (encrypted to self via the existing wallet HKDF-from-nsec pattern for nsec/passkey users; plaintext for extension/bunker users — same trade-off documented for the Spark wallet).
- **Kick rotation.** When founder kicks, generate a new chatKey, gift-wrap it to all remaining members, update the crew def's `wrappedChatKey` with the founder-self-wrap of the new key. The kicked member's old chatKey remains valid for already-encrypted past messages but is useless for future messages.

### Event shapes

**Crew definition (kind:30078) — new shape**

```json
{
  "kind": 30078,
  "tags": [
    ["d", "<crew-id>"],
    ["t", "nostr-district"]
  ],
  "content": "{
    \"name\": ...,
    \"members\": [...],
    \"founder\": ...,
    \"wrappedKeys\": [
      { \"pubkey\": \"<member-1-pubkey>\", \"ct\": \"<nip44-v2-or-v3-blob>\" },
      { \"pubkey\": \"<member-2-pubkey>\", \"ct\": \"<...>\" }
    ]
  }"
}
```

**Chat / post events**: unchanged. Still `kind:9` encrypted with the shared chatKey, tagged with the crew's `h` tag.

### Code changes

| File | What changes |
|---|---|
| `src/nostr/crewService.ts` | Replace `chatKey: <hex>` field with `wrappedKeys: [{ pubkey, ct }]`. Add `wrapChatKeyForMember(chatKey, memberPubkey)` using NIP-44. On read, find own entry, decrypt, cache. Add rotation on kick. |
| `src/ui/CrewPanel.ts` | When founder kicks: show "rotating chat key... N/M members" progress while the rotation publishes. |
| Anywhere else | No changes — chat send/receive remain identical because the key is unchanged on the wire. |

### Member-change cost

| Action | Cost |
|---|---|
| Send chat message | 1 sign (founder OR member) — same as today |
| Add member | 1 NIP-44 encrypt + 1 sign (founder republishes crew def) |
| Kick member | New chatKey + N NIP-44 encrypts + 1 sign (founder republishes crew def). One-time visible cost; show a progress UI. |
| Member login | 1 NIP-44 decrypt to extract their cached chatKey |

For everyday use (sending messages), it's the **same UX as today**. Only the founder pays the per-member cost, and only when membership changes.

### Migration

Pre-prod, so hard-cut:
- New crew defs use the new shape (`wrappedKeys`, no plaintext `chatKey`).
- Old crew defs (from earlier test runs) won't decrypt under the new client; founder can re-create the crew or run a one-time republish helper to rewrap.
- Old chat history encrypted under the old public chatKey: still decryptable forever by anyone (since the key was public). Document this — there is no fixing past leaks.

### Risks / tradeoffs

- **No forward secrecy**: same as today. A member's leaked nsec exposes the wrapped chatKey for that member, exposing all chat that used that key generation.
- **Removed-member exposure window**: removed members retain their copy of the old chatKey until the founder publishes a kick-rotation. They can read messages sent in between leaving and rotation. Founder should rotate immediately on kick (we will publish the new def in the same operation as the kick, so the window is essentially "until the new def propagates to relays" — seconds).
- **Crew def size**: scales linearly with members. NIP-44 ciphertext is ~150 bytes; 50 members = ~7.5KB content. Fine for relays.
- **Founder availability**: only the founder can rotate keys (only they have the privilege of republishing the crew def). If founder is offline during a kick, rotation is delayed. Acceptable for v1; future versions could delegate rotation rights to multiple admins.
- **What about non-members who used to be members**: they can read past messages from when they had access. Acceptable; matches real-world group chat semantics.

---

## Part 2 — NIP-44 v3 adoption

### What v3 provides over v2

Same crypto primitives (secp256k1 ECDH, HKDF, ChaCha20, HMAC). The wire format adds two AAD-authenticated fields:

- `kind: u32` — the Nostr event kind the ciphertext is meant for.
- `scope: utf8 string` — an app-specific tag, e.g. `"nostr-district:dm"`, `"nostr-district:nwc"`.

Both are baked into the MAC, so a v3 ciphertext can be *bound* to its intended context. Signer implementations (extension/bunker) can refuse to decrypt outside the matching scope, which defends against scenarios like:

> Evil site tricks user's Alby extension into decrypting a stolen ciphertext. With v3 + a scope-aware signer, Alby sees the scope says `nostr-district:dm` and the calling origin is `evil.com`, and refuses.

v3 also supports binary plaintext and payloads >65KB. Both nice but not directly relevant to our use cases.

### What v3 does NOT provide

- Group encryption. Still strictly pairwise.
- Forward secrecy. Long-term static-key based.
- Post-compromise security.
- Defense if the nsec leaks.

### Where we use NIP-44 today

| Surface | File | Path |
|---|---|---|
| NIP-17 DM seal + gift-wrap | `src/nostr/dmService.ts` | Direct (nostr-tools) for nsec users, `window.nostr.nip44` for extension, `bunkerClient` for bunker |
| NWC pay_invoice commands | `src/nostr/nwcService.ts` | Same three paths |
| Crew chat (going away — Part 1) | `src/nostr/crewService.ts` | Direct, using shared chatKey |

### Adoption strategy

**Adopt v3 only in paths where we control the key directly** (we hold the secret key in memory). For extension/bunker paths, continue using v2 and the existing `window.nostr.nip44.*` / NIP-46 commands — those signers don't support v3 yet, and they're what govern the wire format on those paths.

When signers ship v3 support later, we flip the extension/bunker paths over.

In code:

```ts
// New module: src/nostr/nip44v3.ts
export function encryptV3(plaintext, recipientPubkey, kind, scope, senderSecret): string
export function decryptV3(ciphertext, senderPubkey, kind, scope, recipientSecret): string
```

These wrap a ported-from-Go implementation of the v3 wire format (32-byte nonce | 32-byte MAC | u32 kind | u32 scope_len | scope | ChaCha20 ciphertext, version byte 0x03 on the front).

Update call sites:

| Surface | Scope tag | Kind |
|---|---|---|
| NIP-17 DM seal | `nostr-district:dm` | 14 (rumor kind) |
| NIP-17 DM gift wrap | `nostr-district:dm` | 13 (seal kind) |
| Crew gift wrap (Part 1) | `nostr-district:crew` | 14 |
| NWC pay_invoice | `nostr-district:nwc` | 23194 / 23195 |

For each call site:
- **If we have the secret key in memory (nsec/passkey)** → use v3 with the appropriate scope.
- **Else (extension/bunker)** → use v2 via the existing window.nostr / bunker calls.

We will need a small abstraction so the receiver tries both v3 and v2 decryption (read both, write whichever the sender wrote). This keeps backwards compat with v2-producing peers.

### Code changes

| File | What changes |
|---|---|
| `src/nostr/nip44v3.ts` *(new)* | Ported implementation of NIP-44 v3 encrypt/decrypt. Reuses `@noble/secp256k1` + `@noble/hashes` (already deps via nostr-tools). |
| `src/nostr/nip44.ts` *(new)* | Thin wrapper: `encrypt(...)` picks v3 if we hold the key + the call site supplies scope+kind, else falls through to v2. `decrypt(...)` auto-detects by version byte. |
| `src/nostr/dmService.ts` | Replace direct `NT.nip44.encrypt/decrypt` calls with the new wrapper, supplying scope `nostr-district:dm`. Extension/bunker paths unchanged (they don't go through our wrapper). |
| `src/nostr/nwcService.ts` | Same wrapper for the direct path. NIP-04 fallback stays. |
| Tests / vectors | Pull `test-vectors.json` from the v3 spec repo and confirm encrypt+decrypt round-trip. |

### Risks / tradeoffs

- **Practical benefit is gated on signers shipping v3**. Until they do, the scope tag is informational. We don't lose anything by adopting it now — just don't oversell the protection.
- **Compat surface grows**: receivers need to handle both v2 and v3. We pay this complexity forever (or until v2 is fully phased out, which won't happen for years).
- **Spec maturity**: v3 is a draft from `nostr-land`, not a merged community NIP. It might change. Mitigate by isolating v3 in its own module so a future bump is contained.
- **JS reference impl**: doesn't exist publicly. We're porting from Go. Small surface area but worth careful testing against the spec's test vectors.

---

## Order of operations

1. **Crew chat NIP-17 fan-out** (Part 1) — fixes the real privacy hole. Ship first.
2. **NIP-44 v3 module** (Part 2) — independent. Can ship after, or in parallel.
3. Update WalletInfo / docs to reflect the new behavior.

---

## Test plan

### Crew chat
- Create a crew with 3+ members.
- Send a message from each member. All members see the message in chat (one sign per message — no per-member popups).
- Non-member tries to fetch the crew def → `wrappedKeys` present, but no `ct` matches their pubkey → can't extract chatKey.
- Non-member queries kind:9 by `h` tag → only sees ciphertext they can't decrypt.
- Add a member → founder rewraps; new member can read going forward.
- Kick a member → founder rotates chatKey; old member's wrapped key is no longer in the def, new messages use the new key and are unreadable to them.
- Test under all signer types: nsec, passkey, extension (Alby), bunker. Sending a chat message should not prompt the signer more than once (just the message itself).

### NIP-44 v3
- Round-trip every test vector from the spec's `test-vectors.json`.
- Round-trip a DM from nsec user A to nsec user B (both use v3) — works.
- Round-trip from nsec user A to extension user B → A writes v3, B's client receives, auto-detects v3 by version byte, decrypts.
- Round-trip from extension user A to nsec user B → A writes v2 (extension only supports v2), B's client auto-detects v2, decrypts via v2 path.

---

## Out of scope

- **Forward secrecy / post-compromise security**: would require Nostr MLS (NIP-104) or similar group ratchet protocol. Significantly more complex. Revisit if/when Nostr District becomes a real privacy target.
- **Deniability**: NIP-44 (v2 or v3) doesn't provide it.
- **Server-side moderation for crew chat**: existing relay-side moderation still applies to the outer kind:1059 events; nothing about content moderation changes.

---

## Open questions

- **Crew member cap**: do we want to enforce a maximum crew size? The wrappedKeys array grows linearly with members but is small (~150 bytes each). Probably fine up to ~200 members.
- **Rotation atomicity**: when the founder kicks a member, the new chatKey is published in the same crew def update. Until that event reaches relays, messages sent in the brief gap may still be decryptable to the kicked member. Acceptable for non-adversarial use; if we ever need stronger we can use a sequence number to gate message acceptance to the latest key version.
- **Founder absence**: only the founder can rotate. If the founder is offline indefinitely, kicks can't actually revoke access until they return. Future: support multiple admins or delegated rotation.

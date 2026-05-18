# In-game Lightning Wallet (Spark)

Nostr District auto-provisions a self-custodial Lightning wallet for every
logged-in user. This document explains how it works end-to-end so you can
maintain or extend it without re-discovering the design.

---

## TL;DR

- Wallet is built on the **Breez SDK Spark** (WASM browser build).
- The wallet's BIP39 mnemonic is **derived from a deterministic signed Nostr
  event** — so the wallet is bound to the user's Nostr identity, not to a
  specific login method.
- A NIP-78 `kind:30078` event publishes the user's in-game Lightning address
  to relays so other Nostr District clients can route in-game zaps to it.
- The user's `kind:0` profile is **never modified automatically** — they can
  opt in to set the in-game wallet as their public Lightning address from the
  Terminal profile editor.

---

## Wallet derivation

### The fixed seed event

```ts
// src/nostr/sparkService.ts
const SEED_EVENT = {
  kind:       22242,
  content:    'nostr-district-spark-wallet-v1',
  tags:       [],
  created_at: 0,
};
```

We never publish this event — we only sign it locally. The signature is the
seed material.

### Flow

1. User logs in (any method).
2. Their signer signs the fixed seed event.
3. BIP-340 Schnorr is **deterministic**, so the resulting 64-byte signature is
   the same every time for the same Nostr key.
4. `HKDF-SHA256(signature)` → 16 bytes → BIP39 12-word mnemonic.
5. Pass mnemonic to Breez SDK `connect()` to provision the wallet.

### Why this works for every login method

| Login | Signer used | UX on first login |
|---|---|---|
| nsec paste | local nostr-tools (`signEvent` with in-memory secret key) | silent |
| Passkey | same as nsec (passkey unlocks nsec, then signs in memory) | silent |
| Browser extension (NIP-07) | `window.nostr.signEvent` | one signing popup |
| Bunker (NIP-46) | remote signer via `bunkerClient.signEvent` | one remote approval |
| Guest | skipped | no wallet |

Same identity → same signature → same mnemonic → same wallet, regardless of
login method. A user who first uses Alby and later pastes their nsec sees
**the same wallet** with the same balance.

### Storage

The derived mnemonic is cached in `localStorage` under
`nd_spark_mnemonic_<pubkeyPrefix>`. The cache avoids re-signing on every page
reload.

**Encryption depends on login method**:

| Login | Storage |
|---|---|
| nsec paste / passkey | AES-GCM ciphertext, key derived via HKDF-SHA256 from the user's nsec (mirrors `nwcService` pattern). Useless without the nsec. |
| Browser extension (NIP-07) | Plaintext. No raw key is available to the app, so we can't derive an encryption key. |
| Bunker (NIP-46) | Plaintext. Same reason. |
| Guest | No wallet stored. |

A legacy plaintext mnemonic written before at-rest encryption shipped will be
auto-migrated to ciphertext on the next read when the user is on an
nsec/passkey login (`getOrDeriveMnemonic` in `sparkService`).

Logout clears the cache via `disconnectSparkWallet(pubkey)`.

### Threat model

This is hot-wallet storage. The **wallet's security is fundamentally bounded
by the security of the user's nsec** — because the wallet is deterministically
derived from a signed event using the user's Nostr key. Anyone who has the
nsec can re-derive the wallet from scratch, with or without `localStorage`.

So encryption of the cached mnemonic does NOT defend against nsec compromise.
What it DOES defend against is the narrower scenario where an attacker has
access to `localStorage` but **not** the nsec or the user's live session
memory (e.g. malicious browser extension that reads disk-backed storage but
not in-process secrets; a stolen-laptop snapshot taken while the user was
logged out).

| Attacker has | Unencrypted cache | HKDF(nsec)-encrypted cache |
|---|---|---|
| `localStorage` only | Mnemonic exposed | Ciphertext only — useless without nsec |
| nsec | Already game over (derives from scratch) | Already game over |
| Both | Game over | Game over |

For **nsec-paste login**: the raw key lives only in `SecureKeyStore` (memory,
never written to disk). `localStorage`-only attacks get just ciphertext.
Encryption is meaningful here.

For **passkey login**: the nsec is itself encrypted in `localStorage` behind
WebAuthn PRF. Both ciphertexts share the same primary credential. Equivalent
protection.

For **extension and bunker users**: we don't have the nsec at all, so we
can't encrypt. The cache is plaintext. Anyone with `localStorage` access
(XSS, malicious extension, shared browser) can drain the wallet directly.
This is the same threat profile most web wallets ship with (Alby hosted,
Mutiny, etc.).

**Why we didn't encrypt for extension/bunker users:** every option adds real
friction without buying meaningful safety:

- **Re-derive on every reload (no cache)**: forces a signing popup on every
  page load. Alby/nos2x users can whitelist the site to silence prompts, but
  the default UX is annoying.
- **NIP-44 self-encrypt via the extension**: requires an extension decrypt
  popup on every reload — same friction as re-derive.
- **WebAuthn PRF (passkey-encrypt)**: viable but requires opt-in passkey
  setup plus an unlock prompt per session.
- **`sessionStorage`**: cosmetic — still plaintext, still XSS-readable while
  the tab is open.

For a hot wallet sized for in-game amounts, the current setup matches user
expectations (web wallet = warmer than hardware wallet) and is documented in
the WalletInfo modal so users know what they're opting into. If someone wants
to ship the passkey-encrypt path later as an opt-in setting, the pattern from
`passkeyStore.ts` is the reference implementation.

---

## In-game zap routing (NIP-78)

### The problem

A user's `kind:0.lud16` might point to an external wallet (e.g.
`alice@getalby.com`). If we always route zaps through `kind:0`, sats leave the
in-game economy.

### The solution

Publish a `kind:30078` event mapping pubkey → in-game Lightning address. Other
Nostr District clients query this when zapping in-game.

```json
{
  "kind":    30078,
  "tags":    [["d", "nostr-district:spark-address"]],
  "content": "{\"lud16\":\"<user>@breez.tips\"}"
}
```

- Replaceable per `(pubkey, kind, d-tag)`.
- Namespaced via the `d` tag — invisible to other Nostr clients.
- Auto-published once per user after wallet init (`publishSparkAddress`).
- Re-publish is skipped if the same address was already published from this
  browser (tracked in `nd_spark_addr_published_<prefix>`).

### Routing logic in `zapUser`

```
1. fetchSparkAddress(recipientPubkey)      // NIP-78 lookup
   → if found, use that Lightning address
2. otherwise, fetchKind0(recipientPubkey)  // legacy fallback
   → use kind:0.lud16 / lud06
```

So:

| Sender | Recipient | Sats go to |
|---|---|---|
| Nostr District player | Has used Nostr District | Their **in-game wallet** |
| Nostr District player | Never used Nostr District | Their `kind:0.lud16` |
| Damus, Amethyst, etc. | Anyone | Their `kind:0.lud16` (other apps don't see our event) |

### Cache

`fetchSparkAddress` keeps a 5-minute in-memory cache (positive + negative).
Cleared on logout.

---

## Paying for things in-game

### From the wallet UI (`WalletPanel`)

- **Receive tab** — generates a BOLT11 invoice via `createSparkInvoice`.
  Amount and description both optional; empty amount yields an amountless
  invoice (sender chooses).
- **Send tab** — `sendSparkToLightningAddress(addr, sats)`:
  1. Resolves LNURL-pay
  2. Fetches invoice
  3. Prepares payment via Breez to get exact fee
  4. Checks balance >= amount + fee (clear error if not)
  5. Sends

### From zaps and the marketplace

`zapService.payLightningAddress` and `zapService.zapUser` both try wallets in
order:
1. Spark (if balance covers amount)
2. WebLN (browser extension)
3. NWC (Nostr Wallet Connect)
4. QR fallback

If the user has Spark with the funds, that's the default path. Otherwise the
existing fallback chain kicks in for users with WebLN/NWC setups.

---

## Toast deduplication

Two notification systems run in parallel:
- The Nostr zap-receipt subscription (`subscribeToZapReceipts`) shows a named
  toast like *"alice zapped you 100 sats"* when the recipient sees the
  `kind:9735` event.
- The Breez SDK fires `paymentSucceeded` when a payment lands, which would
  trigger a generic *"Lightning zapped you 100 sats"* toast.

Without dedup, an in-game zap would show both. Two safeguards:

1. **Per-payment dedup** (`_processedPaymentIds` in `sparkService`) — Breez
   can fire `paymentSucceeded` multiple times per payment (settlement
   stages). We only emit once per payment ID.

2. **Cross-source dedup** (`_recentIncoming` in `ZapToast`) — When a named
   incoming zap toast fires, we record `(amount, timestamp)`. If the Spark
   SDK fires `paymentSucceeded` within 30 seconds for the same amount, we
   suppress the generic toast.

Window is wide (30 s) because Breez can lag the Nostr zap receipt by 5–20
seconds in practice.

---

## UI surfaces

| Component | What it does |
|---|---|
| `WalletPanel` (W key, `/wallet`, HUD click) | Three-tab modal: BALANCE / RECEIVE / SEND |
| `WalletHUD` | Persistent top-left pill showing balance; pulses on receive |
| `WalletInfo` (ⓘ button) | User-facing documentation modal |
| `ProfileTab` (Terminal > Profile) | Pre-fills Lightning Address field with Spark address when `kind:0` is empty; "Use my in-game wallet" button when it differs |

---

## Key files

- `src/nostr/sparkService.ts` — SDK init, mnemonic derivation, send/receive helpers, payment event pub/sub
- `src/nostr/nostrService.ts` — `publishSparkAddress` / `fetchSparkAddress`, login flows that wire it all up
- `src/nostr/zapService.ts` — `zapUser` routing through `fetchSparkAddress` before `kind:0`
- `src/ui/WalletPanel.ts` — main modal
- `src/ui/WalletHUD.ts` — top-left balance pill
- `src/ui/WalletInfo.ts` — user docs
- `src/ui/ZapToast.ts` — incoming-payment toasts + dedup registry
- `src/ui/computer/ProfileTab.ts` — pre-fill + opt-in to Spark address in profile editor

---

## Configuration

- `VITE_BREEZ_API_KEY` (in `.env`) — required for Breez SDK to connect.
- COEP/COOP headers (in `index.html` CSP + `public/_headers`) — required for
  the WASM module to load in browsers.
- `script-src 'self' 'wasm-unsafe-eval'` — required for WebAssembly
  compilation under Content Security Policy.

---

## Things to know

- **`SEED_EVENT.content` is load-bearing.** Changing it would re-derive every
  user to a new (empty) wallet. Bump the version suffix only if you genuinely
  intend that migration.
- The wallet's security is bounded by the user's nsec security. Encrypting
  the cached mnemonic with HKDF(nsec) helps in narrow attack scenarios
  (localStorage exfil without nsec compromise) but is not a defense against
  nsec leak. Don't claim more than this in user-facing copy.
- The wallet is **not held by Nostr District**. Spark is non-custodial in the
  protocol sense — keys live on the user's device. But "non-custodial" here
  is different from "hardware wallet self-custody"; the Spark network has its
  own trust assumptions for liveness. Don't conflate the two in marketing
  copy.
- Existing users (nsec already established elsewhere) will publish a
  kind:30078 event the next time they log in. That's the only "migration"
  required after shipping these changes.

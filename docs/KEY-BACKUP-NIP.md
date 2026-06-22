# NIP-XX

## Encrypted Key Backup for Custodial-Feel Sign-In (OAuth / Cloud)

`draft` `optional`

> Reference implementation: [`src/auth/`](../src/auth/) in this repo
> (`backupCrypto.ts`, `driveBackup.ts`, `googleAuth.ts`, `googlePicker.ts`).
> Published here as an open draft for other clients to read and copy.

## Abstract

This NIP defines a standard, app-agnostic format for storing an encrypted Nostr
private key (`nsec`) in a user-controlled cloud (Google Drive, OneDrive, iCloud,
Dropbox, …) so that a user who signs in with a familiar provider ("Continue with
Google") gets a smooth, custodial-*feeling* experience while remaining fully
self-custodial: the plaintext key never leaves the client, and no server or
provider can decrypt it.

The goal is **interoperability**. Today, apps that offer "sign in with Google"
each invent their own backup blob and store it in a per-app cloud sandbox, so an
account created in one app cannot be opened by another even on the same cloud
account. This NIP fixes that by standardizing (1) the encrypted blob format and
(2) the encryption scheme, plus recommended storage conventions.

## Motivation

Mainstream users do not manage private keys. A large class of Nostr clients have
independently arrived at the same pattern:

1. Generate an `nsec` on the client.
2. Encrypt it with a key derived from a user secret (a PIN) and/or device
   authenticator (passkey/biometric).
3. Upload the ciphertext to the user's own cloud, keyed to an OAuth login.

Because each implementation uses a different blob format and a per-app storage
sandbox (e.g. Google Drive's `appDataFolder`, which is only visible to the
OAuth client that wrote it), these accounts are **siloed**. A user who created
an account in App A cannot recover it in App B without manually exporting the
`nsec`.

Standardizing the blob means any conforming client can decrypt a backup the user
already has — turning "sign in with Google" into a portable Nostr login rather
than an app-specific one.

## Terminology

- **`nsec` / private key** — the 32-byte secp256k1 Nostr secret key.
- **DEK** (Data Encryption Key) — a random 32-byte key that encrypts the private
  key exactly once.
- **Wrap** — the DEK encrypted under a factor (PIN, passkey, etc.). Any single
  wrap recovers the DEK, which decrypts the private key. Adding or rotating a
  factor never re-encrypts the private key.
- **KEK** (Key Encryption Key) — the 32-byte key derived from a factor, used to
  encrypt the DEK in a wrap.
- **Provider** — the cloud account the user authenticates to (Google, Microsoft,
  Apple, …).

## Specification

### 1. The backup blob

The backup is a single UTF-8 JSON object:

```jsonc
{
  "kind": "nostr-key-backup",        // fixed magic string
  "v": 1,                             // format version
  "key": {                            // the private key, encrypted with the DEK
    "alg": "nip44-v2",
    "ct": "<base64>"                  // NIP-44 v2 ciphertext of the 64-char hex privkey
  },
  "wraps": [                          // one or more; any one recovers the DEK
    {
      "type": "pin",
      "kdf": "pbkdf2-sha256",
      "iter": 600000,
      "salt": "<base64url>",          // 16+ random bytes
      "ct": "<base64>"                // NIP-44 v2 ciphertext of the 64-char hex DEK
    },
    {
      "type": "passkey",
      "credentialId": "<base64url>",  // WebAuthn credential id used for PRF
      "prfSalt": "<base64url>",       // PRF evaluation salt, re-run at recovery
      "ct": "<base64>"                // NIP-44 v2 ciphertext of the 64-char hex DEK
    }
  ]
}
```

Rules:

- `kind` MUST be the literal `"nostr-key-backup"`. Clients MUST ignore any file
  whose parsed object lacks this value (lets the same folder hold unrelated
  files).
- `v` is the format version. This document defines `v: 1`. Clients MUST refuse
  to *write* a version they don't understand and SHOULD refuse to *read* one.
- The blob MUST NOT contain the `npub`, display name, provider account id, or
  any other identity-linking field. The filename MUST NOT either (see §3). This
  prevents anyone with cloud access — including the provider — from linking the
  Nostr identity to the cloud identity without the user's PIN.
- `wraps` MUST contain at least one entry. Order is not significant; a client
  tries each wrap whose `type` it supports.

### 2. Encryption

All ciphertext is **NIP-44 v2**, used as a generic authenticated-encryption
primitive: the "conversation key" slot is filled with a raw 32-byte symmetric
key rather than an ECDH output.

> **Implementation note.** This requires a NIP-44 v2 implementation that
> exposes encrypt/decrypt over a raw conversation key. Some libraries only
> expose the higher-level `encrypt(plaintext, privkey, pubkey)` form (which
> derives the conversation key from an ECDH internally) and not the
> raw-key entry point; with those, call the lower-level primitive directly or
> use a library that exposes it. NIP-44 v2's authenticated decrypt also gives
> the wrong-factor signal for free: a wrong PIN or passkey fails the MAC, so a
> failed unlock is indistinguishable from tampering and needs no separate check.

**Encrypting the private key:**

1. Generate a random 32-byte DEK.
2. `key.ct = nip44_v2_encrypt(plaintext = hex(privkey), conversationKey = DEK)`.

**Creating a PIN wrap:**

1. `salt` = 16+ random bytes.
2. `KEK = PBKDF2-HMAC-SHA256(password = utf8(pin), salt, iterations = iter, dkLen = 32)`.
   - `iter` MUST be ≥ 600000. Clients MAY store and honor a larger value.
3. `wrap.ct = nip44_v2_encrypt(plaintext = hex(DEK), conversationKey = KEK)`.

**Creating a passkey wrap** (optional, for biometric/device unlock):

1. Obtain a 32-byte secret from the WebAuthn **PRF** extension for the
   credential (`hmac-secret` on platforms without PRF MAY be used), evaluated
   over a random `prfSalt`.
2. `KEK` = that secret (or HKDF-SHA256 of it to 32 bytes).
3. `wrap.ct = nip44_v2_encrypt(plaintext = hex(DEK), conversationKey = KEK)`.
4. Store `credentialId` and `prfSalt` in the wrap. At recovery the client
   re-evaluates the PRF for that credential over `prfSalt` to reproduce the
   secret, so both fields MUST be present (the `KEK` itself is never stored).

**Unlocking:**

1. Pick a supported wrap, derive its `KEK`, then
   `DEK = unhex(nip44_v2_decrypt(wrap.ct, KEK))`.
2. `privkey = unhex(nip44_v2_decrypt(key.ct, DEK))`.

A future `v` MAY add KDFs (e.g. `argon2id`) or wrap types; clients MUST treat
unknown `kdf`/`type` values as "unsupported wrap" and fall through to others.

> **Note.** Implementations MAY instead derive the KEK salt deterministically
> from a stable provider account identifier (e.g. an OAuth `sub` claim) to avoid
> storing a salt. If they do, they MUST still write the resulting `salt` field so
> that other clients — which may not have access to the same identity claim — can
> decrypt. Storing the random salt is RECOMMENDED for maximum portability.

### 3. Storage and discovery

**The blob lives in the user's own cloud storage — never on a Nostr relay.**
Relays carry public events; an encrypted secret-key backup does not belong there
(it would be world-readable and brute-forceable forever, and the user may not
want their key material on a relay at all). Storage is the user's cloud drive,
tied to the OAuth account they sign in with.

#### Worked example: single-app "Continue with Google"

This is the simplest case — one app recovering its *own* backup from the hidden
app-private folder. Cross-app portability builds on it and is covered below. The
OAuth login is what *locates and authorizes access to* the blob; the user's
password is what *decrypts* it. The provider never sees the key.

1. The user clicks **Continue with Google** → Google returns a token scoped to
   `drive.appdata` only (read/write to one hidden, app-private folder in the
   user's Drive — not their email, name, or other files).
2. The client uses that token to look in the Drive `appDataFolder`:
   - **Returning user:** the blob is there → download it → the user's password
     decrypts it locally → logged in.
   - **New user:** no blob → generate `nsec`, set a password, upload the
     encrypted blob.
3. The plaintext key exists only transiently in client memory. Google stores
   ciphertext it cannot read, and learns nothing about the Nostr identity.

So the provider acts as **locator + access control**, the password as
**decryption** — two independent factors, neither sufficient alone.

```
User's OAuth account (Google / Microsoft / …)
   └── User's cloud drive
         └── app-private folder (e.g. Drive appDataFolder)
               └── nostr-key-backup.json   ← encrypted blob lives HERE
                        (ciphertext only — useless without the password)

Relays  ←── never touched by this flow; they only ever carry public events.
```

A conforming client stores one backup blob per Nostr account as a JSON file in
the user's cloud. **The filename is not part of the interop contract.** Readers
locate a backup through the provider's file picker and identify it by
*decrypting* it — never by matching a name (see "Cross-app discovery" below). So a
client MAY name the file however it likes, subject to two rules:

- The filename MUST NOT embed the npub or any other identity-linking field (§1).
  This rules out the once-tempting `nostr-key-backup-<npub>.json`: a name carrying
  the pubkey would leak the user's identity to anyone who can merely *list* the
  drive, defeating the point.
- Because the blob is already encrypted, a recognizable name buys **no** security
  — it only leaks *metadata*. A client SHOULD prefer a name that does **not
  advertise** "this is a Nostr key" in the clear (an app-scoped vault name, say),
  so an adversary who can list the drive cannot single out the backup to attack
  offline. This is obscurity, not protection, but it costs nothing.

#### The goal: one provider account, many apps

The end state this NIP enables: a user signs into *any* conforming app with the
same provider account (the same "Continue with Google") and recovers the **same**
Nostr key. Create your identity once in App A; App B, App C, … all reopen it. The
provider account is the thread that ties one Nostr identity across every
participating client.

The obstacle is that providers **sandbox app storage per OAuth client**: the same
Google account, opened by a *different* app, gets a *different, empty* app-private
folder. So "same account" is necessary but not sufficient — the blob must live
somewhere every app can actually reach.

#### Two storage models

Where the blob lives decides whether it is single-app or portable:

- **App-private folder** (e.g. Drive `appDataFolder`, scope `drive.appdata`).
  Hidden from the user and from every other app; minimal, non-sensitive scope;
  the app never sees the user's other files. **Single-app only** — by
  construction no other app, and no file picker, can see into it. Best when an
  app only needs to recover *its own* backups.
- **Shared user-visible file** (e.g. Drive "My Drive", scope `drive.file`).
  A normal file under any non-advertising name (see filename guidance above).
  Still ciphertext with no identity fields, so it does not leak the npub — but it
  is *visible* to the user (and to
  anything with drive access) rather than hidden. This is the location that makes
  **cross-app** recovery possible. Its only protection is its password wrap (a
  passkey wrap is domain-bound and useless to other apps — see Security
  Considerations), so it SHOULD use a strong passphrase. A client MAY reuse the
  account's own password here for a single-password experience, but because this
  file is visible and more exposed, it MUST warn the user when that password is weak.

#### Cross-app discovery: user-mediated picker (REQUIRED for portability)

To open a backup *another* app wrote, the reading app uses the provider's native
**file picker** (e.g. Google Picker) with the per-file scope (`drive.file`): the
user selects the backup once, which grants the app access to **only that file** —
never the whole drive. The reader MUST NOT rely on a filename to recognize a
backup; it identifies one by **attempting to decrypt** the picked file (a valid
blob unlocks, anything else fails harmlessly). The app SHOULD then remember that
file — either by **recording its file id** (so it reopens the *same* shared file
next time) or by **copying it into its own app-private folder** — so the pick is
needed only once per app; every later login reopens the key with no further
prompt. Recording the id keeps a single shared vault; copying creates a per-app
duplicate.

This costs the user **one extra tap the first time they use each new app.** That
tap is the deliberate price of never requesting broad drive access (see the
anti-pattern); it cannot be removed without granting some app the ability to read
the user's entire drive.

> **The picker cannot see app-private folders.** A file in one app's
> `appDataFolder` is invisible to every other app *and to the picker itself*. So
> for a single file the two models are mutually exclusive: a blob you want other
> apps to import MUST live in the shared, user-visible location, **not**
> `appDataFolder`.

> **Anti-pattern (do NOT do this).** Auto-discovering the blob by *scanning* the
> user's drive requires a broad read scope (`drive.readonly` / `drive`), which
> grants access to the user's *entire* drive, cannot be narrowed client-side,
> triggers provider security review and an alarming consent screen — and is
> unnecessary, since the picker reaches the same user-visible file with a
> per-file grant. The rule is not "never use a visible file"; it is "never take a
> whole-drive scope to *find* one." Clients MUST NOT request a whole-drive scope
> merely to locate a backup.

#### Per-app file visibility (why the filename is not a shared key)

A per-file scope (`drive.file`) lets an app see and manage **only the files it
created** (or ones the user explicitly picked) — *not* files written by other
apps, nor files the user uploaded by hand. Two consequences follow, and together
they are why the filename is **not** the interop mechanism:

- **There is no single shared file across apps.** Each separate-OAuth-client app
  writes — and can only see — *its own* copy. A "well-known" shared filename does
  not yield one shared file; it yields *several identically-named* files, which is
  **worse** in a picker (the user cannot tell them apart). The blob travels between
  apps because conforming readers can decrypt it, not because they agree on a name.
- **An app finds its own copy without a fixed name.** Listing its
  `drive.file`-visible files returns only what it created, so an app can locate and
  overwrite its own backup with no naming convention at all — which also avoids the
  duplicate-on-rewrite problem *within* an app.

Because the blob carries **no npub field** (§1), the only way to know *whose* key a
file holds is to unlock it. Readers therefore MUST identify a backup by
**decryption, not filename**: after the user picks a file, attempt to decrypt; on
success **verify the derived npub**; tolerate a picked file turning out to be a
*different* account than expected and fail gracefully (offer to pick another).
When several candidates exist, the picker lists them and the user chooses.

> **Implementation note (incremental scopes).** If a client requests `drive.file`
> *after* login already granted `drive.appdata`, some provider OAuth libraries
> silently skip the consent for the newly-added scope unless it is forced (Google
> Identity Services requires `prompt: 'consent'` on the incremental request) — the
> account chooser appears but no token is returned. **Requesting every needed
> scope in the initial login** sidesteps this entirely.

**Storage strategies.** Three are valid, trading privacy and robustness for
portability and simplicity:

1. **Hidden-only.** Default to the app-private folder; offer an explicit "make
   this recoverable in other apps" action that copies the blob to the visible
   location *only when the user asks*. Most private; portability is opt-in.
2. **Hidden + visible.** Request `drive.file` alongside `drive.appdata` at login
   (one consent) and write both copies automatically at account creation —
   portable from the start, with the hidden copy as a safety net.
3. **Single visible vault.** Keep *one* user-visible file as the only copy (no
   hidden duplicate). This is the simplest realization of "one vault, read by
   every app," and an app finds its own vault by remembered id or a `drive.file`
   listing. The trade-off is that the user can delete the file (see §4): a client
   choosing this MUST warn that deleting the vault loses the account, and SHOULD
   lean on the provider's trash grace period.

The reference implementation uses strategy 3.

- **Manual — `nsec` export/import.** Always available; the universal fallback
  this NIP does not replace.

Clients MUST document which storage model(s) and discovery method(s) they
implement, so users know what to expect.

### 4. Client behavior

- **First sign-in (new account):** generate `nsec`, prompt for a PIN (RECOMMEND
  ≥ 6 digits), build the blob with a PIN wrap, upload. Clients SHOULD also offer
  to save the `nsec` to the OS password manager and/or add a passkey wrap so a
  forgotten PIN is not fatal.
- **Returning sign-in:** locate the blob (§3), prompt for PIN (or use a passkey
  wrap), unlock, log in.
- **Forgotten PIN:** because the blob is zero-knowledge, a lost PIN with no other
  wrap is **unrecoverable**. Clients MUST state this plainly and MAY offer a
  destructive "erase and start new" that overwrites the blob.
- **Adding a factor / changing PIN:** recover the DEK via any existing wrap, then
  add/replace the relevant wrap. The `key.ct` is never touched.
- **Multiple writers / conflicts:** if a client must write, it SHOULD write a new
  file and delete the old rather than update in place, to avoid a delete-then-
  upload race; readers pick the most recently modified valid blob.
- **The visible copy can be deleted by the user.** A user-visible file is a
  normal file in the user's drive — they can move or delete it. A client that
  *also* keeps a durable hidden app-private copy is more robust and SHOULD do so.
  A client that deliberately uses the visible file as the **only** vault (the
  simplest cross-app model — see §3 strategy 3) MUST make the trade-off explicit:
  warn the user that deleting it loses the account, rely on the provider's trash
  grace period (e.g. ~30 days) for accidental deletion, and re-create the file on
  next login if it has merely gone missing from a listing.
- **Key rotation / compromise.** A compromised `nsec` cannot be rotated while
  keeping the same identity — in Nostr the public key *is* the identity, so
  "recovery" from compromise means a **new identity** (a new npub; the old one and
  its followers are abandoned). Clients SHOULD offer a deliberate "start a new
  identity" action, distinct from a forgotten-PIN reset, that generates a new key
  and **overwrites (or deletes) the portable copy**, so the abandoned key is not
  left importable by other apps.
- **Reader-cache escape hatch.** A client that remembers a recovered account for
  fast future logins — by copying it into its own app-private folder, or by
  recording the vault's file id — can become *stuck* on that cached account:
  sign-in always reopens the remembered blob and never the user's other accounts.
  Such a client MUST provide an escape — when the remembered blob's password
  repeatedly fails, or on explicit user request, offer to recover a *different*
  account via the picker and replace the cache.
- **Don't overload sign-in with extra consents.** Portability writes/reads need
  the `drive.file` scope, whose consent popup is jarring mid-flow. Acquire it in
  the initial login (see §3) rather than firing a *second* provider popup partway
  through account creation; reserve any further popup for a deliberate user action.

## Privacy considerations

- The blob leaks no Nostr identity: an adversary with full cloud access sees only
  "some app stored ~1 KB of ciphertext," not *whose* npub. The **filename**,
  however, is metadata the adversary also sees — a name like `nostr-key-backup.json`
  advertises "this person uses Nostr and a key backup lives here," which both
  fingerprints the user and points an offline PIN-grinder straight at the file. A
  client SHOULD pick a name that reveals neither (see §3); the contents stay
  encrypted regardless, so this is metadata hygiene, not a security control.
- Requesting `drive.appdata`-style minimal scopes means the client never learns
  the user's email, name, or contacts. Broad Drive scopes are a serious privacy
  regression and are disallowed for discovery (see §3); cross-app access uses a
  per-file picker grant instead.

## Security considerations

- A PIN has low entropy; the blob's security rests on **slow KDF + cloud access
  control**. PBKDF2 ≥ 600k buys time, but an attacker who fully compromises the
  cloud account can brute-force a weak PIN offline. A passkey wrap (high-entropy,
  hardware-bound) is strongly RECOMMENDED as a second factor.
- **Passkey wraps do not travel across apps.** A WebAuthn passkey (and its PRF
  secret) is bound to a single Relying Party ID — the creating app's domain — so
  only that app can use it to unlock; a different app on a different origin
  cannot invoke it. A passkey wrap is therefore a *home-app convenience*, never a
  cross-app factor. It follows that **a backup intended for cross-app recovery (a
  shared, visible copy per §3) MUST carry a strong-passphrase wrap**, because a
  user-supplied passphrase is the only factor every app can reproduce. Such a
  copy is consequently only as strong as that passphrase — and, being visible, is
  more exposed than a hidden app-private copy. Clients SHOULD use a high-entropy
  passphrase for the visible copy; a short numeric PIN on it can be brute-forced
  offline by anyone who obtains the file. A client MAY reuse the account password
  (single-password UX) but then MUST warn the user when that password is weak.
  Clients that want the exposed copy fully isolated from a weak home factor MAY
  give it its **own independent DEK + passphrase wrap**.
- **No integrity binds the whole blob.** Each wrap and the key blob are
  individually authenticated (a wrong factor fails the MAC), but nothing binds
  `key` to the `wraps`, and the blob carries no signature. An attacker with
  *write* access to the cloud account can therefore substitute the entire blob
  with one encrypting a key they control — a substitution/denial attack, not a
  key disclosure (they still cannot read the original key). The tell is that the
  derived `npub` changes; clients SHOULD surface the active public key after
  unlock so a silent substitution is visible.
- The private key and DEK MUST exist in plaintext only transiently in client
  memory and MUST NOT be logged, synced, or sent anywhere.
- Deterministic-salt-from-`sub` schemes MUST NOT let `sub` substitute for the
  PIN: `sub` is not secret.

## Reference implementations

- Nostr District — `src/auth/backupCrypto.ts`, `src/auth/driveBackup.ts`
  (NIP-44 v2 + PBKDF2 600k, this blob format; a **single user-visible Drive
  vault**, located by a remembered file id or a `drive.file` listing, with
  cross-app import via the Google Picker. Reads a legacy hidden `appDataFolder`
  copy once to migrate older accounts, and still dual-reads its own pre-standard
  AES-GCM blobs for backward compatibility).
- Wisp — `app/src/main/kotlin/com/wisp/app/auth/` (NIP-44 v2, PBKDF2 600k,
  `sub`-derived salt, Drive `appDataFolder`).

These arrived at the same pattern independently; aligning their blob format is
the motivating example.

**Interoperability has been validated end-to-end.** A second, independent
implementation — built *only* from this document, with no access to the reference
implementation's source — recovered an account the reference implementation had
written, from a shared user-visible blob in the same Google account, using only
the file picker. The same PIN unlocked the same npub in both apps. This exercised
the full cross-app path (separate OAuth clients, `drive.file` + picker, the v2
blob format) and surfaced most of the operational findings now folded into §3–§4.

## Test vectors

Because NIP-44 v2 mixes a random nonce into every ciphertext, an *encrypt*
vector is not reproducible — so the vector is a **decrypt** vector: given this
exact blob and PIN, a conforming client MUST recover the stated private key.
This exercises the full chain (PBKDF2 → unwrap DEK → decrypt key) and the
NIP-44 framing. Generated by the Nostr District reference implementation.

```
PIN              = "test-pin-1234"
expected privkey = 0000000000000000000000000000000000000000000000000000000000000001
expected nsec    = nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsmhltgl
   (derived npub = npub10xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqpkge6d)
```

```json
{
  "kind": "nostr-key-backup",
  "v": 1,
  "key": {
    "alg": "nip44-v2",
    "ct": "Aqmu5qAFGgSgxFylZ0ii2lD5QdxdmeM877FkW2iJWLdEr29Ls4tA4CtprgFubCqeAWsC8pxOOhSaVnYxMGhmOdlFrI1vLloUUbX5ZzX25ypZQOeAEKEIrpkrxTOtTlY33JxanHOrW1WWSZvEi3PCcOD/psrYmomdvYY70pvU2UBZnZ8="
  },
  "wraps": [
    {
      "type": "pin",
      "kdf": "pbkdf2-sha256",
      "iter": 600000,
      "salt": "6jNvZKCz5Crn3EKdOeocjg",
      "ct": "AhDk9WdKy1YTzn6K0tOBHsm64d3H6Zqjyb8rnZ4VBw5YTsdwUFUvx6B0o8g7hhc0RpUjVn7WvQPru2Ot2xUmVmVO68klir1rS5KnVdxN1v7cOB3WZ2WqtO56T6ybZfysU9VJ2ewfgtkj5JfSL0Kr8A/FukunUQyswhMksKiKBcKJmXM="
    }
  ]
}
```

Decrypt procedure for this vector: `KEK = PBKDF2-HMAC-SHA256(utf8("test-pin-1234"),
base64url-decode("6jNvZKCz5Crn3EKdOeocjg"), 600000, 32)`; `DEK =
unhex(nip44_v2_decrypt(wraps[0].ct, KEK))`; `privkey =
unhex(nip44_v2_decrypt(key.ct, DEK))`.

*(TODO before non-draft: add a passkey-wrap vector once a fixed PRF secret can be
pinned, and a second PIN vector at a non-default iteration count.)*

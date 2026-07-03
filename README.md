# Nostr District

A pixel art social world built on Nostr. Walk around a cyberpunk city, hang out in rooms, chat with other players, and customize your avatar — all powered by decentralized identity.

## What it is

Nostr District is a browser-based MMO where your Nostr identity is your character. Log in with a remote signer, browser extension, or private key — and you're in. Your room, your avatar, your presence on the network.

- **Hub** — shared public space where all players appear in real time
- **Alley** — cyberpunk side-street with a fortune teller, tarot reader, and subway entrance
- **Woods** — outdoor exploration area with its own chat and presence
- **Cabin** — cozy retreat with a fireplace and ambient music
- **Rooms** — personal spaces tied to your pubkey; decorate them, invite people in
- **Feed Room** — live global Nostr feed scrolling in real time
- **Relay Room** — live relay connection status and event stats
- **Chat** — room chat over Nostr ephemeral events (NIP-28)
- **DMs** — encrypted direct messages (NIP-17 + NIP-44)
- **Zaps** — lightning tips via NWC or WebLN (NIP-57 / NIP-47)
- **Polls** — create and vote on polls pinned to rooms (NIP-88)
- **Crews** — persistent guilds with chat, roles, and membership (NIP-29)
- **Bazaar** — an oracle-signed item economy: collect, trade, and sell unique items for sats, settled peer-to-peer over Lightning
- **Avatars** — fully customizable pixel art characters
- **Themes** — publish and browse community pixel art room themes

## Tech Stack

- [Phaser.js](https://phaser.io) — game engine
- [nostr-tools](https://github.com/nbd-wtf/nostr-tools) — Nostr protocol
- [Vite](https://vitejs.dev) + TypeScript
- WebSocket presence server (Node.js)

## Login Methods

- **Continue with Google** — mass-market sign-in; a Nostr key is generated, encrypted, and stored in *your* Google Drive (see below)
- **NIP-46 Remote Signer** — Primal, Amber, nsec.app (recommended)
- **Browser Extension** — Alby, nos2x (NIP-07)
- **Private Key** — nsec (stored in memory only)
- **Guest** — no key needed, look around freely

### Continue with Google (encrypted cloud backup)

For users who don't want to manage a key, "Continue with Google" feels custodial
but stays self-custodial — the private key is generated and encrypted **on the
device**, and **nothing is ever stored on a relay or readable by Google**.

> **Open spec — copy this.** The blob format and crypto are written up as a draft
> NIP so other clients can read the *same* backup: [`docs/KEY-BACKUP-NIP.md`](docs/KEY-BACKUP-NIP.md).
> It's published here rather than as a nips-repo PR; the [`src/auth/`](src/auth/)
> files below are the reference implementation — feel free to lift it.

How it works ([`src/auth/`](src/auth/)):

1. Google returns a token scoped to `drive.file` + `drive.appdata` only — per-file
   access to what the app creates or the user picks, plus one hidden legacy folder;
   never their email, name, or other files. ([`googleAuth.ts`](src/auth/googleAuth.ts))
2. **One vault, shared across apps.** The encrypted backup is a *single visible
   file* in the user's own Drive ([`driveBackup.ts`](src/auth/driveBackup.ts)).
   - **New account:** an `nsec` is generated, the user sets a password, and the
     *encrypted* vault is written to Drive.
   - **Returning / another device:** the app finds the vault by remembered file
     id, or the user picks it once via Google's file picker
     ([`googlePicker.ts`](src/auth/googlePicker.ts)) — it then remembers the id
     and never re-picks. No second copy is ever made.
3. **Forgot the password?** If the user set up **Face ID** at signup, it unlocks
   the same vault and they keep the same account (then set a new password).

Encryption ([`backupCrypto.ts`](src/auth/backupCrypto.ts)): a random DEK encrypts
the nsec with AES-256-GCM; the DEK is wrapped by a key derived from the password
(PBKDF2-SHA256, 600k iterations) and, optionally, by a passkey PRF secret (Face
ID). Any wrap unlocks the DEK; adding one never re-encrypts the nsec. The vault
holds no npub, name, or Google id — so even with full Drive access nobody can
link the Nostr identity to the Google account without the password or Face ID. A
reader recognizes a vault by **decrypting it**, never by filename.

Trust tier: like **Private Key**, the decrypted key lives in app memory during a
session — lower than Remote Signer / Extension (where the key never enters the
app). It's an onboarding convenience, and the nsec stays exportable, so the
account is never locked to Google or to this app.

Build config: set `VITE_GOOGLE_CLIENT_ID` (and `VITE_GOOGLE_PICKER_API_KEY` for
the cross-app file picker) in the frontend build environment (Cloudflare Pages);
the OAuth client must list the production origin under *Authorized JavaScript
origins*.

## Commands

Commands are typed in the chat input. All commands are case-insensitive.

### Navigation

| Command | Aliases | Description |
|---------|---------|-------------|
| `/tp <room>` | `/teleport`, `/go` | Teleport to a room: `hub`, `relay`, `feed`, `myroom`, `lounge`, `market`, `woods` |
| `/visit <player or npub>` | — | Request access to another player's private room. Accepts a name or npub1. |

Room name aliases for `/tp`: `thefeed` → feed, `room` / `my` → myroom, `rooftop` → lounge, `shop` / `store` → market, `forest` / `camp` → woods

### Social

| Command | Aliases | Description |
|---------|---------|-------------|
| `/dm [player]` | `/dms`, `/messages`, `/msg` | Open a DM with a player. No argument lists online players. |
| `/crew` | `/crews` | Open the Crews panel. |
| `/zap <player or npub>` | — | Open the zap modal to send a lightning tip. Accepts a name or npub1. |
| `/players` | `/who`, `/online` | List players currently in the scene. |
| `/follows` | `/following`, `/friends` | Open the follows / friends panel. |
| `/status` | — | Display your current status (Hub only). |

### Customization

| Command | Aliases | Description |
|---------|---------|-------------|
| `/terminal` | `/outfit`, `/avatar`, `/computer` | Open the avatar & room customizer. |
| `/shop` | `/store`, `/market` | Open the cosmetics shop (clothes, colors, auras — paid over Lightning). |
| `/bazaar` | `/items`, `/inv`, `/inventory`, `/bag` | Open the item bazaar: your collection, the market, offers, and sets. Also via the vending machine in the Alley. |
| `/polls` | — | Open the poll board. |
| `/map` | `/world` | Open the district world map. Also toggleable with Tab. |

### Emotes

| Command | Description |
|---------|-------------|
| `/smoke` | Cigarette smoke |
| `/coffee` | Coffee cup |
| `/music` | Music notes |
| `/zzz` | Sleeping |
| `/think` | Thought bubble |
| `/hearts` | Hearts |
| `/angry` | Anger symbol |
| `/sweat` | Sweat drop |
| `/sparkle` | Sparkles |
| `/confetti` | Confetti |
| `/fire` | Flames |
| `/ghost` | Ghost (turns semi-transparent) |
| `/rain` | Rain cloud |

All emotes are toggles — run the command again to stop.

### Fun

| Command | Aliases | Description |
|---------|---------|-------------|
| `/flip` | `/coin` | Flip a coin and broadcast the result. |
| `/8ball <question>` | — | Ask the magic 8-ball a question. |
| `/rps <rock\|paper\|scissors>` | — | Challenge another player to rock-paper-scissors (Hub only). |
| `/slots` | — | Play the slot machine (Hub only). |
| `/ship <name1> <name2>` | — | Calculate compatibility between two names. |

### Moderation

| Command | Aliases | Description |
|---------|---------|-------------|
| `/mute` | — | Toggle chat mute (stops sending and receiving messages). |
| `/mutelist` | `/mutes`, `/blocked` | Open the mute list panel. |
| `/filter [word]` | — | Add a word to the chat filter. No argument lists current filters. |
| `/unfilter <word>` | — | Remove a word from the chat filter. |

### Help

| Command | Aliases | Description |
|---------|---------|-------------|
| `/help` | `/?` | Show available commands for the current scene. |

## Nostr Event Kinds

| Kind | Description | NIP |
|------|-------------|-----|
| 0 | User metadata (profile, lightning address) | NIP-01 |
| 1 | Short text notes (global feed, tarot spread shares) | NIP-01 |
| 3 | Contact list / follows | NIP-01 |
| 5 | Event deletion (crew cleanup) | NIP-09 |
| 6 | Reposts | NIP-18 |
| 9 | Group chat message (crew chat) | NIP-29 |
| 13 | Seal (encrypted rumor wrapper) | NIP-59 |
| 14 | Direct message rumor (unsigned inner event) | NIP-17 |
| 1018 | Poll vote / response | NIP-88 |
| 1059 | Gift wrap (outer DM envelope) | NIP-59 |
| 1068 | Poll event | NIP-88 |
| 9001 | Kick member from group | NIP-29 |
| 9007 | Create group (founder action) | NIP-29 |
| 9008 | Delete group (founder action) | NIP-29 |
| 9021 | Join group request (member action) | NIP-29 |
| 9022 | Leave group (member action) | NIP-29 |
| 27235 | HTTP auth (NIP-96 upload signing) | NIP-98 |
| 9734 | Zap request | NIP-57 |
| 9735 | Zap receipt | NIP-57 |
| 13194 | NWC info event (legacy) | NIP-47 |
| 16767 | User's active UI theme (replaceable) | custom |
| 20000 | Ephemeral channel message (room chat) | NIP-28 |
| 23194 | NWC request | NIP-47 |
| 23195 | NWC response | NIP-47 |
| 30078 | App-specific addressable data (avatar, room config, crew definitions/membership, invite tokens, item economy: items/bids/wins/escrow, unlocks, trade offers) | NIP-78 |
| 30402 | Market listing (item offered for sale at a sats price) | NIP-99 |
| 36767 | Published room theme (addressable) | custom |
| 39001 | Group admin list (relay-maintained) | NIP-29 |
| 39002 | Group member list (relay-maintained) | NIP-29 |

### Kind 30078 — d-tag index

All kind 30078 events are namespaced by their `d` tag:

| d-tag | Owner | Description |
|-------|-------|-------------|
| `nostr-district-avatar` | any user | Avatar configuration (body, hair, clothes, colors) |
| `nostr-district-outfits` | any user | Saved outfit presets |
| `nostr-district-room` | any user | Room decoration and layout config |
| `nostr-district-inventory` | any user | Purchased cosmetic cache (free/earned items only — paid cosmetics are derived from kind:9735 zap receipts) |
| `nostr-district-unlocks` | any user | Relay-backed cosmetic unlocks (auras, fishing items, login streak, legendary-catch count) |
| `nostr-district-offers` | any user | The player's pending trade offers + resolved-offer set |
| `{instanceId}` (`t=nditem`) | **oracle** | An item ownership record. `p` tag = current owner; transfers re-publish under the same `d` with a new owner; `burned` tag tombstones it. Escrow variants carry `escrow_*` tags. |
| `{instanceId}` (`t=ndbid`) | bidder | A bid on a listing (`p` = seller, `amount` tag) |
| `win_{instanceId}` (`t=ndwin`) | **oracle** | Durable "you won the auction" marker (`p` = winner) |
| `nostr-district:spark-address` | any user | Maps the user's Nostr pubkey → in-game Spark Lightning address so in-game zaps land in the in-game wallet |
| `nostr-district:spark-mnemonic` | any user | NIP-44 self-encrypted Spark wallet mnemonic — enables cross-device wallet sync (same nsec → same wallet on every browser/device) |
| `nd-crew-ptr-{id}` | founder | Crew pointer (v2 authority) — names the current `crewPk`. Only the founder can replace it; cryptographic recovery anchor. |
| `nd-crew-{id}` | crew `crewPk` | Crew definition (name, emblem, roles, kicked list, wrappedChatKey). Signed by the shared `crewSk` — any admin who holds the key can update it. |
| `nd-m-{crewId}` | each member | Per-member crew membership status (`active: true/false, role`) |
| `nd-invite-{token}` | invitee | Consumed invite token record (one-time use, cross-device) |

### The district relay

The district runs its own allowlist relay at `wss://nostr.thedistrict.online` —
the canonical durable store for economy events (items, listings, bids, burns)
and citizens' encrypted wallet-mnemonic backups. Public relays remain as
redundancy. Source, accept policy, and full ops runbook (deploy, rollback,
backfill, monitoring): [`relay/`](relay/README.md).

## NIPs Implemented

| NIP | Standard | Usage |
|-----|----------|-------|
| NIP-01 | Basic protocol | Core event types, signing, relay communication |
| NIP-04 | Encrypted DMs (legacy) | Fallback encryption for NWC and older extensions |
| NIP-07 | Browser extension signing | Login via Alby / nos2x; signing and encryption |
| NIP-09 | Event deletion | Kind 5 deletion events used to remove crew definitions |
| NIP-17 | Encrypted DMs | Private messages using gift wrap + NIP-44 |
| NIP-18 | Reposts | Kind 6 repost display in the feed room |
| NIP-19 | Bech32 encoding | npub / nsec / naddr encode and decode |
| NIP-28 | Public channels | Room chat via ephemeral kind 20000 events |
| NIP-29 | Simple Groups | Crew system — group creation, membership, chat, kick, leave |
| NIP-44 | Encrypted payloads v2 | Primary encryption for DMs and NWC requests |
| NIP-46 | Remote signing | Login via Bunker URL or QR-based client flow |
| NIP-47 | Nostr Wallet Connect | Pay zap invoices from a connected lightning wallet |
| NIP-57 | Zaps | Zap requests, receipt verification, and ZAP-gated item ownership — paid items are unlocked exclusively by verifying kind:9735 receipts signed by the store's lightning wallet |
| NIP-59 | Gift wraps | Seals and gift wraps for NIP-17 DM privacy |
| NIP-78 | App-specific data | Kind 30078 for avatar, room config, crews, and the item economy (items, bids, wins, escrow, unlocks, trade offers) |
| NIP-88 | Polls | Create polls and record votes in rooms |
| NIP-99 | Classified listings | Kind 30402 for item market listings (price in sats) |
| NIP-89 | App handler info | `client` tag on published notes so clients display "posted via Nostr District" |
| NIP-92 | Media attachments | `imeta` tags on kind 1 tarot share notes for inline image previews in Primal, Nostur, and other clients |
| NIP-96 | HTTP file storage | Card images upscaled and uploaded to a free NIP-96 host (nostr.build → nostrcheck.me fallback) before publishing tarot spread notes |
| NIP-98 | HTTP auth | Signs NIP-96 upload requests with the user's Nostr key — no account or subscription required |

## Crews (NIP-29 + custom multi-admin authority)

Crews are persistent guilds backed by NIP-29 groups on dedicated relay infrastructure. Roles:

- **Founder** — creates the crew, owns the cryptographic "pointer" event, can do everything plus cryptographically revoke admins
- **Admins** — hold the shared `crewSk` and can edit any crew metadata, kick/unkick members, promote/demote roles, and accept/decline join requests
- **Officers** — can accept/decline join requests and post in the Posts (announcements) tab
- **Members** — can chat, react, and read posts

### Authority model (v2)

To let multiple admins co-control a crew on top of Nostr's "events are keyed by author" rule, every crew has its own keypair `(crewSk, crewPk)` and is represented by two events:

| Event | d-tag | Signer | Purpose |
|---|---|---|---|
| **Pointer** | `nd-crew-ptr-{id}` | Founder's personal nsec | Names the current `crewPk`. Only the founder can replace it. |
| **Definition** | `nd-crew-{id}` | `crewSk` | All mutable state: name, emblem, members, roles, kicked list, chat key. Any holder of `crewSk` can update it. |

The crew identity keypair `crewSk` is generated at creation and shared with each admin via a NIP-17 gift-wrapped DM (`nd-crew-sk:{crewId}:{hex}`) at promotion time. Holders can sign def updates as authoritative co-admins.

**Soft demote** (set role to Member via dropdown): UI-only, trust-based. The demoted user still has `crewSk` cached locally — same model as Discord/Slack.

**Cryptographic revoke** (founder-only "Revoke" button): generates a new `(crewSk2, crewPk2)`, rewraps the chat key under `crewPk2`, republishes the def under `crewPk2`, updates the pointer to name `crewPk2`, and gift-wraps the new key to remaining admins. The revoked admin's old `crewSk` becomes useless — well-behaved clients follow the pointer and ignore their def updates.

The founder is uncickable (clients filter `founderPubkey` from `kickedPubkeys` before honoring the def).

### Chat encryption

Crew chat is NIP-44-encrypted with a per-crew `chatKey`. For closed crews the chatKey is wrapped under the crew identity (`crewSk → crewPk` NIP-44 self-encrypt) inside the def, so any admin can decrypt it directly. Regular members receive their `chatKey` via gift-wrapped DM (`nd-key:{crewId}:{hex}`) when their join request is accepted.

### Membership records

Each member publishes their own `kind:30078` event (d-tag `nd-m-{crewId}`) as a self-owned membership record — analogous to a kind:3 contact list. `active: true` means joined; `active: false` means left. This is the authoritative membership source and syncs across all devices and browsers automatically.

### Join request resolution

Join requests appear as `kind:9` chat events tagged `nd-joinreq` with a token. Any admin or officer can Accept or Decline. The resolver publishes a system message in crew chat (`"X's request to join was accepted"` / `"... was declined"`), which all members see — the join-request card swaps to an "Accepted" or "Declined" badge for everyone. No per-user resolution cache; chat is the single source of truth.

### Invite tokens

DM crew invites include a one-time token. When accepted, a `kind:30078` event with d-tag `nd-invite-{token}` is published by the accepting user. Any browser with the same keypair will see the invite as already consumed.

### NIP-29 relay infrastructure

Crew chat, membership actions, and group management use [groups.0xchat.com](wss://groups.0xchat.com) and [relay.groups.nip29.com](wss://relay.groups.nip29.com) as the NIP-29 relay layer. Crew definitions and member records are also mirrored to standard discovery relays (kind:30078) so crews are browsable without needing NIP-29 access.

Live chat subscription uses both layers, with a 5-second poll fallback to catch any messages the live socket misses. Sends are throttled to ~2 msg/sec and retried up to 3× if zero relays ACK, to handle NIP-29 burst rate limits.

## Item Economy & Bazaar

Unique, ownable items that live entirely on relays — collected by fishing and scavenging, then traded or sold to other players. There is no item database; ownership is a signed Nostr event.

### The oracle

Items are minted and transferred by an **oracle** — a Nostr keypair whose private key lives only on the server (`ORACLE_PRIVATE_KEY`, never client-side). Every item is a `kind:30078` event (`t=nditem`, `d={instanceId}`) **signed by the oracle**; clients trust only items signed by the baked-in oracle pubkey, so items can't be forged. Because 30078 is addressable, a **transfer** is just a re-publish under the same `d` with a new `p` (owner) tag, and a **burn** is a `burned` tombstone — relays keep only the latest. See [ORACLE_SETUP.md](ORACLE_SETUP.md) for key generation and deployment.

The oracle is a **scarcity notary, not a bank** — it never holds funds. The only trust placed in it is "don't counterfeit items, stay online to process trades." If it goes offline, every existing item remains valid and viewable from relays; only new mints/trades pause.

### Selling (escrow + Lightning, no custody)

Listing an item escrows it (re-owned to the oracle, same `d`) and publishes a `kind:30402` (NIP-99) market listing. A buyer's sats go **directly to the seller** via their LNURL/Lightning address — the oracle polls **LNURL-verify** and only releases the item (transfers oracle → buyer) once payment is confirmed. Funds never touch the oracle. The sale memo rides on the payment (LUD-12), and both parties get a NIP-17 DM.

### Bidding

Listings accept relay-backed bids (`kind:30078`, `t=ndbid`). Accepting a bid stamps the escrow `awaiting_winner` and publishes a durable win marker (`t=ndwin`, `p=winner`); the winner is notified by NIP-17 DM and can pay to claim. Bids/wins are cancellable.

### Trading & gifting

Players swap items directly (oracle performs an atomic two-way transfer) or gift them one-way. A pending outgoing offer locks the item so it can't also be listed, gifted, or offered again.

### Collections → cosmetics

Owning items completes **sets**, and certain sets unlock **auras** (e.g. every legendary non-fish item → Gold aura); owning every non-legendary fish unlocks the **Fish Hat**. Unlocks are relay-backed (`d=nostr-district-unlocks`), so they follow the player across devices.

## In-game Wallet (Spark / Breez SDK)

Every logged-in user gets an in-game Lightning wallet powered by [Breez SDK](https://breez.technology/sdk) on the [Spark](https://spark.money) Bitcoin layer-2. The wallet is **non-custodial** — Nostr District never holds anyone's keys or funds.

### How it's bound to your Nostr key

The wallet's BIP-39 mnemonic is derived from a signature: the app asks the user's signer to sign a fixed canonical event (`kind:22242`, content `nostr-district-spark-wallet-v1`), HKDFs the resulting 64-byte Schnorr signature, and converts the bits to a 12-word mnemonic.

Result: every login method (nsec / passkey / extension / bunker) provisions a Spark wallet bound to the user's Nostr identity. No separate seed phrase to write down — your nsec is your wallet.

### Cross-device wallet sync

Schnorr signatures (BIP-340) are non-deterministic by default (auxiliary randomness), so re-signing the seed event on a new device produces a *different* signature and therefore a different mnemonic. To make the same nsec yield the same wallet on every browser/device, the mnemonic is also published to Nostr:

- **Backup event:** `kind:30078` with d-tag `nostr-district:spark-mnemonic`, content = mnemonic **NIP-44 self-encrypted to the user's own pubkey**.
- **On login:** the client fetches the backup once per session. If present, it's adopted as the canonical mnemonic (overrides any locally derived one). If absent, the local mnemonic is published as the canonical one for future devices.

Only the user (with their nsec / signer) can decrypt the backup. The encrypted content is public; the key material isn't.

### Wallet keys at rest

| Login method | Mnemonic storage in localStorage |
|---|---|
| nsec / passkey | AES-GCM encrypted with a key derived via HKDF from the nsec |
| Extension / bunker | Plaintext (no raw nsec available to derive an encryption key) |

The plaintext fallback is the same trade-off documented in the WalletInfo modal — the wallet is hot-wallet storage in either case, intended for in-game amounts, not savings. Anyone with browser-data access can read plaintext entries; nsec-based ciphertext is useless without the nsec.

### Extension compatibility

The wallet sync, DMs, crew chat, and admin gift-wraps all rely on **NIP-44** encryption. Some Nostr extensions (notably Nostore on Safari) implement `nip44.encrypt`/`decrypt` partially or not at all. After a successful NIP-07 login the app runs a self-encrypt → self-decrypt round-trip; if it fails, a one-time warning modal explains the limitation and suggests logging in with `nsec` directly or switching to a fully-featured extension (Alby, nos2x).

## Security

Nostr District ships with a built-in security kit (`src/nostr-auth-security-kit.js`) that handles key protection, input sanitization, and session safety across all login methods.

### Key Handling

| Method | How the key is handled |
|--------|----------------------|
| NIP-07 Extension | Private key never touches the app — signing happens inside the extension |
| NIP-46 Bunker | Key stays on the remote signer; app only holds a temporary session token |
| nsec | Stored in a closure-based `SecureKeyStore` with no `.get()` method — XSS cannot extract the raw key |
| Continue with Google | nsec generated and AES-256-GCM-encrypted client-side; only ciphertext is stored (in the user's own Google Drive app folder); decrypted into memory at login like nsec. Google never sees the key |
| Guest | Ephemeral key generated locally, never persisted |

### SecureKeyStore

The `SecureKeyStore` holds the nsec private key inside a JavaScript closure. There is no public getter — external scripts can only call `.signEvent()`, which returns a signed event but never exposes the key bytes. On logout or page unload the key bytes are zeroed out in memory.

### Auto-Logout

nsec sessions automatically log out after **15 minutes of inactivity** (mouse, keyboard, scroll, touch). If the tab is hidden and the timeout elapses while away, logout triggers on return.

### Input Sanitization

All user-generated content (display names, bios, NIP-05, chat messages) is passed through:
- **HTML escaping** — prevents XSS injection via `innerHTML`
- **URL sanitization** — blocks `javascript:`, `data:`, `vbscript:`, and `file:` protocols
- **Length capping** — prevents DOM bloat from maliciously long profile fields

### Encrypted Messaging

DMs use **NIP-17 + NIP-59** (gift wraps with NIP-44 encryption). Messages are sealed and wrapped before being published — relay operators cannot read them.

### NWC

The wallet connection string is never sent to any Nostr District server. Storage security depends on login method:

| Login | Storage |
|-------|---------|
| nsec | NWC URI is **AES-GCM encrypted** before hitting `localStorage`. The 256-bit key is derived from the user's private key via HKDF, so the ciphertext is useless without the nsec. |
| Extension / Bunker | Stored plain under `nd_nwc_uri` — no persistent secret is available in the page's JS context to derive a meaningful key. |

Wallet communication uses **NIP-44 v2** encryption (NIP-04 as fallback, negotiated via the wallet's `kind:13194` info event), transmitted only to your own wallet relay.

## Running Locally

```bash
npm install

# Start the WebSocket presence server
npx ts-node server.ts

# Start the frontend (separate terminal)
npm run dev
```

Open `http://localhost:5173`

## Deployment

Frontend — [Cloudflare Pages](https://pages.cloudflare.com)  
WebSocket server — [Railway](https://railway.app)  
Build command: `vite build`  
Output directory: `dist`

### IP Protection

Relay connections are proxied through a Cloudflare Pages Function (`functions/api/relay.js`). Clients connect to `wss://<host>/api/relay?relay=wss://relay.example.com` and the Worker forwards traffic to the upstream relay — so Nostr relays only ever see Cloudflare IP addresses, not end-user IPs.

## License

MIT

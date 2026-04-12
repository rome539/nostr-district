# Nostr District

A pixel art social world built on Nostr. Walk around a cyberpunk city, hang out in rooms, chat with other players, and customize your avatar — all powered by decentralized identity.

## What it is

Nostr District is a browser-based MMO where your Nostr identity is your character. Log in with a remote signer, browser extension, or private key — and you're in. Your room, your avatar, your presence on the network.

- **Hub** — shared public space where all players appear in real time
- **Rooms** — personal spaces tied to your pubkey; decorate them, invite people in
- **Woods** — outdoor exploration area with its own chat and presence
- **Feed Room** — live global Nostr feed scrolling in real time
- **Relay Room** — live relay connection status and event stats
- **Chat** — room chat over Nostr ephemeral events (NIP-28)
- **DMs** — encrypted direct messages (NIP-17 + NIP-44)
- **Zaps** — lightning tips via NWC or WebLN (NIP-57 / NIP-47)
- **Polls** — create and vote on polls pinned to rooms (NIP-88)
- **Crews** — persistent guilds with chat, roles, and membership (NIP-29)
- **Avatars** — fully customizable pixel art characters
- **Themes** — publish and browse community pixel art room themes

## Tech Stack

- [Phaser.js](https://phaser.io) — game engine
- [nostr-tools](https://github.com/nbd-wtf/nostr-tools) — Nostr protocol
- [Vite](https://vitejs.dev) + TypeScript
- WebSocket presence server (Node.js)

## Login Methods

- **NIP-46 Remote Signer** — Primal, Amber, nsec.app (recommended)
- **Browser Extension** — Alby, nos2x (NIP-07)
- **Private Key** — nsec (stored in memory only)
- **Guest** — no key needed, look around freely

## Commands

Commands are typed in the chat input. All commands are case-insensitive.

### Navigation

| Command | Aliases | Description |
|---------|---------|-------------|
| `/tp <room>` | `/teleport`, `/go` | Teleport to a room: `hub`, `relay`, `feed`, `myroom`, `lounge`, `market`, `woods` |
| `/visit <player>` | — | Request access to another player's private room (Hub only) |

Room name aliases for `/tp`: `thefeed` → feed, `room` / `my` → myroom, `rooftop` → lounge, `shop` / `store` → market, `forest` / `camp` → woods

### Social

| Command | Aliases | Description |
|---------|---------|-------------|
| `/dm [player]` | — | Open a DM with a player. No argument lists online players. |
| `/crew` | `/crews` | Open the Crews panel. |
| `/zap <player>` | — | Open the zap modal to send a lightning tip. Requires login. |
| `/players` | `/who`, `/online` | List players currently in the scene. |
| `/follows` | `/following`, `/friends` | Open the follows / friends panel. |
| `/status` | — | Display your current status (Hub only). |

### Customization

| Command | Aliases | Description |
|---------|---------|-------------|
| `/terminal` | `/wardrobe`, `/outfit`, `/avatar` | Open the avatar & room customizer. In a private room, add `/computer`. |
| `/polls` | — | Open the poll board (Hub only). |

### Fun

| Command | Aliases | Description |
|---------|---------|-------------|
| `/smoke` | — | Toggle cigarette smoke emote. |
| `/flip` | `/coin` | Flip a coin and broadcast the result (Hub only). |
| `/8ball <question>` | — | Ask the magic 8-ball a question (Hub only). |
| `/rps <rock\|paper\|scissors>` | — | Challenge another player to rock-paper-scissors (Hub only). |
| `/slots` | — | Play the slot machine (Hub only). |
| `/ship <name1> <name2>` | — | Calculate compatibility between two names (Hub only). |

### Moderation

| Command | Aliases | Description |
|---------|---------|-------------|
| `/mute` | — | Toggle chat mute (stops sending and receiving messages). |
| `/mutelist` | `/mutes`, `/blocked` | Open the mute list panel (Hub only). |
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
| 30078 | App-specific replaceable data (avatar, room config, crew definitions, crew membership, invite tokens) | NIP-78 |
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
| `nd-crew-{id}` | founder | Crew definition (name, emblem, roles, kicked list) |
| `nd-m-{crewId}` | each member | Per-member crew membership status (`active: true/false, role`) |
| `nd-invite-{token}` | invitee | Consumed invite token record (one-time use, cross-device) |

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
| NIP-57 | Zaps | Zap requests and receipt verification |
| NIP-59 | Gift wraps | Seals and gift wraps for NIP-17 DM privacy |
| NIP-78 | App-specific data | Kind 30078 for avatar, room config, crew definitions, membership, and invite tokens |
| NIP-88 | Polls | Create polls and record votes in rooms |
| NIP-89 | App handler info | `client` tag on published notes so clients display "posted via Nostr District" |
| NIP-92 | Media attachments | `imeta` tags on kind 1 tarot share notes for inline image previews in Primal, Nostur, and other clients |
| NIP-96 | HTTP file storage | Card images upscaled and uploaded to a free NIP-96 host (nostr.build → nostrcheck.me fallback) before publishing tarot spread notes |
| NIP-98 | HTTP auth | Signs NIP-96 upload requests with the user's Nostr key — no account or subscription required |

## Crews (NIP-29)

Crews are persistent guilds backed by NIP-29 groups on dedicated relay infrastructure. Each crew has:

- **Founder** — creates and fully controls the crew; can promote/kick anyone
- **Admins** — can accept join requests and kick regular members
- **Members** — can chat, post, and react in the crew channel

### How membership works

Each member publishes their own `kind:30078` event (d-tag `nd-m-{crewId}`) as a self-owned membership record — analogous to a kind:3 contact list. `active: true` means joined; `active: false` means left. This is the authoritative membership source and syncs across all devices and browsers automatically.

The crew definition (d-tag `nd-crew-{id}`) published by the founder stores roles, the kicked list, and the NIP-44 chat key used to encrypt crew chat history.

### Invite tokens

DM crew invites include a one-time token. When accepted, a `kind:30078` event with d-tag `nd-invite-{token}` is published by the accepting user. Any browser with the same keypair will see the invite as already consumed.

### NIP-29 relay infrastructure

Crew chat, membership actions, and group management use [groups.0xchat.com](wss://groups.0xchat.com) and [relay.groups.nip29.com](wss://relay.groups.nip29.com) as the NIP-29 relay layer. Crew definitions and member records are also mirrored to standard discovery relays (kind:30078) so crews are browsable without needing NIP-29 access.

## Security

Nostr District ships with a built-in security kit (`src/nostr-auth-security-kit.js`) that handles key protection, input sanitization, and session safety across all login methods.

### Key Handling

| Method | How the key is handled |
|--------|----------------------|
| NIP-07 Extension | Private key never touches the app — signing happens inside the extension |
| NIP-46 Bunker | Key stays on the remote signer; app only holds a temporary session token |
| nsec | Stored in a closure-based `SecureKeyStore` with no `.get()` method — XSS cannot extract the raw key |
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

The wallet connection string is stored in `localStorage` and only transmitted to your own wallet relay over an encrypted NIP-04 channel. It is never sent to any Nostr District server.

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

Frontend — [Vercel](https://vercel.com)  
WebSocket server — [Railway](https://railway.app)  
Build command: `vite build`  
Output directory: `dist`

## License

MIT

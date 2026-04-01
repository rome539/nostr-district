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
| 1 | Short text notes (global feed) | NIP-01 |
| 3 | Contact list / follows | NIP-01 |
| 6 | Reposts | NIP-18 |
| 13 | Seal (encrypted rumor wrapper) | NIP-59 |
| 14 | Direct message rumor (unsigned inner event) | NIP-17 |
| 1018 | Poll vote / response | NIP-88 |
| 1059 | Gift wrap (outer DM envelope) | NIP-59 |
| 1068 | Poll event | NIP-88 |
| 9734 | Zap request | NIP-57 |
| 9735 | Zap receipt | NIP-57 |
| 13194 | NWC info event (legacy) | NIP-47 |
| 16767 | User's active theme (replaceable) | custom |
| 20000 | Ephemeral channel message (room chat) | NIP-28 |
| 23194 | NWC request | NIP-47 |
| 23195 | NWC response | NIP-47 |
| 36767 | Published theme (addressable) | custom |

## NIPs Implemented

| NIP | Standard | Usage |
|-----|----------|-------|
| NIP-01 | Basic protocol | Core event types, signing, relay communication |
| NIP-04 | Encrypted DMs (legacy) | Fallback encryption for NWC and older extensions |
| NIP-07 | Browser extension signing | Login via Alby / nos2x; signing and encryption |
| NIP-17 | Encrypted DMs | Private messages using gift wrap + NIP-44 |
| NIP-18 | Reposts | Kind 6 repost display in the feed room |
| NIP-19 | Bech32 encoding | npub / nsec / naddr encode and decode |
| NIP-28 | Public channels | Room chat via ephemeral kind 20000 events |
| NIP-44 | Encrypted payloads v2 | Primary encryption for DMs and NWC requests |
| NIP-46 | Remote signing | Login via Bunker URL or QR-based client flow |
| NIP-47 | Nostr Wallet Connect | Pay zap invoices from a connected lightning wallet |
| NIP-57 | Zaps | Zap requests and receipt verification |
| NIP-59 | Gift wraps | Seals and gift wraps for NIP-17 DM privacy |
| NIP-88 | Polls | Create polls and record votes in rooms |

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

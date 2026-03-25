# Nostr District

A pixel art social world built on Nostr. Walk around a cyberpunk city, hang out in rooms, chat with other players, and customize your avatar — all powered by decentralized identity.

## What it is

Nostr District is a browser-based MMO where your Nostr identity is your character. Log in with a remote signer, browser extension, or private key — and you're in. Your room, your avatar, your presence on the network.

- **Hub** — shared public space where all players appear in real time
- **Rooms** — personal spaces tied to your pubkey. Decorate them, invite people in
- **Feed Room** — live global Nostr feed scrolling in real time
- **Chat** — room chat over Nostr channels (NIP-28)
- **DMs** — encrypted direct messages (NIP-17)
- **Avatars** — fully customizable pixel art characters

## Tech Stack

- [Phaser.js](https://phaser.io) — game engine
- [Nostr Tools](https://github.com/nbd-wtf/nostr-tools) — Nostr protocol
- [Vite](https://vitejs.dev) + TypeScript
- NIP-46 remote signing, NIP-17 DMs, NIP-28 channels

## Login Methods

- **NIP-46 Remote Signer** — Primal, Amber, nsec.app (recommended)
- **Browser Extension** — Alby, nos2x
- **Private Key** — nsec (stored in memory only)
- **Guest** — no key needed, look around freely

## Running Locally

```bash
npm install

# Start the WebSocket presence server
npx ts-node server.ts

# Start the frontend (separate terminal)
npm run dev
```

Open `http://localhost:5173`

## Commands

| Command | Description |
|---|---|
| `/terminal` | Open avatar & room customizer |
| `/tp <room>` | Teleport to relay, feed, lounge, market, hub |
| `/tp <player>` | Request access to a player's room |
| `/dm <player>` | Open DM with a player |
| `/players` | List players in current room |
| `/smoke` | Light a cigarette |
| `/mute` | Toggle chat mute |
| `/filter <word>` | Add a chat filter |

## Deployment

Frontend — [Vercel](https://vercel.com)  
WebSocket server — [Railway](https://railway.app)  
Build command: `vite build`  
Output directory: `dist`

## License

MIT

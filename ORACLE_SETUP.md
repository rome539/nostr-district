# Item Oracle Setup

The oracle is a Nostr keypair whose private key lives only on the server.
It signs every item mint — clients verify authenticity against the public key.
Nobody can forge items without the private key.

---

## First-time setup

### 1. Generate a keypair (run once)

```bash
node -e "
const { generateSecretKey, getPublicKey } = require('nostr-tools');
const { bytesToHex } = require('@noble/hashes/utils');
const sk = generateSecretKey();
console.log('ORACLE_PRIVATE_KEY=' + bytesToHex(sk));
console.log('VITE_ORACLE_PUBKEY=' + getPublicKey(sk));
"
```

Save both values somewhere safe (password manager).

### 2. Set Railway environment variable

Railway dashboard → your service → Variables → New variable:

```
ORACLE_PRIVATE_KEY = <the private key hex from step 1>
```

The private key never appears in code or the repo. Railway injects it at runtime via `process.env.ORACLE_PRIVATE_KEY`.

### 3. Set the public key for the client

In `.env` (already has the placeholder):

```
VITE_ORACLE_PUBKEY=<the public key hex from step 1>
```

Commit this — the public key is safe to be public. It's how clients verify items are real.

---

## Moving off Railway

The oracle key is **not tied to Railway**. It's just a keypair you own.

### Moving to Fly.io

```bash
fly secrets set ORACLE_PRIVATE_KEY=<your private key hex>
```

### Moving to a VPS / Docker

```bash
export ORACLE_PRIVATE_KEY=<your private key hex>
# or in your .env / docker-compose.yml environment section
```

### Moving to Render / Heroku / any platform

Set `ORACLE_PRIVATE_KEY` as an environment variable / secret in that platform's dashboard.

**All previously minted items remain valid** — signatures don't expire and the public key doesn't change.

---

## If the oracle server goes down

- Existing items in player inventories remain valid (they're signed events on Nostr relays)
- New items cannot be minted until the server is back
- The bazaar browsing and trading still works — only minting is blocked

---

## Oracle trust set (rotation & fallback)

The client doesn't trust just one key — it trusts a **set** of public keys, configured
via `VITE_ORACLE_PUBKEYS` (comma-separated) in `.env`. An item counts if it was signed
by **any** key in the set.

Two important properties:

- **Read-side only.** The set decides which signatures the client *validates*. It does
  NOT mean multiple oracles sign. Minting stays **single-signer**: only the one running
  server holds a private key and mints. So adding keys to the set never produces
  duplicate items.
- **Rotation without a reset.** If you ever change the oracle key, add the new public key
  to `VITE_ORACLE_PUBKEYS` **and keep the old one in the list**. Items minted under the
  old key keep verifying forever; the server just starts signing new ones with the new key.

## If you lose the private key

- Existing items remain valid forever (already signed)
- Generate a new keypair, set the new `ORACLE_PRIVATE_KEY` on the server
- **Add** the new public key to `VITE_ORACLE_PUBKEYS` in `.env` (keep the old key in the
  list too) — this means old items still count and you have NOT reset anyone's collection
- Redeploy the client with the updated `.env`
- **Keep the private key backed up in 2+ places (e.g. a password manager + offline copy)** —
  with a backup, an outage is just a pause, never a loss

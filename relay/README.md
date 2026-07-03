# nd-relay — the Nostr District relay

`wss://nostr.thedistrict.online` — allowlist khatru relay, the canonical durable
store for the district's economy events and citizens' wallet-mnemonic backups.

## What it accepts (and nothing else)

| Event | Rule |
|---|---|
| kind:30402 `t=ndmarket` | bazaar listings (seller-signed) |
| kind:30078 `t=ndbid / ndbiddecline / ndfish` | player-signed economy events |
| kind:30078 `t=nditem / ndwin / ndbounty / ndfishrec / ndweekly` | oracle-signed; forgery-walled when `ND_ORACLE_PUBKEYS` is set |
| kind:30078 `d=nostr-district:spark-mnemonic` (exact) | Spark wallet mnemonic backup — NIP-44 self-encrypted by the client, relay only ever sees ciphertext (v2, 2026-07-03) |
| kind:0 | oracle profile only (when the wall is set) |

Everything else → `blocked: not a district event`. NIP-33 replacement is wired
(`ReplaceEvent`), so newest-wins per (kind, pubkey, d) — burns supersede items,
which is what kills ghost listings/bids.

## Where it runs

- **DO droplet** `relay-nostrdistrict` — 159.65.226.178 (1vCPU/1GB/25GB, NYC1,
  2GB swap). Access: root via SSH key or the DO web console.
- **systemd unit** `nd-relay`, binary at `/opt/nd-relay/nd-relay`, listening on
  `127.0.0.1:8080`, badger data in `/opt/nd-relay/data`.
- **Caddy** reverse-proxies `nostr.thedistrict.online` → :8080 with automatic
  Let's Encrypt TLS. Cloudflare DNS A record `nostr` → droplet, **DNS-only
  (grey cloud)** — required for Caddy's cert issuance.
- ⚠️ `relay.thedistrict.online` is a DIFFERENT machine — the game's presence/
  oracle WS server on Railway. Do not confuse them.
- **Backups:** DO daily droplet snapshot + nightly local tar of the badger dir
  (`/usr/local/bin/relay-backup.sh`, cron 03:30, keeps 7).

## Env

| Var | Default | Meaning |
|---|---|---|
| `ND_LISTEN` | `127.0.0.1:8080` | listen address |
| `ND_DATA` | `/opt/nd-relay/data` | badger directory |
| `ND_ORACLE_PUBKEYS` | *(unset — wall OFF)* | comma-separated hex pubkeys; when set, oracle tags must be authored by one of them |

## Build & deploy

Source lives HERE (this folder) — it was once kept only in /tmp and a reboot
deleted it; never again. Build on the Mac, ship the binary:

```bash
cd relay
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o nd-relay-bin-v2 .
```

Transfer either via scp (`scp nd-relay-bin-v2 root@159.65.226.178:/root/nd-relay-v2`)
or, if working from the DO web console, via a temporary git branch:
push the binary on a throwaway branch, `curl -sL -o /root/nd-relay-v2
https://raw.githubusercontent.com/rome539/nostr-district/<branch>/relay/nd-relay-bin-v2`
on the droplet, then delete the branch.

Swap on the droplet (backs up the running binary first):

```bash
BIN=$(systemctl cat nd-relay | awk -F= '/ExecStart/{print $2}' | awk '{print $1}')
cp "$BIN" /root/nd-relay-prev.bak
systemctl stop nd-relay && cp /root/nd-relay-v2 "$BIN" && chmod +x "$BIN" && systemctl start nd-relay
systemctl status nd-relay --no-pager | head -4
```

Rollback: `cp /root/nd-relay-prev.bak "$BIN" && systemctl restart nd-relay`
(v1 from 2026-06-19 is preserved as `/root/nd-relay-v1.bak`.)

Verify a deploy end-to-end from anywhere: publish a signed test event per the
policy table above and check it's accepted, stored, and read back — see
`tools/backfill-mnemonics.mjs` for the WS publish/query pattern.

## Watching it

```bash
journalctl -u nd-relay -f        # live: one ACCEPTED line per stored event
journalctl -u nd-relay -n 100    # recent history
```

Rejected events are not logged — only what gets in.

## Backfill

`tools/backfill-mnemonics.mjs` (run from the repo root with `node`) harvests
every spark-mnemonic backup from the public backup relays and republishes them
here, signatures intact. Idempotent — NIP-33 keeps the newest per author.
First run (2026-07-03): 70 citizens' backups migrated; nos.lol had been
silently carrying almost all of them. The June 2026 bazaar backfill (1,044
events → 918 after NIP-33 collapse) used the same relay-to-relay pattern.

## History

- **v1** 2026-06-19 — built + deployed; bazaar events only; backfilled history.
- **v2** 2026-07-03 — accepts spark-mnemonic backups (damus shutdown prompted
  moving the most critical user data onto owned infrastructure); source
  reconstructed into this folder; app's `MNEMONIC_BACKUP_RELAYS` now leads
  with this relay.
- Open items: set `ND_ORACLE_PUBKEYS` (forgery wall, keys documented in the
  oracle setup), droplet pending a reboot for security updates.

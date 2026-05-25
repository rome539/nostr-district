# Persistent Bunker URL Login (NIP-46)

Notes for porting the "paste the same `bunker://` URL twice and have it just
work" behavior to other Nostr web clients.

## The problem

A naive bunker URL login flow does this each time the user pastes:

```js
const clientSk = generateSecretKey();     // ← NEW each time
const clientPk = getPublicKey(clientSk);
// publish kind:24133 connect event to signer
```

Works the **first** time. On the second paste — even with the same URL —
the signer (Amber, Primal Mobile, nsec.app) sees a different `clientPk`
trying to consume the same secret, and silently returns:

```js
{ id: '...', result: '', error: 'already connected' }
```

To the user, the app just hangs on "Connecting…" forever, then either
times out or shows the cryptic "already connected" message.

Amethyst doesn't hit this because it **persists its `clientSk`** in
app storage and reuses it on every reconnect.

## The fix

Persist a `signerPk → clientSk` map in `localStorage`. On every bunker
URL paste:

1. Parse the URL to extract `signerPk`.
2. Look up `signerPk` in the saved map.
3. If found, **reuse** that `clientSk` for the connect event.
4. If not, generate a new `clientSk` and (after the connect succeeds)
   save the mapping for next time.

The signer sees the same `clientPk` and accepts the reconnect without
needing fresh user approval.

## Implementation sketch

```js
const CLIENTS_KEY = 'myapp_bunker_clients';

async function loginWithBunkerUrl(bunkerUrl) {
    const url = new URL(bunkerUrl);
    if (url.protocol !== 'bunker:') throw new Error('Invalid bunker URL');
    const signerPk = url.hostname || url.pathname.replace(/^\/\//, '');
    if (!signerPk || signerPk.length !== 64) throw new Error('Bad signer pubkey');
    const relays = url.searchParams.getAll('relay');
    if (!relays.length) throw new Error('No relays in URL');
    const secret = url.searchParams.get('secret') || '';

    // 1. Look up a saved clientSk for this signer.
    let clientSk = null;
    try {
        const map = JSON.parse(localStorage.getItem(CLIENTS_KEY) || '{}');
        if (typeof map[signerPk] === 'string') {
            clientSk = hexToBytes(map[signerPk]);
            console.log('[Bunker] Reusing saved clientSk for', signerPk.slice(0,16));
        }
    } catch {}

    // 2. Otherwise generate fresh.
    if (!clientSk) clientSk = nostrTools.generateSecretKey();
    const clientPk = nostrTools.getPublicKey(clientSk);

    // 3. Connect to relays, subscribe for response, publish connect event.
    //    (Use SimplePool.ensureRelay() if available — it awaits the open
    //    so the publish doesn't drop on slow mobile connections.)
    await Promise.allSettled(relays.map(u => pool.ensureRelay(u)));

    const since = Math.floor(Date.now() / 1000) - 60;
    const userPk = await new Promise((resolve, reject) => {
        let settled = false;
        const sub = pool.subscribeMany(relays,
            [{ kinds: [24133], '#p': [clientPk], since }],
            { onevent: async (ev) => {
                if (settled) return;
                try {
                    const resp = JSON.parse(await nip44Decrypt(clientSk, ev.pubkey, ev.content));
                    if (resp.result === 'auth_url' && resp.error) {
                        window.open(resp.error, '_blank'); return;
                    }
                    if (resp.error && resp.result !== 'auth_url') {
                        settled = true; sub.close();
                        reject(new Error(resp.error)); return;
                    }
                    settled = true; sub.close();
                    // Use get_public_key to confirm + get the actual user pubkey.
                    const pk = await bunkerRequest('get_public_key', clientSk, signerPk, relays);
                    resolve(pk);
                } catch {}
            }},
        );

        // Build & publish the connect event.
        (async () => {
            const enc = await nip44Encrypt(clientSk, signerPk, JSON.stringify({
                id: randomHex(8),
                method: 'connect',
                params: [signerPk, secret, /* perms */],
            }));
            const signed = nostrTools.finalizeEvent({
                kind: 24133, created_at: Math.floor(Date.now()/1000),
                tags: [['p', signerPk]], content: enc,
            }, clientSk);
            await Promise.allSettled(relays.map(async u =>
                (await pool.ensureRelay(u)).publish(signed)
            ));
        })();

        setTimeout(() => {
            if (!settled) { settled = true; sub.close(); reject(new Error('signer timeout')); }
        }, 30_000);
    });

    // 4. SUCCESS: save the clientSk for this signer so re-paste works later.
    try {
        const map = JSON.parse(localStorage.getItem(CLIENTS_KEY) || '{}');
        map[signerPk] = bytesToHex(clientSk);
        localStorage.setItem(CLIENTS_KEY, JSON.stringify(map));
    } catch {}

    return userPk;
}
```

## Gotchas worth knowing

### 1. Heartbeat will kill you

If your bunker client has an internal `ping` heartbeat, **disable it**
or make it non-destructive. Amber's ping handler is unreliable; a
single 10s timeout will trigger your disconnect handler, which usually
wipes `_signerPk` and breaks every in-flight signing request (wallet
init, profile fetch, DM history, etc).

Either:
- Set `heartbeatMs: 0` (recommended — let signing failures surface real
  problems on their own)
- Or bump the ping timeout to 30s+ AND require N consecutive failures
  before declaring dead AND don't wipe `_clientSk` in the disconnect
  handler (so the next signing attempt can still go through).

### 2. Publish before relays are open

If you're using a custom raw WebSocket pool (not `SimplePool`), make
sure `publish()` queues messages for sockets still in `CONNECTING`
state instead of silently dropping them. Mobile clients open 4
relays in 1–5s; a fixed `await sleep(800ms)` is not enough.

`SimplePool.ensureRelay(url)` handles this correctly out of the box.

### 3. The QR flow can lock the URL flow

If your UI shows both a QR code (`nostrconnect://`) and a URL paste
input on the same screen, opening the QR view typically kicks off a
client-flow connect that sets `loginInProgress = true`. When the user
then pastes a URL and clicks Go, your handler may silently no-op due
to that guard.

Fix: in the URL paste handler, if a QR/client flow is already running,
cancel it first, then proceed.

### 4. Status UX after cancel

If you cancel the QR flow before starting the URL flow, the cancel
likely fires `onStatusChange('idle', 'Cancelled')` which paints
"Cancelled" in the UI. Re-set the status to "Connecting…" *after* the
cancel and *before* starting the URL connect, otherwise the user sees
"Cancelled" while the URL connect is silently running.

### 5. Signer responses can be unusual

On a reconnect with the same `clientSk`, some signers (notably Amber)
return non-standard payloads in the connect response — sometimes a
stringified event, sometimes empty `result`. Don't be strict about the
exact shape. If `resp.error` is absent, treat it as success and
immediately call `get_public_key` to confirm and fetch the user's pubkey.

### 6. localStorage can be wiped

Users who "Clear cookies and site data" will lose the stored
`clientSk`. The first paste after that is a true fresh connect (new
`clientSk`, signer prompts user). This is the correct fallback; just
don't assume the map always has an entry.

Cache (HTTP cache) and history clears do NOT touch localStorage.

### 7. Cleanly clearing the saved map

On full logout, leave `myapp_bunker_clients` intact so re-pasting the
URL still works — that's the entire point. Add a separate "Forget
signer" UI affordance for users who want to wipe it. Don't conflate
the two.

## Optional: surface this in your signer info modal

Users may not realize the app remembers them. Add a short blurb in the
NIP-46 / Remote Signer info popover explaining:

> After your first successful connect, we save a client-side session
> key (NOT your nsec) in browser localStorage. This lets the signer
> recognize you on subsequent re-pastes of the same bunker URL, so
> logout → re-login works without needing fresh approval. Clearing
> "cookies and site data" in your browser wipes it.

## What you do NOT need to store

- The bunker URL itself
- The secret
- The user's nsec (never goes near your app in NIP-46)
- Profile / wallet state (those have their own storage layers)

Just the `signerPk → clientSk` mapping. ~100 bytes per signer.

## References

- NIP-46: <https://github.com/nostr-protocol/nips/blob/master/46.md>
- Amethyst (Android client that does this correctly):
  <https://github.com/vitorpamplona/amethyst>
- Reference implementation in this repo: [src/nostr/nostrService.ts](../src/nostr/nostrService.ts)
  (`loginWithBunkerUrl`) and [nip46-bunker.js](../nip46-bunker.js)
  (`BunkerClient.connectBunkerUrl` with the `clientSkHex` option).

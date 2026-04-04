/**
 * NIP-46 Remote Signer (Bunker) Login — Raw WebSocket Implementation
 * Uses raw WebSockets instead of SimplePool for reliable relay communication.
 */

// =========================================================================
// NIP-44 ENCRYPTION
// =========================================================================

let _nip44mod = null;

async function _loadNip44() {
    if (_nip44mod) return _nip44mod;
    if (globalThis.__nip44mod) {
        _nip44mod = globalThis.__nip44mod;
        return _nip44mod;
    }
    _nip44mod = await import('nostr-tools/nip44');
    return _nip44mod;
}

async function nip44Encrypt(sk, pk, text) {
    const m = await _loadNip44();
    const ck = m.getConversationKey ? m.getConversationKey(sk, pk) : m.v2.utils.getConversationKey(sk, pk);
    return (m.encrypt || m.v2.encrypt)(text, ck);
}

async function nip44Decrypt(sk, pk, ct) {
    const m = await _loadNip44();
    const ck = m.getConversationKey ? m.getConversationKey(sk, pk) : m.v2.utils.getConversationKey(sk, pk);
    return (m.decrypt || m.v2.decrypt)(ct, ck);
}

// =========================================================================
// UTIL
// =========================================================================

function randomHex(n = 16) {
    const a = new Uint8Array(n); crypto.getRandomValues(a);
    return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}
function skToHex(sk) { return Array.from(sk).map(b => b.toString(16).padStart(2, '0')).join(''); }
function hexToSk(h) { return new Uint8Array(h.match(/.{2}/g).map(x => parseInt(x, 16))); }

// =========================================================================
// RAW WEBSOCKET RELAY POOL
// =========================================================================

class RawRelayPool {
    constructor() {
        this._sockets = new Map(); // url -> WebSocket
        this._listeners = []; // { subId, filter, onEvent }
        this._queue = new Map(); // url -> messages queued while connecting
    }

    connect(urls) {
        for (const url of urls) {
            if (this._sockets.has(url)) continue;
            this._openSocket(url);
        }
    }

    _openSocket(url) {
        let ws;
        try { ws = new WebSocket(url); } catch(e) { return; }
        this._sockets.set(url, ws);
        this._queue.set(url, []);

        ws.onopen = () => {
            console.log(`[NIP-46 WS] Connected: ${url}`);
            const q = this._queue.get(url) || [];
            this._queue.delete(url);
            for (const msg of q) {
                try { ws.send(msg); } catch(e) {}
            }
            for (const { subId, filter } of this._listeners) {
                try { ws.send(JSON.stringify(['REQ', subId, filter])); } catch(e) {}
            }
        };

        ws.onmessage = async (msg) => {
            try {
                const data = JSON.parse(msg.data);
                if (data[0] === 'EVENT' && data[2]) {
                    const ev = data[2];
                    const subId = data[1];
                    for (const listener of this._listeners) {
                        if (listener.subId === subId) {
                            listener.onEvent(ev, url);
                        }
                    }
                }
            } catch(e) {}
        };

        ws.onerror = () => {};
        ws.onclose = () => { this._sockets.delete(url); };
    }

    subscribe(subId, filter, onEvent) {
        this._listeners.push({ subId, filter, onEvent });
        const msg = JSON.stringify(['REQ', subId, filter]);
        for (const [url, ws] of this._sockets) {
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(msg); } catch(e) {}
            } else if (ws.readyState === WebSocket.CONNECTING) {
                const q = this._queue.get(url) || [];
                q.push(msg);
                this._queue.set(url, q);
            }
        }
    }

    unsubscribe(subId) {
        this._listeners = this._listeners.filter(l => l.subId !== subId);
        const msg = JSON.stringify(['CLOSE', subId]);
        for (const [, ws] of this._sockets) {
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(msg); } catch(e) {}
            }
        }
    }

    publish(event) {
        const msg = JSON.stringify(['EVENT', event]);
        let sent = 0;
        for (const [, ws] of this._sockets) {
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(msg); sent++; } catch(e) {}
            }
        }
        console.log(`[NIP-46 WS] Published to ${sent} relays`);
    }

    destroy() {
        for (const [, ws] of this._sockets) {
            try { ws.close(); } catch(e) {}
        }
        this._sockets.clear();
        this._listeners = [];
        this._queue.clear();
    }
}

// =========================================================================
// QR RENDERER
// =========================================================================

export async function renderQR(container, data, opts = {}) {
    const max = opts.size || 240;
    container.innerHTML = '';
    try {
        if (!window.qrcode) {
            const mod = await import('qrcode-generator');
            window.qrcode = mod.default || mod;
        }
        const qr = window.qrcode(0, 'L'); qr.addData(data); qr.make();
        const mc = qr.getModuleCount();
        const cs = Math.max(3, Math.min(5, Math.floor(max / mc)));
        const mg = 12, sz = mc * cs + mg * 2;
        const cv = document.createElement('canvas');
        cv.width = sz; cv.height = sz;
        cv.style.width = Math.min(max, sz) + 'px';
        cv.style.height = Math.min(max, sz) + 'px';
        cv.style.borderRadius = '10px';
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sz, sz);
        ctx.fillStyle = '#000';
        for (let r = 0; r < mc; r++)
            for (let c = 0; c < mc; c++)
                if (qr.isDark(r, c)) ctx.fillRect(mg + c * cs, mg + r * cs, cs, cs);
        container.appendChild(cv);
    } catch (e) {
        container.textContent = 'QR unavailable — copy the string below';
    }
}

// =========================================================================
// BUNKER CLIENT
// =========================================================================

export class BunkerClient {
    constructor(opts) {
        this.NostrTools = opts.NostrTools;
        this.appName = opts.appName || 'Nostr App';
        this.appUrl = opts.appUrl || '';
        this.perms = opts.perms || '';
        this.relays = opts.relays || ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub'];
        this.storageKey = opts.storageKey || null;
        this.sessionMaxAge = opts.sessionMaxAge || 24 * 60 * 60 * 1000;
        this.heartbeatMs = opts.heartbeatMs !== undefined ? opts.heartbeatMs : 30000;
        this.onAuthUrl = opts.onAuthUrl || (url => window.open(url, '_blank', 'width=600,height=700'));
        this.onStatusChange = opts.onStatusChange || (() => {});
        this.onDisconnect = opts.onDisconnect || (() => {});

        this._clientSk = null; this._clientPk = null;
        this._signerPk = null; this._userPk = null;
        this._relays = null;
        this._connecting = false; this._heartbeat = null;
        this._rawPool = null;
    }

    get connected() { return !!(this._signerPk && this._userPk); }
    get userPubkey() { return this._userPk; }
    get signerPubkey() { return this._signerPk; }

    // ------------------------------------------------------------------
    // FLOW 1: Client-initiated (nostrconnect://)
    // ------------------------------------------------------------------

    async startClientFlow() {
        if (this._connecting) throw new Error('Already connecting');
        if (this._signerPk) throw new Error('Already connected');
        this._connecting = true;
        this.onStatusChange('waiting', 'Generating connection…');

        const clientSk = this.NostrTools.generateSecretKey();
        const clientPk = this.NostrTools.getPublicKey(clientSk);
        const secret = randomHex(8);
        const relays = this.relays;
        this._clientSk = clientSk; this._clientPk = clientPk; this._relays = relays;

        const rp = relays.map(r => `relay=${encodeURIComponent(r)}`).join('&');
        const parts = [`nostrconnect://${clientPk}?${rp}`, `secret=${secret}`, `name=${encodeURIComponent(this.appName)}`];
        if (this.appUrl) parts.push(`url=${encodeURIComponent(this.appUrl)}`);
        if (this.perms) parts.push(`perms=${encodeURIComponent(this.perms)}`);
        const connectUri = parts.join('&');

        console.log('[NIP-46] Client pubkey:', clientPk);
        console.log('[NIP-46] Connecting to relays:', relays);

        // Open raw WebSocket connections FIRST
        this._rawPool = new RawRelayPool();
        this._rawPool.connect(relays);

        // Wait for connections to establish
        await new Promise(r => setTimeout(r, 800));

        const since = Math.floor(Date.now() / 1000) - 300;
        const subId = 'nip46-connect-' + randomHex(4);
        let settled = false;
        const self = this;

        let resolveFn, rejectFn;
        const waitForConnect = new Promise((resolve, reject) => {
            resolveFn = resolve;
            rejectFn = reject;
        });

        this._rawPool.subscribe(subId, { kinds: [24133], '#p': [clientPk], since }, async (ev, relayUrl) => {
            if (settled) return;
            try {
                const decrypted = await nip44Decrypt(clientSk, ev.pubkey, ev.content);
                const resp = JSON.parse(decrypted);
                console.log('[NIP-46] Response:', JSON.stringify(resp), 'relay:', relayUrl);

                if (resp.result === 'auth_url' && resp.error) {
                    self.onAuthUrl(resp.error);
                    return;
                }
                if (resp.error && resp.result !== 'auth_url') {
                    settled = true; self._connecting = false;
                    self._rawPool.unsubscribe(subId);
                    self.onStatusChange('error', resp.error);
                    rejectFn(new Error(resp.error));
                    return;
                }
                if (resp.result !== secret && resp.result !== 'ack') {
                    console.log('[NIP-46] Ignoring response, secret mismatch. Got:', resp.result, 'Expected:', secret);
                    return;
                }

                settled = true;
                self._rawPool.unsubscribe(subId);
                self._signerPk = ev.pubkey;
                self.onStatusChange('waiting', 'Fetching identity…');
                console.log('[NIP-46] Signer approved! pubkey:', ev.pubkey);

                try { self._userPk = await self._request('get_public_key'); }
                catch (e) {
                    console.warn('[NIP-46] get_public_key failed, using signer pubkey');
                    self._userPk = ev.pubkey;
                }

                self._finishConnect();
                resolveFn(self._userPk);
            } catch (e) {
                // decrypt failed — not for us
            }
        });

        this.onStatusChange('waiting', 'Waiting for remote signer…');
        return { connectUri, waitForConnect };
    }

    // ------------------------------------------------------------------
    // FLOW 2: Signer-initiated (bunker://)
    // ------------------------------------------------------------------

    async connectBunkerUrl(bunkerUrl) {
        if (this._connecting) throw new Error('Already connecting');
        if (this._signerPk) throw new Error('Already connected');
        this._connecting = true;
        this.onStatusChange('waiting', 'Connecting…');

        const url = new URL(bunkerUrl);
        if (url.protocol !== 'bunker:') throw new Error('URL must start with bunker://');
        const signerPk = url.hostname || url.pathname.replace(/^\/\//, '');
        if (!signerPk || signerPk.length !== 64) throw new Error('Invalid signer pubkey');
        const relays = url.searchParams.getAll('relay');
        if (!relays.length) throw new Error('No relays in bunker URL');
        const secret = url.searchParams.get('secret') || '';

        const clientSk = this.NostrTools.generateSecretKey();
        const clientPk = this.NostrTools.getPublicKey(clientSk);
        this._clientSk = clientSk; this._clientPk = clientPk;
        this._signerPk = signerPk; this._relays = relays;

        this._rawPool = new RawRelayPool();
        this._rawPool.connect(relays);
        await new Promise(r => setTimeout(r, 800));

        const since = Math.floor(Date.now() / 1000) - 300;
        const subId = 'nip46-bunker-' + randomHex(4);
        let settled = false;

        return new Promise((resolve, reject) => {
            this._rawPool.subscribe(subId, { kinds: [24133], '#p': [clientPk], since }, async (ev) => {
                if (settled) return;
                try {
                    const resp = JSON.parse(await nip44Decrypt(clientSk, ev.pubkey, ev.content));
                    if (resp.result === 'auth_url' && resp.error) { this.onAuthUrl(resp.error); return; }
                    if (resp.error && resp.result !== 'auth_url') {
                        settled = true; this._rawPool.unsubscribe(subId);
                        this._connecting = false;
                        this.onStatusChange('error', resp.error);
                        reject(new Error(resp.error)); return;
                    }
                    settled = true;
                    this._rawPool.unsubscribe(subId);
                    try { this._userPk = await this._request('get_public_key'); }
                    catch (e) { this._userPk = signerPk; }
                    this._finishConnect();
                    resolve(this._userPk);
                } catch (e) {}
            });

            const reqId = randomHex(8);
            nip44Encrypt(clientSk, signerPk, JSON.stringify({
                id: reqId, method: 'connect', params: [signerPk, secret, this.perms]
            })).then(enc => {
                const ev = this.NostrTools.finalizeEvent({
                    kind: 24133, created_at: Math.floor(Date.now() / 1000),
                    tags: [['p', signerPk]], content: enc,
                }, clientSk);
                this._rawPool.publish(ev);
            });
        });
    }

    // ------------------------------------------------------------------
    // POST-CONNECT
    // ------------------------------------------------------------------

    _finishConnect() {
        this._connecting = false;
        this.saveSession();
        this.startHeartbeat();
        this.onStatusChange('connected', 'Signed in');
    }

    // ------------------------------------------------------------------
    // SIGN EVENTS
    // ------------------------------------------------------------------

    async signEvent(tmpl) {
        if (!this.connected) throw new Error('Not connected');
        try {
            const r = await this._request('sign_event', [JSON.stringify({
                kind: tmpl.kind, content: tmpl.content || '', tags: tmpl.tags || [],
                created_at: tmpl.created_at || Math.floor(Date.now() / 1000),
            })]);
            return JSON.parse(r);
        } catch (e) {
            console.warn('[NIP-46] signEvent failed:', e.message);
            this._handleDisconnect();
            throw new Error('Signer disconnected');
        }
    }

    async ping() { return this._request('ping'); }

    /**
     * NIP-44 encrypt via remote signer (NIP-46 nip44_encrypt method).
     * Not all signers support this — throws the original error on failure.
     */
    async nip44Encrypt(recipientPubkey, plaintext) {
        if (!this.connected) throw new Error('Bunker not connected');
        return this._request('nip44_encrypt', [recipientPubkey, plaintext]);
    }

    /**
     * NIP-44 decrypt via remote signer (NIP-46 nip44_decrypt method).
     * Not all signers support this — throws the original error on failure.
     */
    async nip44Decrypt(senderPubkey, ciphertext) {
        if (!this.connected) throw new Error('Bunker not connected');
        return this._request('nip44_decrypt', [senderPubkey, ciphertext]);
    }

    // ------------------------------------------------------------------
    // HEARTBEAT
    // ------------------------------------------------------------------

    startHeartbeat() {
        this.stopHeartbeat();
        if (!this.heartbeatMs) return;
        this._heartbeat = setInterval(async () => {
            if (!this.connected) { this.stopHeartbeat(); return; }
            try {
                const pong = await Promise.race([
                    this._request('ping'),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
                ]);
                if (pong === 'pong') console.log('[NIP-46] Heartbeat OK');
                else throw new Error('bad response');
            } catch (e) {
                console.log('[NIP-46] Heartbeat failed:', e.message);
                this._handleDisconnect();
            }
        }, this.heartbeatMs);
    }

    stopHeartbeat() {
        if (this._heartbeat) { clearInterval(this._heartbeat); this._heartbeat = null; }
    }

    _handleDisconnect() {
        this.stopHeartbeat();
        this._signerPk = null; this._userPk = null;
        this._clientSk = null; this._clientPk = null;
        this._relays = null;
        this.clearSession();
        this.onStatusChange('error', 'Signer disconnected');
        this.onDisconnect();
    }

    // ------------------------------------------------------------------
    // SESSION PERSISTENCE
    // ------------------------------------------------------------------

    saveSession() {
        if (!this.storageKey || !this._clientSk || !this._signerPk || !this._userPk) return;
        try {
            localStorage.setItem(this.storageKey, JSON.stringify({
                sk: skToHex(this._clientSk), pk: this._clientPk,
                signer: this._signerPk, user: this._userPk,
                relays: this._relays, t: Date.now(),
            }));
            console.log('[NIP-46] Session saved');
        } catch (e) {}
    }

    async restoreSession() {
        if (!this.storageKey) return false;
        let d;
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (!raw) return false;
            d = JSON.parse(raw);
        } catch (e) { return false; }

        if (!d.sk || !d.pk || !d.signer || !d.user || !d.relays?.length) {
            this.clearSession(); return false;
        }
        if (d.t && Date.now() - d.t > this.sessionMaxAge) {
            this.clearSession(); return false;
        }

        console.log('[NIP-46] Restoring session…');
        this._clientSk = hexToSk(d.sk); this._clientPk = d.pk;
        this._signerPk = d.signer; this._userPk = d.user; this._relays = d.relays;

        this._rawPool = new RawRelayPool();
        this._rawPool.connect(d.relays);
        await new Promise(r => setTimeout(r, 800));

        try {
            const pong = await Promise.race([
                this._request('ping'),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
            ]);
            if (pong !== 'pong') throw new Error('bad pong');
        } catch (e) {
            console.log('[NIP-46] Saved session dead:', e.message);
            this._clientSk = null; this._clientPk = null;
            this._signerPk = null; this._userPk = null; this._relays = null;
            if (this._rawPool) { this._rawPool.destroy(); this._rawPool = null; }
            this.clearSession();
            return false;
        }

        console.log('[NIP-46] Session restored');
        this.startHeartbeat();
        this.onStatusChange('connected', 'Session restored');
        return true;
    }

    clearSession() {
        if (this.storageKey) try { localStorage.removeItem(this.storageKey); } catch (e) {}
    }

    // ------------------------------------------------------------------
    // CLEANUP
    // ------------------------------------------------------------------

    cancel() {
        this._connecting = false;
        if (this._rawPool) { this._rawPool.destroy(); this._rawPool = null; }
        this.onStatusChange('idle', 'Cancelled');
    }

    destroy() {
        this.cancel();
        this.stopHeartbeat();
        this._clientSk = null; this._clientPk = null;
        this._signerPk = null; this._userPk = null; this._relays = null;
        this.clearSession();
        this.onStatusChange('idle', 'Disconnected');
    }

    // ------------------------------------------------------------------
    // INTERNAL — NIP-46 JSON-RPC over raw WebSockets
    // ------------------------------------------------------------------

    async _request(method, params = []) {
        if (!this._signerPk) throw new Error('No signer');
        const { _clientSk: sk, _clientPk: pk, _signerPk: spk, _relays: relays } = this;
        const id = randomHex(8);
        const enc = await nip44Encrypt(sk, spk, JSON.stringify({ id, method, params }));
        const signed = this.NostrTools.finalizeEvent({
            kind: 24133, created_at: Math.floor(Date.now() / 1000),
            tags: [['p', spk]], content: enc,
        }, sk);

        const since = Math.floor(Date.now() / 1000) - 60;
        const subId = 'nip46-req-' + id;

        return new Promise((resolve, reject) => {
            let done = false;
            const to = setTimeout(() => {
                if (!done) {
                    done = true;
                    if (this._rawPool) this._rawPool.unsubscribe(subId);
                    reject(new Error(`${method} timed out (45s)`));
                }
            }, 45000);

            if (this._rawPool) {
                this._rawPool.subscribe(subId, { kinds: [24133], '#p': [pk], since }, async (ev) => {
                    try {
                        const r = JSON.parse(await nip44Decrypt(sk, ev.pubkey, ev.content));
                        if (r.id !== id) return;
                        if (r.result === 'auth_url' && r.error) { this.onAuthUrl(r.error); return; }
                        if (done) return;
                        done = true; clearTimeout(to);
                        if (this._rawPool) this._rawPool.unsubscribe(subId);
                        r.error ? reject(new Error(r.error)) : resolve(r.result);
                    } catch (e) {}
                });
            }

            this._rawPool.publish(signed);
        });
    }
}
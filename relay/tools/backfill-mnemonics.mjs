// Backfill: fetch every spark-mnemonic backup event (kind:30078,
// d=nostr-district:spark-mnemonic) from the public backup relays and
// republish to the district relay. Signatures preserved — the relay
// verifies each one; NIP-33 keeps only the newest per author.
import { webcrypto } from 'node:crypto'; globalThis.crypto ??= webcrypto;
import WebSocket from 'ws';

const SOURCES = [
  'wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom',
  'wss://nostr.wine', 'wss://relay.0xchat.com', 'wss://nostr21.com',
];
const TARGET = 'wss://nostr.thedistrict.online';
const FILTER = { kinds: [30078], '#d': ['nostr-district:spark-mnemonic'] };

const events = new Map(); // id → event
async function harvest(url) {
  return new Promise((resolve) => {
    let got = 0;
    const ws = new WebSocket(url, { handshakeTimeout: 8000 });
    const done = () => { try { ws.close(); } catch {} resolve(got); };
    const timer = setTimeout(done, 15000);
    ws.on('open', () => ws.send(JSON.stringify(['REQ', 'bf', FILTER])));
    ws.on('message', (m) => {
      try {
        const msg = JSON.parse(m);
        if (msg[0] === 'EVENT' && msg[2]?.kind === 30078) { events.set(msg[2].id, msg[2]); got++; }
        if (msg[0] === 'EOSE') { clearTimeout(timer); done(); }
      } catch {}
    });
    ws.on('error', () => { clearTimeout(timer); done(); });
  });
}

for (const url of SOURCES) {
  const n = await harvest(url);
  console.log(url.padEnd(28), '→', n, 'events');
}
const authors = new Set([...events.values()].map(e => e.pubkey));
console.log(`\ncollected ${events.size} events from ${authors.size} distinct citizens\n`);

// republish to the district relay
const results = { ok: 0, rejected: 0, dup: 0 };
await new Promise((resolve) => {
  const ws = new WebSocket(TARGET);
  const pending = new Map();
  ws.on('open', () => {
    for (const ev of events.values()) { pending.set(ev.id, true); ws.send(JSON.stringify(['EVENT', ev])); }
    if (events.size === 0) { ws.close(); resolve(); }
  });
  ws.on('message', (m) => {
    try {
      const msg = JSON.parse(m);
      if (msg[0] === 'OK') {
        if (msg[2]) results.ok++;
        else if (/duplicate|replaced|older/i.test(msg[3] || '')) results.dup++;
        else { results.rejected++; console.log('REJECT:', (msg[3] || '').slice(0, 60)); }
        pending.delete(msg[1]);
        if (pending.size === 0) { ws.close(); resolve(); }
      }
    } catch {}
  });
  setTimeout(() => { ws.close(); resolve(); }, 30000);
});
console.log('republished →', JSON.stringify(results));

// verify: count what the district relay now serves
await new Promise((resolve) => {
  const ws = new WebSocket(TARGET);
  let count = 0;
  ws.on('open', () => ws.send(JSON.stringify(['REQ', 'verify', FILTER])));
  ws.on('message', (m) => {
    const msg = JSON.parse(m);
    if (msg[0] === 'EVENT') count++;
    if (msg[0] === 'EOSE') { console.log(`district relay now serves ${count} mnemonic backups`); ws.close(); resolve(); }
  });
  setTimeout(resolve, 15000);
});
process.exit(0);

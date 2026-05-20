/**
 * /api/relay — Nostr relay WebSocket bridge.
 *
 * Browsers send a `wss://<our-host>/api/relay?relay=wss://target.example`
 * upgrade request to this Pages Function. We open an outbound WebSocket
 * to the named relay and shuttle frames between the two sides. The upstream
 * relay therefore observes Cloudflare's egress IP rather than the user's,
 * which is the only thing this layer is here to provide.
 *
 * Built on the standard Cloudflare Pages Function WebSocket-handling shape:
 *   - HTTP 426 unless the request is asking for an upgrade
 *   - `new WebSocketPair()` to obtain a connected client/server pair
 *   - return the client half in a 101 response while the server half stays
 *     in this handler's closure so we can read/write the local side
 *
 * https://developers.cloudflare.com/workers/runtime-apis/websockets/
 */

const SUPPORTED_PROTOCOLS = new Set(['ws:', 'wss:']);

const httpResponse = (body, status) => new Response(body, { status });

export async function onRequest(context) {
  const { request } = context;

  // Browsers must announce a WebSocket upgrade. Anything else is the
  // wrong endpoint and gets a clear 426 instead of a confusing 200.
  const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();
  if (upgrade !== 'websocket') {
    return httpResponse('This endpoint only handles WebSocket upgrades.', 426);
  }

  const target = resolveUpstreamTarget(request.url);
  if (target.error) return httpResponse(target.error, 400);

  // WebSocketPair returns a pair of connected sockets:
  //   `outward` is the half we hand back to the browser in the 101 response
  //   `inward`  is the half we keep here for read/write inside the function
  const pair    = new WebSocketPair();
  const outward = pair[0];
  const inward  = pair[1];
  inward.accept();

  // Outbound socket to the actual Nostr relay. The WebSocket constructor
  // never throws synchronously in the Workers runtime — failures surface
  // as an 'error' event on the resulting object.
  const upstream = new WebSocket(target.url);

  // Wire up bidirectional forwarding. The first few client frames can
  // arrive before the upstream handshake completes, so we hold them in
  // a small outbox and flush as soon as we're connected.
  //
  // `context.waitUntil` keeps the Worker alive until both sockets are
  // closed. Without this, Cloudflare can recycle the isolate after the
  // 101 response is returned, and long-lived subscriptions on quiet
  // relays (e.g. relay.coinos.io) get their forwarding handlers killed
  // mid-flight — which is what the flapping symptom in production was.
  const bridgeLifetime = bridgeSockets(inward, upstream);
  if (context.waitUntil) context.waitUntil(bridgeLifetime);

  return new Response(null, { status: 101, webSocket: outward });
}

/**
 * Pull the desired upstream relay URL out of the incoming request's
 * `?relay=` parameter and validate it. Returns either `{ url }` on
 * success or `{ error }` describing why we rejected it.
 *
 * Restricting the scheme to ws/wss keeps the bridge from being abused
 * as a general-purpose Cloudflare proxy for arbitrary protocols.
 */
function resolveUpstreamTarget(incomingUrl) {
  const param = new URL(incomingUrl).searchParams.get('relay');
  if (!param) return { error: 'Missing required `relay` query parameter.' };

  let parsed;
  try {
    parsed = new URL(param);
  } catch {
    return { error: 'The `relay` parameter is not a valid URL.' };
  }

  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    return { error: 'Only ws:// and wss:// relay URLs are accepted.' };
  }

  return { url: parsed.toString() };
}

/**
 * Pump frames between the browser-facing socket and the upstream relay
 * socket. Handles the pre-open buffering of client → upstream frames and
 * propagates close / error events symmetrically.
 *
 * Returns a Promise that resolves once the bridge has fully torn down.
 * Hand this to `context.waitUntil` so the Worker isolate is kept alive
 * for the whole WebSocket lifetime rather than only until the 101.
 */
function bridgeSockets(local, remote) {
  return new Promise((resolve) => {
    const queuedBeforeOpen = [];
    let remoteReady = false;
    let settled = false;

    // Close helpers — Workers throws if you call close() on an already-closed
    // socket, so we always wrap in try/catch.
    const safeClose = (sock, code, reason) => {
      try { sock.close(code, reason); } catch { /* already gone */ }
    };
    const tearDown = (code, reason) => {
      safeClose(local,  code, reason);
      safeClose(remote, code, reason);
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    // Local → Remote. Buffer until the upstream handshake completes,
    // then drain in arrival order on 'open'.
    local.addEventListener('message', (e) => {
      if (remoteReady && remote.readyState === WebSocket.OPEN) {
        try { remote.send(e.data); } catch { /* remote dropped */ }
      } else {
        queuedBeforeOpen.push(e.data);
      }
    });

    remote.addEventListener('open', () => {
      remoteReady = true;
      while (queuedBeforeOpen.length > 0) {
        const next = queuedBeforeOpen.shift();
        try { remote.send(next); } catch { /* remote dropped mid-flush */ break; }
      }
    });

    // Remote → Local. No buffering needed — `local.accept()` has already
    // run, so it's ready to receive immediately.
    remote.addEventListener('message', (e) => {
      if (local.readyState === WebSocket.OPEN) {
        try { local.send(e.data); } catch { /* local dropped */ }
      }
    });

    // Mirror close events both ways so neither side is left dangling.
    local.addEventListener('close',  (e) => tearDown(e.code, e.reason));
    remote.addEventListener('close', (e) => tearDown(e.code, e.reason));

    // Errors on either side terminate the bridge with an "internal error"
    // close code so the other side can decide whether to retry.
    local.addEventListener('error',  () => tearDown(1011, 'Browser-side socket error'));
    remote.addEventListener('error', () => tearDown(1011, 'Upstream relay socket error'));
  });
}

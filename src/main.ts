import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { HubScene } from './scenes/HubScene';
import { GAME_WIDTH, GAME_HEIGHT } from './config/game.config';
import { LoginScreen } from './ui/LoginScreen';
import { authStore } from './stores/authStore';
import { RoomScene } from './scenes/RoomScene';
import { WoodsScene } from './scenes/WoodsScene';
import { CabinScene } from './scenes/CabinScene';
import { AlleyScene } from './scenes/AlleyScene';
import { SoundEngine } from './audio/SoundEngine';
import { disconnectPresence } from './nostr/presenceService';
import './stores/themeStore'; // init theme CSS vars early

// PWA service worker — registers a no-op SW so Chrome/Edge consider the app
// installable. We do NOT cache anything: the game is fully real-time and
// offline play is not supported.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Graceful disconnect when the page is actually unloaded (tab close, navigate away).
// e.persisted = true means the page entered the back-forward cache (iOS bfcache) —
// we skip disconnect in that case so returning users reconnect cleanly.
// Mobile app-kills that bypass this are caught by the server heartbeat instead.
window.addEventListener('pagehide', (e) => {
  if (!e.persisted) disconnectPresence();
});

// Unlock the AudioContext on user gestures. Mobile browsers start AudioContext
// suspended; ctx.resume() only works inside a real gesture handler. We keep
// retrying on every touchend/click/pointerdown until audioUnlocked is confirmed —
// touchstart is unreliable on iOS Safari for this purpose.
{
  // Keep listeners permanent — iOS can re-suspend the AudioContext at any time
  // (phone call, lock screen, backgrounding). Every gesture re-runs unlock() which
  // is idempotent when running and picks up any _pendingRoomRestart if suspended.
  const unlockAudio = () => { SoundEngine.get().unlock(); };
  document.addEventListener('touchend',    unlockAudio, { passive: true });
  document.addEventListener('click',       unlockAudio);
  document.addEventListener('pointerdown', unlockAudio, { passive: true });

  // Enable the audio debug HUD via ?audioDebug=1 in the URL.
  if (new URLSearchParams(window.location.search).has('audioDebug')) {
    SoundEngine.get().enableDebugHud();
  }

  // When the tab returns to foreground the AudioContext may have been suspended
  // by the browser. Attempt a resume — works without a gesture on Android Chrome;
  // on iOS the next user touch will handle it via the listeners above.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) SoundEngine.get().unlock();
  });

  // Eager resume attempt at page load, no gesture. Browsers ALLOW this for
  // sites they trust with audio (Chrome's media-engagement score, Brave's /
  // Firefox's per-site autoplay permission) — so for returning players the
  // login-screen fireworks are audible immediately, including right after a
  // logout reload. On a fresh visitor this rejects harmlessly and the gesture
  // listeners above take over.
  SoundEngine.get().unlock();
}
import {
  loginWithExtension,
  loginWithNsec,
  loginWithNewAccount,
  loginWithBunkerUrl,
  loginAsGuest,
  startBunkerFlow,
  cancelBunkerFlow,
  loadNostrTools,
} from './nostr/nostrService';
import { getStoredPasskeys, loginWithPasskey, isPasskeySupported, saveWithPasskey } from './stores/passkeyStore';
import { WalletHUD } from './ui/WalletHUD';

// Auto-fullscreen on landscape rotation (touch devices only)
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
const isStandalone = (navigator as any).standalone === true;

if ('ontouchstart' in window && !isIOS && document.documentElement.requestFullscreen) {
  // Android / non-iOS: use real Fullscreen API on rotation
  const tryFullscreen = () => {
    const landscape = screen.orientation
      ? screen.orientation.type.startsWith('landscape')
      : Math.abs((window.orientation as number) ?? 0) === 90;
    if (landscape && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };
  if (screen.orientation) {
    screen.orientation.addEventListener('change', tryFullscreen);
  } else {
    window.addEventListener('orientationchange', tryFullscreen);
  }
}

if (isIOS && !isStandalone && !localStorage.getItem('nd_pwa_hint_dismissed')) {
  // iOS: show "Add to Home Screen" hint once, only in landscape
  const showHint = () => {
    const landscape = screen.orientation
      ? screen.orientation.type.startsWith('landscape')
      : Math.abs((window.orientation as number) ?? 0) === 90;
    if (!landscape) return;
    if (document.getElementById('nd-pwa-hint')) return;

    const banner = document.createElement('div');
    banner.id = 'nd-pwa-hint';
    banner.style.cssText = `
      position:fixed;bottom:72px;left:50%;transform:translateX(-50%);
      z-index:9999;background:linear-gradient(135deg,#0D0221ee,#1a0a3aee);
      border:1px solid #9b7fe888;border-radius:10px;padding:10px 14px;
      font-family:'Courier New',monospace;font-size:12px;color:#c9b8f0;
      max-width:min(320px,88vw);text-align:center;line-height:1.6;
      box-shadow:0 4px 20px rgba(0,0,0,0.7);
    `;
    banner.innerHTML = `
      <div style="margin-bottom:6px;color:#9b7fe8;font-size:10px;letter-spacing:1px;">FOR FULLSCREEN ON IOS</div>
      Tap <strong style="color:#fff;">Share</strong> <span style="font-size:14px;">⎙</span>
      then <strong style="color:#fff;">Add to Home Screen</strong>
      <button id="nd-pwa-dismiss" style="
        display:block;margin:8px auto 0;background:none;
        border:1px solid #9b7fe855;border-radius:4px;
        color:#9b7fe8;font-family:'Courier New',monospace;font-size:10px;
        padding:3px 12px;cursor:pointer;
      ">Got it</button>
    `;
    document.body.appendChild(banner);
    document.getElementById('nd-pwa-dismiss')?.addEventListener('click', () => {
      banner.remove();
      localStorage.setItem('nd_pwa_hint_dismissed', '1');
    });
  };

  // Show after a short delay so it doesn't flash immediately on load
  setTimeout(showHint, 3000);
  if (screen.orientation) {
    screen.orientation.addEventListener('change', () => setTimeout(showHint, 500));
  } else {
    window.addEventListener('orientationchange', () => setTimeout(showHint, 500));
  }
}

// Vite HMR guard — this flag persists on window across module re-evaluations
const w = window as any;
if (w.__nostr_district_started) {
  // Module re-evaluated by HMR but game already started — do nothing
  console.log('[Main] HMR reload detected, skipping login screen');
} else {


let game: Phaser.Game | null = null;
let gameStarting = false;
let loginInProgress = false;

function safeError(e: any): string {
  const msg: string = e?.message || String(e) || 'Unknown error';
  // Strip any nsec1 keys from error messages before showing to user
  return msg.replace(/nsec1[a-z0-9]+/gi, '[private key]');
}

// Mobile: when the software keyboard appears, iOS scrolls the visual viewport
// to try to show the focused input — which makes the top of the canvas look
// clipped. Counter that by translating #game-container by -offsetTop so the
// game stays visually anchored. Keep the container at its full size so the
// keyboard simply overlays the bottom of the canvas instead of squishing it.
if ('ontouchstart' in window && window.visualViewport) {
  const vv = window.visualViewport;
  const anchorToVisualViewport = () => {
    const container = document.getElementById('game-container');
    if (!container) return;
    container.style.transform = vv.offsetTop
      ? `translateY(${vv.offsetTop}px)`
      : '';
  };
  vv.addEventListener('resize', anchorToVisualViewport);
  vv.addEventListener('scroll', anchorToVisualViewport);
}

function startGame(): void {
  if (gameStarting || game) return;
  gameStarting = true;

  // Persistent wallet balance HUD (top-right pill) — self-syncs with auth state
  WalletHUD.init();

  let container = document.getElementById('game-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'game-container';
    document.body.appendChild(container);
  }

  setTimeout(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        gameStarting = false;
        game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: 'game-container',
          width: GAME_WIDTH,
          height: GAME_HEIGHT,
          pixelArt: true,
          roundPixels: true,
          antialias: false,
          // Cap the game loop on high-refresh displays. Phaser otherwise drives the loop
          // off requestAnimationFrame, which fires at the DISPLAY refresh rate — on a 120Hz
          // ProMotion Mac that's 120fps, running every per-frame system twice as often
          // and ~doubling CPU/energy for no visible benefit at this art style.
          // The limit must sit BETWEEN 60 and 120, never AT 60: Phaser's limiter skips any
          // rAF tick whose accumulated delta is under 1000/limit ms, and on a 60Hz panel
          // the ~16.7ms ticks jitter both sides of 16.67 — limit:60 randomly drops frames
          // (render stutters between 30-60fps and the camera visibly drags on walks).
          // At limit:90 a 60Hz tick (16.7ms ≥ 11.1ms) always renders, while 120Hz ticks
          // (8.3ms) accumulate two-per-render → still an effective 60fps cap there.
          fps: { limit: 90, target: 60 },
          scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.NO_CENTER,
            width: GAME_WIDTH,
            height: GAME_HEIGHT,
          },
          scene: [BootScene, HubScene, RoomScene, WoodsScene, CabinScene, AlleyScene],
          // We manage all audio via our SoundEngine singleton. Disabling Phaser's
          // internal WebAudioSoundManager prevents it from creating a second
          // AudioContext that competes with ours on iOS Safari.
          audio: { disableWebAudio: true, noAudio: true },
          callbacks: {
            preBoot: (g) => {
              const state = authStore.getState();
              g.registry.set('playerName', state.displayName || 'guest');
              g.registry.set('playerPubkey', state.pubkey || state.displayName || 'guest');
            },
          },
        });

        // Free the WebGL context + all canvas textures on unload/reload. Logout does a
        // location.reload(), and Safari REUSES the same Web Content process across it —
        // it's slow to reclaim a heavy WebGL app's GPU/canvas memory, so repeated
        // logout→reload→login piles up gigabytes. Tearing the game down explicitly and
        // forcing context loss frees it before the reload instead of leaving it for GC.
        window.addEventListener('pagehide', () => {
          if (!game) return;
          const canvas = game.canvas;
          const gl = (canvas?.getContext('webgl2') || canvas?.getContext('webgl')) as WebGLRenderingContext | null;
          try { game.destroy(true, true); } catch { /* best effort on unload */ }
          try { (game as unknown as { runDestroy?: () => void })?.runDestroy?.(); } catch { /* force synchronous */ }
          game = null;
          try { (gl?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext(); } catch { /* best effort */ }
          try { if (canvas) { canvas.width = 0; canvas.height = 0; } } catch { /* */ }
        });

        if (import.meta.env.DEV && game) {
          (window as unknown as { __nd_game?: Phaser.Game }).__nd_game = game;
          // Side-effect import wires window.__refreshClothing() and the
          // Vite HMR listener for /public/assets/ clothing PNG changes.
          import('./entities/avatar/devRefresh');
        }
      });
    });
  }, 100);
}

const _storedPasskeys = getStoredPasskeys();

const MAX_PASSKEYS = 3;

async function _offerPasskey(nsec: string, displayName: string): Promise<void> {
  // Re-read storage rather than trusting the startup snapshot — user may have
  // saved (or deleted) a passkey within this session.
  if (getStoredPasskeys().length >= MAX_PASSKEYS) return;
  if (!(await isPasskeySupported())) return;
  await loginScreen.showSavePasskeyPrompt(nsec, displayName);
}

const loginScreen = new LoginScreen({
  storedPasskeys: _storedPasskeys,
  onPasskeyLogin: async (credentialId: string) => {
    if (loginInProgress) return;
    loginInProgress = true;
    try {
      const nsec = await loginWithPasskey(credentialId);
      await loginWithNsec(nsec);
      w.__nostr_district_started = true;
      loginScreen.destroy();
      startGame();
    } catch (e: any) {
      loginInProgress = false;
      loginScreen.setStatus(safeError(e), true);
    }
  },
  onExtensionLogin: async () => {
    if (loginInProgress) return;
    loginInProgress = true;
    try {
      await loginWithExtension();
      w.__nostr_district_started = true;
      loginScreen.destroy();
      startGame();
    } catch (e: any) {
      loginInProgress = false;
      loginScreen.setStatus(safeError(e), true);
    }
  },
  onNsecLogin: async (nsec: string, username?: string) => {
    if (loginInProgress) return;
    loginInProgress = true;
    try {
      // A username is only passed when rotating to a fresh identity — publish a
      // profile (kind:0 + Lightning address) for it; otherwise plain key login.
      if (username) await loginWithNewAccount(nsec, username);
      else await loginWithNsec(nsec);
      w.__nostr_district_started = true;
      loginScreen.destroy();
      startGame();
    } catch (e: any) {
      loginInProgress = false;
      loginScreen.setStatus(safeError(e), true);
    }
  },
  onBunkerLogin: async (url: string) => {
    // If a QR/client flow is already in progress (loginInProgress=true was
    // set when the user opened the Remote Signer panel), cancel it so the
    // user-initiated URL paste takes priority. Without this, clicking Go
    // silently no-ops because the in-progress guard rejects it.
    if (loginInProgress) {
      cancelBunkerFlow();
      loginInProgress = false;
    }
    loginInProgress = true;
    // Re-set the status AFTER cancel — cancel()'s onStatusChange fires
    // 'Cancelled' synchronously and would otherwise leave the UI showing
    // "Cancelled" while the URL connect is actually running in the background.
    loginScreen.setBunkerStatus('Connecting to signer…');
    try {
      await loginWithBunkerUrl(url);
      w.__nostr_district_started = true;
      loginScreen.destroy();
      startGame();
    } catch (e: any) {
      if (e?.message === 'cancelled') return;
      loginInProgress = false;
      loginScreen.setBunkerStatus(safeError(e));
    }
  },
  onBunkerClientFlow: async () => {
    if (loginInProgress) return;
    loginInProgress = true;
    // Client-initiated: generate QR code for signer app
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const qrContainer = loginScreen.getQRContainer();
      const { connectUri, waitForConnect } = await startBunkerFlow(
        (status, msg) => {
          loginScreen.setBunkerStatus(msg);
        },
        qrContainer,
      );

      // If session was restored, connectUri is empty and we're already logged in
      if (!connectUri) {
        w.__nostr_district_started = true;
        loginScreen.destroy();
        startGame();
        return;
      }

      // Show the connect URI so user can copy it
      loginScreen.showConnectUri(connectUri);
      loginScreen.setBunkerStatus('Waiting for signer approval...');

      // Timeout after 3 minutes — QR expires
      const TIMEOUT_MS = 3 * 60 * 1000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('timeout'));
        }, TIMEOUT_MS);
      });

      // Race: either signer approves or timeout
      await Promise.race([waitForConnect, timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);
      w.__nostr_district_started = true;
      loginScreen.destroy();
      startGame();
    } catch (e: any) {
      if (timeoutId) clearTimeout(timeoutId);
      loginInProgress = false;
      if (e.message === 'timeout') {
        cancelBunkerFlow();
        loginScreen.setBunkerStatus('Connection expired. Click Back and try again.');
      } else {
        loginScreen.setBunkerStatus(e.message);
      }
    }
  },
  onBunkerCancel: () => {
    loginInProgress = false;
    cancelBunkerFlow();
  },
  onGuestLogin: async () => {
    if (loginInProgress) return;
    loginInProgress = true;
    try {
      await loginAsGuest();
      w.__nostr_district_started = true;
      loginScreen.destroy();
      startGame();
    } catch (e: any) {
      loginInProgress = false;
      loginScreen.setStatus(safeError(e), true);
    }
  },
  onCreateWithPasskey: async (username: string): Promise<string> => {
    await loadNostrTools();
    const { generateSecretKey, nip19 } = await import('nostr-tools');
    return nip19.nsecEncode(generateSecretKey());
  },
  onConfirmCreate: async (nsec: string, username: string) => {
    if (loginInProgress) return;
    loginInProgress = true;
    try {
      await loginWithNewAccount(nsec, username);
      // A freshly created free account logs in with its nsec, so make the
      // quick-login offer private-key login ("Private key (nsec)") next time.
      localStorage.setItem('nd_last_login', 'nsec');
      // Passkey save removed from the create flow — passkeys are now used only as
      // the Face ID recovery wrap on the Google backup. (_offerPasskey kept for reuse.)
      w.__nostr_district_started = true;
      loginScreen.destroy();
      startGame();
    } catch (e: any) {
      loginInProgress = false;
      loginScreen.setStatus(safeError(e), true);
    }
  },
});

// Vite HMR cleanup: a hot update re-evaluates this entry but the `__nostr_district_started`
// flag lives on `window` (so it survives HMR), which meant the previous Phaser game and
// LoginScreen were never torn down — they piled up across a long dev session (each game =
// hundreds of canvas textures + audio buffers = the GBs seen in Activity Monitor). Tear
// them down + reset the flag before replacement so the re-evaluated module rebuilds clean.
// Dev-only: production has no HMR (and logout does a full reload), so it's never affected.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    // Phaser's game.destroy() is DEFERRED to the next game-loop tick — which never runs
    // during an HMR dispose, so the WebGL context + canvas textures are never freed and
    // each hot update leaks a whole game (the GBs in Activity Monitor). Force it:
    const canvas = game?.canvas as HTMLCanvasElement | undefined;
    const gl = (canvas?.getContext('webgl2') || canvas?.getContext('webgl')) as WebGLRenderingContext | null;
    try { game?.destroy(true, true); } catch { /* best effort */ }
    try { (game as unknown as { runDestroy?: () => void })?.runDestroy?.(); } catch { /* force synchronous teardown */ }
    game = null;
    // Drop the GPU context + textures immediately (don't wait for Safari's lazy GC).
    try { (gl?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext(); } catch { /* */ }
    // Zero the canvas backing store so its native memory is released too.
    try { if (canvas) { canvas.width = 0; canvas.height = 0; } } catch { /* */ }
    try { loginScreen?.destroy(); } catch { /* best effort */ }
    w.__nostr_district_started = false;
  });
}

} // end of HMR guard else block
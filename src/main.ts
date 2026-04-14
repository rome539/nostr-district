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
}
import {
  loginWithExtension,
  loginWithNsec,
  loginWithBunkerUrl,
  loginAsGuest,
  startBunkerFlow,
  cancelBunkerFlow,
} from './nostr/nostrService';

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

// Mobile: keep #game-container fit inside the visual viewport so the software
// keyboard overlays from below instead of iOS scrolling the page and clipping
// the top of the canvas. Runs regardless of whether the game is started yet.
if ('ontouchstart' in window && window.visualViewport) {
  const vv = window.visualViewport;
  const fitToVisualViewport = () => {
    const container = document.getElementById('game-container');
    if (!container) return;
    const kbHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    container.style.top = `${vv.offsetTop}px`;
    container.style.bottom = `${kbHeight}px`;
    if (game) game.scale.refresh();
  };
  vv.addEventListener('resize', fitToVisualViewport);
  vv.addEventListener('scroll', fitToVisualViewport);
}

function startGame(): void {
  if (gameStarting || game) return;
  gameStarting = true;

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
      });
    });
  }, 100);
}

const loginScreen = new LoginScreen({
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
      loginScreen.setStatus(e.message, true);
    }
  },
  onNsecLogin: async (nsec: string) => {
    if (loginInProgress) return;
    loginInProgress = true;
    try {
      await loginWithNsec(nsec);
      w.__nostr_district_started = true;
      loginScreen.destroy();
      startGame();
    } catch (e: any) {
      loginInProgress = false;
      loginScreen.setStatus(e.message, true);
    }
  },
  onBunkerLogin: async (url: string) => {
    if (loginInProgress) return;
    loginInProgress = true;
    // Signer-initiated: user pasted a bunker:// URL
    try {
      await loginWithBunkerUrl(url);
      w.__nostr_district_started = true;
      loginScreen.destroy();
      startGame();
    } catch (e: any) {
      loginInProgress = false;
      loginScreen.setStatus(e.message, true);
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
      loginScreen.setStatus(e.message, true);
    }
  },
});

} // end of HMR guard else block
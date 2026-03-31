import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { HubScene } from './scenes/HubScene';
import { GAME_WIDTH, GAME_HEIGHT } from './config/game.config';
import { LoginScreen } from './ui/LoginScreen';
import { authStore } from './stores/authStore';
import { RoomScene } from './scenes/RoomScene';
import { WoodsScene } from './scenes/WoodsScene';
import './stores/themeStore'; // init theme CSS vars early
import {
  loginWithExtension,
  loginWithNsec,
  loginWithBunkerUrl,
  loginAsGuest,
  startBunkerFlow,
  cancelBunkerFlow,
} from './nostr/nostrService';

// Vite HMR guard — this flag persists on window across module re-evaluations
const w = window as any;
if (w.__nostr_district_started) {
  // Module re-evaluated by HMR but game already started — do nothing
  console.log('[Main] HMR reload detected, skipping login screen');
} else {

let game: Phaser.Game | null = null;

function startGame(): void {
  if (game) {
    game.destroy(true);
    game = null;
  }

  let container = document.getElementById('game-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'game-container';
    document.body.appendChild(container);
  }

  setTimeout(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
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
            autoCenter: Phaser.Scale.CENTER_BOTH,
          },
          scene: [BootScene, HubScene, RoomScene, WoodsScene],
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
    try {
      await loginWithExtension();
      w.__nostr_district_started = true;
      loginScreen.destroy();
      startGame();
    } catch (e: any) {
      loginScreen.setStatus(e.message, true);
    }
  },
  onNsecLogin: async (nsec: string) => {
    try {
      await loginWithNsec(nsec);
      w.__nostr_district_started = true;
      loginScreen.destroy();
      startGame();
    } catch (e: any) {
      loginScreen.setStatus(e.message, true);
    }
  },
  onBunkerLogin: async (url: string) => {
    // Signer-initiated: user pasted a bunker:// URL
    try {
      await loginWithBunkerUrl(url);
      w.__nostr_district_started = true;
      loginScreen.destroy();
      startGame();
    } catch (e: any) {
      loginScreen.setStatus(e.message, true);
    }
  },
  onBunkerClientFlow: async () => {
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
      if (e.message === 'timeout') {
        cancelBunkerFlow();
        loginScreen.setBunkerStatus('Connection expired. Click Back and try again.');
      } else {
        loginScreen.setBunkerStatus(e.message);
      }
    }
  },
  onBunkerCancel: () => {
    cancelBunkerFlow();
  },
  onGuestLogin: async () => {
    try {
      await loginAsGuest();
      w.__nostr_district_started = true;
      loginScreen.destroy();
      startGame();
    } catch (e: any) {
      loginScreen.setStatus(e.message, true);
    }
  },
});

} // end of HMR guard else block
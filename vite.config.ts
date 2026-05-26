import { defineConfig, type Plugin } from 'vite';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Hot-swap clothing/asset PNGs without a full page reload. Without this,
// Vite force-reloads the page on any change under /public, blowing away
// the current scene + login session.
function clothingHmrPlugin(): Plugin {
  const ASSET_RE = /\/public\/assets\/(tops|bottoms|hats|accessories|hair|eyes|body|furniture)\//;
  return {
    name: 'nd-clothing-hmr',
    handleHotUpdate({ file, server }) {
      if (ASSET_RE.test(file)) {
        server.ws.send({ type: 'custom', event: 'nd:asset-changed', data: { file } });
        return [];
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [
    wasm(),
    nodePolyfills(),
    clothingHmrPlugin(),
  ],
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@breeztech/breez-sdk-spark'],
  },
  server: {
    port: 3000,
    open: true,
    headers: {
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
});

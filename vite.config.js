import { defineConfig } from 'vite';

const base = process.env.VITE_BASE_PATH ?? '/';
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.184.0';

export default defineConfig({
  base,
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2018',
    modulePreload: { polyfill: true },
    chunkSizeWarningLimit: 200,
    rollupOptions: {
      // Three.js (~770 KB) loaded from jsDelivr CDN via import map — not bundled
      external: (id) => id === 'three' || id.startsWith('three/'),
      output: {
        manualChunks(id) {
          if (id.includes('@pixiv/three-vrm')) return 'three-vrm';
        },
      },
    },
  },
  // Dev: still use local node_modules three (no import map needed in dev)
  resolve: {
    dedupe: ['three'],
  },
});

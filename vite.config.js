import { defineConfig } from 'vite';

// When deployed to GitHub Pages the app lives at /<repo-name>/
// Set VITE_BASE_PATH in your environment or GitHub Actions to match your repo name.
// Example: VITE_BASE_PATH=/ar-ai/
// Falls back to '/' for local dev.
const base = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base,
  server: {
    host: true,   // expose on local network so you can open on phone
    port: 5173,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 650, // three.js is large by nature
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@pixiv/three-vrm')) return 'three-vrm';
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
});

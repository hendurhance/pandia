import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [
    sveltekit(),
    wasm(),
    topLevelAwait()
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Configure worker handling
  worker: {
    format: 'es'
  },

  // Ensure proper asset handling
  assetsInclude: ['**/*.worker.js'],

  // SSR configuration - process svelte libraries server-side
  ssr: {
    noExternal: ['svelte-jsoneditor', 'svelte-awesome']
  }
});
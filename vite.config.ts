import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  build: {
    sourcemap: false,
    // Tweak chunking. Keep vendor chunking simple for single-page app
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  // Externalize heavy browser-only libs from SSR to prevent server bundling costs
  ssr: {
    noExternal: [],
    external: [
      'web-audio-beat-detector',
      'wavesurfer.js',
      'meyda',
    ],
  },
  worker: {
    format: 'es',
  },
});

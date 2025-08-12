import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

    kit: {
        adapter: adapter(),
        // CSR only app; prerender handled via +layout.ts
        files: {
            // keep defaults
        },
        paths: {
            base: '/musicality-nerd'
        }
    }
};

export default config;

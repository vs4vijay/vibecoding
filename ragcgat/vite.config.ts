import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: { port: 4647 }, // 4647 = RAGCHAT in leetspeak (A=4, G=6, A=4, T=7)
	test: { setupFiles: ['src/lib/db/__tests__/setup.ts'] },
});

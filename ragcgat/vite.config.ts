import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: { port: 1337 }, // 1337 = LEET
	test: { setupFiles: ['src/lib/db/__tests__/setup.ts'] },
});

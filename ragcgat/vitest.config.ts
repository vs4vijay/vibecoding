import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: { setupFiles: ['src/lib/db/__tests__/setup.ts'] },
});

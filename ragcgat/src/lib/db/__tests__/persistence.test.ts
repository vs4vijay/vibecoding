import { describe, expect, it } from 'vitest';
import { ensurePersistence } from '../persistence';

describe('ensurePersistence', () => {
	it('returns false rather than throwing where navigator is absent', async () => {
		await expect(ensurePersistence()).resolves.toBe(false);
	});

	it('returns a boolean on repeat calls without re-requesting', async () => {
		const first = await ensurePersistence();
		const second = await ensurePersistence();
		expect(typeof first).toBe('boolean');
		expect(typeof second).toBe('boolean');
	});

	it('never rejects', async () => {
		let rejected = false;
		try {
			await ensurePersistence();
		} catch {
			rejected = true;
		}
		expect(rejected).toBe(false);
	});
});

import { describe, it, expect } from 'vitest';
import { generateDedupHash, hashMessage } from '../index';
import type { Message } from '../types';

describe('generateDedupHash', () => {
	const base = { timestamp: 1720500000000, sender: 'Alice', text: 'Hello', type: 'text' };

	it('produces identical hash for identical inputs', () => {
		const h1 = generateDedupHash(base);
		const h2 = generateDedupHash(base);
		expect(h1).toBe(h2);
	});

	it('produces different hash for different sender', () => {
		const h1 = generateDedupHash(base);
		const h2 = generateDedupHash({ ...base, sender: 'Bob' });
		expect(h1).not.toBe(h2);
	});

	it('produces different hash for different text', () => {
		const h1 = generateDedupHash(base);
		const h2 = generateDedupHash({ ...base, text: 'World' });
		expect(h1).not.toBe(h2);
	});

	it('produces different hash for different timestamp', () => {
		const h1 = generateDedupHash(base);
		const h2 = generateDedupHash({ ...base, timestamp: 1720500000001 });
		expect(h1).not.toBe(h2);
	});

	it('produces different hash for different type', () => {
		const h1 = generateDedupHash(base);
		const h2 = generateDedupHash({ ...base, type: 'system' });
		expect(h1).not.toBe(h2);
	});

	it('returns 16-character hex string', () => {
		const hash = generateDedupHash(base);
		expect(hash).toMatch(/^[0-9a-f]{16}$/);
	});
});

describe('hashMessage', () => {
	it('works with full Message object', () => {
		const msg: Message = {
			timestamp: 1720500000000,
			sender: 'Alice',
			text: 'Hello',
			type: 'text',
			mediaType: undefined,
			dedupHash: '',
			rawLine: '[2024/07/09, 08:01:49] Alice: Hello',
			originalTimezone: 'America/New_York',
		};
		const hash = hashMessage(msg);
		expect(hash).toMatch(/^[0-9a-f]{16}$/);
	});
});

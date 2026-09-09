import { describe, expect, it } from 'vitest';
import { parseChatParam, serializeChatParam } from '../selection';

describe('parseChatParam', () => {
	it('round-trips valid ids through serializeChatParam', () => {
		for (const id of [1, 42, 999_999, Number.MAX_SAFE_INTEGER]) {
			expect(parseChatParam(serializeChatParam(id))).toBe(id);
		}
	});

	it('parses plain positive integers', () => {
		expect(parseChatParam('1')).toBe(1);
		expect(parseChatParam('007')).toBe(7);
	});

	it('rejects non-numeric input', () => {
		for (const raw of ['', 'abc', '12x', 'x12', '3.5', ' 3', '3 ', '1e3', '+5']) {
			expect(parseChatParam(raw)).toBeNull();
		}
	});

	it('rejects null, zero, and negative values', () => {
		expect(parseChatParam(null)).toBeNull();
		expect(parseChatParam('0')).toBeNull();
		expect(parseChatParam('-1')).toBeNull();
		expect(parseChatParam('-42')).toBeNull();
	});

	it('rejects integers beyond MAX_SAFE_INTEGER', () => {
		expect(parseChatParam('9007199254740993')).toBeNull();
		expect(parseChatParam('99999999999999999999999')).toBeNull();
	});
});

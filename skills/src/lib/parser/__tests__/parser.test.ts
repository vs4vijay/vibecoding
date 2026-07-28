import { describe, it, expect } from 'vitest';
import { parseString, detectCapWarning, generateDedupHash } from '../index';

describe('parseString', () => {
	it('parses iOS bracketed format correctly', () => {
		const result = parseString('[2024/07/09, 08:01:49] Alice: Hello\n[2024/07/09, 08:02:00] Bob: Hi there');
		expect(result.messages).toHaveLength(2);
		expect(result.messages[0].sender).toBe('Alice');
		expect(result.messages[0].text).toBe('Hello');
		expect(result.messages[0].timestamp).toBeGreaterThan(0);
		expect(result.messages[0].type).toBe('text');
		expect(result.participants).toEqual(['Alice', 'Bob']);
	});

	it('classifies system messages without sender', () => {
		const result = parseString(
			"[2024/07/09, 08:01:49] Alice: Hello\n[2024/07/09, 08:02:00] John joined using this group's invite link",
		);
		expect(result.messages[1].type).toBe('system');
		expect(result.messages[1].sender).toBe('');
	});

	it('handles multi-line continuation as single message', () => {
		const result = parseString(
			'[2024/07/09, 08:01:49] Alice: First line\ncontinued\nanother line\n[2024/07/09, 08:02:00] Bob: Second message',
		);
		expect(result.messages).toHaveLength(2);
		expect(result.messages[0].text).toBe('First line\ncontinued\nanother line');
	});

	it('classifies media messages with correct mediaType', () => {
		const result = parseString('[2024/07/09, 08:01:49] Alice: <Media omitted>');
		expect(result.messages[0].type).toBe('media');
		expect(result.messages[0].mediaType).toBe('image');
	});

	it('returns empty Chat for empty content', () => {
		const result = parseString('');
		expect(result.messages).toHaveLength(0);
		expect(result.messageCount).toBe(0);
	});

	it('handles nullish content gracefully', () => {
		const result = parseString(null as unknown as string);
		expect(result.messages).toHaveLength(0);
	});

	it('parses Android dash-separated format', () => {
		const result = parseString('7/9/24, 8:01 AM - Alice: Hello\n7/9/24, 8:02 AM - Bob: Hi');
		expect(result.messages).toHaveLength(2);
		expect(result.messages[0].sender).toBe('Alice');
		expect(result.messages[0].timestamp).toBeGreaterThan(0);
	});

	it('parses European dotted format', () => {
		const result = parseString('15.03.2024, 14:30 - Alice: Hello\n15.03.2024, 14:31 - Bob: Hi');
		expect(result.messages).toHaveLength(2);
		expect(result.messages[0].sender).toBe('Alice');
	});

	it('returns capWarning for exports with 35000+ lines', () => {
		const lines: string[] = [];
		for (let i = 0; i < 36000; i++) {
			lines.push(`[2024/07/09, 08:01:49] User${i}: Message ${i}`);
		}
		const result = parseString(lines.join('\n'));
		expect(result.capWarning).not.toBeNull();
		expect(result.capWarning).toMatch(/40,000|40K/i);
	});

	it('returns null capWarning for small exports', () => {
		const result = parseString('[2024/07/09, 08:01:49] Alice: Hello');
		expect(result.capWarning).toBeNull();
	});

	it('deduplicates participants', () => {
		const result = parseString('[2024/07/09, 08:01:49] Alice: Hello\n[2024/07/09, 08:02:00] Alice: Another');
		expect(result.participants).toHaveLength(1);
		expect(result.participants[0]).toBe('Alice');
	});

	it('stores timestamp as epoch ms number', () => {
		const result = parseString('[2024/07/09, 08:01:49] Alice: Hello');
		expect(result.messages[0].timestamp).toBeTypeOf('number');
		expect(Number.isInteger(result.messages[0].timestamp)).toBe(true);
	});

	it('stores originalTimezone from options or defaults', () => {
		const result = parseString('[2024/07/09, 08:01:49] Alice: Hello');
		expect(result.messages[0].originalTimezone).toBeTypeOf('string');
		expect(result.messages[0].originalTimezone.length).toBeGreaterThan(0);

		const result2 = parseString('[2024/07/09, 08:01:49] Alice: Hello', {
			timezone: 'America/New_York',
		});
		expect(result2.messages[0].originalTimezone).toBe('America/New_York');
	});

	it('produces non-empty dedupHash on every parsed message', () => {
		const result = parseString('[2024/07/09, 08:01:49] Alice: Hello\n[2024/07/09, 08:02:00] Bob: World');
		for (const msg of result.messages) {
			expect(msg.dedupHash).toMatch(/^[0-9a-f]{16}$/);
		}
	});

	it('produces identical hashes for identical parse results', () => {
		const input = '[2024/07/09, 08:01:49] Alice: Hello';
		const r1 = parseString(input);
		const r2 = parseString(input);
		expect(r1.messages[0].dedupHash).toBe(r2.messages[0].dedupHash);
	});
});

describe('detectCapWarning', () => {
	it('returns warning string at 35000+ threshold', () => {
		const warning = detectCapWarning(35000, 40000);
		expect(warning).not.toBeNull();
		expect(warning).toMatch(/40,000|40K/i);
	});

	it('returns null below threshold', () => {
		expect(detectCapWarning(100, 200)).toBeNull();
	});
});

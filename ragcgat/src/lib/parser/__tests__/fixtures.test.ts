import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseString } from '../index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, '../../../../fixtures/chattopdf-2026.07.json');
const benchmark = JSON.parse(readFileSync(fixturePath, 'utf-8'));

interface BenchmarkCase {
	id: string;
	category: string;
	locale: string;
	input: string;
	expected: {
		messageCount?: number;
		sender?: string;
		text?: string;
		year?: number;
		month?: number;
		day?: number;
		hour?: number;
		minute?: number;
		type?: string;
		participants?: string[];
	};
}

const cases = benchmark.cases as BenchmarkCase[];

describe('chattopdf 24-fixture benchmark', () => {
	it('has 24 fixtures', () => {
		expect(cases).toHaveLength(24);
	});

	for (const fixture of cases) {
		it(`${fixture.id} — ${fixture.locale}`, () => {
			const result = parseString(fixture.input);

			if (fixture.expected.messageCount !== undefined) {
				expect(result.messages.length).toBe(fixture.expected.messageCount);
			}

			if (fixture.expected.sender !== undefined && result.messages.length > 0) {
				expect(result.messages[0].sender).toBe(fixture.expected.sender);
			}

			if (fixture.expected.type !== undefined && result.messages.length > 0) {
				expect(result.messages[0].type).toBe(fixture.expected.type);
			}

			if (fixture.expected.text !== undefined && result.messages.length > 0) {
				expect(result.messages[0].text).toBe(fixture.expected.text);
			}

			if (result.messages.length > 0) {
				expect(result.messages[0].dedupHash).toMatch(/^[0-9a-f]{16}$/);
			}

			if (fixture.expected.year !== undefined && result.messages.length > 0) {
				const ts = new Date(result.messages[0].timestamp);
				expect(ts.getUTCFullYear()).toBe(fixture.expected.year);
				expect(ts.getUTCMonth() + 1).toBe(fixture.expected.month);
				expect(ts.getUTCDate()).toBe(fixture.expected.day);
			}

			if (fixture.expected.hour !== undefined && result.messages.length > 0) {
				const ts = new Date(result.messages[0].timestamp);
				expect(ts.getUTCHours()).toBe(fixture.expected.hour);
				expect(ts.getUTCMinutes()).toBe(fixture.expected.minute);
			}

			if (fixture.expected.participants !== undefined) {
				expect(result.participants.sort()).toEqual([...fixture.expected.participants].sort());
			}

			if (fixture.id === 'behavior-multiline' && result.messages.length > 0) {
				expect(result.messages[0].text).toContain('\n');
			}
		});
	}
});

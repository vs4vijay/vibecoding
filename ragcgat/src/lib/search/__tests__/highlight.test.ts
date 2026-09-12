import { describe, expect, it } from 'vitest';
import { makeSnippet, splitByTerms } from '../highlight';

describe('splitByTerms', () => {
	it('returns unmodified text with no tokens', () => {
		expect(splitByTerms('hello world', [])).toEqual([{ text: 'hello world', match: false }]);
	});

	it('returns unmodified text with empty text', () => {
		expect(splitByTerms('', ['a'])).toEqual([{ text: '', match: false }]);
	});

	it('marks case-insensitive matches', () => {
		const segs = splitByTerms('Pineapple is great pineapple', ['pineapple']);
		const matched = segs.filter((s) => s.match);
		expect(matched).toHaveLength(2);
		expect(matched[0].text).toBe('Pineapple');
		expect(matched[1].text).toBe('pineapple');
	});

	it('handles multiple separate tokens', () => {
		const segs = splitByTerms('pineapple and orange pie', ['pineapple', 'orange']);
		const matched = segs.filter((s) => s.match);
		expect(matched).toHaveLength(2);
		expect(matched[0].text).toBe('pineapple');
		expect(matched[1].text).toBe('orange');
	});

	it('preserves unicode text', () => {
		const segs = splitByTerms('café und über cool', ['über']);
		const matched = segs.filter((s) => s.match);
		expect(matched).toHaveLength(1);
		expect(matched[0].text).toBe('über');
	});
});

describe('makeSnippet', () => {
	it('returns short text unchanged', () => {
		expect(makeSnippet('hello', ['hello'])).toBe('hello');
	});

	it('returns full text when no match found', () => {
		expect(makeSnippet('no match here', ['zzz'])).toBe('no match here');
	});

	it('returns text when tokens empty', () => {
		expect(makeSnippet('hello', [])).toBe('hello');
	});

	it('windows around the first match', () => {
		const long = `${'a'.repeat(100)} TARGET ${'b'.repeat(100)}`;
		const s = makeSnippet(long, ['target'], 60);
		expect(s).toContain('TARGET');
		expect(s.startsWith('…')).toBe(true);
		expect(s.endsWith('…')).toBe(true);
	});

	it('truncates long text without match', () => {
		const long = 'c'.repeat(200);
		const s = makeSnippet(long, ['zzz'], 80);
		expect(s).toHaveLength(81); // 80 + '…'
		expect(s.endsWith('…')).toBe(true);
	});
});

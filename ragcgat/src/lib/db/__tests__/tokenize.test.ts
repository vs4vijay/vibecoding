import { describe, expect, it } from 'vitest';
import { tokenize } from '../tokenize';

describe('tokenize', () => {
	it('lowercases tokens', () => {
		expect(tokenize('Hello WORLD')).toEqual(['hello', 'world']);
	});

	it('splits on punctuation and drops single chars', () => {
		expect(tokenize('a I be ok! go')).toEqual(['be', 'ok', 'go']);
	});

	it('handles unicode and accented runs', () => {
		expect(tokenize('Café naïve résumé')).toEqual(['café', 'naïve', 'résumé']);
	});

	it('dedupes within a message', () => {
		expect(tokenize('hello hello HELLO world')).toEqual(['hello', 'world']);
	});

	it('returns empty array for empty string', () => {
		expect(tokenize('')).toEqual([]);
	});

	it('caps terms on pathological input', () => {
		const word = (i: number) => `word${i}`;
		const input = Array.from({ length: 2000 }, (_, i) => word(i)).join(' ');
		const terms = tokenize(input);
		expect(terms.length).toBeLessThanOrEqual(200);
		expect(new Set(terms).size).toBe(terms.length);
	});

	it('truncates giant input so output stays bounded', () => {
		const input = `prefix ${'x'.repeat(5000)} suffix`;
		expect(tokenize(input).length).toBeLessThanOrEqual(200);
	});
});

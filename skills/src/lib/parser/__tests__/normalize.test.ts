import { describe, it, expect } from 'vitest';
import { normalize, translateDigits } from '../index';

describe('normalize', () => {
	it('converts CRLF to LF', () => {
		expect(normalize('line1\r\nline2\r\nline3')).toBe('line1\nline2\nline3');
	});

	it('strips BOM character', () => {
		const bom = String.fromCharCode(0xfeff);
		expect(normalize(bom + 'hello')).toBe('hello');
	});

	it('removes directional marks', () => {
		const input = '\u200ehello\u200f';
		expect(normalize(input)).toBe('hello');
	});

	it('replaces Arabic comma with regular comma', () => {
		expect(normalize('\u060c')).toBe(',');
	});

	it('replaces narrow no-break space', () => {
		expect(normalize('\u202f')).toBe(' ');
	});

	it('replaces no-break space', () => {
		expect(normalize('\u00a0')).toBe(' ');
	});
});

describe('translateDigits', () => {
	it('translates Arabic-Indic digits (U+0660-U+0669)', () => {
		expect(translateDigits('\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669')).toBe('0123456789');
	});

	it('translates Persian digits (U+06F0-U+06F9)', () => {
		expect(translateDigits('\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9')).toBe('0123456789');
	});

	it('translates Devanagari digits (U+0966-U+096F)', () => {
		expect(translateDigits('\u0966\u0967\u0968\u0969\u096a\u096b\u096c\u096d\u096e\u096f')).toBe('0123456789');
	});

	it('translates Thai digits (U+0E50-U+0E59)', () => {
		expect(translateDigits('\u0e50\u0e51\u0e52\u0e53\u0e54\u0e55\u0e56\u0e57\u0e58\u0e59')).toBe('0123456789');
	});

	it('replaces Persian AM/PM markers', () => {
		expect(translateDigits('\u0628.\u0638')).toBe('PM');
		expect(translateDigits('\u0642.\u0638')).toBe('AM');
	});

	it('replaces Arabic AM/PM markers', () => {
		expect(translateDigits('\u0635')).toBe('AM');
		expect(translateDigits('\u0645')).toBe('PM');
	});

	it('replaces Chinese AM/PM markers', () => {
		expect(translateDigits('\u4e0a\u5348')).toBe('AM');
		expect(translateDigits('\u4e0b\u5348')).toBe('PM');
	});

	it('handles mixed Arabic-Indic and ASCII digits', () => {
		expect(translateDigits('Hello \u0661\u0662\u0663 World 456')).toBe('Hello 123 World 456');
	});
});

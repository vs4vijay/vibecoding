import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { MAX_UNZIPPED_BYTES, basenameOf, extractTxtFromZip, listTxtEntries, sniffZipMagic } from '../unzip';

const SMALL = '[2024/07/09, 08:01:49] Alice: small';
const BIG = Array.from(
	{ length: 50 },
	(_, i) => `[2024/07/09, 08:${String(i).padStart(2, '0')}:00] Alice: big line ${i} padding padding padding`,
).join('\n');

function makeZip(entries: Record<string, Uint8Array | string>): Uint8Array {
	const data: Record<string, Uint8Array> = {};
	for (const [k, v] of Object.entries(entries)) {
		data[k] = typeof v === 'string' ? strToU8(v) : v;
	}
	return zipSync(data);
}

describe('extractTxtFromZip', () => {
	it('picks the largest .txt by byte length', () => {
		const zip = makeZip({ 'small.txt': SMALL, 'chat exports/big.txt': BIG, 'notes.md': '# no' });
		const best = extractTxtFromZip(zip);
		expect(best.name).toBe('big.txt');
		expect(new TextDecoder().decode(best.bytes)).toBe(BIG);
	});

	it('ignores __MACOSX segments, directory entries, and dotfiles', () => {
		const zip = makeZip({
			'__MACOSX/chat.txt': 'junk macos content that is longer than real',
			'.hidden.txt': 'dotfile junk longer than real content here',
			'real.txt': SMALL,
		});
		const best = extractTxtFromZip(zip);
		expect(best.name).toBe('real.txt');
	});

	it('listTxtEntries exposes basenames only for nested paths', () => {
		const zip = makeZip({ 'a/b/c/nested.txt': SMALL });
		const listed = listTxtEntries(zip);
		expect(listed).toHaveLength(1);
		expect(listed[0].name).toBe('nested.txt');
	});

	it('sanitizes traversal basenames', () => {
		expect(basenameOf('../../evil.txt')).toBe('evil.txt');
		expect(basenameOf('..\\..\\evil.txt')).toBe('evil.txt');
		const zip = makeZip({ '../../evil.txt': SMALL });
		const best = extractTxtFromZip(zip);
		expect(best.name).toBe('evil.txt');
		expect(best.name).not.toContain('/');
	});

	it('throws corrupt-zip on garbage bytes', () => {
		expect(() => extractTxtFromZip(new Uint8Array([1, 2, 3, 4, 5]))).toThrow('corrupt-zip');
	});

	it('throws no-txt-in-zip when no .txt entries exist', () => {
		const zip = makeZip({ 'readme.md': '# hi', 'photo.jpg': new Uint8Array([1, 2, 3]) });
		expect(() => extractTxtFromZip(zip)).toThrow('no-txt-in-zip');
	});

	it('throws no-txt-in-zip for an empty archive listing', () => {
		const zip = makeZip({ '.hidden.txt': 'dotfiles do not count' });
		expect(() => extractTxtFromZip(zip)).toThrow('no-txt-in-zip');
	});

	it('throws zip-entry-too-large for over-cap entries', () => {
		const huge = new Uint8Array(MAX_UNZIPPED_BYTES + 1);
		huge.fill(65);
		const zip = makeZip({ 'huge.txt': huge });
		expect(() => extractTxtFromZip(zip)).toThrow('zip-entry-too-large');
	});
});

describe('sniffZipMagic', () => {
	it('detects PK-03-04 leading bytes (renamed zips)', () => {
		const zip = makeZip({ 'chat.txt': SMALL });
		expect(sniffZipMagic(zip)).toBe(true);
	});

	it('rejects plain text bytes', () => {
		expect(sniffZipMagic(new TextEncoder().encode('plain text export'))).toBe(false);
		expect(sniffZipMagic(new Uint8Array(0))).toBe(false);
	});
});

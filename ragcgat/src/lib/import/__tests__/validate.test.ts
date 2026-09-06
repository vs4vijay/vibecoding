import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, validateFile } from '../validate';

describe('validateFile', () => {
	it('accepts lowercase .txt', () => {
		expect(validateFile({ name: 'chat.txt', size: 100 })).toEqual({ kind: 'txt' });
	});

	it('accepts uppercase .TXT', () => {
		expect(validateFile({ name: 'CHAT.TXT', size: 100 })).toEqual({ kind: 'txt' });
	});

	it('accepts lowercase .zip', () => {
		expect(validateFile({ name: 'export.zip', size: 100 })).toEqual({ kind: 'zip' });
	});

	it('accepts uppercase .ZIP', () => {
		expect(validateFile({ name: 'EXPORT.ZIP', size: 100 })).toEqual({ kind: 'zip' });
	});

	it('rejects .exe with unsupported-type', () => {
		expect(() => validateFile({ name: 'evil.txt.exe', size: 100 })).toThrow('unsupported-type');
	});

	it('rejects .pdf with unsupported-type', () => {
		expect(() => validateFile({ name: 'doc.pdf', size: 100 })).toThrow('unsupported-type');
	});

	it('rejects extensionless names with unsupported-type', () => {
		expect(() => validateFile({ name: 'chat', size: 100 })).toThrow('unsupported-type');
	});

	it('rejects zero-byte files with empty-file', () => {
		expect(() => validateFile({ name: 'chat.txt', size: 0 })).toThrow('empty-file');
	});

	it('rejects over-cap files with file-too-large', () => {
		expect(() => validateFile({ name: 'chat.txt', size: MAX_FILE_BYTES + 1 })).toThrow('file-too-large');
	});

	it('accepts a file exactly at the cap', () => {
		expect(validateFile({ name: 'chat.txt', size: MAX_FILE_BYTES })).toEqual({ kind: 'txt' });
	});
});

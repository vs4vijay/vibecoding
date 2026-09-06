import { describe, expect, it } from 'vitest';
import { parseString } from '../../parser/parseFile';
import { buildPreview, decodeBytes, deriveChatName } from '../preview';

const EXPORT = [
	'[2024/07/09, 08:01:49] Alice: Hello',
	'[2024/07/09, 08:02:00] Bob: Hi there',
	'[2024/07/09, 08:03:10] Alice: How are you?',
].join('\n');

describe('deriveChatName', () => {
	it('strips .txt extension', () => {
		expect(deriveChatName('Chat with Alice.txt')).toBe('Chat with Alice');
	});

	it('strips .zip case-insensitively', () => {
		expect(deriveChatName('export.ZIP')).toBe('export');
	});

	it('strips directory prefixes', () => {
		expect(deriveChatName('C:\\exports\\chat.txt')).toBe('chat');
		expect(deriveChatName('/tmp/nested/chat.txt')).toBe('chat');
	});

	it('defaults to Untitled chat when nothing remains', () => {
		expect(deriveChatName('.txt')).toBe('Untitled chat');
	});
});

describe('buildPreview', () => {
	it('returns total, participants, and derived chatName', () => {
		const chat = parseString(EXPORT);
		const preview = buildPreview(chat, 'Chat with Alice.txt');
		expect(preview.total).toBe(3);
		expect(preview.chatName).toBe('Chat with Alice');
		expect(preview.participants).toEqual(['Alice', 'Bob']);
		expect(preview.fileName).toBe('Chat with Alice.txt');
	});

	it('computes date range min-max', () => {
		const chat = parseString(EXPORT);
		const preview = buildPreview(chat, 'chat.txt');
		const ts = chat.messages.map((m) => m.timestamp);
		expect(preview.dateRange).toEqual({ from: Math.min(...ts), to: Math.max(...ts) });
	});

	it('excludes timestamp-0 preamble rows from the date range', () => {
		const chat = parseString(`Some preamble line\n${EXPORT}`);
		expect(chat.messages[0].timestamp).toBe(0);
		const preview = buildPreview(chat, 'chat.txt');
		const real = chat.messages.map((m) => m.timestamp).filter((t) => t > 0);
		expect(preview.dateRange).toEqual({ from: Math.min(...real), to: Math.max(...real) });
	});

	it('returns null date range when only preamble exists', () => {
		const chat = parseString('Just a preamble line with no timestamps');
		expect(buildPreview(chat, 'chat.txt').dateRange).toBeNull();
	});

	it('truncates samples at 280 chars with default size 5', () => {
		const long = 'a'.repeat(500);
		const lines = Array.from({ length: 7 }, (_, i) => `[2024/07/09, 08:0${i}:00] Alice: ${long} ${i}`).join('\n');
		const chat = parseString(lines);
		const preview = buildPreview(chat, 'chat.txt');
		expect(preview.samples).toHaveLength(5);
		for (const s of preview.samples) expect(s.text.length).toBeLessThanOrEqual(280);
	});

	it('passes capWarning through', () => {
		const chat = parseString(EXPORT);
		const warned = { ...chat, capWarning: 'cap!' };
		expect(buildPreview(warned, 'chat.txt').capWarning).toBe('cap!');
		expect(buildPreview(chat, 'chat.txt').capWarning).toBeNull();
	});
});

describe('decodeBytes', () => {
	it('decodes utf-8', () => {
		const bytes = new TextEncoder().encode('[2024/07/09, 08:01:49] Alice: héllo ✓');
		expect(decodeBytes(bytes)).toContain('héllo ✓');
	});

	it('strips a leading BOM', () => {
		const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0x42]);
		expect(decodeBytes(bytes)).toBe('AB');
	});

	it('falls back to windows-1252 for latin-1 bytes', () => {
		// 0x93 is undefined in strict utf-8 single-byte context → triggers fallback;
		// in windows-1252 0x93 is SET SINGLE CHARACTER INTRODUCER (control char).
		const bytes = new Uint8Array([0x41, 0x93, 0x42]);
		const decoded = decodeBytes(bytes);
		expect(decoded).toContain('A');
		expect(decoded).toContain('B');
	});
});

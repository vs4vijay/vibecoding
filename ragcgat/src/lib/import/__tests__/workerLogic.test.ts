import { describe, expect, it } from 'vitest';
import { parseString } from '../../parser/parseFile';
import { buildPreview, decodeBytes } from '../preview';
import type { WorkerRequest, WorkerResponse } from '../workerProtocol';

const EXPORT = ['[2024/07/09, 08:01:49] Alice: Hello', '[2024/07/09, 08:02:00] Bob: Hi there'].join('\n');

/** Mirror of parse.worker.ts onmessage logic minus the Worker scope. */
function runWorkerLogic(req: WorkerRequest): WorkerResponse[] {
	const out: WorkerResponse[] = [];
	const post = (r: WorkerResponse) => out.push(r);
	if (req.type !== 'parse-preview') {
		post({ type: 'error', code: 'unknown-request', message: 'Unknown request type' });
		return out;
	}
	try {
		const bytes = new Uint8Array(req.buffer);
		post({ type: 'progress', phase: 'decode', done: 0, total: bytes.length });
		const text = decodeBytes(bytes);
		post({ type: 'progress', phase: 'parse', done: 0 });
		const chat = parseString(text);
		const preview = buildPreview(chat, req.fileName);
		const hashes = chat.messages.map((m) => m.dedupHash);
		const lines = text.length === 0 ? 0 : text.split('\n').length;
		post({ type: 'preview-result', preview, hashes, stats: { bytes: bytes.length, lines } });
	} catch (err) {
		post({
			type: 'error',
			code: 'parse-failed',
			message: err instanceof Error ? err.message : 'Failed to parse file',
		});
	}
	return out;
}

describe('worker logic (pure-function level, no real Worker)', () => {
	it('decode falls back for latin-1 bytes', () => {
		const bytes = new Uint8Array([0x41, 0x93, 0x42]);
		const decoded = decodeBytes(bytes);
		expect(decoded).toContain('A');
		expect(decoded).toContain('B');
	});

	it('buildPreview shape carries stats, samples, and truncated text', () => {
		const preview = buildPreview(parseString(EXPORT), 'chat.txt');
		expect(preview.total).toBe(2);
		expect(preview.samples).toHaveLength(2);
		expect(preview.participants).toEqual(['Alice', 'Bob']);
		expect(preview.dateRange).not.toBeNull();
	});

	it('protocol round-trip: progress then preview-result with small payload', () => {
		const buffer = new TextEncoder().encode(EXPORT).buffer as ArrayBuffer;
		const out = runWorkerLogic({ type: 'parse-preview', buffer, fileName: 'chat.txt' });
		expect(out[0]).toEqual({ type: 'progress', phase: 'decode', done: 0, total: buffer.byteLength });
		expect(out[1]).toEqual({ type: 'progress', phase: 'parse', done: 0 });
		const result = out[2];
		expect(result.type).toBe('preview-result');
		if (result.type !== 'preview-result') throw new Error('unreachable');
		expect(result.preview.total).toBe(2);
		expect(result.hashes).toHaveLength(2);
		expect(result.stats.bytes).toBe(buffer.byteLength);
		expect(result.stats.lines).toBe(2);
		// Small payload only: no full text or full message array crosses the boundary.
		expect('text' in result).toBe(false);
		expect('messages' in result).toBe(false);
	});

	it('protocol error variant carries code and message', () => {
		const err: WorkerResponse = { type: 'error', code: 'parse-failed', message: 'boom' };
		expect(err.type).toBe('error');
		if (err.type !== 'error') throw new Error('unreachable');
		expect(err.code).toBe('parse-failed');
		expect(err.message).toBe('boom');
	});

	it('unknown request type yields unknown-request error', () => {
		const out = runWorkerLogic({ type: 'nope', buffer: new ArrayBuffer(0), fileName: 'x' } as unknown as WorkerRequest);
		expect(out).toHaveLength(1);
		expect(out[0]).toEqual({ type: 'error', code: 'unknown-request', message: 'Unknown request type' });
	});
});

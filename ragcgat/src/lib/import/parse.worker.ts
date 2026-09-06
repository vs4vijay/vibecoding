/// <reference lib="webworker" />

import { parseString } from '../parser/parseFile';
import { buildPreview, decodeBytes } from './preview';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

function post(response: WorkerResponse): void {
	(self as unknown as { postMessage: (m: WorkerResponse) => void }).postMessage(response);
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
	const req = e.data;
	if (req.type !== 'parse-preview') {
		post({ type: 'error', code: 'unknown-request', message: 'Unknown request type' });
		return;
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
		post({
			type: 'preview-result',
			preview,
			hashes,
			stats: { bytes: bytes.length, lines },
		});
	} catch (err) {
		post({
			type: 'error',
			code: 'parse-failed',
			message: err instanceof Error ? err.message : 'Failed to parse file',
		});
	}
};

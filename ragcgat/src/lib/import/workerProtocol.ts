import type { ImportPreview } from './preview';

export type WorkerRequest = {
	type: 'parse-preview';
	buffer: ArrayBuffer;
	fileName: string;
};

export type WorkerResponse =
	| { type: 'progress'; phase: 'decode' | 'parse'; done: number; total?: number }
	| {
			type: 'preview-result';
			preview: ImportPreview;
			hashes: string[];
			stats: { bytes: number; lines: number };
	  }
	| { type: 'error'; code: string; message: string };

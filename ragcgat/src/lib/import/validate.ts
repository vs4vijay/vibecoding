export const MAX_FILE_BYTES = 25_000_000;

const ACCEPT_EXT = new Set(['.txt', '.zip']);

export type FileKind = 'txt' | 'zip';

export interface FileLike {
	name: string;
	size: number;
}

export function validateFile(f: FileLike): { kind: FileKind } {
	const dot = f.name.lastIndexOf('.');
	const ext = dot >= 0 ? f.name.slice(dot).toLowerCase() : '';
	if (!ACCEPT_EXT.has(ext)) throw new Error('unsupported-type');
	if (f.size === 0) throw new Error('empty-file');
	if (f.size > MAX_FILE_BYTES) throw new Error('file-too-large');
	return { kind: ext === '.zip' ? 'zip' : 'txt' };
}

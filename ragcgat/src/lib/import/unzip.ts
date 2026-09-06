import { unzipSync } from 'fflate';

export const MAX_ZIP_BYTES = 25_000_000;
export const MAX_UNZIPPED_BYTES = 50_000_000;

export interface ZipTxtEntry {
	name: string;
	bytes: Uint8Array;
}

/** Basename-only: neutralizes zip path traversal; names are display text only. */
export function basenameOf(rawName: string): string {
	const fwd = rawName.split('/').pop() ?? '';
	return fwd.split('\\').pop() ?? '';
}

export function sniffZipMagic(bytes: Uint8Array): boolean {
	return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function listTxtEntries(data: Uint8Array): ZipTxtEntry[] {
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(data);
	} catch {
		throw new Error('corrupt-zip');
	}
	const out: ZipTxtEntry[] = [];
	for (const [rawName, bytes] of Object.entries(entries)) {
		if (rawName.endsWith('/')) continue;
		if (rawName.includes('__MACOSX/')) continue;
		const base = basenameOf(rawName);
		if (!base.toLowerCase().endsWith('.txt')) continue;
		if (base.startsWith('.')) continue;
		if (bytes.length > MAX_UNZIPPED_BYTES) throw new Error('zip-entry-too-large');
		out.push({ name: base, bytes });
	}
	return out;
}

/**
 * Pick the largest .txt entry by byte length (WhatsApp exports one chat per
 * file; multi-chat import is explicitly deferred). Throws no-txt-in-zip,
 * corrupt-zip, or zip-entry-too-large.
 */
export function extractTxtFromZip(data: Uint8Array): ZipTxtEntry {
	const found = listTxtEntries(data);
	if (found.length === 0) throw new Error('no-txt-in-zip');
	let best = found[0];
	for (const e of found) {
		if (e.bytes.length > best.bytes.length) best = e;
	}
	return best;
}

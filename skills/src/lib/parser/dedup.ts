import type { Message } from './types';

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

export function generateDedupHash(msg: {
	timestamp: number;
	sender: string;
	text: string;
	type: string;
}): string {
	const canonical = `${msg.timestamp}|${msg.sender}|${msg.text}|${msg.type}`;
	const encoder = new TextEncoder();
	const bytes = encoder.encode(canonical);

	let hash = FNV_OFFSET_BASIS;
	for (let i = 0; i < bytes.length; i++) {
		hash ^= BigInt(bytes[i]);
		hash = (hash * FNV_PRIME) & 0xffffffffffffffffn;
	}

	return hash.toString(16).padStart(16, '0');
}

export function hashMessage(msg: Message): string {
	return generateDedupHash({
		timestamp: msg.timestamp,
		sender: msg.sender,
		text: msg.text,
		type: msg.type,
	});
}

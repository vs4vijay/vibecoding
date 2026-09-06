import type { ChatRecord, RagChatDB } from '../db/db';
import type { Chat } from '../parser/types';

export interface PreviewSample {
	sender: string;
	timestamp: number;
	text: string;
}

export interface ImportPreview {
	fileName: string;
	chatName: string;
	total: number;
	dateRange: { from: number; to: number } | null;
	participants: string[];
	samples: PreviewSample[];
	capWarning: string | null;
}

export function deriveChatName(fileName: string): string {
	const base = fileName.split('/').pop()?.split('\\').pop() ?? fileName;
	const lower = base.toLowerCase();
	const stripped = lower.endsWith('.txt') || lower.endsWith('.zip') ? base.slice(0, -4) : base;
	const name = stripped.trim();
	return name.length > 0 ? name : 'Untitled chat';
}

export function decodeBytes(bytes: Uint8Array): string {
	let text: string | null = null;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		text = new TextDecoder('windows-1252').decode(bytes);
	}
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	return text;
}

export interface UpsertDiff {
	newCount: number;
	skippedCount: number;
	existingChat?: ChatRecord;
}

export const DIFF_BATCH = 5000;

/**
 * Bounded diff: batched anyOf keyed queries, never a full-store scan or
 * offset read. Matches bulkSave's dedup key semantics (dedupHash).
 */
export async function diffPreview(db: RagChatDB, hashes: string[], chatName: string): Promise<UpsertDiff> {
	const seen = new Set<string>();
	for (let i = 0; i < hashes.length; i += DIFF_BATCH) {
		const batch = hashes.slice(i, i + DIFF_BATCH);
		if (batch.length === 0) continue;
		const keys = await db.messages.where('dedupHash').anyOf(batch).keys();
		for (const k of keys) seen.add(String(k));
	}
	let skippedCount = 0;
	for (const h of hashes) {
		if (seen.has(h)) skippedCount++;
	}
	const existingChat = await db.chats.where('name').equals(chatName).first();
	return {
		newCount: hashes.length - skippedCount,
		skippedCount,
		...(existingChat ? { existingChat } : {}),
	};
}
export function buildPreview(chat: Chat, fileName: string, sampleSize = 5): ImportPreview {
	const ts = chat.messages.map((m) => m.timestamp).filter((t) => t > 0);
	return {
		fileName,
		chatName: deriveChatName(fileName),
		total: chat.messageCount,
		dateRange: ts.length ? { from: Math.min(...ts), to: Math.max(...ts) } : null,
		participants: chat.participants,
		samples: chat.messages
			.slice(0, sampleSize)
			.map((m) => ({ sender: m.sender, timestamp: m.timestamp, text: m.text.slice(0, 280) })),
		capWarning: chat.capWarning,
	};
}

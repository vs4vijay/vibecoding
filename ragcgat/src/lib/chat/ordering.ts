import type { ChatRecord } from '../db/db';

/** Sidebar row view-model; normalizes pre-v3 fields to safe fallbacks. */
export interface ChatSummary {
	id: number;
	name: string;
	lastMessageAt: number;
	lastSnippet: string;
	lastSender: string;
	messageCount: number;
}

export function toChatSummary(chat: ChatRecord): ChatSummary {
	return {
		id: chat.id as number,
		name: chat.name,
		lastMessageAt: chat.lastMessageAt ?? chat.importedAt,
		lastSnippet: chat.lastSnippet ?? '',
		lastSender: chat.lastSender ?? '',
		messageCount: chat.messageCount ?? 0,
	};
}

/**
 * Newest-first comparator — for tests and previews only. Production sidebar
 * order comes from the Dexie lastMessageAt index, never a client sort.
 */
export function byLastMessageAtDesc(a: ChatSummary, b: ChatSummary): number {
	return b.lastMessageAt - a.lastMessageAt;
}

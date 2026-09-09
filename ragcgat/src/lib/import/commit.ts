import type { ChatRecord, MessageRecord, RagChatDB } from '../db/db';
import { snippetOf } from '../db/migrations';
import { ensurePersistence } from '../db/persistence';
import { ChatRepository, MessageRepository } from '../db/repositories';
import { tokenize } from '../db/tokenize';
import type { Chat } from '../parser/types';
import { deriveChatName } from './preview';

export { deriveChatName };

export interface CommitResult {
	chatId: number;
	written: number;
}

export async function commitImport(
	db: RagChatDB,
	chatName: string,
	parsed: Chat,
	onProgress?: (written: number, total: number) => void,
): Promise<CommitResult> {
	const chats = new ChatRepository(db);
	const messages = new MessageRepository(db);
	const existing = await chats.findChatByName(chatName);
	const newest = newestOf(parsed.messages);
	const importedAt = Date.now();
	const chatId =
		existing?.id ??
		(await chats.saveChat({
			name: chatName,
			importedAt,
			messageCount: parsed.messageCount,
			participants: parsed.participants,
			// v3 denormalized sidebar stats, derived once from the parsed batch.
			lastMessageAt: newest?.timestamp ?? importedAt,
			lastSnippet: newest ? snippetOf(newest.text) : '',
			lastSender: newest?.sender ?? '',
		}));

	const records: MessageRecord[] = parsed.messages.map((m) => ({
		chatId,
		timestamp: m.timestamp,
		sender: m.sender,
		text: m.text,
		type: m.type,
		mediaType: m.mediaType,
		dedupHash: m.dedupHash,
		terms: tokenize(m.text),
	}));

	const written = await messages.bulkSave(records, onProgress);

	if (existing && written > 0) {
		// Upsert-merge: messageCount always bumps; recency stats advance only when
		// the fresh batch actually carries the chat's newest message (max-merge —
		// merging an older export must never roll the sidebar order back).
		const freshNewest = newestOf(records);
		const patch: Partial<ChatRecord> = { messageCount: (existing.messageCount ?? 0) + written };
		if (freshNewest && freshNewest.timestamp > (existing.lastMessageAt ?? Number.NEGATIVE_INFINITY)) {
			patch.lastMessageAt = freshNewest.timestamp;
			patch.lastSnippet = snippetOf(freshNewest.text);
			patch.lastSender = freshNewest.sender;
		}
		await chats.updateChatStats(chatId, patch);
	}
	if (written > 0) {
		void ensurePersistence().then((p) => console.info('persistent storage:', p));
	}
	return { chatId, written };
}

/** Newest message of a batch by timestamp (latest wins ties, deterministically). */
function newestOf<T extends { timestamp: number; text: string; sender: string }>(
	messages: readonly T[],
): T | undefined {
	let newest: T | undefined;
	for (const m of messages) {
		if (newest === undefined || m.timestamp >= newest.timestamp) newest = m;
	}
	return newest;
}

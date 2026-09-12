import { type ChatRecord, type MessageRecord, type RagChatDB, db } from '../db/db';
import { MessageRepository } from '../db/repositories';

export interface SearchResult {
	message: MessageRecord;
	chatName: string;
}

export async function searchAll(
	query: string,
	opts?: { db?: RagChatDB; limit?: number },
): Promise<{ total: number; results: SearchResult[] }> {
	const source = opts?.db ?? db;
	const messages = new MessageRepository(source);
	const { total, results } = await messages.searchMessages(query, { limit: opts?.limit ?? 50 });

	const chatIds = [...new Set(results.map((m) => m.chatId))];
	const chats = await source.chats.bulkGet(chatIds);
	const present = chats.filter((c): c is ChatRecord => c !== undefined);
	const nameMap = new Map(present.map((c) => [c.id, c.name]));

	return {
		total,
		results: results.map((m) => ({
			message: m,
			chatName: nameMap.get(m.chatId) ?? 'Unknown chat',
		})),
	};
}

export async function searchChat(
	chatId: number,
	query: string,
	opts?: { db?: RagChatDB; limit?: number },
): Promise<{ total: number; results: SearchResult[] }> {
	const source = opts?.db ?? db;
	const messages = new MessageRepository(source);
	const { total, results } = await messages.searchMessages(query, {
		chatId,
		limit: opts?.limit ?? 50,
	});

	const chat = await source.chats.get(chatId);

	return {
		total,
		results: results.map((m) => ({
			message: m,
			chatName: chat?.name ?? '',
		})),
	};
}

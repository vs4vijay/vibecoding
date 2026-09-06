import type { MessageRecord, RagChatDB } from '../db/db';
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
	const chatId =
		existing?.id ??
		(await chats.saveChat({
			name: chatName,
			importedAt: Date.now(),
			messageCount: parsed.messageCount,
			participants: parsed.participants,
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
		await db.chats.update(chatId, { messageCount: (existing.messageCount ?? 0) + written });
	}
	if (written > 0) {
		void ensurePersistence().then((p) => console.info('persistent storage:', p));
	}
	return { chatId, written };
}

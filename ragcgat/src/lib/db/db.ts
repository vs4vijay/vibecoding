import Dexie, { type EntityTable } from 'dexie';
import type { MediaType, MessageType } from '../parser/types';

export interface ChatRecord {
	id?: number;
	name: string;
	importedAt: number;
	messageCount: number;
	participants: string[];
}

export interface MessageRecord {
	id?: number;
	chatId: number;
	timestamp: number;
	sender: string;
	text: string;
	type: MessageType;
	mediaType?: MediaType;
	dedupHash: string;
	terms: string[];
}

export class RagChatDB extends Dexie {
	chats!: EntityTable<ChatRecord, 'id'>;
	messages!: EntityTable<MessageRecord, 'id'>;

	constructor(name = 'ragchat') {
		super(name);
		this.version(1).stores({
			chats: '++id, name, importedAt',
			messages: '++id, chatId, timestamp, [chatId+timestamp], *terms, &dedupHash',
		});
	}
}

export const db = new RagChatDB();

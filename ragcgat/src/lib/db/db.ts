import Dexie, { type EntityTable } from 'dexie';
import type { MediaType, MessageType } from '../parser/types';
import { applyMigrations } from './migrations';

export interface ChatRecord {
	id?: number;
	name: string;
	importedAt: number;
	/** v3: max(messages.timestamp) for this chat — backfilled by the v3 migration, maintained by commitImport. */
	lastMessageAt?: number;
	/** v3: newest message text truncated to SNIPPET_MAX_LENGTH chars ('' when the chat has no messages). */
	lastSnippet?: string;
	/** v3: newest message sender ('' when the chat has no messages). */
	lastSender?: string;
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
// Production wiring: the exported singleton always runs the full migration
// chain (v2 day backfill, v3 lastMessageAt/snippet denormalization). Tests
// construct their own RagChatDB and call applyMigrations explicitly so seeded
// legacy shapes exercise the real upgrade paths.
applyMigrations(db);

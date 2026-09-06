import { parseString } from '../parser/parseFile';
import type { ChatRecord, MessageRecord, RagChatDB } from './db';
import { ensurePersistence } from './persistence';
import { tokenize } from './tokenize';

export const BULK_CHUNK_SIZE = 500;

export interface PageCursor {
	timestamp: number;
	id: number;
}

export interface ImportResult {
	chatId: number;
	written: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

function isValidCursor(cursor: PageCursor): boolean {
	return (
		typeof cursor.timestamp === 'number' &&
		Number.isFinite(cursor.timestamp) &&
		typeof cursor.id === 'number' &&
		Number.isFinite(cursor.id)
	);
}

export class ChatRepository {
	constructor(private readonly db: RagChatDB) {}

	async saveChat(input: {
		name: string;
		importedAt?: number;
		messageCount?: number;
		participants?: string[];
	}): Promise<number> {
		const record: ChatRecord = {
			name: input.name,
			importedAt: input.importedAt ?? Date.now(),
			messageCount: input.messageCount ?? 0,
			participants: input.participants ?? [],
		};
		return (await this.db.chats.add(record)) as number;
	}

	async listChatsNewest(limit = 50): Promise<ChatRecord[]> {
		return this.db.chats.orderBy('importedAt').reverse().limit(limit).toArray();
	}
}

export class MessageRepository {
	constructor(private readonly db: RagChatDB) {}

	/**
	 * Idempotent chunked bulk write. All tokenize/hash work must happen in the
	 * caller before this runs — the transaction body contains Dexie ops only.
	 * Dedup-before-write: pre-query existing dedupHash values, bulkAdd the
	 * remainder in 500-row chunks with per-chunk BulkError isolation.
	 */
	async bulkSave(records: MessageRecord[]): Promise<number> {
		if (records.length === 0) return 0;

		const hashes = records.map((r) => r.dedupHash);
		const existingKeys = await this.db.messages.where('dedupHash').anyOf(hashes).keys();
		const seen = new Set(existingKeys.map(String));
		const fresh = records.filter((r) => !seen.has(r.dedupHash));
		if (fresh.length === 0) return 0;

		let written = 0;
		for (const c of chunk(fresh, BULK_CHUNK_SIZE)) {
			const database = this.db;
			try {
				await database.transaction('rw', database.messages, async () => {
					await database.messages.bulkAdd(c);
				});
				written += c.length;
			} catch (e) {
				const failures = (e as { name?: string; failures?: unknown[] })?.failures;
				if ((e as { name?: string })?.name === 'BulkError' && Array.isArray(failures)) {
					written += c.length - failures.length;
					console.warn(`bulkSave: chunk wrote ${c.length - failures.length}/${c.length} rows`);
				} else {
					throw e;
				}
			}
		}
		return written;
	}

	async getLatestWindow(chatId: number, limit: number): Promise<MessageRecord[]> {
		return this.db.messages
			.where('[chatId+timestamp]')
			.between([chatId, Number.NEGATIVE_INFINITY], [chatId, Number.POSITIVE_INFINITY])
			.reverse()
			.limit(limit)
			.toArray();
	}

	/**
	 * Keyset page of strictly-older rows. Same-timestamp siblings (equal ms)
	 * are resolved by id tiebreak in JS and merged newest-first ahead of the
	 * older-timestamp rows. Malformed cursors return [] — never a full scan.
	 */
	async getOlderPage(chatId: number, cursor: PageCursor, limit: number): Promise<MessageRecord[]> {
		if (!isValidCursor(cursor) || limit <= 0) return [];

		const sameTs = await this.db.messages
			.where('[chatId+timestamp]')
			.equals([chatId, cursor.timestamp])
			.limit(1000)
			.toArray();
		const siblings = sameTs
			.filter((m) => (m.id as number) < cursor.id)
			.sort((a, b) => (b.id as number) - (a.id as number))
			.slice(0, limit);

		const remaining = limit - siblings.length;
		let older: MessageRecord[] = [];
		if (remaining > 0) {
			older = await this.db.messages
				.where('[chatId+timestamp]')
				.between([chatId, Number.NEGATIVE_INFINITY], [chatId, cursor.timestamp], true, false)
				.reverse()
				.limit(remaining)
				.toArray();
		}
		return [...siblings, ...older];
	}

	async searchTerms(query: string, limit = 50): Promise<MessageRecord[]> {
		const tokens = tokenize(query);
		if (tokens.length === 0) return [];
		return this.db.messages.where('terms').anyOf(tokens).distinct().limit(limit).toArray();
	}

	async searchTermsInChat(chatId: number, query: string, limit = 50): Promise<MessageRecord[]> {
		const tokens = tokenize(query);
		if (tokens.length === 0) return [];
		return this.db.messages
			.where('terms')
			.anyOf(tokens)
			.filter((m) => m.chatId === chatId)
			.distinct()
			.limit(limit)
			.toArray();
	}
}

/**
 * Parser-to-DB import entry point: parse text, create the chat row, map
 * parser messages to records (tokenize here, before any transaction opens),
 * idempotent bulkSave, then fire-and-forget persistence request.
 */
export async function importChatText(db: RagChatDB, name: string, raw: string): Promise<ImportResult> {
	const chat = parseString(raw);
	const chats = new ChatRepository(db);
	const messages = new MessageRepository(db);

	const chatId = await chats.saveChat({
		name,
		importedAt: Date.now(),
		messageCount: chat.messageCount,
		participants: chat.participants,
	});

	const records: MessageRecord[] = chat.messages.map((m) => ({
		chatId,
		timestamp: m.timestamp,
		sender: m.sender,
		text: m.text,
		type: m.type,
		mediaType: m.mediaType,
		dedupHash: m.dedupHash,
		terms: tokenize(m.text),
	}));

	const written = await messages.bulkSave(records);
	if (written > 0) {
		void ensurePersistence().then((p) => console.info('persistent storage:', p));
	}
	return { chatId, written };
}

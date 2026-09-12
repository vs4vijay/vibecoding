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
		lastMessageAt?: number;
		lastSnippet?: string;
		lastSender?: string;
	}): Promise<number> {
		const importedAt = input.importedAt ?? Date.now();
		const record: ChatRecord = {
			name: input.name,
			importedAt,
			// v3 denormalized stats default to "nothing newer than the import" so
			// every new row is indexable by lastMessageAt, even for pre-v3 callers.
			lastMessageAt: input.lastMessageAt ?? importedAt,
			lastSnippet: input.lastSnippet ?? '',
			lastSender: input.lastSender ?? '',
			messageCount: input.messageCount ?? 0,
			participants: input.participants ?? [],
		};
		return (await this.db.chats.add(record)) as number;
	}

	/**
	 * Sidebar order: message recency via the v3 lastMessageAt index — never a
	 * client sort. Instances whose schema predates v3 (legacy v1/v2 databases)
	 * fall back to the importedAt index; production always registers v3 via
	 * applyMigrations (wired onto the singleton in db.ts).
	 */
	async listChatsNewest(limit = 50): Promise<ChatRecord[]> {
		const hasLastMessageIndex = this.db.chats.schema.indexes.some((idx) => idx.name === 'lastMessageAt');
		const ordered = hasLastMessageIndex ? this.db.chats.orderBy('lastMessageAt') : this.db.chats.orderBy('importedAt');
		return ordered.reverse().limit(limit).toArray();
	}

	/** Patch denormalized stats (lastMessageAt/lastSnippet/lastSender/messageCount) on one chat. */
	async updateChatStats(chatId: number, patch: Partial<ChatRecord>): Promise<void> {
		await this.db.chats.update(chatId, patch);
	}

	async findChatByName(name: string): Promise<ChatRecord | undefined> {
		return this.db.chats.where('name').equals(name).first();
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
	async bulkSave(records: MessageRecord[], onProgress?: (written: number, total: number) => void): Promise<number> {
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
			onProgress?.(written, fresh.length);
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

	/**
	 * Exact-count, newest-first search across or within one chat.
	 *
	 * Filter-then-distinct: chatId filter runs BEFORE distinct() — the
	 * documented safe order for multiEntry anyOf in Dexie.
	 * primaryKeys() returns ids only (zero record materialization for count);
	 * ids are sorted descending then capped at candidateCap so the newest
	 * matches are always fetched (anyOf+distinct primaryKeys are grouped
	 * per-term ascending-within-term, not globally by id).
	 */
	async searchMessages(
		query: string,
		opts?: { chatId?: number; limit?: number; candidateCap?: number },
	): Promise<{ total: number; results: MessageRecord[] }> {
		const tokens = tokenize(query);
		if (tokens.length === 0) return { total: 0, results: [] };

		// Filter before distinct (Dexie documented order for multiEntry anyOf).
		let col = this.db.messages.where('terms').anyOf(tokens);
		if (typeof opts?.chatId === 'number') {
			col = col.filter((m) => m.chatId === opts.chatId);
		}
		col = col.distinct();

		const ids = await col.primaryKeys();
		const total = ids.length;
		if (total === 0) return { total: 0, results: [] };

		const candidateCap = opts?.candidateCap ?? 200;
		const candidates = ids.sort((a, b) => (b as number) - (a as number)).slice(0, candidateCap);

		const records = await this.db.messages.bulkGet(candidates);
		const limit = opts?.limit ?? 50;
		return {
			total,
			results: records
				.filter((r): r is MessageRecord => r !== undefined)
				.sort((a, b) => b.timestamp - a.timestamp || (b.id as number) - (a.id as number))
				.slice(0, limit),
		};
	}

	/**
	 * Bounded window of messages around a target message for scroll-to-result
	 * navigation. Returns null when the target is missing or belongs to a
	 * different chat — callers fall back to a normal newest-open.
	 *
	 * Every read (same-ts siblings, older/newer rows) has an explicit .limit()
	 * — satisfies the repo-layer guardrail "every read path is limit-bounded".
	 */
	async getWindowAt(
		chatId: number,
		msgId: number,
		limit: number,
	): Promise<{ messages: MessageRecord[]; targetId: number } | null> {
		const target = await this.db.messages.get(msgId);
		if (!target || target.chatId !== chatId) return null;

		const half = Math.floor((limit - 1) / 2);

		// Older: same-ts siblings with id < target.id, then rows below.
		const olderSiblings = await this.db.messages
			.where('[chatId+timestamp]')
			.equals([chatId, target.timestamp])
			.limit(1000)
			.toArray();
		const olderSameTs = olderSiblings
			.filter((m) => (m.id as number) < (target.id as number))
			.sort((a, b) => (b.id as number) - (a.id as number))
			.slice(0, half);

		const olderRemainder = half - olderSameTs.length;
		let olderOlder: MessageRecord[] = [];
		if (olderRemainder > 0) {
			olderOlder = await this.db.messages
				.where('[chatId+timestamp]')
				.between([chatId, Number.NEGATIVE_INFINITY], [chatId, target.timestamp], true, false)
				.reverse()
				.limit(olderRemainder)
				.toArray();
		}
		const olderChronological = [...olderOlder.reverse(), ...olderSameTs.reverse()];

		// Newer: same-ts siblings with id > target.id, then rows above.
		const newerSiblings = await this.db.messages
			.where('[chatId+timestamp]')
			.equals([chatId, target.timestamp])
			.limit(1000)
			.toArray();
		const newerSameTs = newerSiblings
			.filter((m) => (m.id as number) > (target.id as number))
			.sort((a, b) => (a.id as number) - (b.id as number))
			.slice(0, half);

		const newerRemainder = limit - half - 1 - newerSameTs.length;
		let newerOlder: MessageRecord[] = [];
		if (newerRemainder > 0) {
			newerOlder = await this.db.messages
				.where('[chatId+timestamp]')
				.between([chatId, target.timestamp], [chatId, Number.POSITIVE_INFINITY], false, true)
				.limit(newerRemainder)
				.toArray();
		}
		const newerChronological = [...newerSameTs, ...newerOlder];

		return {
			messages: [...olderChronological, target, ...newerChronological],
			targetId: target.id as number,
		};
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

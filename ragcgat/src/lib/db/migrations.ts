import type { ChatRecord, MessageRecord, RagChatDB } from './db';

export interface MigratedMessageRecord extends MessageRecord {
	/** Backfilled in v2: calendar day (YYYY-MM-DD) derived from timestamp. */
	day?: string;
}

/** Hard cap for ChatRecord.lastSnippet — shared by the v3 backfill and commitImport. */
export const SNIPPET_MAX_LENGTH = 140;

/** Newest-message preview text as stored on the chat row (denormalized, v3). */
export function snippetOf(text: string): string {
	return text.length <= SNIPPET_MAX_LENGTH ? text : text.slice(0, SNIPPET_MAX_LENGTH);
}

/**
 * Registers the schema versions beyond the frozen version(1) block in db.ts.
 *
 * v2 adds a `sender` index and backfills a derived `day` field via a pure
 * synchronous modify() callback — upgrade errors roll back the whole upgrade
 * transaction rather than partial-writing (T-02-07).
 *
 * v3 (this phase) denormalizes sidebar ordering onto the chat row: chats gain
 * a `lastMessageAt` index, backfilled per chat from the newest message via a
 * bounded [chatId+timestamp] reverse limit-1 read (importedAt fallback for
 * empty chats), with lastSnippet/lastSender taken from that same message.
 * Rows already carrying a numeric lastMessageAt are skipped, so re-running
 * the upgrade (or upgrading an already-migrated library) is idempotent.
 */
export function applyMigrations(db: RagChatDB): void {
	db.version(2)
		.stores({
			messages: '++id, chatId, timestamp, [chatId+timestamp], *terms, &dedupHash, sender',
		})
		.upgrade((tx) => {
			return tx
				.table<MigratedMessageRecord>('messages')
				.toCollection()
				.modify((msg) => {
					if (msg.day === undefined) {
						msg.day = new Date(msg.timestamp).toISOString().slice(0, 10);
					}
				});
		});

	db.version(3)
		.stores({
			// Restate ALL stores: version stores() declarations are per-version
			// snapshots, so messages must repeat the full v2 schema (including the
			// sender index) or that index would be dropped at v3.
			chats: '++id, name, importedAt, lastMessageAt',
			messages: '++id, chatId, timestamp, [chatId+timestamp], *terms, &dedupHash, sender',
		})
		.upgrade(async (tx) => {
			const chats = tx.table<ChatRecord>('chats');
			const msgs = tx.table<MessageRecord>('messages');
			const rows = await chats.toArray();
			for (const chat of rows) {
				// Idempotence: migrated rows keep their stored values untouched.
				if (typeof chat.lastMessageAt === 'number') continue;
				// Bounded read: newest message of THIS chat only — a reverse
				// limit-1 walk of the compound index, never an unbounded scan.
				const latest = await msgs
					.where('[chatId+timestamp]')
					.between([chat.id as number, Number.NEGATIVE_INFINITY], [chat.id as number, Number.POSITIVE_INFINITY])
					.reverse()
					.limit(1)
					.first();
				await chats.update(chat.id as number, {
					lastMessageAt: latest?.timestamp ?? chat.importedAt,
					lastSnippet: latest ? snippetOf(latest.text) : '',
					lastSender: latest?.sender ?? '',
				});
			}
		});
}

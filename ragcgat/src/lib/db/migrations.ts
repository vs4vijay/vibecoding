import type { MessageRecord, RagChatDB } from './db';

export interface MigratedMessageRecord extends MessageRecord {
	/** Backfilled in v2: calendar day (YYYY-MM-DD) derived from timestamp. */
	day?: string;
}

/**
 * Registers the next schema version WITHOUT touching the frozen version(1)
 * block in db.ts. v2 adds a `sender` index and backfills a derived `day`
 * field via a pure synchronous modify() callback — upgrade errors roll back
 * the whole upgrade transaction rather than partial-writing (T-02-07).
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
}

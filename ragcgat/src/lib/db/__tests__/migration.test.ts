import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { type MessageRecord, RagChatDB } from '../db';
import { type MigratedMessageRecord, applyMigrations } from '../migrations';
import { tokenize } from '../tokenize';

let dbs: RagChatDB[] = [];

afterEach(async () => {
	for (const db of dbs) {
		try {
			await db.delete();
		} catch {
			// already deleted — ignore
		}
		try {
			await db.close();
		} catch {
			// already closed — ignore
		}
	}
	dbs = [];
});

describe('migration v1 to v2', () => {
	it('preserves all rows, backfills day, and exposes the sender index', async () => {
		const name = `migration-${randomUUID()}`;

		// Seed v1-shaped data with the frozen version(1) schema only.
		const v1 = new RagChatDB(name);
		dbs.push(v1);
		const chatId = (await v1.chats.add({
			name: 'Migrate Me',
			importedAt: Date.UTC(2026, 0, 1),
			messageCount: 3,
			participants: ['Alice', 'Bob'],
		})) as number;
		const texts = ['hello alice here', 'bob replies loudly', 'alice again'];
		const records: MessageRecord[] = texts.map((text, i) => ({
			chatId,
			timestamp: Date.UTC(2026, 0, 2, 10, i, 0),
			sender: i % 2 === 0 ? 'Alice' : 'Bob',
			text,
			type: 'text',
			mediaType: undefined,
			dedupHash: `mig-hash-${i}`,
			terms: tokenize(text),
		}));
		await v1.transaction('rw', v1.messages, async () => {
			await v1.messages.bulkAdd(records);
		});
		expect(await v1.messages.count()).toBe(3);
		await v1.close();

		// Reopen with the v2 migration registered — upgrade runs on open.
		const v2 = new RagChatDB(name);
		dbs.push(v2);
		applyMigrations(v2);
		await v2.open();

		// Zero row loss.
		expect(await v2.messages.count()).toBe(3);
		expect(await v2.chats.count()).toBe(1);

		// Backfill applied to every row.
		const all = (await v2.messages.orderBy('timestamp').limit(10).toArray()) as MigratedMessageRecord[];
		expect(all).toHaveLength(3);
		for (const m of all) {
			expect(m.day).toBe('2026-01-02');
		}

		// New sender index is queryable.
		const fromAlice = await v2.messages.where('sender').equals('Alice').limit(10).toArray();
		expect(fromAlice).toHaveLength(2);
		const fromBob = await v2.messages.where('sender').equals('Bob').limit(10).toArray();
		expect(fromBob).toHaveLength(1);

		// Pre-existing indexes still work after upgrade.
		const hits = await v2.messages.where('terms').anyOf(tokenize('replies')).distinct().limit(10).toArray();
		expect(hits).toHaveLength(1);
	});
});

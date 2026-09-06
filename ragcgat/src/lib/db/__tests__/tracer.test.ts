import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { RagChatDB, type MessageRecord } from '../db';
import { tokenize } from '../tokenize';

let db: RagChatDB | undefined;

afterEach(async () => {
	if (db) {
		await db.delete();
		await db.close();
		db = undefined;
	}
});

describe('tracer round trip', () => {
	it('writes a chat plus 20 messages and reads back newest 10 via compound index', async () => {
		db = new RagChatDB(`tracer-${randomUUID()}`);

		const chatId = (await db.chats.add({
			name: 'Family Group',
			importedAt: Date.now(),
			messageCount: 20,
			participants: ['Alice', 'Bob'],
		})) as number;

		const base = Date.now();
		const records: MessageRecord[] = Array.from({ length: 20 }, (_, i) => {
			const text = i === 7 ? 'see you at the pineapple market' : `hello message number ${i}`;
			return {
				chatId,
				timestamp: base + i * 1000,
				sender: i % 2 === 0 ? 'Alice' : 'Bob',
				text,
				type: 'text',
				mediaType: undefined,
				dedupHash: `tracer-hash-${i}`,
				terms: tokenize(text),
			};
		});

		await db.transaction('rw', db.messages, async () => {
			await db!.messages.bulkPut(records);
		});

		const newest = await db.messages
			.where('[chatId+timestamp]')
			.between([chatId, Number.NEGATIVE_INFINITY], [chatId, Number.POSITIVE_INFINITY])
			.reverse()
			.limit(10)
			.toArray();

		expect(newest).toHaveLength(10);
		for (let i = 0; i < newest.length - 1; i++) {
			expect(newest[i].timestamp).toBeGreaterThanOrEqual(newest[i + 1].timestamp);
		}
		expect(newest[0].timestamp).toBe(base + 19 * 1000);

		const hits = await db.messages
			.where('terms')
			.anyOf(tokenize('PINEAPPLE'))
			.distinct()
			.limit(10)
			.toArray();
		expect(hits).toHaveLength(1);
		expect(hits[0].text).toContain('pineapple');
	});

	it('exposes the compound, multiEntry, and unique indexes', async () => {
		db = new RagChatDB(`tracer-schema-${randomUUID()}`);
		await db.open();
		const schema = db.messages.schema;
		expect(schema.indexes.some((idx) => idx.name === '[chatId+timestamp]')).toBe(true);
		expect(
			schema.indexes.some((idx) => idx.name === 'terms' && idx.multi === true),
		).toBe(true);
		expect(
			schema.indexes.some((idx) => idx.name === 'dedupHash' && idx.unique === true),
		).toBe(true);
	});
});

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { RagChatDB } from '../../db/db';
import { ChatRepository } from '../../db/repositories';
import { parseString } from '../../parser/parseFile';
import { commitImport } from '../commit';
import { DIFF_BATCH, diffPreview } from '../preview';

const DB_BASENAME = 'upsert';
let dbs: RagChatDB[] = [];

function openDb(suffix: string): RagChatDB {
	const db = new RagChatDB(`${DB_BASENAME}-${suffix}-${randomUUID()}`);
	dbs.push(db);
	return db;
}

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

const EXPORT_A = [
	'[2024/07/09, 08:01:49] Alice: Hello',
	'[2024/07/09, 08:02:00] Bob: Hi there',
	'[2024/07/09, 08:03:10] Alice: How are you?',
].join('\n');

const EXPORT_B = `${EXPORT_A}\n[2024/07/09, 08:04:00] Bob: One more message`;

function hashesOf(text: string): string[] {
	return parseString(text).messages.map((m) => m.dedupHash);
}

describe('diffPreview', () => {
	it('all-new import yields newCount N and skipped 0', async () => {
		const db = openDb('allnew');
		const hashes = hashesOf(EXPORT_A);
		const diff = await diffPreview(db, hashes, 'Chat A');
		expect(diff.newCount).toBe(3);
		expect(diff.skippedCount).toBe(0);
		expect(diff.existingChat).toBeUndefined();
	});

	it('full re-import yields skipped N and new 0', async () => {
		const db = openDb('fulldup');
		await commitImport(db, 'Chat A', parseString(EXPORT_A));
		const diff = await diffPreview(db, hashesOf(EXPORT_A), 'Chat A');
		expect(diff.newCount).toBe(0);
		expect(diff.skippedCount).toBe(3);
		expect(diff.existingChat?.name).toBe('Chat A');
	});

	it('partial overlap splits correctly', async () => {
		const db = openDb('partial');
		await commitImport(db, 'Chat A', parseString(EXPORT_A));
		const diff = await diffPreview(db, hashesOf(EXPORT_B), 'Chat A');
		expect(diff.newCount).toBe(1);
		expect(diff.skippedCount).toBe(3);
	});

	it('findChatByName hit returns the row and miss returns undefined', async () => {
		const db = openDb('findbyname');
		const chats = new ChatRepository(db);
		await chats.saveChat({ name: 'Exists' });
		expect((await chats.findChatByName('Exists'))?.name).toBe('Exists');
		expect(await chats.findChatByName('Missing')).toBeUndefined();
	});

	it('batched diff matches unbatched counts on inputs over one batch', async () => {
		const db = openDb('batched');
		const lines = Array.from(
			{ length: DIFF_BATCH + 500 },
			(_, i) =>
				`[2024/07/09, 08:${String(Math.floor(i / 3600)).padStart(2, '0')}:${String(Math.floor(i / 60) % 60).padStart(2, '0')}] Alice: batch message ${i} unique-${randomUUID()}`,
		).join('\n');
		const parsed = parseString(lines);
		const hashes = parsed.messages.map((m) => m.dedupHash);
		expect(hashes.length).toBeGreaterThan(DIFF_BATCH);
		const before = await diffPreview(db, hashes, 'Big Chat');
		expect(before.newCount).toBe(hashes.length);
		expect(before.skippedCount).toBe(0);
		await commitImport(db, 'Big Chat', parsed);
		const after = await diffPreview(db, hashes, 'Big Chat');
		expect(after.newCount).toBe(0);
		expect(after.skippedCount).toBe(hashes.length);
	}, 30000);

	it('diff on an empty hash list returns zeros', async () => {
		const db = openDb('empty');
		const diff = await diffPreview(db, [], 'Chat A');
		expect(diff.newCount).toBe(0);
		expect(diff.skippedCount).toBe(0);
	});
});

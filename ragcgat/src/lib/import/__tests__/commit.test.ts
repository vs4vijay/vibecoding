import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { RagChatDB } from '../../db/db';
import { parseString } from '../../parser/parseFile';
import { commitImport } from '../commit';
import { buildPreview } from '../preview';

const DB_BASENAME = 'commit';

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

describe('commitImport', () => {
	it('creates a new chat and writes all messages', async () => {
		const db = openDb('new');
		const parsed = parseString(EXPORT_A);
		const { chatId, written } = await commitImport(db, 'Chat A', parsed);
		expect(chatId).toBeGreaterThan(0);
		expect(written).toBe(3);
		expect(await db.chats.count()).toBe(1);
		expect(await db.messages.where('chatId').equals(chatId).count()).toBe(3);
	});

	it('reuses chatId on existing name and bumps messageCount by written only', async () => {
		const db = openDb('reuse');
		const first = await commitImport(db, 'Chat A', parseString(EXPORT_A));
		const second = await commitImport(db, 'Chat A', parseString(EXPORT_B));
		expect(second.chatId).toBe(first.chatId);
		expect(second.written).toBe(1);
		const chat = await db.chats.get(first.chatId);
		expect(chat?.messageCount).toBe(4);
	});

	it('full re-import writes 0 rows and leaves messageCount unchanged', async () => {
		const db = openDb('idempotent');
		const parsed = parseString(EXPORT_A);
		const first = await commitImport(db, 'Chat A', parsed);
		const before = await db.chats.get(first.chatId);
		const second = await commitImport(db, 'Chat A', parseString(EXPORT_A));
		expect(second.written).toBe(0);
		expect(second.chatId).toBe(first.chatId);
		const after = await db.chats.get(first.chatId);
		expect(after?.messageCount).toBe(before?.messageCount);
	});

	it('partial overlap writes only fresh rows', async () => {
		const db = openDb('partial');
		const first = await commitImport(db, 'Chat A', parseString(EXPORT_A));
		const second = await commitImport(db, 'Chat A', parseString(EXPORT_B));
		expect(second.written).toBe(1);
		expect(await db.messages.where('chatId').equals(first.chatId).count()).toBe(4);
	});

	it('onProgress fires per chunk with monotonic written counts', async () => {
		const db = openDb('progress');
		const lines = Array.from(
			{ length: 1200 },
			(_, i) =>
				`[2024/07/09, 08:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}] Alice: progress message ${i} unique-${randomUUID()}`,
		).join('\n');
		const seen: Array<[number, number]> = [];
		const { written } = await commitImport(db, 'Big Chat', parseString(lines), (w, t) => seen.push([w, t]));
		expect(written).toBeGreaterThan(0);
		expect(seen.length).toBeGreaterThan(0);
		for (let i = 1; i < seen.length; i++) expect(seen[i][0]).toBeGreaterThanOrEqual(seen[i - 1][0]);
		expect(seen[seen.length - 1][0]).toBe(written);
	});

	it('preview-only flow leaves zero chats and messages rows (cancel semantics)', async () => {
		const db = openDb('cancel');
		const parsed = parseString(EXPORT_A);
		// Preview path: pure functions only, no Dexie writes.
		const preview = buildPreview(parsed, 'chat.txt');
		expect(preview.total).toBe(3);
		expect(await db.chats.count()).toBe(0);
		expect(await db.messages.count()).toBe(0);
	});
});

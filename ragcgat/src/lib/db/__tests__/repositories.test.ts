import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { type MessageRecord, RagChatDB } from '../db';
import { ChatRepository, MessageRepository, importChatText } from '../repositories';
import { tokenize } from '../tokenize';

const DB_BASENAME = 'repos';

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

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** Build a WhatsApp export with one message per second (unique timestamps). */
function buildExport(count: number, opts?: { word?: string; baseMs?: number }): string {
	const base = opts?.baseMs ?? Date.UTC(2026, 0, 5, 10, 0, 0);
	const lines: string[] = [];
	for (let i = 0; i < count; i++) {
		const d = new Date(base + i * 1000);
		const stamp = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
		const sender = i % 2 === 0 ? 'Alice' : 'Bob';
		const extra = opts?.word && i % 10 === 0 ? ` ${opts.word}` : '';
		lines.push(`[${stamp}] ${sender}: message number ${i}${extra}`);
	}
	return lines.join('\n');
}

function syntheticRecords(chatId: number, count: number, opts?: { tag?: string; sameTs?: number }): MessageRecord[] {
	const tag = opts?.tag ?? randomUUID();
	const base = Date.UTC(2026, 2, 10, 12, 0, 0);
	return Array.from({ length: count }, (_, i) => {
		const text = `synthetic ${tag} message ${i}`;
		return {
			chatId,
			timestamp: opts?.sameTs ?? base + i * 1000,
			sender: i % 2 === 0 ? 'Alice' : 'Bob',
			text,
			type: 'text' as const,
			mediaType: undefined,
			dedupHash: `hash-${tag}-${i}`,
			terms: tokenize(text),
		};
	});
}

async function collectAll(chatId: number, repo: MessageRepository, pageSize: number): Promise<MessageRecord[]> {
	const first = await repo.getLatestWindow(chatId, pageSize);
	const pages: MessageRecord[][] = [first];
	let cursor =
		first.length > 0
			? { timestamp: first[first.length - 1].timestamp, id: first[first.length - 1].id as number }
			: null;
	while (cursor) {
		const next = await repo.getOlderPage(chatId, cursor, pageSize);
		if (next.length === 0) break;
		pages.push(next);
		cursor = { timestamp: next[next.length - 1].timestamp, id: next[next.length - 1].id as number };
	}
	return pages.flat();
}

describe('repositories', () => {
	it('writes every row on a 2500-message import', async () => {
		const db = openDb('bulk');
		const { chatId, written } = await importChatText(db, 'Big Group', buildExport(2500));
		expect(written).toBe(2500);
		const count = await db.messages.where('chatId').equals(chatId).count();
		expect(count).toBe(2500);
	}, 30000);

	it('keeps the message count stable on re-import of the same batch', async () => {
		const db = openDb('reimport');
		const raw = buildExport(200);
		const first = await importChatText(db, 'Group', raw);
		expect(first.written).toBe(200);
		const second = await importChatText(db, 'Group', raw);
		expect(second.written).toBe(0);
		expect(await db.messages.count()).toBe(200);
	}, 30000);

	it('pages 120 messages in 30-item keyset pages with zero overlap and zero gaps', async () => {
		const db = openDb('pages');
		const chats = new ChatRepository(db);
		const repo = new MessageRepository(db);
		const chatId = await chats.saveChat({ name: 'Paged', participants: ['Alice', 'Bob'] });
		const written = await repo.bulkSave(syntheticRecords(chatId, 120, { tag: 'pages' }));
		expect(written).toBe(120);

		const p1 = await repo.getLatestWindow(chatId, 30);
		expect(p1).toHaveLength(30);
		const p2 = await repo.getOlderPage(chatId, { timestamp: p1[29].timestamp, id: p1[29].id as number }, 30);
		const p3 = await repo.getOlderPage(chatId, { timestamp: p2[29].timestamp, id: p2[29].id as number }, 30);
		const p4 = await repo.getOlderPage(chatId, { timestamp: p3[29].timestamp, id: p3[29].id as number }, 30);
		const p5 = await repo.getOlderPage(chatId, { timestamp: p4[29].timestamp, id: p4[29].id as number }, 30);
		expect(p5).toHaveLength(0);

		const all = [...p1, ...p2, ...p3, ...p4];
		const ids = all.map((m) => m.id);
		expect(new Set(ids).size).toBe(120);
		for (let i = 0; i < all.length - 1; i++) {
			expect(all[i].timestamp).toBeGreaterThanOrEqual(all[i + 1].timestamp);
		}
	});

	it('paginates same-millisecond messages without loss or duplication', async () => {
		const db = openDb('samems');
		const chats = new ChatRepository(db);
		const repo = new MessageRepository(db);
		const chatId = await chats.saveChat({ name: 'Burst' });
		const sameTs = Date.UTC(2026, 4, 1, 9, 0, 0);
		const written = await repo.bulkSave(syntheticRecords(chatId, 25, { tag: 'burst', sameTs }));
		expect(written).toBe(25);

		const all = await collectAll(chatId, repo, 10);
		expect(all).toHaveLength(25);
		expect(new Set(all.map((m) => m.id)).size).toBe(25);
	});

	it('finds case-insensitive search matches exactly once each', async () => {
		const db = openDb('search');
		const { chatId } = await importChatText(db, 'Search Group', buildExport(60, { word: 'PiNeApPlE' }));
		const repo = new MessageRepository(db);
		const { total, results } = await repo.searchMessages('pineapple');
		expect(total).toBe(6);
		expect(results).toHaveLength(6);
		expect(new Set(results.map((m) => m.id)).size).toBe(6);

		const { total: scopedTotal, results: scoped } = await repo.searchMessages('PINEAPPLE', { chatId });
		expect(scopedTotal).toBe(6);
		expect(scoped).toHaveLength(6);
		expect(scoped.every((m) => m.chatId === chatId)).toBe(true);

		expect(await repo.searchMessages('')).toEqual({ total: 0, results: [] });
		expect(await repo.searchMessages('!!!')).toEqual({ total: 0, results: [] });
	}, 30000);

	it('orders search results newest-first and caps at limit', async () => {
		const db = openDb('searchorder');
		const chats = new ChatRepository(db);
		const repo = new MessageRepository(db);
		const chatId = await chats.saveChat({ name: 'Search Order' });
		await repo.bulkSave(syntheticRecords(chatId, 60, { tag: 'order' }));
		const { total, results } = await repo.searchMessages('order', { limit: 10 });
		expect(total).toBe(60);
		expect(results).toHaveLength(10);
		for (let i = 0; i < results.length - 1; i++) {
			expect(results[i].timestamp).toBeGreaterThanOrEqual(results[i + 1].timestamp);
		}
	});

	it('getWindowAt returns target with surrounding messages', async () => {
		const db = openDb('windowat');
		const chats = new ChatRepository(db);
		const repo = new MessageRepository(db);
		const chatId = await chats.saveChat({ name: 'Window At' });
		await repo.bulkSave(syntheticRecords(chatId, 30, { tag: 'win' }));
		const all = await collectAll(chatId, repo, 30);
		const target = all[15];
		const found = await repo.getWindowAt(chatId, target.id as number, 11);
		expect(found).not.toBeNull();
		if (!found) throw new Error('expected window');
		expect(found.targetId).toBe(target.id);
		expect(found.messages.length).toBeLessThanOrEqual(11);
		expect(found.messages.some((m) => m.id === target.id)).toBe(true);
	});

	it('getWindowAt returns null for missing message and foreign chat', async () => {
		const db = openDb('windowatnull');
		const chats = new ChatRepository(db);
		const repo = new MessageRepository(db);
		const chatId = await chats.saveChat({ name: 'Null Window' });
		await repo.bulkSave(syntheticRecords(chatId, 5, { tag: 'nullwin' }));
		expect(await repo.getWindowAt(chatId, 999999, 11)).toBeNull();
		const all = await collectAll(chatId, repo, 5);
		const target = all[0];
		const otherChatId = await chats.saveChat({ name: 'Other' });
		expect(await repo.getWindowAt(otherChatId, target.id as number, 11)).toBeNull();
	}, 30000);

	it('preserves data across close plus reopen', async () => {
		const name = `${DB_BASENAME}-reopen-${randomUUID()}`;
		const db1 = new RagChatDB(name);
		dbs.push(db1);
		const { chatId } = await importChatText(db1, 'Durable', buildExport(50));
		await db1.close();

		const db2 = new RagChatDB(name);
		dbs.push(db2);
		expect(await db2.messages.where('chatId').equals(chatId).count()).toBe(50);
		const chats = await db2.chats.toArray();
		expect(chats.some((c) => c.name === 'Durable')).toBe(true);
	}, 30000);

	it('lists chats newest-first', async () => {
		const db = openDb('list');
		const chats = new ChatRepository(db);
		await chats.saveChat({ name: 'Old', importedAt: 1000 });
		await chats.saveChat({ name: 'New', importedAt: 2000 });
		const listed = await chats.listChatsNewest(10);
		expect(listed.map((c) => c.name)).toEqual(['New', 'Old']);
	});

	it('keeps every read path limit-bounded with no offset scans', () => {
		const src = readFileSync(new URL('../repositories.ts', import.meta.url), 'utf8');
		const toArrays = (src.match(/\.toArray\(\)/g) ?? []).length;
		const limits = (src.match(/\.limit\(/g) ?? []).length;
		expect(toArrays).toBeGreaterThan(0);
		expect(limits).toBeGreaterThanOrEqual(toArrays);
		expect(src).not.toMatch(/\.offset\(/);
	});

	it('rejects malformed cursors without scanning', async () => {
		const db = openDb('cursor');
		const repo = new MessageRepository(db);
		expect(await repo.getOlderPage(1, { timestamp: Number.NaN, id: 1 }, 10)).toEqual([]);
		expect(await repo.getOlderPage(1, { timestamp: 1, id: Number.POSITIVE_INFINITY }, 10)).toEqual([]);
		expect(await repo.getOlderPage(1, { timestamp: 1, id: 1 }, 0)).toEqual([]);
	});
});

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { RagChatDB } from '../../db/db';
import { ChatRepository, MessageRepository, importChatText } from '../../db/repositories';
import { searchAll, searchChat } from '../search';

const DB_BASENAME = 'searchtest';

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
			// already deleted
		}
		try {
			await db.close();
		} catch {
			// already closed
		}
	}
	dbs = [];
});

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

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

describe('searchAll', () => {
	it('returns cross-chat results with chat names', async () => {
		const db = openDb('cross');
		await importChatText(
			db,
			'Alpha Group',
			buildExport(40, { word: 'albatross', baseMs: Date.UTC(2026, 0, 5, 10, 0, 0) }),
		);
		await importChatText(
			db,
			'Beta Group',
			buildExport(40, { word: 'albatross', baseMs: Date.UTC(2026, 0, 5, 12, 0, 0) }),
		);
		const { total, results } = await searchAll('albatross', { db });
		expect(total).toBeGreaterThan(0);
		expect(results.length).toBeGreaterThan(0);
		for (const r of results) {
			expect(['Alpha Group', 'Beta Group']).toContain(r.chatName);
		}
		expect(results.some((r) => r.chatName === 'Alpha Group')).toBe(true);
		expect(results.some((r) => r.chatName === 'Beta Group')).toBe(true);
	}, 30000);

	it('returns empty for no-match query', async () => {
		const db = openDb('nomatch');
		await importChatText(db, 'Empty', buildExport(10));
		const { total, results } = await searchAll('zzzznothing', { db });
		expect(total).toBe(0);
		expect(results).toEqual([]);
	});
});

describe('searchChat', () => {
	it('scopes results to one chat', async () => {
		const db = openDb('scoped');
		await importChatText(db, 'Alpha', buildExport(30, { word: 'pineapple', baseMs: Date.UTC(2026, 0, 5, 10, 0, 0) }));
		const { chatId } = await importChatText(
			db,
			'Beta',
			buildExport(30, { word: 'pineapple', baseMs: Date.UTC(2026, 0, 5, 12, 0, 0) }),
		);
		const { total, results } = await searchChat(chatId, 'pineapple', { db });
		expect(total).toBe(3);
		expect(results.every((r) => r.message.chatId === chatId)).toBe(true);
		for (const r of results) {
			expect(r.chatName).toBe('Beta');
		}
	}, 30000);
});

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { commitImport } from '../../import/commit';
import type { Chat } from '../../parser/types';
import type { MessageRecord } from '../db';
import { RagChatDB } from '../db';
import { applyMigrations } from '../migrations';
import { ChatRepository } from '../repositories';
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

/** Open an isolated DB with the full migration chain registered. */
async function openMigrated(): Promise<RagChatDB> {
	const db = new RagChatDB(`ordering-${randomUUID()}`);
	dbs.push(db);
	applyMigrations(db);
	await db.open();
	return db;
}

function messageRecord(chatId: number, timestamp: number, sender: string, text: string, tag: string): MessageRecord {
	return {
		chatId,
		timestamp,
		sender,
		text,
		type: 'text',
		mediaType: undefined,
		dedupHash: `ordering-${tag}`,
		terms: tokenize(text),
	};
}

async function seedMessages(db: RagChatDB, chatId: number, rows: { ts: number; sender: string; text: string }[]) {
	await db.transaction('rw', db.messages, async () => {
		await db.messages.bulkAdd(
			rows.map((r, i) => messageRecord(chatId, r.ts, r.sender, r.text, `${randomUUID()}-${i}`)),
		);
	});
}

function parsedChat(tag: string, rows: { ts: number; sender: string; text: string }[]): Chat {
	return {
		messages: rows.map((r, i) => ({
			timestamp: r.ts,
			sender: r.sender,
			text: r.text,
			type: 'text' as const,
			mediaType: undefined,
			dedupHash: `commit-${tag}-${randomUUID()}-${i}`,
			rawLine: '',
			originalTimezone: '',
		})),
		participants: [...new Set(rows.map((r) => r.sender))],
		messageCount: rows.length,
		participantCount: new Set(rows.map((r) => r.sender)).size,
		capWarning: null,
	};
}

describe('sidebar ordering after out-of-order commits', () => {
	it('listChatsNewest follows max message time, not import order', async () => {
		const db = await openMigrated();
		const chats = new ChatRepository(db);

		await commitImport(
			db,
			'Early Import',
			parsedChat('early', [
				{ ts: Date.UTC(2026, 5, 20, 12), sender: 'Alice', text: 'newer conversation here' },
				{ ts: Date.UTC(2026, 5, 21, 12), sender: 'Bob', text: 'still the newest message' },
			]),
		);
		await commitImport(
			db,
			'Late Import',
			parsedChat('late', [{ ts: Date.UTC(2026, 0, 5, 12), sender: 'Carol', text: 'imported later but older content' }]),
		);

		const newest = await chats.listChatsNewest();
		expect(newest.map((c) => c.name)).toEqual(['Early Import', 'Late Import']);
		expect(newest[0].lastMessageAt).toBe(Date.UTC(2026, 5, 21, 12));
		expect(newest[1].lastMessageAt).toBe(Date.UTC(2026, 0, 5, 12));
	});
});

describe('v3 migration', () => {
	/** Seed v1-shaped rows, then reopen the same name with migrations registered. */
	async function migrate(name: string, seed: (v1: RagChatDB) => Promise<void>): Promise<RagChatDB> {
		const v1 = new RagChatDB(name);
		dbs.push(v1);
		await seed(v1);
		await v1.close();
		const v3 = new RagChatDB(name);
		dbs.push(v3);
		applyMigrations(v3);
		await v3.open();
		return v3;
	}

	it('backfills lastMessageAt, lastSnippet, and lastSender from the newest message', async () => {
		const v3 = await migrate(`ordering-backfill-${randomUUID()}`, async (v1) => {
			const chatId = (await v1.chats.add({
				name: 'Normal',
				importedAt: Date.UTC(2026, 0, 1),
				messageCount: 3,
				participants: ['Alice', 'Bob'],
			})) as number;
			await seedMessages(v1, chatId, [
				{ ts: Date.UTC(2026, 0, 2, 10), sender: 'Alice', text: 'first hello world' },
				{ ts: Date.UTC(2026, 0, 4, 10), sender: 'Bob', text: 'newest message text here' },
				{ ts: Date.UTC(2026, 0, 3, 10), sender: 'Alice', text: 'middle message content' },
			]);
		});

		const chat = await v3.chats.where('name').equals('Normal').first();
		expect(chat?.lastMessageAt).toBe(Date.UTC(2026, 0, 4, 10));
		expect(chat?.lastSnippet).toBe('newest message text here');
		expect(chat?.lastSender).toBe('Bob');
	});

	it('falls back to importedAt with empty snippet and sender for message-less chats', async () => {
		const importedAt = Date.UTC(2026, 2, 10, 8);
		const v3 = await migrate(`ordering-empty-${randomUUID()}`, async (v1) => {
			await v1.chats.add({ name: 'Empty', importedAt, messageCount: 0, participants: [] });
		});

		const chat = await v3.chats.where('name').equals('Empty').first();
		expect(chat?.lastMessageAt).toBe(importedAt);
		expect(chat?.lastSnippet).toBe('');
		expect(chat?.lastSender).toBe('');
	});

	it('leaves already-migrated rows untouched', async () => {
		const v3 = await migrate(`ordering-idempotent-${randomUUID()}`, async (v1) => {
			const chatId = (await v1.chats.add({
				name: 'Migrated',
				importedAt: Date.UTC(2026, 0, 1),
				lastMessageAt: 12345,
				lastSnippet: 'keep me around',
				lastSender: 'Keeper',
				messageCount: 1,
				participants: ['Keeper'],
			})) as number;
			await seedMessages(v1, chatId, [
				{ ts: Date.UTC(2026, 5, 1, 10), sender: 'Newbie', text: 'newer but must not win' },
			]);
		});

		const chat = await v3.chats.where('name').equals('Migrated').first();
		expect(chat?.lastMessageAt).toBe(12345);
		expect(chat?.lastSnippet).toBe('keep me around');
		expect(chat?.lastSender).toBe('Keeper');
	});

	it('supports a fresh install straight onto v3', async () => {
		const db = await openMigrated();
		const chats = new ChatRepository(db);
		await chats.saveChat({ name: 'Fresh', messageCount: 0, participants: [] });

		const rows = await chats.listChatsNewest();
		expect(rows).toHaveLength(1);
		expect(rows[0].name).toBe('Fresh');
		expect(typeof rows[0].lastMessageAt).toBe('number');
	});
});

describe('commitImport stat maintenance', () => {
	it('stores the three denormalized fields on new chats, truncated to 140 chars', async () => {
		const db = await openMigrated();
		const long = `x${'y'.repeat(200)}`;
		const { chatId } = await commitImport(
			db,
			'New Chat',
			parsedChat('new', [
				{ ts: Date.UTC(2026, 4, 1, 9), sender: 'Alice', text: 'older words here' },
				{ ts: Date.UTC(2026, 4, 2, 9), sender: 'Bob', text: long },
			]),
		);

		const chat = await db.chats.get(chatId);
		expect(chat?.lastMessageAt).toBe(Date.UTC(2026, 4, 2, 9));
		expect(chat?.lastSnippet).toHaveLength(140);
		expect(chat?.lastSender).toBe('Bob');
	});

	it('upsert merges advance on newer batches and never roll back on older ones', async () => {
		const db = await openMigrated();
		const chats = new ChatRepository(db);

		const first = await commitImport(
			db,
			'Merge Chat',
			parsedChat('batch1', [{ ts: Date.UTC(2026, 3, 1, 10), sender: 'Alice', text: 'batch one content' }]),
		);
		const newer = await commitImport(
			db,
			'Merge Chat',
			parsedChat('batch2', [{ ts: Date.UTC(2026, 3, 5, 10), sender: 'Bob', text: 'batch two is newer' }]),
		);
		expect(newer.chatId).toBe(first.chatId);
		expect((await db.chats.get(first.chatId))?.lastMessageAt).toBe(Date.UTC(2026, 3, 5, 10));
		expect((await db.chats.get(first.chatId))?.lastSender).toBe('Bob');

		await commitImport(
			db,
			'Merge Chat',
			parsedChat('batch3', [{ ts: Date.UTC(2026, 1, 1, 10), sender: 'Carol', text: 'stale export must not win' }]),
		);
		const merged = await db.chats.get(first.chatId);
		expect(merged?.lastMessageAt).toBe(Date.UTC(2026, 3, 5, 10));
		expect(merged?.lastSnippet).toBe('batch two is newer');
		expect(merged?.messageCount).toBe(3);
		expect((await chats.listChatsNewest()).map((c) => c.name)).toEqual(['Merge Chat']);
	});
});

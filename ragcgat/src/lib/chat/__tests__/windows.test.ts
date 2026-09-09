import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '../../db/db';
import {
	MAX_RENDERED_PAGES,
	PAGE_SIZE,
	assertRenderBudget,
	cursorOf,
	emptyWindow,
	prependPage,
	renderedCount,
} from '../windows';

function msg(id: number, timestamp: number): MessageRecord {
	return {
		id,
		chatId: 7,
		timestamp,
		sender: 'Alice',
		text: `message ${id}`,
		type: 'text',
		mediaType: undefined,
		dedupHash: `window-${id}`,
		terms: [],
	};
}

function fullPage(startId: number, baseTs: number): MessageRecord[] {
	return Array.from({ length: PAGE_SIZE }, (_, i) => msg(startId + i, baseTs + i * 1000));
}

describe('cursorOf', () => {
	it('returns null on empty state', () => {
		expect(cursorOf(emptyWindow(7))).toBeNull();
	});

	it('reads the oldest held message', () => {
		const state = { ...emptyWindow(7), pages: [[msg(3, 3000), msg(5, 5000)]] };
		expect(cursorOf(state)).toEqual({ timestamp: 3000, id: 3 });
	});
});

describe('prependPage', () => {
	it('prepends an older page ahead of the held pages', () => {
		const newer = [msg(10, 10_000), msg(11, 11_000)];
		const older = [msg(8, 8000), msg(9, 9000)];
		const next = prependPage({ ...emptyWindow(7), pages: [newer] }, older);
		expect(next.pages).toHaveLength(2);
		expect(next.pages[0]).toEqual(older);
		expect(next.pages[1]).toEqual(newer);
		expect(next.hasMore).toBe(false);
	});

	it('keeps at most MAX_RENDERED_PAGES newest pages', () => {
		expect(MAX_RENDERED_PAGES).toBe(3);
		const p1 = fullPage(1, 1000);
		const p2 = fullPage(101, 2000);
		const p3 = fullPage(201, 3000);
		const p0 = fullPage(1001, 500);
		const next = prependPage({ ...emptyWindow(7), pages: [p1, p2, p3] }, p0);
		expect(next.pages).toHaveLength(MAX_RENDERED_PAGES);
		expect(next.pages[next.pages.length - 1]).toEqual(p3);
	});

	it('sets hasMore false on an empty page and keeps held pages', () => {
		const held = [msg(10, 10_000)];
		const next = prependPage({ ...emptyWindow(7), pages: [held] }, []);
		expect(next.hasMore).toBe(false);
		expect(next.pages).toEqual([held]);
	});

	it('sets hasMore false on a short page and true on a full page', () => {
		expect(prependPage(emptyWindow(7), [msg(1, 1000)]).hasMore).toBe(false);
		expect(prependPage(emptyWindow(7), fullPage(1, 1000)).hasMore).toBe(true);
		expect(PAGE_SIZE).toBe(40);
	});
});

describe('renderedCount and assertRenderBudget', () => {
	it('sums messages across pages', () => {
		const state = {
			...emptyWindow(7),
			pages: [[msg(1, 1000), msg(2, 2000)], [msg(3, 3000)]],
		};
		expect(renderedCount(state)).toBe(3);
		expect(renderedCount(emptyWindow(7))).toBe(0);
	});

	it('passes under the cap and throws over it', () => {
		const over = {
			...emptyWindow(7),
			pages: [
				fullPage(1, 1000),
				fullPage(101, 2000),
				fullPage(201, 3000),
				fullPage(301, 4000),
				fullPage(401, 5000),
				fullPage(501, 6000),
			],
		};
		expect(renderedCount(over)).toBe(240);
		expect(() => assertRenderBudget(over)).toThrow();
		expect(() => assertRenderBudget(emptyWindow(7))).not.toThrow();
		expect(() => assertRenderBudget({ ...emptyWindow(7), pages: [[msg(1, 1000)]] }, 0)).toThrow();
	});
});

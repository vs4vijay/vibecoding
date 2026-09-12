import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '../../db/db';
import {
	MAX_RENDERED_PAGES,
	PAGE_SIZE,
	anchorDelta,
	assertRenderBudget,
	cursorOf,
	emptyWindow,
	groupForRender,
	isSameDay,
	prependPage,
	renderedCount,
	seedWindow,
	trimToBudget,
} from '../windows';

function msg(id: number, timestamp: number, sender = 'Alice'): MessageRecord {
	return {
		id,
		chatId: 1,
		timestamp,
		sender,
		text: `msg ${id}`,
		type: 'text',
		dedupHash: `h${id}`,
		terms: [],
	};
}

function fullPage(startId: number, baseTs: number): MessageRecord[] {
	return Array.from({ length: PAGE_SIZE }, (_, i) => msg(startId + i, baseTs + i * 1000));
}

/** 5 full pages (200 messages) oldest-first, as if held after 2 trims. */
function fivePageState() {
	return {
		chatId: 1,
		pages: [
			fullPage(0, 0),
			fullPage(PAGE_SIZE, 40_000),
			fullPage(PAGE_SIZE * 2, 80_000),
			fullPage(PAGE_SIZE * 3, 120_000),
			fullPage(PAGE_SIZE * 4, 160_000),
		],
		hasMore: true,
		loading: false,
	};
}

function todayNoon(): number {
	const d = new Date();
	d.setHours(12, 0, 0, 0);
	return d.getTime();
}

describe('cursorOf', () => {
	it('returns null on empty state', () => {
		expect(cursorOf(emptyWindow(7))).toBeNull();
	});

	it('reads the oldest held message', () => {
		const state = prependPage(emptyWindow(1), [msg(10, 1000), msg(11, 2000)]);
		expect(cursorOf(state)).toEqual({ timestamp: 1000, id: 10 });
	});
});

describe('prependPage', () => {
	it('prepends an older page ahead of the held pages', () => {
		let state = prependPage(emptyWindow(1), [msg(10, 1000), msg(11, 2000)]);
		state = prependPage(state, [msg(1, 500), msg(2, 600)]);
		expect(state.pages).toHaveLength(2);
		expect(state.pages[0][0].id).toBe(1);
		expect(state.pages[1][0].id).toBe(10);
	});

	it('keeps at most MAX_RENDERED_PAGES oldest pages', () => {
		// Load newest page first, then progressively older pages (production order).
		let state = emptyWindow(1);
		for (let i = 5; i > 0; i--) {
			state = prependPage(state, fullPage((i - 1) * PAGE_SIZE, (i - 1) * 40_000));
		}
		expect(state.pages.length).toBe(MAX_RENDERED_PAGES);
		// The NEWEST two pages were trimmed away; the oldest three survive —
		// the frontier the user is scrolling into.
		expect(state.pages[0][0].id).toBe(0);
		expect(state.pages[state.pages.length - 1][0].id).toBe(PAGE_SIZE * 2);
	});

	it('sets hasMore false on an empty page and keeps held pages', () => {
		const state = prependPage(emptyWindow(1), [msg(1, 100)]);
		const next = prependPage(state, []);
		expect(next.hasMore).toBe(false);
		expect(next.pages).toEqual(state.pages);
	});

	it('sets hasMore false on a short page and true on a full page', () => {
		const short = prependPage(emptyWindow(1), [msg(1, 100)]);
		expect(short.hasMore).toBe(false);
		const full = prependPage(emptyWindow(1), fullPage(1, 1000));
		expect(full.hasMore).toBe(true);
	});
});

describe('renderedCount and assertRenderBudget', () => {
	it('sums messages across pages', () => {
		const state = {
			chatId: 1,
			pages: [fullPage(1, 0), fullPage(PAGE_SIZE + 1, 40_000)],
			hasMore: true,
			loading: false,
		};
		expect(renderedCount(state)).toBe(PAGE_SIZE * 2);
	});

	it('passes under the cap and throws over it', () => {
		// 6 full pages = 240 rendered, exceeding the default 200 cap.
		const over = { ...emptyWindow(1), pages: [0, 1, 2, 3, 4, 5].map((i) => fullPage(i * PAGE_SIZE, i * 40_000)) };
		expect(() => assertRenderBudget(over)).toThrow('render budget exceeded');
		expect(() => assertRenderBudget(prependPage(emptyWindow(1), fullPage(1, 1000)))).not.toThrow();
	});
});

describe('isSameDay', () => {
	it('returns true for timestamps on the same calendar day', () => {
		expect(isSameDay(new Date(2026, 5, 14, 8).getTime(), new Date(2026, 5, 14, 23).getTime())).toBe(true);
	});

	it('returns false for timestamps on different days', () => {
		expect(isSameDay(new Date(2026, 5, 14, 12).getTime(), new Date(2026, 5, 15, 12).getTime())).toBe(false);
	});

	it('returns false for timestamps 1ms apart around midnight', () => {
		expect(
			isSameDay(new Date(2026, 5, 15, 0, 0, 0, 0).getTime(), new Date(2026, 5, 14, 23, 59, 59, 999).getTime()),
		).toBe(false);
	});
});

describe('anchorDelta', () => {
	it('computes the correct new scrollTop when content grows above', () => {
		expect(anchorDelta(1000, 2000, 500)).toBe(1500);
	});

	it('does not change scrollTop when height is unchanged', () => {
		expect(anchorDelta(1000, 1000, 500)).toBe(500);
	});

	it('handles scroll at the very top of the container', () => {
		expect(anchorDelta(1000, 1800, 0)).toBe(800);
	});
});

describe('groupForRender', () => {
	it('groups messages by day', () => {
		const today = todayNoon();
		const yesterday = today - 86_400_000;
		const todayMessages = [msg(1, today, 'Alice'), msg(2, today + 1000, 'Bob')];
		const yesterdayMessages = [msg(3, yesterday, 'Alice')];
		const sections = groupForRender([todayMessages, yesterdayMessages]);
		expect(sections).toHaveLength(2);
		expect(sections[0].label).toBe('Today');
		expect(sections[0].messages).toHaveLength(2);
		expect(sections[1].label).toBe('Yesterday');
		expect(sections[1].messages).toHaveLength(1);
	});

	it('suppresses sender headers for consecutive same-sender runs', () => {
		const today = todayNoon();
		const messages = [msg(1, today, 'Alice'), msg(2, today + 1000, 'Alice'), msg(3, today + 2000, 'Alice')];
		const sections = groupForRender([messages]);
		expect(sections).toHaveLength(1);
		expect(sections[0].messages[0].showSender).toBe(true);
		expect(sections[0].messages[1].showSender).toBe(false);
		expect(sections[0].messages[2].showSender).toBe(false);
	});

	it('resets sender tracking across day boundaries', () => {
		const today = todayNoon();
		const yesterday = today - 86_400_000;
		const sections = groupForRender([[msg(1, yesterday, 'Alice'), msg(2, today, 'Alice')]]);
		expect(sections).toHaveLength(2);
		expect(sections[0].messages[0].showSender).toBe(true);
		expect(sections[1].messages[0].showSender).toBe(true);
	});

	it('returns an empty array for empty pages', () => {
		expect(groupForRender([])).toEqual([]);
		expect(groupForRender([[]])).toEqual([]);
	});

	it('flags each sender change inside one day', () => {
		const today = todayNoon();
		const messages = [msg(1, today, 'Alice'), msg(2, today + 1000, 'Bob'), msg(3, today + 2000, 'Alice')];
		const sections = groupForRender([messages]);
		expect(sections).toHaveLength(1);
		expect(sections[0].messages[0].showSender).toBe(true); // Alice
		expect(sections[0].messages[1].showSender).toBe(true); // Bob
		expect(sections[0].messages[2].showSender).toBe(true); // Alice again (differs from Bob)
	});

	it('merges adjacent same-day pages into a single section', () => {
		const today = todayNoon();
		const sections = groupForRender([
			[msg(1, today, 'Alice'), msg(2, today + 1000, 'Bob')],
			[msg(3, today + 2000, 'Alice')],
		]);
		expect(sections).toHaveLength(1);
		expect(sections[0].messages).toHaveLength(3);
	});
});

describe('trimToBudget', () => {
	it('does nothing when within budget', () => {
		const state = prependPage(emptyWindow(1), fullPage(1, 1000));
		expect(trimToBudget(state)).toBe(state); // same reference when no trim needed
	});

	it('keeps the oldest pages when over budget', () => {
		const trimmed = trimToBudget(fivePageState());
		expect(trimmed.pages.length).toBe(MAX_RENDERED_PAGES);
		// Oldest 3 pages survive: ids 0..119, timestamps 0..119000.
		expect(trimmed.pages[0][0].id).toBe(0);
		expect(trimmed.pages[0][0].timestamp).toBe(0);
		expect(trimmed.pages[trimmed.pages.length - 1][0].id).toBe(PAGE_SIZE * 2);
		expect(trimmed.pages[trimmed.pages.length - 1][0].timestamp).toBe(80_000);
	});

	it('cursor is unchanged after trim — the next read is strictly older, never a held re-read', () => {
		const state = fivePageState();
		expect(cursorOf(state)).toEqual({ timestamp: 0, id: 0 });
		// The trimmed window must offer the same keyset cursor as before the
		// trim: prependPage loads OLDER rows, so dropping the newest page must
		// not move the frontier. (The previous slice(-N) trim dropped the
		// just-loaded page and made every subsequent load re-read one keyset.)
		expect(cursorOf(trimToBudget(state))).toEqual({ timestamp: 0, id: 0 });
	});
});

describe('simulated-100K budget', () => {
	it('stays within the 200-node cap after 2500 prepends (100K messages)', () => {
		// Newest page first, then older pages, as production loads them.
		let state = emptyWindow(1);
		for (let i = 2500; i > 0; i--) {
			state = prependPage(state, fullPage((i - 1) * PAGE_SIZE, (i - 1) * 40_000));
		}
		expect(state.pages.length).toBeLessThanOrEqual(MAX_RENDERED_PAGES);
		assertRenderBudget(state); // ≤ 120 rendered regardless of 100K total
	});
});

describe('seedWindow', () => {
	it('creates a window with one page and correct hasMore', () => {
		const messages = fullPage(1, 0);
		const state = seedWindow(42, messages);
		expect(state.chatId).toBe(42);
		expect(state.pages).toHaveLength(1);
		expect(state.pages[0]).toBe(messages);
		expect(state.hasMore).toBe(true); // PAGE_SIZE messages = hasMore true
		expect(state.loading).toBe(false);
	});

	it('sets hasMore false when fewer than PAGE_SIZE', () => {
		const messages = Array.from({ length: 5 }, (_, i) => msg(i, i * 1000));
		const state = seedWindow(1, messages);
		expect(state.hasMore).toBe(false);
	});

	it('cursorOf reads the oldest message from seeded window', () => {
		const messages = fullPage(100, 1000);
		const state = seedWindow(1, messages);
		expect(cursorOf(state)).toEqual({ timestamp: 1000, id: 100 });
	});

	it('prependPage works after seedWindow', () => {
		const messages = fullPage(100, 1000);
		const state = seedWindow(1, messages);
		const older = Array.from({ length: 5 }, (_, i) => msg(i, i * 1000));
		const next = prependPage(state, older);
		expect(next.pages).toHaveLength(2);
		expect(next.pages[0]).toBe(older);
		expect(next.pages[1]).toBe(messages);
	});
});

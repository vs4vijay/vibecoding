import type { MessageRecord } from '../db/db';
import type { PageCursor } from '../db/repositories';

export const PAGE_SIZE = 40;
export const MAX_RENDERED_PAGES = 3;

/**
 * Capped message-window state machine (pure — no DOM, no Dexie).
 * `pages` holds display-ready chronological pages, OLDEST page first, so
 * cursorOf reads the oldest held message at pages[0][0] and ChatView renders
 * pages in order without flipping.
 */
export interface WindowState {
	chatId: number;
	pages: MessageRecord[][];
	hasMore: boolean;
	loading: boolean;
}

export function emptyWindow(chatId: number): WindowState {
	return { chatId, pages: [], hasMore: true, loading: false };
}

/** Cursor for the next keyset read: the oldest held message; null when empty. */
export function cursorOf(state: WindowState): PageCursor | null {
	const oldest = state.pages[0]?.[0];
	return oldest && typeof oldest.id === 'number' ? { timestamp: oldest.timestamp, id: oldest.id } : null;
}

/**
 * Prepend an older (chronological) page, keeping at most MAX_RENDERED_PAGES
 * NEWEST pages — slice(-N) drops the oldest rendered page; its messages stay
 * in the DB and are reachable again via the recomputed pages[0][0] cursor
 * (a re-read, never data loss). An empty page means the keyset is exhausted;
 * a short page (fewer than PAGE_SIZE) closes the window too.
 */
export function prependPage(state: WindowState, page: MessageRecord[]): WindowState {
	if (page.length === 0) return { ...state, hasMore: false, loading: false };
	return {
		...state,
		pages: [page, ...state.pages].slice(-MAX_RENDERED_PAGES),
		hasMore: page.length === PAGE_SIZE,
		loading: false,
	};
}

export function renderedCount(state: WindowState): number {
	return state.pages.reduce((n, p) => n + p.length, 0);
}

/** Hard render-budget invariant (SC-4 shell); throws when the window exceeds cap. */
export function assertRenderBudget(state: WindowState, cap = 200): void {
	const count = renderedCount(state);
	if (count > cap) throw new Error(`render budget exceeded: ${count} > ${cap}`);
}

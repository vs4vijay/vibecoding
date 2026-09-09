import type { MessageRecord } from '../db/db';
import type { PageCursor } from '../db/repositories';
import { formatDayLabel } from './formatting';

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
 * NEWEST pages — trimToBudget drops the oldest rendered page; its messages
 * stay in the DB and are reachable again via the recomputed pages[0][0]
 * cursor (a re-read, never data loss). An empty page means the keyset is
 * exhausted; a short page (fewer than PAGE_SIZE) closes the window too.
 */
export function prependPage(state: WindowState, page: MessageRecord[]): WindowState {
	if (page.length === 0) return { ...state, hasMore: false, loading: false };
	return trimToBudget({
		...state,
		pages: [page, ...state.pages],
		hasMore: page.length === PAGE_SIZE,
		loading: false,
	});
}

export function renderedCount(state: WindowState): number {
	return state.pages.reduce((n, p) => n + p.length, 0);
}

/** Hard render-budget invariant (SC-4 shell); throws when the window exceeds cap. */
export function assertRenderBudget(state: WindowState, cap = 200): void {
	const count = renderedCount(state);
	if (count > cap) throw new Error(`render budget exceeded: ${count} > ${cap}`);
}

/** Two timestamps fall on the same calendar day (UTC-agnostic; uses viewer locale like formatDayLabel). */
export function isSameDay(a: number, b: number): boolean {
	const da = new Date(a);
	const db = new Date(b);
	return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

/**
 * Pure scroll-anchor helper: after content prepends above the viewport,
 * compute the new scrollTop so the user sees the same messages (no jump).
 */
export function anchorDelta(oldHeight: number, newHeight: number, oldTop: number): number {
	return oldTop + (newHeight - oldHeight);
}

export interface MessageGroup {
	message: MessageRecord;
	showSender: boolean;
}

export interface DaySection {
	label: string;
	messages: MessageGroup[];
}

/**
 * Fold chronological pages into day sections for rendering.
 * A DateSeparator is emitted per day; consecutive same-sender messages
 * share one header (showSender = false after the first in each run).
 */
export function groupForRender(pages: MessageRecord[][]): DaySection[] {
	const sections: DaySection[] = [];
	let currentLabel = '';
	let currentMessages: MessageGroup[] = [];
	let prevSender = '';

	for (const page of pages) {
		for (const message of page) {
			const label = formatDayLabel(message.timestamp);
			if (label !== currentLabel) {
				if (currentMessages.length > 0 || currentLabel) {
					sections.push({ label: currentLabel, messages: currentMessages });
				}
				currentLabel = label;
				currentMessages = [];
				prevSender = '';
			}
			const showSender = message.sender !== prevSender;
			prevSender = message.sender;
			currentMessages.push({ message, showSender });
		}
	}

	if (currentMessages.length > 0 || currentLabel) {
		sections.push({ label: currentLabel, messages: currentMessages });
	}

	return sections;
}

/**
 * Trim window to at most MAX_RENDERED_PAGES NEWEST pages.
 * The dropped oldest page is still in IndexedDB; cursor recompute from
 * pages[0][0] makes it re-fetchable on scroll-up.
 */
export function trimToBudget(state: WindowState): WindowState {
	if (state.pages.length <= MAX_RENDERED_PAGES) return state;
	return { ...state, pages: state.pages.slice(-MAX_RENDERED_PAGES) };
}

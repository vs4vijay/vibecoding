import { browser } from '$app/environment';
import { liveQuery } from 'dexie';
import { type ChatRecord, type MessageRecord, type RagChatDB, db } from '../db/db';
import { MessageRepository } from '../db/repositories';

/**
 * Dexie liveQuery wrappers. Wave-0 confirmed against the installed dexie
 * 4.4.5: liveQuery is exported from the package root, takes a synchronous
 * querier, and returns an Observable whose .subscribe({ next, error }) yields
 * a handle with unsubscribe().
 *
 * Rules: call only inside $effect/onMount behind the browser guard (prerender
 * has no IndexedDB); one subscription per view; always unsubscribe (the
 * $effect return value does it); never await liveQuery — it is not a promise.
 */

export interface ObserveChatsOptions {
	/** DB instance; defaults to the app singleton (tests inject isolated instances). */
	source?: RagChatDB;
	/** Sidebar cap. */
	limit?: number;
}

/**
 * Sidebar feed ordered by the indexed lastMessageAt field (newest-first) —
 * order comes from the index; any commitImport repaints subscribers without a
 * manual refresh.
 */
export function observeChats(onNext: (rows: ChatRecord[]) => void, opts: ObserveChatsOptions = {}): () => void {
	if (!browser) return () => {};
	const source = opts.source ?? db;
	const sub = liveQuery(() =>
		source.chats
			.orderBy('lastMessageAt')
			.reverse()
			.limit(opts.limit ?? 100)
			.toArray(),
	).subscribe({
		next: onNext,
		error: (e) => console.error('observeChats failed', e),
	});
	return () => sub.unsubscribe();
}

/** Live newest-window feed for one chat (newest-first), capped at limit. */
export function observeLatest(
	chatId: number,
	limit: number,
	onNext: (rows: MessageRecord[]) => void,
	source: RagChatDB = db,
): () => void {
	if (!browser) return () => {};
	const messages = new MessageRepository(source);
	const sub = liveQuery(() => messages.getLatestWindow(chatId, limit)).subscribe({
		next: onNext,
		error: (e) => console.error('observeLatest failed', e),
	});
	return () => sub.unsubscribe();
}

<script lang="ts">
import {
	PAGE_SIZE,
	type WindowState,
	assertRenderBudget,
	cursorOf,
	emptyWindow,
	groupForRender,
	prependPage,
} from '$lib/chat/windows';
import type { ChatRecord } from '$lib/db/db';
import { db } from '$lib/db/db';
import { MessageRepository } from '$lib/db/repositories';
import { tick } from 'svelte';
import DateSeparator from './DateSeparator.svelte';
import MessageBubble from './MessageBubble.svelte';

const {
	chat,
	selectedId = null,
}: {
	chat: ChatRecord | undefined;
	selectedId?: number | null;
} = $props();

let win = $state<WindowState | null>(null);
let loadingOlder = $state(false);
// biome-ignore lint/style/useConst: Svelte bind:this requires a let binding
let scrollEl = $state<HTMLElement | null>(null);
// biome-ignore lint/style/useConst: Svelte bind:this requires a let binding
let sentinelEl = $state<HTMLElement | null>(null);

const messages = new MessageRepository(db);

// One shared IntersectionObserver per ChatView (Pitfall 6: zero per-bubble observers).
// No {@html} anywhere — escaped interpolation only (T-04-01 / Pitfall 5).
// No flex-col-reverse (Pitfall 2) — chronological DOM, scrollTop pinned to scrollHeight.

// Capped window: newest PAGE_SIZE rows via keyset read, trimmed to MAX_RENDERED_PAGES.
// Dexie contact stays behind the browser guard in $effect (prerender has no IndexedDB).
$effect(() => {
	const chatId = chat?.id;
	if (!browser || typeof chatId !== 'number') {
		win = null;
		return;
	}
	let cancelled = false;
	win = null;
	void (async () => {
		const newestFirst = await messages.getLatestWindow(chatId, PAGE_SIZE);
		if (cancelled) return;
		const next = prependPage(emptyWindow(chatId), [...newestFirst].reverse());
		assertRenderBudget(next);
		win = next;
		await tick();
		// Pin to the newest message: chronological DOM, explicit scrollTop
		// (never flex-col-reverse), only after Svelte flushed the rows.
		if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
		void setupSentinel();
	})();
	return () => {
		cancelled = true;
		activeObserver?.disconnect();
		activeObserver = null;
	};
});

async function setupSentinel() {
	// Disconnect any prior observer (chat change or re-setup).
	activeObserver?.disconnect();
	const el = sentinelEl;
	if (!el) return;
	const obs = new IntersectionObserver(
		(entries) => {
			if (entries[0]?.isIntersecting) {
				void loadOlder();
			}
		},
		{ root: scrollEl, threshold: 0 },
	);
	obs.observe(el);
	activeObserver = obs;
}

async function loadOlder() {
	const current = win;
	if (!browser || !current || loadingOlder || !current.hasMore) return;
	const cursor = cursorOf(current);
	if (!cursor) return;
	const prevHeight = scrollEl?.scrollHeight ?? 0;
	const prevTop = scrollEl?.scrollTop ?? 0;
	loadingOlder = true;
	try {
		const olderNewestFirst = await messages.getOlderPage(current.chatId, cursor, PAGE_SIZE);
		const next = prependPage(current, [...olderNewestFirst].reverse());
		assertRenderBudget(next);
		win = next;
		await tick();
		if (scrollEl) scrollEl.scrollTop = prevTop + (scrollEl.scrollHeight - prevHeight);
	} finally {
		loadingOlder = false;
	}
}

const sections = $derived(win ? groupForRender(win.pages) : []);
</script>

<div class="flex h-full min-h-0 flex-col">
	{#if chat}
		<header class="flex items-baseline justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
			<h2 class="truncate font-semibold">{chat.name}</h2>
			<span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">{chat.messageCount} messages</span>
		</header>
		<div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
			{#if win === null}
				<p class="text-center text-sm text-gray-500 dark:text-gray-400" role="status">Loading…</p>
			{:else if sections.length === 0}
				<div class="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
					<p class="text-sm text-gray-500 dark:text-gray-400">This conversation has no messages.</p>
					<p class="text-xs text-gray-400 dark:text-gray-500">Import a chat export to populate it.</p>
				</div>
			{:else}
				<div bind:this={sentinelEl} class="h-px"></div>
				{#if win.hasMore}
					<button
						type="button"
						class="mx-auto mb-3 block rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
						disabled={loadingOlder}
						onclick={() => void loadOlder()}
					>
						{loadingOlder ? 'Loading…' : 'Load older'}
					</button>
				{/if}
				{#each sections as section (section.label)}
					<DateSeparator label={section.label} />
					{#each section.messages as group (group.message.id)}
						<MessageBubble message={group.message} showSender={group.showSender} />
					{/each}
				{/each}
			{/if}
		</div>
	{:else}
		<div class="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
			{#if selectedId !== null}
				<!-- Unknown ?chat= id: empty state, never a throw (T-04-02) -->
				<p class="text-sm text-gray-500 dark:text-gray-400">Conversation not found.</p>
			{:else}
				<p class="text-sm text-gray-500 dark:text-gray-400">Select a conversation to read it here.</p>
			{/if}
		</div>
	{/if}
</div>

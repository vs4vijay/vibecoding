<script lang="ts">
import { browser } from '$app/environment';
import { PAGE_SIZE, type WindowState, assertRenderBudget, cursorOf, emptyWindow, prependPage } from '$lib/chat/windows';
import type { ChatRecord } from '$lib/db/db';
import { db } from '$lib/db/db';
import { MessageRepository } from '$lib/db/repositories';
import { tick } from 'svelte';
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

const messages = new MessageRepository(db);

// Capped window (shell): newest PAGE_SIZE rows plus an explicit Load older
// button. No scroll sentinel, no anchor correction, no trim machinery —
// virtualization is 04-02. All Dexie contact stays behind the browser guard
// in $effect (prerender has no IndexedDB).
$effect(() => {
	const chatId = chat?.id;
	if (!browser || typeof chatId !== 'number') {
		win = null;
		return;
	}
	let cancelled = false;
	win = null;
	void (async () => {
		// Repository returns newest-first; reverse to chronological for render.
		const newestFirst = await messages.getLatestWindow(chatId, PAGE_SIZE);
		if (cancelled) return;
		const next = prependPage(emptyWindow(chatId), [...newestFirst].reverse());
		assertRenderBudget(next);
		win = next;
		await tick();
		// Pin to the newest message: chronological DOM, explicit scrollTop.
		if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
	})();
	return () => {
		cancelled = true;
	};
});

async function loadOlder() {
	const current = win;
	if (!browser || !current || loadingOlder || !current.hasMore) return;
	const cursor = cursorOf(current);
	if (!cursor) return;
	loadingOlder = true;
	try {
		const olderNewestFirst = await messages.getOlderPage(current.chatId, cursor, PAGE_SIZE);
		const next = prependPage(current, [...olderNewestFirst].reverse());
		assertRenderBudget(next);
		win = next;
	} finally {
		loadingOlder = false;
	}
}
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
			{:else}
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
				{#each win.pages as page (page[0]?.id)}
					{#each page as message (message.id)}
						<MessageBubble {message} />
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

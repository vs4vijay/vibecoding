<script lang="ts">
import { browser } from '$app/environment';
import type { MessageRecord } from '$lib/db/db';
import { db } from '$lib/db/db';
import { tokenize } from '$lib/db/tokenize';
import { searchAll, searchChat } from '$lib/search/search';
import type { SearchResult } from '$lib/search/search';
import SearchResults from './SearchResults.svelte';

interface Props {
	mode: 'global' | 'chat';
	chatId?: number;
	onselect: (message: SearchResult['message']) => void;
}

const { mode, chatId, onselect }: Props = $props();

let query = $state('');
let results = $state<SearchResult[]>([]);
let total = $state(0);
let open = $state(false);
let loading = $state(false);
let searchSeq = 0;
// biome-ignore lint/style/useConst: Svelte bind:this requires a let binding
let inputEl: HTMLInputElement | null = null;

async function runSearch(q: string, seq: number) {
	if (!browser) return;
	loading = true;
	try {
		const tokens = tokenize(q);
		if (tokens.length === 0) {
			results = [];
			total = 0;
			open = false;
			return;
		}
		const { total: t, results: r } =
			mode === 'chat' && typeof chatId === 'number'
				? await searchChat(chatId, q, { db, limit: 8 })
				: await searchAll(q, { db, limit: 8 });
		// Monotonic request-id guard: a slow earlier query must never
		// overwrite a newer query's results.
		if (seq === searchSeq) {
			total = t;
			results = r;
			open = true;
		}
	} finally {
		if (seq === searchSeq) loading = false;
	}
}

function debouncedSearch(q: string) {
	query = q;
	if (!browser) return;
	const seq = ++searchSeq;
	if (tokenize(q).length === 0) {
		results = [];
		total = 0;
		open = false;
		return;
	}
	setTimeout(() => {
		if (seq === searchSeq) void runSearch(q, seq);
	}, 300);
}

function handleResult(message: MessageRecord) {
	onselect(message);
	open = false;
}

function closeDropdown() {
	open = false;
}

function handleBlur() {
	// Allow a result click to fire before blur closes the dropdown.
	setTimeout(closeDropdown, 150);
}

function handleKey(e: KeyboardEvent) {
	if (e.key === 'Escape') {
		closeDropdown();
		inputEl?.blur();
	}
}
</script>

<div class="relative">
	<input
		bind:this={inputEl}
		type="search"
		bind:value={query}
		oninput={(e) => debouncedSearch((e.target as HTMLInputElement).value)}
		onfocus={() => (open = query.trim().length > 0 && results.length > 0)}
		onblur={handleBlur}
		onkeydown={handleKey}
		placeholder={mode === 'global' ? 'Search all chats…' : 'Search this chat…'}
		aria-label={mode === 'global' ? 'Search all chats' : 'Search this chat'}
		autocomplete="off"
		class="w-full max-w-sm rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
	/>
	{#if open}
		<div
			id="search-results"
			class="absolute top-full right-0 left-0 z-50 mt-1 rounded border border-gray-300 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
		>
			<SearchResults {results} {total} {query} {mode} onselect={handleResult} />
		</div>
	{/if}
</div>

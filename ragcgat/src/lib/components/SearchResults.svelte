<script lang="ts">
import { formatClock, senderColor } from '$lib/chat/formatting';
import { tokenize } from '$lib/db/tokenize';
import { makeSnippet, splitByTerms } from '$lib/search/highlight';
import type { SearchResult } from '$lib/search/search';

interface Props {
	results: SearchResult[];
	total: number;
	query: string;
	mode: 'global' | 'chat';
	onselect: (message: SearchResult['message']) => void;
}

const { results, total, query, mode, onselect }: Props = $props();

const tokens = $derived(tokenize(query));

function bits(text: string) {
	return splitByTerms(makeSnippet(text, tokens), tokens);
}
</script>

{#if results.length === 0}
	<div class="px-4 py-2 text-center text-sm text-gray-500 dark:text-gray-400">
		No results for "{query}".
	</div>
{:else}
	<div class="border-t border-gray-200 px-4 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
		{total} result{total !== 1 ? 's' : ''} for "{query}"
	</div>
	<ul role="listbox" aria-label="Search results">
		{#each results as result (result.message.id)}
			<li>
				<button
					type="button"
					role="option"
					aria-selected="false"
					class="block w-full cursor-pointer px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
					onclick={() => onselect(result.message)}
				>
					{#if mode === 'global'}
						<div class="mb-0.5 truncate text-xs font-medium text-green-700 dark:text-green-300">
							{result.chatName}
						</div>
					{/if}
					<div class="flex items-baseline gap-1 text-sm">
						<span class="font-semibold {senderColor(result.message.sender)}">
							{result.message.sender}
						</span>
						<span class="shrink-0 text-gray-500 dark:text-gray-400">
							{formatClock(result.message.timestamp)}
						</span>
					</div>
					<div class="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
						{#each bits(result.message.text) as seg, i (i)}
							{#if seg.match}<mark>{seg.text}</mark>{:else}{seg.text}{/if}
						{/each}
					</div>
				</button>
			</li>
		{/each}
	</ul>
{/if}

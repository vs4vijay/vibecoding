<script lang="ts">
import { browser } from '$app/environment';
import { formatSidebarTime } from '$lib/chat/formatting';
import { type ChatSummary, toChatSummary } from '$lib/chat/ordering';
import { observeChats } from '$lib/chat/queries';

const {
	selectedId = null,
	onselect,
}: {
	selectedId?: number | null;
	onselect: (id: number) => void;
} = $props();

let chats = $state<ChatSummary[]>([]);
let loading = $state(true);

// Sidebar order comes from the lastMessageAt index inside liveQuery — never
// a client sort. Subscribed in $effect behind the browser guard (prerender
// has no IndexedDB); the returned unsubscribe is the $effect cleanup.
$effect(() => {
	if (!browser) return;
	return observeChats((rows) => {
		chats = rows.map(toChatSummary);
		loading = false;
	});
});
</script>

{#if loading}
	<p class="p-4 text-sm text-gray-500 dark:text-gray-400" role="status">Loading conversations…</p>
{:else if chats.length === 0}
	<p class="p-4 text-sm text-gray-500 dark:text-gray-400">
		No conversations yet — switch to Import to load a chat export.
	</p>
{:else}
	<ul class="divide-y divide-gray-200 dark:divide-gray-700">
		{#each chats as chat (chat.id)}
			<li>
				<button
					type="button"
					class="w-full px-4 py-3 text-left transition-colors {chat.id === selectedId
						? 'bg-green-50 dark:bg-green-900/30'
						: 'hover:bg-gray-100 dark:hover:bg-gray-800'}"
					onclick={() => onselect(chat.id)}
				>
					<span class="flex items-baseline justify-between gap-2">
						<span class="truncate font-medium {chat.id === selectedId ? 'text-green-800 dark:text-green-200' : ''}">
							{chat.name}
						</span>
						<span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">
							{formatSidebarTime(chat.lastMessageAt)}
						</span>
					</span>
					<span class="mt-0.5 block truncate text-sm text-gray-500 dark:text-gray-400">
						{chat.lastSnippet || 'No messages'}
					</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}

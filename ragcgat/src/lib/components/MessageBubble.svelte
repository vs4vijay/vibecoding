<script lang="ts">
import { formatClock, senderColor } from '$lib/chat/formatting';
import { eventKind } from '$lib/chat/placeholders';
import type { MessageRecord } from '$lib/db/db';
import MediaPlaceholder from './MediaPlaceholder.svelte';

const { message, showSender = true }: { message: MessageRecord; showSender?: boolean } = $props();

const event = $derived(eventKind(message.type));
const color = $derived(event ? '' : senderColor(message.sender));
</script>

{#if event}
	<!-- system / call / deleted: centered event row, never a bubble -->
	<div class="my-2 text-center text-xs text-gray-500 dark:text-gray-400" data-msg>
		{message.text}
		· {formatClock(message.timestamp)}
	</div>
{:else}
	<div class="mb-2 flex flex-col items-start" data-msg>
		{#if showSender}<span class="mb-0.5 text-xs font-semibold {color}">{message.sender}</span>{/if}
		<div class="max-w-[75%] rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-700">
			{#if message.type === 'media'}
				<MediaPlaceholder mediaType={message.mediaType} />
			{/if}
			{#if message.text}
				<!-- escaped interpolation only; {@html} is banned on chat content (T-04-01) -->
				<p class="whitespace-pre-wrap break-words text-sm">{message.text}</p>
			{/if}
			<span class="mt-1 block text-right text-[10px] text-gray-500 dark:text-gray-400">
				{formatClock(message.timestamp)}
			</span>
		</div>
	</div>
{/if}

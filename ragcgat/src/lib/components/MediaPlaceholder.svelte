<script lang="ts">
import { mediaPlaceholder } from '$lib/chat/placeholders';
import type { MediaType } from '$lib/parser/types';

const { mediaType }: { mediaType?: MediaType } = $props();

// Typed placeholder only — no <img>/<video>/<audio> is ever rendered here
// (BROW-04; export .txt files do not carry the media payloads).
const placeholder = $derived(mediaPlaceholder('media', mediaType));
</script>

<div
	class="flex items-center gap-2 rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
>
	<span aria-hidden="true">{placeholder.icon}</span>
	<span>{placeholder.label}</span>
</div>

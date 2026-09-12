<script lang="ts">
const {
	busy = false,
	onfiles,
}: {
	busy?: boolean;
	onfiles: (files: File[]) => void;
} = $props();

let dragging = $state(false);
// biome-ignore lint/style/useConst: Svelte bind:this requires a let binding
let fileInput = $state<HTMLInputElement | null>(null);

function onDrop(e: DragEvent) {
	e.preventDefault();
	dragging = false;
	const files = Array.from(e.dataTransfer?.files ?? []);
	if (files.length) onfiles(files);
}

function onInputChange(e: Event) {
	const input = e.currentTarget as HTMLInputElement;
	const files = Array.from(input.files ?? []);
	input.value = '';
	if (files.length) onfiles(files);
}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	role="button"
	tabindex="0"
	aria-label="Drop WhatsApp export here"
	class="mt-6 rounded-lg border-2 border-dashed p-8 text-center transition-colors {dragging
		? 'border-blue-500 bg-blue-50'
		: 'border-gray-300'}"
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragenter={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={onDrop}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') fileInput?.click();
	}}
>
	{#if busy}
		<p aria-live="polite" class="text-gray-700">Reading file…</p>
	{:else}
		<p>Drag &amp; drop your .txt or .zip export here or</p>
		<button
			type="button"
			class="mt-2 rounded bg-blue-600 px-4 py-2 text-white"
			onclick={() => fileInput?.click()}
		>
			Browse files
		</button>
	{/if}
</div>
<input
	bind:this={fileInput}
	type="file"
	accept=".txt,.zip,.TXT,.ZIP"
	hidden
	onchange={onInputChange}
/>

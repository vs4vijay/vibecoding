<script lang="ts">
const {
	done = 0,
	total = null,
	label = 'Working…',
}: {
	done?: number;
	total?: number | null;
	label?: string;
} = $props();

const percent = $derived(total !== null && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null);
</script>

{#if percent === null}
	<div role="progressbar" aria-label={label} class="mt-4">
		<p aria-live="polite" class="text-sm text-gray-700">{label}</p>
		<div class="mt-1 h-2 animate-pulse rounded bg-gray-200"></div>
	</div>
{:else}
	<div
		role="progressbar"
		aria-label={label}
		aria-valuenow={percent}
		aria-valuemin={0}
		aria-valuemax={100}
		class="mt-4"
	>
		<p aria-live="polite" class="text-sm text-gray-700">{label} — {percent}%</p>
		<div class="mt-1 h-2 overflow-hidden rounded bg-gray-200">
			<div class="h-full rounded bg-blue-600 transition-all" style="width: {percent}%"></div>
		</div>
	</div>
{/if}

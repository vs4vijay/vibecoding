<script lang="ts">
const { label }: { label: string } = $props();
</script>

<!-- Centered day-divider row (BROW-03). The label arrives preformatted from
     formatting.ts (formatDayLabel) — this component never formats. Light and
     dark variants; no {@html}, escaped interpolation only. -->
<div class="my-3 flex justify-center" role="separator">
	<span
		class="rounded-full bg-gray-200 px-3 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300"
	>
		{label}
	</span>
</div>
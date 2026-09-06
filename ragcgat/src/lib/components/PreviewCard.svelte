<script lang="ts">
import type { ImportPreview } from '$lib/import/preview';

const {
	preview,
	chatName,
	newCount,
	skippedCount,
	existingChatName = null,
	onchatname,
	onconfirm,
	oncancel,
}: {
	preview: ImportPreview;
	chatName: string;
	newCount: number;
	skippedCount: number;
	existingChatName?: string | null;
	onchatname: (name: string) => void;
	onconfirm: () => void;
	oncancel: () => void;
} = $props();

function formatDate(ts: number): string {
	return new Date(ts).toLocaleString();
}
</script>

<section aria-label="Import preview" class="mt-6 rounded-lg border p-4">
	<h2 class="text-lg font-semibold">Preview</h2>
	<dl class="mt-2 space-y-1 text-sm">
		<div><dt class="inline font-medium">File: </dt><dd class="inline">{preview.fileName}</dd></div>
		<div><dt class="inline font-medium">Messages: </dt><dd class="inline">{preview.total}</dd></div>
		<div>
			<dt class="inline font-medium">Date range: </dt><dd class="inline">
				{#if preview.dateRange}
					{formatDate(preview.dateRange.from)} – {formatDate(preview.dateRange.to)}
				{:else}
					Unknown
				{/if}
			</dd>
		</div>
		<div>
			<dt class="inline font-medium">Participants: </dt><dd class="inline">
				{preview.participants.join(', ') || 'None detected'}
			</dd>
		</div>
		<div>
			<dt class="inline font-medium">New: </dt><dd class="inline">{newCount}</dd>
			<dt class="ml-3 inline font-medium">Skipped (already imported): </dt><dd class="inline">
				{skippedCount}
			</dd>
		</div>
		{#if existingChatName}
			<div>
				<dt class="inline font-medium">Existing chat: </dt><dd class="inline">{existingChatName}</dd>
			</div>
		{/if}
	</dl>
	<label class="mt-3 block text-sm">
		<span class="font-medium">Chat name</span>
		<input
			type="text"
			value={chatName}
			oninput={(e) => onchatname(e.currentTarget.value)}
			class="mt-1 block w-full rounded border px-2 py-1"
		/>
	</label>
	{#if preview.capWarning}
		<p class="mt-2 text-sm text-amber-700">{preview.capWarning}</p>
	{/if}
	<h3 class="mt-4 font-medium">Sample messages</h3>
	<ul class="mt-1 space-y-2">
		{#each preview.samples as s}
			<li class="rounded bg-gray-50 p-2 text-sm">
				<span class="font-medium">{s.sender}</span>
				<span class="text-gray-500"> · {formatDate(s.timestamp)}</span>
				<p class="mt-1 whitespace-pre-wrap">{s.text}</p>
			</li>
		{/each}
	</ul>
	<div class="mt-4 flex gap-2">
		<button type="button" class="rounded bg-green-600 px-4 py-2 text-white" onclick={onconfirm}>
			Confirm import
		</button>
		<button type="button" class="rounded border px-4 py-2" onclick={oncancel}>Cancel</button>
	</div>
</section>

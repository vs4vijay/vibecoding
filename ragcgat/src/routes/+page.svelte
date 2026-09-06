<script lang="ts">
import { db } from '$lib/db/db';
import { commitImport } from '$lib/import/commit';
import { type ImportPreview, buildPreview, decodeBytes } from '$lib/import/preview';
import { validateFile } from '$lib/import/validate';
import type { WorkerResponse } from '$lib/import/workerProtocol';
import { parseString } from '$lib/parser/parseFile';

type Status = 'idle' | 'reading' | 'parsing' | 'preview' | 'committing' | 'done' | 'error';

let status = $state<Status>('idle');
let preview = $state<ImportPreview | null>(null);
let error = $state<string | null>(null);
let chatName = $state('');
let doneInfo = $state<{ chatId: number; written: number } | null>(null);
let dragging = $state(false);

let worker: Worker | null = null;
let pendingFile: File | null = null;
// biome-ignore lint/style/useConst: Svelte bind:this requires a let binding
let fileInput = $state<HTMLInputElement | null>(null);

function terminateWorker() {
	worker?.terminate();
	worker = null;
}

function fail(message: string) {
	terminateWorker();
	pendingFile = null;
	preview = null;
	error = message;
	status = 'error';
}

function handleWorkerMessage(e: MessageEvent<WorkerResponse>) {
	const msg = e.data;
	if (msg.type === 'progress') {
		status = 'parsing';
	} else if (msg.type === 'preview-result') {
		preview = msg.preview;
		chatName = msg.preview.chatName;
		status = 'preview';
		terminateWorker();
	} else {
		fail(msg.message);
	}
}

async function handleFiles(files: File[]) {
	status = 'reading';
	error = null;
	preview = null;
	doneInfo = null;
	await new Promise((r) => requestAnimationFrame(r));

	const file = files[0];
	if (!file) {
		status = 'idle';
		return;
	}
	let kind: 'txt' | 'zip';
	try {
		kind = validateFile(file).kind;
	} catch (err) {
		fail(err instanceof Error ? err.message : 'Invalid file');
		return;
	}
	if (kind === 'zip') {
		fail('Zip imports land in the next update — please drop the .txt export for now.');
		return;
	}

	pendingFile = file;
	status = 'parsing';
	try {
		const buffer = await file.arrayBuffer();
		const w = new Worker(new URL('$lib/import/parse.worker.ts', import.meta.url), {
			type: 'module',
		});
		terminateWorker();
		worker = w;
		w.onmessage = handleWorkerMessage;
		w.onerror = () => fail('parse-failed');
		w.postMessage({ type: 'parse-preview', buffer, fileName: file.name }, [buffer]);
	} catch (err) {
		fail(err instanceof Error ? err.message : 'Could not read file');
	}
}

function onDrop(e: DragEvent) {
	e.preventDefault();
	dragging = false;
	const files = [...(e.dataTransfer?.files ?? [])];
	if (files.length) void handleFiles(files);
}

function onInputChange(e: Event) {
	const input = e.currentTarget as HTMLInputElement;
	const files = [...(input.files ?? [])];
	input.value = '';
	if (files.length) void handleFiles(files);
}

function onCancel() {
	terminateWorker();
	pendingFile = null;
	preview = null;
	status = 'idle';
}

async function onConfirm() {
	if (!preview || !pendingFile) return;
	status = 'committing';
	await new Promise((r) => requestAnimationFrame(r));
	try {
		const bytes = new Uint8Array(await pendingFile.arrayBuffer());
		const chat = parseString(decodeBytes(bytes));
		const name = chatName.trim() || preview.chatName;
		const result = await commitImport(db, name, chat);
		doneInfo = result;
		preview = null;
		pendingFile = null;
		status = 'done';
	} catch (err) {
		fail(err instanceof Error ? err.message : 'Could not save chat');
	}
}

function formatDate(ts: number): string {
	return new Date(ts).toLocaleString();
}
</script>

<main class="mx-auto max-w-2xl px-4 py-10">
	<h1 class="text-2xl font-bold">Import WhatsApp chat</h1>
	<p class="mt-1 text-sm text-gray-600">Drop a .txt export or pick a file. Preview first — nothing is saved until you confirm.</p>

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
		{#if status === 'reading' || status === 'parsing' || status === 'committing'}
			<p aria-live="polite" class="text-gray-700">
				{#if status === 'reading'}Reading file…{/if}
				{#if status === 'parsing'}Parsing messages…{/if}
				{#if status === 'committing'}Saving chat…{/if}
			</p>
		{:else}
			<p>Drag &amp; drop your .txt export here or</p>
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
		accept=".txt,.zip"
		hidden
		onchange={onInputChange}
	/>

	{#if status === 'error' && error}
		<div role="alert" class="mt-4 rounded border border-red-300 bg-red-50 p-4 text-red-800">
			<p class="font-semibold">Import failed</p>
			<p>{error}</p>
			<button
				type="button"
				class="mt-2 rounded border px-3 py-1"
				onclick={() => {
					error = null;
					status = 'idle';
				}}
			>
				Try again
			</button>
		</div>
	{/if}

	{#if status === 'preview' && preview}
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
			</dl>
			<label class="mt-3 block text-sm">
				<span class="font-medium">Chat name</span>
				<input
					type="text"
					bind:value={chatName}
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
				<button
					type="button"
					class="rounded bg-green-600 px-4 py-2 text-white"
					onclick={() => void onConfirm()}
				>
					Confirm import
				</button>
				<button type="button" class="rounded border px-4 py-2" onclick={onCancel}>
					Cancel
				</button>
			</div>
		</section>
	{/if}

	{#if status === 'done' && doneInfo}
		<div role="status" class="mt-6 rounded border border-green-300 bg-green-50 p-4 text-green-900">
			<p class="font-semibold">Import complete</p>
			<p>{doneInfo.written} messages saved.</p>
			<button
				type="button"
				class="mt-2 rounded border px-3 py-1"
				onclick={() => {
					doneInfo = null;
					status = 'idle';
				}}
			>
				Import another
			</button>
		</div>
	{/if}

	<p class="mt-6 text-xs text-gray-500">
		Nothing is written to your library until you confirm the preview.
	</p>
</main>

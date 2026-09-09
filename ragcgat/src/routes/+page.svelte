<script lang="ts">
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { observeChats } from '$lib/chat/queries';
import { parseChatParam, serializeChatParam } from '$lib/chat/selection';
import ChatSidebar from '$lib/components/ChatSidebar.svelte';
import ChatView from '$lib/components/ChatView.svelte';
import DropZone from '$lib/components/DropZone.svelte';
import PreviewCard from '$lib/components/PreviewCard.svelte';
import ProgressBar from '$lib/components/ProgressBar.svelte';
import ThemeToggle from '$lib/components/ThemeToggle.svelte';
import type { ChatRecord } from '$lib/db/db';
import { db } from '$lib/db/db';
import { commitImport } from '$lib/import/commit';
import { type ImportState, errorMessage, transition } from '$lib/import/importState';
import { type ImportPreview, decodeBytes, diffPreview } from '$lib/import/preview';
import { extractTxtFromZip, sniffZipMagic } from '$lib/import/unzip';
import { validateFile } from '$lib/import/validate';
import type { WorkerResponse } from '$lib/import/workerProtocol';
import { parseString } from '$lib/parser/parseFile';

// --- Browse shell (OQ2: persistent top-level tabs, Browse default once a
// chat exists). Selection syncs both ways with ?chat=<id>: parsed from the
// page store for deep links, written via goto on sidebar clicks.
let tab = $state<'browse' | 'import' | null>(null);
let chats = $state<ChatRecord[]>([]);
const activeTab = $derived(tab ?? (chats.length > 0 ? 'browse' : 'import'));
const selectedId = $derived(parseChatParam(page.url.searchParams.get('chat')));
const selectedChat = $derived(chats.find((c) => c.id === selectedId));

// One liveQuery here for tab default + selected-chat resolution; the
// sidebar owns its own subscription (per-subscriber liveQuery).
$effect(() => {
	if (!browser) return;
	return observeChats((rows) => {
		chats = rows;
	});
});

function openChat(id: number) {
	if (id === selectedId) return;
	void goto(`?chat=${serializeChatParam(id)}`, { noScroll: true, keepFocus: true });
}

function switchTab(next: 'browse' | 'import') {
	tab = next;
}

let machine = $state<ImportState>({ status: 'idle', errorKey: null, hasPreview: false });
let preview = $state<ImportPreview | null>(null);
let hashes = $state<string[]>([]);
let newCount = $state(0);
let skippedCount = $state(0);
let existingChatName = $state<string | null>(null);
let chatName = $state('');
let doneInfo = $state<{ chatName: string; written: number } | null>(null);
let unzipping = $state(false);
let parseProgress = $state<{ done: number; total: number | null }>({ done: 0, total: null });
let storeProgress = $state<{ done: number; total: number | null }>({ done: 0, total: null });

let worker: Worker | null = null;
// Retained source bytes for confirm re-parse (zip flows keep the winning
// entry bytes — never re-inflate the zip on confirm; txt flows keep the
// file bytes so confirm never re-reads the File).
let pendingBytes: Uint8Array | null = null;

const status = $derived(machine.status);
const error = $derived(machine.errorKey ? errorMessage(machine.errorKey) : null);

function send(e: Parameters<typeof transition>[1]) {
	machine = transition(machine, e);
}

function terminateWorker() {
	worker?.terminate();
	worker = null;
}

function fail(code: string) {
	terminateWorker();
	pendingBytes = null;
	preview = null;
	hashes = [];
	unzipping = false;
	send({ type: 'error', code });
}

async function refreshDiff() {
	if (!preview) return;
	const name = chatName.trim() || preview.chatName;
	const diff = await diffPreview(db, hashes, name);
	newCount = diff.newCount;
	skippedCount = diff.skippedCount;
	existingChatName = diff.existingChat?.name ?? null;
}

function handleWorkerMessage(e: MessageEvent<WorkerResponse>) {
	const msg = e.data;
	if (msg.type === 'progress') {
		send({ type: 'worker-progress' });
		parseProgress = { done: msg.done, total: msg.total ?? null };
	} else if (msg.type === 'preview-result') {
		preview = msg.preview;
		hashes = msg.hashes;
		chatName = msg.preview.chatName;
		terminateWorker();
		send({ type: 'preview-result' });
		void refreshDiff();
	} else {
		fail(msg.code || 'parse-failed');
	}
}

function postToWorker(bytes: Uint8Array, fileName: string) {
	// Transfer a copy — the retained pendingBytes must survive for confirm re-parse.
	const transfer = bytes.slice();
	const w = new Worker(new URL('$lib/import/parse.worker.ts', import.meta.url), {
		type: 'module',
	});
	terminateWorker();
	worker = w;
	w.onmessage = handleWorkerMessage;
	w.onerror = () => fail('parse-failed');
	w.postMessage({ type: 'parse-preview', buffer: transfer.buffer, fileName }, [transfer.buffer]);
}

async function handleFiles(files: File[]) {
	send({ type: 'files-received' });
	preview = null;
	hashes = [];
	doneInfo = null;
	unzipping = false;
	parseProgress = { done: 0, total: null };
	storeProgress = { done: 0, total: null };
	await new Promise((r) => requestAnimationFrame(r));

	const file = files[0];
	if (!file) {
		send({ type: 'reset' });
		return;
	}
	let kind: 'txt' | 'zip';
	try {
		kind = validateFile(file).kind;
	} catch (err) {
		fail(err instanceof Error ? err.message : 'unsupported-type');
		return;
	}

	try {
		const raw = new Uint8Array(await file.arrayBuffer());
		let entryBytes = raw;
		let entryName = file.name;
		if (kind === 'zip' || sniffZipMagic(raw)) {
			// Zip listing is a millisecond-scale main-thread op; only the parse runs in the worker.
			unzipping = true;
			await new Promise((r) => requestAnimationFrame(r));
			try {
				const entry = extractTxtFromZip(raw);
				entryBytes = entry.bytes;
				entryName = entry.name;
			} catch (err) {
				fail(err instanceof Error ? err.message : 'corrupt-zip');
				return;
			} finally {
				unzipping = false;
			}
		}
		pendingBytes = entryBytes;
		send({ type: 'worker-progress' });
		postToWorker(entryBytes, entryName);
	} catch (err) {
		fail(err instanceof Error ? err.message : 'parse-failed');
	}
}

function onCancel() {
	terminateWorker();
	pendingBytes = null;
	preview = null;
	hashes = [];
	unzipping = false;
	send({ type: 'cancel' });
}

async function onConfirm() {
	if (!preview || !pendingBytes) return;
	send({ type: 'confirm' });
	await new Promise((r) => requestAnimationFrame(r));
	try {
		// Deterministic re-parse of the retained source bytes on the main thread.
		// Only a small preview object ever crossed postMessage; if profiling ever
		// shows re-parse jank, the fallback is worker-posted record batches.
		const chat = parseString(decodeBytes(pendingBytes));
		const name = chatName.trim() || preview.chatName;
		const result = await commitImport(db, name, chat, (written, total) => {
			storeProgress = { done: written, total };
		});
		doneInfo = { chatName: name, written: result.written };
		preview = null;
		hashes = [];
		pendingBytes = null;
		send({ type: 'commit-resolve' });
	} catch (err) {
		fail(err instanceof Error ? err.message : 'parse-failed');
	}
}

function onChatName(name: string) {
	chatName = name;
	void refreshDiff();
}
</script>

<div class="flex min-h-screen flex-col bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
	<header class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
		<h1 class="text-lg font-bold">RagChat</h1>
		<nav class="flex items-center gap-2" aria-label="Main">
			<button
				type="button"
				aria-current={activeTab === 'browse' ? 'page' : undefined}
				class="rounded px-3 py-1 text-sm {activeTab === 'browse'
					? 'bg-green-600 text-white'
					: 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'}"
				onclick={() => switchTab('browse')}
			>
				Browse
			</button>
			<button
				type="button"
				aria-current={activeTab === 'import' ? 'page' : undefined}
				class="rounded px-3 py-1 text-sm {activeTab === 'import'
					? 'bg-green-600 text-white'
					: 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'}"
				onclick={() => switchTab('import')}
			>
				Import
			</button>
			<ThemeToggle />
		</nav>
	</header>

	{#if activeTab === 'browse'}
		<div class="mx-auto flex min-h-0 w-full max-w-6xl flex-1">
			<aside
				class="w-72 shrink-0 overflow-y-auto border-r border-gray-200 dark:border-gray-700"
				aria-label="Conversations"
			>
				<ChatSidebar selectedId={selectedId} onselect={openChat} />
			</aside>
			<section class="min-w-0 flex-1">
				<ChatView chat={selectedChat} {selectedId} />
			</section>
		</div>
	{:else}
	<main class="mx-auto max-w-2xl px-4 py-10">
	<h1 class="text-2xl font-bold">Import WhatsApp chat</h1>
	<p class="mt-1 text-sm text-gray-600">
		Drop a .txt or .zip export or pick a file. Preview first — nothing is saved until you confirm.
	</p>

	{#if status === 'idle' || status === 'reading'}
		<DropZone busy={status === 'reading' && !unzipping} onfiles={(f) => void handleFiles(f)} />
		{#if unzipping}
			<p aria-live="polite" class="mt-2 text-sm text-gray-700">Unzipping archive…</p>
		{/if}
	{/if}

	{#if status === 'parsing'}
		<ProgressBar done={parseProgress.done} total={parseProgress.total} label="Parsing messages" />
	{/if}

	{#if status === 'committing'}
		<ProgressBar done={storeProgress.done} total={storeProgress.total} label="Saving chat" />
	{/if}

	{#if status === 'error' && error}
		<div role="alert" class="mt-4 rounded border border-red-300 bg-red-50 p-4 text-red-800">
			<p class="font-semibold">Import failed</p>
			<p>{error}</p>
			<button
				type="button"
				class="mt-2 rounded border px-3 py-1"
				onclick={() => send({ type: 'reset' })}
			>
				Try again
			</button>
		</div>
	{/if}

	{#if status === 'preview' && preview}
		<PreviewCard
			{preview}
			{chatName}
			{newCount}
			{skippedCount}
			{existingChatName}
			onchatname={onChatName}
			onconfirm={() => void onConfirm()}
			oncancel={onCancel}
		/>
	{/if}

	{#if status === 'done' && doneInfo}
		<div role="status" class="mt-6 rounded border border-green-300 bg-green-50 p-4 text-green-900">
			<p class="font-semibold">Import complete</p>
			<p>{doneInfo.written} messages saved to {doneInfo.chatName}.</p>
			<button
				type="button"
				class="mt-2 rounded border px-3 py-1"
				onclick={() => {
					doneInfo = null;
					send({ type: 'reset' });
				}}
			>
				Import another
			</button>
		</div>
	{/if}

	<p class="mt-6 text-xs text-gray-500">
		Nothing is written to your library until you confirm the preview. Multi-chat zips import the
		largest chat only for now.
	</p>
</main>
	{/if}
</div>

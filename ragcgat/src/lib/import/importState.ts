/**
 * Framework-free import status machine. The import page (+page.svelte) keeps
 * its own Svelte runes state for rendering, but every transition rule lives
 * here so the machine is unit-testable without Svelte, a Worker, or a browser.
 */

export type ImportStatus = 'idle' | 'reading' | 'parsing' | 'preview' | 'committing' | 'done' | 'error';

export interface ImportState {
	status: ImportStatus;
	/** Machine error code (e.g. 'no-txt-in-zip'); mapped via errorMessage(). */
	errorKey: string | null;
	hasPreview: boolean;
}

export type ImportEvent =
	| { type: 'files-received' }
	| { type: 'worker-progress' }
	| { type: 'preview-result' }
	| { type: 'confirm' }
	| { type: 'commit-resolve' }
	| { type: 'error'; code: string }
	| { type: 'cancel' }
	| { type: 'reset' };

export const initialImportState: ImportState = { status: 'idle', errorKey: null, hasPreview: false };

export function transition(state: ImportState, event: ImportEvent): ImportState {
	switch (event.type) {
		case 'files-received':
			// Set synchronously in the same tick as drop/change, before any await,
			// so the spinner paints in under 100ms.
			return { status: 'reading', errorKey: null, hasPreview: false };
		case 'worker-progress':
			return state.status === 'reading' || state.status === 'parsing' ? { ...state, status: 'parsing' } : state;
		case 'preview-result':
			return { ...state, status: 'preview', hasPreview: true };
		case 'confirm':
			return state.status === 'preview' ? { ...state, status: 'committing' } : state;
		case 'commit-resolve':
			return state.status === 'committing' ? { ...state, status: 'done', hasPreview: false } : state;
		case 'error':
			return { status: 'error', errorKey: event.code, hasPreview: false };
		case 'cancel':
			return state.status === 'preview' || state.status === 'parsing' || state.status === 'reading'
				? { status: 'idle', errorKey: null, hasPreview: false }
				: state;
		case 'reset':
			return { status: 'idle', errorKey: null, hasPreview: false };
	}
}

/** Distinct user-facing copy per failure code; every failure path writes nothing. */
export function errorMessage(code: string): string {
	switch (code) {
		case 'unsupported-type':
			return 'That file type is not supported. Drop a .txt or .zip WhatsApp export.';
		case 'empty-file':
			return 'That file is empty. Pick a non-empty export to preview.';
		case 'file-too-large':
			return 'That file exceeds the 25 MB limit. Split the export and try again.';
		case 'no-txt-in-zip':
			return 'No .txt export found inside that zip. Zip the WhatsApp .txt file and try again.';
		case 'zip-entry-too-large':
			return 'An entry inside that zip exceeds the 50 MB safety cap. Nothing was imported.';
		case 'corrupt-zip':
			return 'That zip could not be opened — it may be corrupt. Nothing was imported.';
		case 'parse-failed':
			return 'Those messages could not be parsed as a WhatsApp export. Nothing was saved.';
		default:
			return 'Something went wrong during import. Nothing was saved.';
	}
}

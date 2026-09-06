import { describe, expect, it } from 'vitest';
import { errorMessage, initialImportState, transition } from '../importState';

describe('import status machine', () => {
	it('files-received sets reading synchronously with cleared error and preview', () => {
		const next = transition(
			{ status: 'error', errorKey: 'parse-failed', hasPreview: false },
			{ type: 'files-received' },
		);
		expect(next).toEqual({ status: 'reading', errorKey: null, hasPreview: false });
	});

	it('worker first-progress moves reading to parsing', () => {
		const next = transition({ ...initialImportState, status: 'reading' }, { type: 'worker-progress' });
		expect(next.status).toBe('parsing');
	});

	it('preview-result moves to preview with preview retained', () => {
		const next = transition({ status: 'parsing', errorKey: null, hasPreview: false }, { type: 'preview-result' });
		expect(next).toEqual({ status: 'preview', errorKey: null, hasPreview: true });
	});

	it('confirm then commit-resolve flows preview to committing to done', () => {
		const committing = transition({ status: 'preview', errorKey: null, hasPreview: true }, { type: 'confirm' });
		expect(committing.status).toBe('committing');
		const done = transition(committing, { type: 'commit-resolve' });
		expect(done).toEqual({ status: 'done', errorKey: null, hasPreview: false });
	});

	it('any error code moves to error with the right message key', () => {
		for (const code of [
			'unsupported-type',
			'empty-file',
			'file-too-large',
			'no-txt-in-zip',
			'zip-entry-too-large',
			'corrupt-zip',
			'parse-failed',
		]) {
			const next = transition({ status: 'parsing', errorKey: null, hasPreview: true }, { type: 'error', code });
			expect(next.status).toBe('error');
			expect(next.errorKey).toBe(code);
			expect(next.hasPreview).toBe(false);
			expect(errorMessage(code)).not.toBe(errorMessage('__unknown__'));
		}
	});

	it('cancel from preview or parsing returns to idle with empty preview', () => {
		for (const status of ['preview', 'parsing', 'reading'] as const) {
			const next = transition({ status, errorKey: null, hasPreview: status === 'preview' }, { type: 'cancel' });
			expect(next).toEqual({ status: 'idle', errorKey: null, hasPreview: false });
		}
	});

	it('reset returns to idle from done or error', () => {
		expect(transition({ status: 'done', errorKey: null, hasPreview: false }, { type: 'reset' })).toEqual(
			initialImportState,
		);
		expect(transition({ status: 'error', errorKey: 'x', hasPreview: false }, { type: 'reset' })).toEqual(
			initialImportState,
		);
	});

	it('stray events are ignored (no phantom transitions)', () => {
		expect(transition(initialImportState, { type: 'confirm' }).status).toBe('idle');
		expect(transition(initialImportState, { type: 'commit-resolve' }).status).toBe('idle');
		expect(transition(initialImportState, { type: 'worker-progress' }).status).toBe('idle');
	});
});

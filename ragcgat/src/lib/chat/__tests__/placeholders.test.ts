import { describe, expect, it } from 'vitest';
import type { MediaType } from '../../parser/types';
import { eventKind, mediaPlaceholder } from '../placeholders';

const ALL_MEDIA: MediaType[] = ['image', 'video', 'audio', 'document', 'sticker', 'gif'];

describe('mediaPlaceholder', () => {
	it('maps all six media types to distinct icon-plus-label pairs', () => {
		const pairs = ALL_MEDIA.map((mediaType) => mediaPlaceholder('media', mediaType));
		for (const pair of pairs) {
			expect(pair.icon.length).toBeGreaterThan(0);
			expect(pair.label.length).toBeGreaterThan(0);
		}
		expect(new Set(pairs.map((p) => p.label)).size).toBe(6);
		expect(new Set(pairs.map((p) => `${p.icon}${p.label}`)).size).toBe(6);
	});

	it('returns the generic pair for undefined mediaType without throwing', () => {
		expect(mediaPlaceholder('media', undefined)).toEqual({ icon: '📎', label: 'Media' });
	});

	it('throws for non-media message types', () => {
		for (const type of ['text', 'system', 'call', 'deleted'] as const) {
			expect(() => mediaPlaceholder(type)).toThrow();
		}
	});
});

describe('eventKind', () => {
	it('classifies system, call, and deleted as event rows', () => {
		expect(eventKind('system')).toBe('system');
		expect(eventKind('call')).toBe('call');
		expect(eventKind('deleted')).toBe('deleted');
	});

	it('returns null for bubble kinds', () => {
		expect(eventKind('text')).toBeNull();
		expect(eventKind('media')).toBeNull();
	});
});

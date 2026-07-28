import { describe, it, expect } from 'vitest';
import { classifyMessage, getClassificationLabel } from '../index';

describe('classifyMessage', () => {
	it('returns system for null sender', () => {
		const result = classifyMessage('some text', null, 'some text');
		expect(result.type).toBe('system');
	});

	it('returns media/image for <Media omitted>', () => {
		const result = classifyMessage('<Media omitted>', 'Alice', '<Media omitted>');
		expect(result.type).toBe('media');
		expect(result.mediaType).toBe('image');
	});

	it('returns media/image for IMG- prefix', () => {
		const result = classifyMessage('IMG-20240709-WA0001.jpg', 'Alice', 'IMG-20240709-WA0001.jpg');
		expect(result.type).toBe('media');
		expect(result.mediaType).toBe('image');
	});

	it('returns media/video for VID- prefix', () => {
		const result = classifyMessage(
			'VID-20240709-WA0001.mp4 (video file)',
			'Alice',
			'VID-20240709-WA0001.mp4 (video file)',
		);
		expect(result.type).toBe('media');
		expect(result.mediaType).toBe('video');
	});

	it('returns media/audio for AUD- prefix', () => {
		const result = classifyMessage('AUD-20240709-WA0001.ogg', 'Alice', 'AUD-20240709-WA0001.ogg');
		expect(result.type).toBe('media');
		expect(result.mediaType).toBe('audio');
	});

	it('returns media/document for PDF attachment', () => {
		const result = classifyMessage('document.pdf (file attached)', 'Alice', 'document.pdf (file attached)');
		expect(result.type).toBe('media');
		expect(result.mediaType).toBe('document');
	});

	it('returns media/sticker for sticker pattern', () => {
		const result = classifyMessage('<Sticker: 12345>', 'Alice', '<Sticker: 12345>');
		expect(result.type).toBe('media');
		expect(result.mediaType).toBe('sticker');
	});

	it('returns media/gif for GIF pattern', () => {
		const result = classifyMessage('GIF omitted', 'Alice', 'GIF omitted');
		expect(result.type).toBe('media');
		expect(result.mediaType).toBe('gif');
	});

	it('returns deleted for deleted message', () => {
		const result = classifyMessage('This message was deleted', 'Alice', 'This message was deleted');
		expect(result.type).toBe('deleted');
	});

	it('returns call for missed voice call', () => {
		const result = classifyMessage('Missed voice call', 'Alice', 'Missed voice call');
		expect(result.type).toBe('call');
	});

	it('returns system for join events', () => {
		const result = classifyMessage(
			"John joined using this group's invite link",
			'John',
			"John joined using this group's invite link",
		);
		expect(result.type).toBe('system');
	});

	it('returns text for normal messages', () => {
		const result = classifyMessage('Just a normal message', 'Alice', 'Just a normal message');
		expect(result.type).toBe('text');
	});
});

describe('getClassificationLabel', () => {
	it('returns readable label for text', () => {
		expect(getClassificationLabel('text')).toBe('Text');
	});

	it('returns readable label for media with type', () => {
		expect(getClassificationLabel('media', 'image')).toBe('Image');
		expect(getClassificationLabel('media', 'video')).toBe('Video');
	});
});

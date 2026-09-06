import { describe, expect, it } from 'vitest';
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

	it('returns text for prose containing "left" (CR-01)', () => {
		const result = classifyMessage('I left my keys at home', 'Alice', 'I left my keys at home');
		expect(result.type).toBe('text');
	});

	it('returns text for prose containing "added" (CR-01)', () => {
		const result = classifyMessage('I added sugar to the coffee', 'Alice', 'I added sugar to the coffee');
		expect(result.type).toBe('text');
	});

	it('returns text for prose containing "removed" (CR-01)', () => {
		const result = classifyMessage('I removed him from the list', 'Alice', 'I removed him from the list');
		expect(result.type).toBe('text');
	});

	it('returns text for prose mentioning the IMG- prefix (WR-03)', () => {
		const result = classifyMessage('The IMG- tag is used for figures', 'Alice', 'The IMG- tag is used for figures');
		expect(result.type).toBe('text');
	});

	it('returns text for prose mentioning a bare .gif extension (IN-01)', () => {
		const result = classifyMessage('Check out this .gif url', 'Alice', 'Check out this .gif url');
		expect(result.type).toBe('text');
	});

	it('returns deleted for "You deleted this message" (WR-04)', () => {
		const result = classifyMessage('You deleted this message', 'Alice', 'You deleted this message');
		expect(result.type).toBe('deleted');
	});

	it('still returns system for canonical invite-link join events', () => {
		const result = classifyMessage('Bob joined using invite link', 'Bob', 'Bob joined using invite link');
		expect(result.type).toBe('system');
	});

	it('still returns system for canonical "left the group" notices', () => {
		const result = classifyMessage('Alice left', 'Alice', 'Alice left');
		expect(result.type).toBe('system');
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

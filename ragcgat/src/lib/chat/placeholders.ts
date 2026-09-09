import type { MediaType, MessageType } from '../parser/types';

export type EventKind = 'system' | 'call' | 'deleted';

/**
 * Row classification: system/call/deleted messages render as centered event
 * rows (never bubbles); null means the message is a bubble (text or media).
 */
export function eventKind(type: MessageType): EventKind | null {
	return type === 'system' || type === 'call' || type === 'deleted' ? type : null;
}

/**
 * Typed placeholder for media messages (BROW-04). Total over mediaType;
 * an undefined mediaType (unrecognized filename anchor) falls back to the
 * generic attachment pair. Throws for non-media types — callers gate on
 * eventKind/type first. No <img>/<video>/<audio> is ever rendered anywhere:
 * .txt exports do not carry media payloads, placeholders are the spec.
 */
export function mediaPlaceholder(type: MessageType, mediaType?: MediaType): { icon: string; label: string } {
	if (type !== 'media') throw new Error(`mediaPlaceholder: non-media message type "${type}"`);
	switch (mediaType) {
		case 'image':
			return { icon: '📷', label: 'Image' };
		case 'video':
			return { icon: '🎬', label: 'Video' };
		case 'audio':
			return { icon: '🎤', label: 'Audio' };
		case 'document':
			return { icon: '📄', label: 'Document' };
		case 'sticker':
			return { icon: '⭐', label: 'Sticker' };
		case 'gif':
			return { icon: '🎞️', label: 'GIF' };
		default:
			return { icon: '📎', label: 'Media' };
	}
}

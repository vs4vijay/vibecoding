import type { MediaType, MessageType } from './types';

export function classifyMessage(
	text: string,
	sender: string | null,
	rawLine: string,
): { type: MessageType; mediaType?: MediaType } {
	if (sender === null || sender === '') {
		return { type: 'system' };
	}

	const lowerBody = text.toLowerCase();
	const lowerRaw = rawLine.toLowerCase();

	const systemPatterns: (string | RegExp)[] = [
		"joined using this group's invite link",
		'joined using invite link',
		// Bare-substring entries ('left'/'added'/'removed') false-positived on
		// ordinary prose (CR-01). Match canonical system-notice shapes anchored
		// at end of body instead, so prose like "I left my keys at home"
		// (trailing content after the keyword) stays text.
		/\bleft\.?\s*$/i,
		/\bjoined\.?\s*$/i,
		/\bwas added\.?\s*$/i,
		/\bwas removed\.?\s*$/i,
		/\badded\s+\S+\.?\s*$/i,
		/\bremoved\s+\S+\.?\s*$/i,
		'changed the group',
		"changed this group's icon",
		'security code changed',
		'messages and calls are end-to-end encrypted',
		'created group',
		'changed the subject',
		"changed this group's subject",
	];
	for (const p of systemPatterns) {
		const hit = typeof p === 'string' ? lowerBody.includes(p) : p.test(lowerBody);
		if (hit) {
			return { type: 'system' };
		}
	}

	const mediaPatterns: { regex: RegExp; mediaType: MediaType }[] = [
		{ regex: /<media omitted>/i, mediaType: 'image' },
		{ regex: /image omitted/i, mediaType: 'image' },
		// Full WhatsApp attachment filename shape only (WR-03): bare "IMG-"
		// prose mentions no longer match.
		{ regex: /\bIMG[-_]\d{8}[-_]WA\d+\.\w+/i, mediaType: 'image' },
		// Filename-token-anchored extensions (IN-01): word chars must precede
		// the dot, so " .gif" prose mentions stay text.
		{ regex: /\b[\w-]+\.(jpg|jpeg|png|gif|webp)\b/i, mediaType: 'image' },
		{ regex: /<sticker:/i, mediaType: 'sticker' },
		{ regex: /sticker omitted/i, mediaType: 'sticker' },
		// Dot-prefixed ".gif" is an extension mention, not the word "gif".
		{ regex: /(?<!\.)\bgif\b/i, mediaType: 'gif' },
		{ regex: /gif omitted/i, mediaType: 'gif' },
		{ regex: /\bVID[-_]\d{8}[-_]WA\d+\.\w+/i, mediaType: 'video' },
		{ regex: /video omitted/i, mediaType: 'video' },
		{ regex: /\b[\w-]+\.(mp4|avi|mov|mkv)\b/i, mediaType: 'video' },
		{ regex: /\bAUD[-_]\d{8}[-_]WA\d+\.\w+/i, mediaType: 'audio' },
		{ regex: /audio omitted/i, mediaType: 'audio' },
		{ regex: /voice message/i, mediaType: 'audio' },
		{ regex: /\b[\w-]+\.(mp3|ogg|opus|aac|wav)\b/i, mediaType: 'audio' },
		{ regex: /document omitted/i, mediaType: 'document' },
		{ regex: /\b[\w-]+\.pdf\b/i, mediaType: 'document' },
	];

	for (const { regex, mediaType } of mediaPatterns) {
		if (regex.test(lowerRaw) || regex.test(lowerBody)) {
			return { type: 'media', mediaType };
		}
	}

	if (
		lowerBody.includes('this message was deleted') ||
		lowerBody.includes('this message has been deleted') ||
		lowerBody.includes('you deleted this message')
	) {
		return { type: 'deleted' };
	}

	const callPatterns = [
		/missed voice call/i,
		/missed video call/i,
		/call duration/i,
		/voice call \((\d+:\d+)\)/i,
		/video call \((\d+:\d+)\)/i,
	];
	for (const p of callPatterns) {
		if (p.test(lowerBody)) {
			return { type: 'call' };
		}
	}

	return { type: 'text' };
}

export function getClassificationLabel(type: MessageType, mediaType?: MediaType): string {
	if (type === 'media' && mediaType) {
		const labels: Record<MediaType, string> = {
			image: 'Image',
			video: 'Video',
			audio: 'Audio',
			document: 'Document',
			sticker: 'Sticker',
			gif: 'GIF',
		};
		return labels[mediaType];
	}
	const labels: Record<MessageType, string> = {
		text: 'Text',
		media: 'Media',
		system: 'System',
		call: 'Call',
		deleted: 'Deleted',
	};
	return labels[type];
}

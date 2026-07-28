import type { MessageType, MediaType } from './types';

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

	const systemPatterns = [
		"joined using this group's invite link",
		'joined using invite link',
		'left',
		'added',
		'removed',
		'changed the group',
		"changed this group's icon",
		'security code changed',
		'messages and calls are end-to-end encrypted',
		'created group',
		'changed the subject',
		"changed this group's subject",
	];
	for (const p of systemPatterns) {
		if (lowerBody.includes(p)) {
			return { type: 'system' };
		}
	}

	const mediaPatterns: { regex: RegExp; mediaType: MediaType }[] = [
		{ regex: /<media omitted>/i, mediaType: 'image' },
		{ regex: /image omitted/i, mediaType: 'image' },
		{ regex: /\bIMG[-_]/i, mediaType: 'image' },
		{ regex: /\.(jpg|jpeg|png|gif|webp)\b/i, mediaType: 'image' },
		{ regex: /<sticker:/i, mediaType: 'sticker' },
		{ regex: /sticker omitted/i, mediaType: 'sticker' },
		{ regex: /\bgif\b/i, mediaType: 'gif' },
		{ regex: /gif omitted/i, mediaType: 'gif' },
		{ regex: /\bVID[-_]/i, mediaType: 'video' },
		{ regex: /video omitted/i, mediaType: 'video' },
		{ regex: /\.(mp4|avi|mov|mkv)\b/i, mediaType: 'video' },
		{ regex: /\bAUD[-_]/i, mediaType: 'audio' },
		{ regex: /audio omitted/i, mediaType: 'audio' },
		{ regex: /voice message/i, mediaType: 'audio' },
		{ regex: /\.(mp3|ogg|opus|aac|wav)\b/i, mediaType: 'audio' },
		{ regex: /document omitted/i, mediaType: 'document' },
		{ regex: /\.pdf\b/i, mediaType: 'document' },
	];

	for (const { regex, mediaType } of mediaPatterns) {
		if (regex.test(lowerRaw) || regex.test(lowerBody)) {
			return { type: 'media', mediaType };
		}
	}

	if (lowerBody.includes('this message was deleted') || lowerBody.includes('this message has been deleted')) {
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

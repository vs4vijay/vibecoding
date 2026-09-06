import type { Chat } from '../parser/types';

export interface PreviewSample {
	sender: string;
	timestamp: number;
	text: string;
}

export interface ImportPreview {
	fileName: string;
	chatName: string;
	total: number;
	dateRange: { from: number; to: number } | null;
	participants: string[];
	samples: PreviewSample[];
	capWarning: string | null;
}

export function deriveChatName(fileName: string): string {
	const base = fileName.split('/').pop()?.split('\\').pop() ?? fileName;
	const lower = base.toLowerCase();
	const stripped = lower.endsWith('.txt') || lower.endsWith('.zip') ? base.slice(0, -4) : base;
	const name = stripped.trim();
	return name.length > 0 ? name : 'Untitled chat';
}

export function decodeBytes(bytes: Uint8Array): string {
	let text: string | null = null;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		text = new TextDecoder('windows-1252').decode(bytes);
	}
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	return text;
}

export function buildPreview(chat: Chat, fileName: string, sampleSize = 5): ImportPreview {
	const ts = chat.messages.map((m) => m.timestamp).filter((t) => t > 0);
	return {
		fileName,
		chatName: deriveChatName(fileName),
		total: chat.messageCount,
		dateRange: ts.length ? { from: Math.min(...ts), to: Math.max(...ts) } : null,
		participants: chat.participants,
		samples: chat.messages
			.slice(0, sampleSize)
			.map((m) => ({ sender: m.sender, timestamp: m.timestamp, text: m.text.slice(0, 280) })),
		capWarning: chat.capWarning,
	};
}

export type MessageType = 'text' | 'media' | 'system' | 'call' | 'deleted';

export type MediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'gif';

export interface Message {
	timestamp: number;
	sender: string;
	text: string;
	type: MessageType;
	mediaType: MediaType | undefined;
	dedupHash: string;
	rawLine: string;
	originalTimezone: string;
}

export interface Chat {
	messages: Message[];
	participants: string[];
	messageCount: number;
	participantCount: number;
	capWarning: string | null;
}

export interface ParseOptions {
	timezone?: string;
	locale?: string;
}

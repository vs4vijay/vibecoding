import type { Chat, Message, MessageType, MediaType, ParseOptions } from './types';
import { normalize, translateDigits } from './normalize';
import { PATTERNS, type TimestampPattern } from './patterns';
import { classifyMessage } from './classify';
import { generateDedupHash } from './dedup';

const MAX_CONTINUATION_LINES = 1000;

function parseDateYearFirst(groups: RegExpExecArray): Date {
	return new Date(`${groups[1]} ${groups[2]}`);
}

function parseDateSlashAmPm(groups: RegExpExecArray): Date {
	let dateStr = `${groups[1]} ${groups[2]}`;
	if (!/[APap][Mm]/.test(groups[2])) {
		dateStr += ' AM';
	}
	return new Date(dateStr);
}

function parseDateDotEuro(groups: RegExpExecArray): Date {
	const parts = groups[1].split('.');
	const dateStr = `${parts[2]}-${parts[1]}-${parts[0]} ${groups[2]}`;
	return new Date(dateStr);
}

function parseTimestamp(groups: RegExpExecArray, patternType: string): number {
	let d: Date;
	switch (patternType) {
		case 'yyyy-slash-bracket':
			d = parseDateYearFirst(groups);
			break;
		case 'slash-ampm-dash':
			d = parseDateSlashAmPm(groups);
			break;
		case 'dot-euro-dash':
			d = parseDateDotEuro(groups);
			break;
		default:
			d = new Date(`${groups[1]} ${groups[2]}`);
	}
	return d.getTime();
}

export function buildMessage(groups: RegExpExecArray, pattern: TimestampPattern, options?: ParseOptions): Message {
	const dateStr = `${groups[1]} ${groups[2]}`;
	const body = groups[groups.length - 1];

	const isSender = groups.length === 5;
	const sender = isSender ? groups[3].trim() : '';
	const text = body;
	const rawLine = dateStr + ' - ' + (isSender ? `${groups[3]}: ` : '') + body;

	const { type, mediaType } = classifyMessage(text, isSender ? sender : null, rawLine);

	const timestamp = parseTimestamp(groups, pattern.patternType);
	const originalTimezone = options?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

	const dedupHash = generateDedupHash({ timestamp, sender, text, type });

	return {
		timestamp,
		sender,
		text,
		type,
		mediaType,
		dedupHash,
		rawLine,
		originalTimezone,
	};
}

export function buildChat(messages: Message[], headerLineCount: number, totalLineCount: number): Chat {
	const participants = [...new Set(messages.map((m) => m.sender).filter(Boolean))];
	return {
		messages,
		participants,
		messageCount: messages.length,
		participantCount: participants.length,
		capWarning: detectCapWarning(headerLineCount, totalLineCount),
	};
}

export function detectCapWarning(headerLineCount: number, totalLineCount: number): string | null {
	if (headerLineCount >= 35000) {
		return `Export contains ${totalLineCount} lines — approaching or exceeding the 40,000 line limit. Some messages may not be included.`;
	}
	return null;
}

function matchesSenderOrSystem(line: string, pattern: TimestampPattern): RegExpExecArray | null {
	const trimmed = line.trim();
	const senderMatch = pattern.senderRegex.exec(trimmed);
	if (senderMatch) return senderMatch;

	const bodyMatch = pattern.systemRegex.exec(trimmed);
	if (bodyMatch) return bodyMatch;

	return null;
}

export function parseString(content: string, options?: ParseOptions): Chat {
	if (!content) {
		return buildChat([], 0, 0);
	}

	const normalized = normalize(content);
	const lines = normalized.split('\n');

	const messages: Message[] = [];
	let currentMessage: Message | null = null;
	let continuationCount = 0;
	let headerLineCount = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		let matched = false;

		for (const pattern of PATTERNS) {
			const groups = matchesSenderOrSystem(line, pattern);
			if (groups) {
				if (currentMessage) {
					messages.push(currentMessage);
				}

				currentMessage = buildMessage(groups, pattern, options);
				continuationCount = 0;
				headerLineCount++;
				matched = true;
				break;
			}
		}

		if (!matched && currentMessage) {
			continuationCount++;
			if (continuationCount <= MAX_CONTINUATION_LINES) {
				currentMessage.text += (currentMessage.text ? '\n' : '') + line;
				currentMessage.rawLine += '\n' + line;
			} else if (continuationCount === MAX_CONTINUATION_LINES + 1) {
				currentMessage.text += '\n[truncated...]';
				currentMessage.rawLine += '\n[truncated...]';
			}
		}
	}

	if (currentMessage) {
		messages.push(currentMessage);
	}

	return buildChat(messages, headerLineCount, lines.length);
}

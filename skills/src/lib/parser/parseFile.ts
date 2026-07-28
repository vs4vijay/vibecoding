import { classifyMessage } from './classify';
import { generateDedupHash } from './dedup';
import { normalize } from './normalize';
import { PATTERNS, type TimestampPattern } from './patterns';
import type { Chat, Message, ParseOptions } from './types';

const MAX_CONTINUATION_LINES = 1000;
const MAX_PREAMBLE_LINES = 50;

function parseTimeStr(timeStr: string): { hours: number; minutes: number; seconds: number } {
	let s = timeStr.trim();
	let isPM = false;

	const prefixMatch = s.match(/^(AM|PM)\s+/i);
	if (prefixMatch) {
		isPM = prefixMatch[1].toUpperCase() === 'PM';
		s = s.slice(prefixMatch[0].length);
	}

	const suffixMatch = s.match(/\s?(AM|PM)$/i);
	if (suffixMatch) {
		isPM = suffixMatch[1].toUpperCase() === 'PM';
		s = s.slice(0, -suffixMatch[0].length);
	}

	const parts = s.split(':').map(Number);
	let hours = parts[0] || 0;
	const minutes = parts[1] || 0;
	const seconds = parts[2] || 0;

	if (isPM && hours < 12) hours += 12;
	if (!isPM && hours === 12) hours = 0;

	return { hours, minutes, seconds };
}

function resolveDate(dateStr: string, timeStr: string, patternType: string): number {
	const { hours, minutes, seconds } = parseTimeStr(timeStr);

	switch (patternType) {
		case 'yyyy-slash-bracket':
		case 'yyyy-dot-bracket':
		case 'android-yyyy-slash-dash': {
			const sep = patternType === 'yyyy-dot-bracket' ? '.' : '/';
			const [y, m, d] = dateStr.split(sep).map(Number);
			return Date.UTC(y, m - 1, d, hours, minutes, seconds);
		}
		case 'iso-ampm-bracket':
		case 'iso-numeric-bracket':
		case 'iso-ampm-dash':
		case 'iso-numeric-dash': {
			const [y, m, d] = dateStr.split('-').map(Number);
			return Date.UTC(y, m - 1, d, hours, minutes, seconds);
		}
		case 'cjk-year-bracket': {
			const match = dateStr.match(/(\d{4})\u5e74(\d{1,2})\u6708(\d{1,2})\u65e5/);
			if (match) {
				return Date.UTC(+match[1], +match[2] - 1, +match[3], hours, minutes, seconds);
			}
			return Date.UTC(1970, 0, 1);
		}
		case 'cjk-bracket':
		case 'slash-numeric-bracket':
		case 'slash-numeric-dash': {
			const parts = dateStr.split('/').map(Number);
			if (parts.length !== 3) return Date.UTC(1970, 0, 1);
			let [a, b, y] = parts;
			if (y < 100) y += 2000;
			const hasAMPM = /AM|PM/i.test(timeStr);
			if (a > 12) return Date.UTC(y, b - 1, a, hours, minutes, seconds);
			if (b > 12) return Date.UTC(y, a - 1, b, hours, minutes, seconds);
			if (hasAMPM) return Date.UTC(y, a - 1, b, hours, minutes, seconds);
			return Date.UTC(y, b - 1, a, hours, minutes, seconds);
		}
		case 'euro-dot-bracket':
		case 'dot-euro-dash':
		case 'dot-euro-ampm-dash':
		case 'euro-dot-short-dash': {
			const [d, m, yRaw] = dateStr.split('.').map(Number);
			let y = yRaw;
			if (y < 100) y += 2000;
			return Date.UTC(y, m - 1, d, hours, minutes, seconds);
		}
		case 'ddd-mm-yy-bracket':
		case 'dutch-dash-dash': {
			const [d, m, y] = dateStr.split('-').map(Number);
			return Date.UTC(y, m - 1, d, hours, minutes, seconds);
		}
		case 'yy-mm-dd-bracket': {
			const [y, m, d] = dateStr.split('-').map(Number);
			return Date.UTC(y + 2000, m - 1, d, hours, minutes, seconds);
		}
		case 'slash-ampm-bracket':
		case 'slash-ampm-dash': {
			const [a, b, yRaw] = dateStr.split('/').map(Number);
			let y = yRaw;
			if (y < 100) y += 2000;
			if (a > 12) return Date.UTC(y, b - 1, a, hours, minutes, seconds);
			return Date.UTC(y, a - 1, b, hours, minutes, seconds);
		}
		default: {
			const d = new Date(`${dateStr} ${timeStr}`);
			return d.getTime();
		}
	}
}

export function buildMessage(groups: RegExpExecArray, pattern: TimestampPattern, options?: ParseOptions): Message {
	const dateStr = groups[1];
	const timeStr = groups[2];
	const body = groups[groups.length - 1];

	const isSender = groups.length >= 5;
	const sender = isSender ? groups[groups.length - 2].trim() : '';
	const text = body;
	const rawLine = `${dateStr} ${timeStr} - ${isSender ? `${sender}: ` : ''}${body}`;

	const { type, mediaType } = classifyMessage(text, isSender ? sender : null, rawLine);

	const finalSender = !isSender ? 'system' : sender;

	const timestamp = resolveDate(dateStr, timeStr, pattern.patternType);
	const originalTimezone = options?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

	const dedupHash = generateDedupHash({ timestamp, sender: finalSender, text, type });

	return {
		timestamp,
		sender: finalSender,
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
	if (!content || !content.trim()) {
		return buildChat([], 0, 0);
	}

	const normalized = normalize(content);
	const lines = normalized.split('\n');

	const messages: Message[] = [];
	let currentMessage: Message | null = null;
	let continuationCount = 0;
	let headerLineCount = 0;
	let preambleLines = 0;

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

		if (!matched) {
			if (!currentMessage) {
				if (preambleLines < MAX_PREAMBLE_LINES) {
					if (preambleLines === 0) {
						const preambleWarning = `[Preamble before first message — captured ${lines.length - i} lines]`;
						currentMessage = {
							timestamp: 0,
							sender: 'system',
							text: `${preambleWarning}\n${line}`,
							type: 'system',
							mediaType: undefined,
							dedupHash: generateDedupHash({
								timestamp: 0,
								sender: 'system',
								text: `${preambleWarning}\n${line}`,
								type: 'system',
							}),
							rawLine: `${preambleWarning}\n${line}`,
							originalTimezone: options?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
						};
					} else {
						// biome-ignore lint/style/noNonNullAssertion: assigned in preambleLines === 0 branch
						currentMessage!.text += `\n${line}`;
						// biome-ignore lint/style/noNonNullAssertion: assigned in preambleLines === 0 branch
						currentMessage!.rawLine += `\n${line}`;
						// biome-ignore lint/style/noNonNullAssertion: assigned in preambleLines === 0 branch
						currentMessage!.dedupHash = generateDedupHash({
							timestamp: 0,
							sender: 'system',
							// biome-ignore lint/style/noNonNullAssertion: assigned in preambleLines === 0 branch
							text: currentMessage!.text,
							type: 'system',
						});
					}
					preambleLines++;
				}
			} else {
				continuationCount++;
				if (continuationCount <= MAX_CONTINUATION_LINES) {
					currentMessage.text += (currentMessage.text ? '\n' : '') + line;
					currentMessage.rawLine += `\n${line}`;
				} else if (continuationCount === MAX_CONTINUATION_LINES + 1) {
					currentMessage.text += '\n[truncated...]';
					currentMessage.rawLine += '\n[truncated...]';
				}
			}
		}
	}

	if (currentMessage) {
		messages.push(currentMessage);
	}

	return buildChat(messages, headerLineCount, lines.length);
}

/**
 * Pure highlight/snippet helpers for the search results surface.
 * All output is plain text — no HTML, no {@html}. Callers render via
 * escaped interpolation with <mark> for matched segments.
 */

interface Segment {
	text: string;
	match: boolean;
}

/**
 * Split text into segments marking every term match (case-insensitive).
 * Tokens are regex-escaped and sorted longest-first to prevent partial
 * matches within longer tokens.
 */
export function splitByTerms(text: string, tokens: string[]): Segment[] {
	if (tokens.length === 0 || text.length === 0) return [{ text, match: false }];

	const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
	const re = new RegExp(`(${escaped.join('|')})`, 'gi');

	const segments: Segment[] = [];
	let last = 0;
	for (const m of text.matchAll(re)) {
		const idx = m.index;
		if (idx === undefined) continue;
		if (idx > last) {
			segments.push({ text: text.slice(last, idx), match: false });
		}
		segments.push({ text: m[0], match: true });
		last = idx + m[0].length;
	}
	if (last < text.length) {
		segments.push({ text: text.slice(last), match: false });
	}
	return segments;
}

/**
 * Produce a snippet around the first term match, capped at maxLen.
 * Snapped outward to the nearest space boundary when possible;
 * prefixed/suffixed with '…' when trimmed.
 */
export function makeSnippet(text: string, tokens: string[], maxLen = 160): string {
	if (tokens.length === 0 || text.length === 0) return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;

	const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
	const re = new RegExp(`(${escaped.join('|')})`, 'gi');
	const m = re.exec(text);
	if (!m || m.index === undefined) return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;

	const mStart = m.index;
	const mEnd = mStart + m[0].length;
	const windowStart = Math.max(0, mStart - Math.floor(maxLen / 3));
	const windowEnd = Math.min(text.length, mEnd + Math.ceil((maxLen * 2) / 3));

	// Snap outward to nearest space boundary (within 20 chars)
	let start = windowStart;
	if (start > 0) {
		const spaceIdx = text.lastIndexOf(' ', start - 1);
		if (spaceIdx >= 0 && start - spaceIdx < 20) start = spaceIdx + 1;
	}
	let end = windowEnd;
	if (end < text.length) {
		const spaceIdx = text.indexOf(' ', end);
		if (spaceIdx >= 0 && spaceIdx - end < 20) end = spaceIdx;
	}

	const prefix = start > 0 ? '…' : '';
	const suffix = end < text.length ? '…' : '';
	return `${prefix}${text.slice(start, end)}${suffix}`;
}

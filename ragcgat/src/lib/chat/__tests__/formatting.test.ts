import { describe, expect, it } from 'vitest';
import { SENDER_PALETTE, formatClock, formatDayLabel, formatSidebarTime, senderColor } from '../formatting';

const CLOCK_SHAPE = /^\d{1,2}:\d{2}/;

function startOfToday(): number {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

describe('formatClock', () => {
	it('returns HH:MM shaped output for known epochs', () => {
		expect(formatClock(Date.UTC(2026, 0, 2, 10, 5))).toMatch(CLOCK_SHAPE);
		expect(formatClock(Date.UTC(2026, 5, 14, 0, 0))).toMatch(CLOCK_SHAPE);
		expect(formatClock(Date.UTC(2026, 11, 31, 23, 59))).toMatch(CLOCK_SHAPE);
	});

	it('is stable for the same instant', () => {
		const ts = Date.UTC(2026, 3, 9, 15, 30);
		expect(formatClock(ts)).toBe(formatClock(ts));
	});
});

describe('formatDayLabel', () => {
	it('returns Today for now', () => {
		expect(formatDayLabel(Date.now())).toBe('Today');
	});

	it('returns Yesterday for now minus 86400000', () => {
		expect(formatDayLabel(Date.now() - 86_400_000)).toBe('Yesterday');
	});

	it('holds Today just after midnight and Yesterday just before it', () => {
		const midnight = startOfToday();
		expect(formatDayLabel(midnight + 60_000)).toBe('Today');
		expect(formatDayLabel(midnight - 60_000)).toBe('Yesterday');
	});

	it('returns a dated label otherwise', () => {
		const label = formatDayLabel(Date.UTC(2020, 5, 14, 12));
		expect(label).not.toBe('Today');
		expect(label).not.toBe('Yesterday');
		expect(label.length).toBeGreaterThan(0);
	});
});

describe('formatSidebarTime', () => {
	it('shows the clock for messages from today', () => {
		const now = Date.now();
		expect(formatSidebarTime(now, now)).toMatch(CLOCK_SHAPE);
		expect(formatSidebarTime(now, now)).toBe(formatClock(now));
	});

	it('shows Yesterday for messages from yesterday', () => {
		const now = Date.now();
		expect(formatSidebarTime(now - 86_400_000, now)).toBe('Yesterday');
	});

	it('shows a compact date for older messages', () => {
		const old = formatSidebarTime(Date.UTC(2020, 5, 14, 12));
		expect(old).not.toBe('Yesterday');
		expect(old).not.toMatch(CLOCK_SHAPE);
		expect(old.length).toBeGreaterThan(0);
	});
});

describe('senderColor', () => {
	it('is deterministic per sender', () => {
		expect(senderColor('Alice')).toBe(senderColor('Alice'));
		expect(senderColor('Bob Mom')).toBe(senderColor('Bob Mom'));
	});

	it('returns palette entries', () => {
		for (const name of ['Alice', 'Bob', '', '+1 (555) 010-2030']) {
			expect(SENDER_PALETTE as readonly string[]).toContain(senderColor(name));
		}
	});

	it('distributes distinct senders across the palette', () => {
		const senders = Array.from({ length: 32 }, (_, i) => `sender-${i}@example.com`);
		const used = new Set(senders.map(senderColor));
		expect(used.size).toBeGreaterThan(1);
	});
});

describe('SENDER_PALETTE dark pairing (Pitfall 7)', () => {
	it('every palette entry carries a light and a dark text utility', () => {
		for (const entry of SENDER_PALETTE) {
			expect(entry).toMatch(/\btext-\S+-\d{3}\b/);
			expect(entry).toMatch(/\bdark:text-\S+-\d{3}\b/);
		}
	});
});

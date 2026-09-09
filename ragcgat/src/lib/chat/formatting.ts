/**
 * Pure chat formatting helpers (Phase 04). Stdlib Intl only — no date-fns.
 * Labels resolve in the viewer's locale/timezone; tests pin shapes, not
 * locale spellings.
 */

const clockFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const sidebarDateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

function sameCalendarDay(a: Date, b: Date): boolean {
	return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Clock label for bubble rows ("3:05 PM" / "15:05" shaped). */
export function formatClock(ts: number): string {
	return clockFormatter.format(new Date(ts));
}

/** "Today" / "Yesterday" / dated label ("14 Jun 2026" shaped) for day context. */
export function formatDayLabel(ts: number, now = Date.now()): string {
	const day = new Date(ts);
	if (sameCalendarDay(day, new Date(now))) return 'Today';
	if (sameCalendarDay(day, new Date(now - 86_400_000))) return 'Yesterday';
	return dayFormatter.format(day);
}

/** Sidebar row time: clock for today, "Yesterday", compact date otherwise. */
export function formatSidebarTime(ts: number, now = Date.now()): string {
	const day = new Date(ts);
	if (sameCalendarDay(day, new Date(now))) return formatClock(ts);
	if (sameCalendarDay(day, new Date(now - 86_400_000))) return 'Yesterday';
	return sidebarDateFormatter.format(day);
}

/**
 * Deterministic per-sender color: string hash into an 8-hue Tailwind palette.
 * Every entry carries its light and dark class pair in one string so each
 * color utility has its dark: sibling (Pitfall 7) and both tokens stay
 * visible to the Tailwind scanner right here in source.
 */
export const SENDER_PALETTE = [
	'text-rose-600 dark:text-rose-300',
	'text-sky-600 dark:text-sky-300',
	'text-emerald-600 dark:text-emerald-300',
	'text-amber-600 dark:text-amber-300',
	'text-violet-600 dark:text-violet-300',
	'text-pink-600 dark:text-pink-300',
	'text-cyan-600 dark:text-cyan-300',
	'text-lime-600 dark:text-lime-300',
] as const;

export function senderColor(sender: string): string {
	let hash = 0;
	for (const ch of sender) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
	return SENDER_PALETTE[hash % SENDER_PALETTE.length];
}

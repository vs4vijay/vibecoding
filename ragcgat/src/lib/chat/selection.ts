/**
 * ?chat= query-param codec (T-04-02): strict positive safe-integer parse.
 * Anything non-numeric, zero, negative, or beyond Number.MAX_SAFE_INTEGER is
 * null — callers render the empty state. Parsed ids are only ever used as
 * Dexie primary-key gets, never interpolated into queries.
 */
export function parseChatParam(raw: string | null): number | null {
	if (raw === null) return null;
	if (!/^\d+$/.test(raw)) return null;
	const id = Number(raw);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Reverse trip of parseChatParam for goto('?chat=…') links. */
export function serializeChatParam(id: number): string {
	return String(id);
}

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

/**
 * ?at= query-param codec for message ids: strict positive safe-integer parse.
 * Anything non-numeric, zero, negative, or beyond Number.MAX_SAFE_INTEGER is null.
 * A ?at= without a valid ?chat= is inert — ChatView only seeks when a chat id is present.
 */
export function parseMessageParam(raw: string | null): number | null {
	if (raw === null) return null;
	if (!/^\d+$/.test(raw)) return null;
	const id = Number(raw);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Reverse trip of parseMessageParam for goto('?chat=…&at=…') links. */
export function serializeMessageParam(id: number): string {
	return String(id);
}

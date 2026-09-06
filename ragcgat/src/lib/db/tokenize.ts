const MAX_INPUT_CHARS = 2000;
const MAX_TERMS = 200;

export function tokenize(text: string): string[] {
	const terms = text
		.slice(0, MAX_INPUT_CHARS)
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((t) => t.length >= 2);
	return [...new Set(terms)].slice(0, MAX_TERMS);
}

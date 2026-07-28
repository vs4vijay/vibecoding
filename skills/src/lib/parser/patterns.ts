export interface TimestampPattern {
	senderRegex: RegExp;
	systemRegex: RegExp;
	patternType: string;
}

const PATTERNS: TimestampPattern[] = [
	{
		patternType: 'yyyy-slash-bracket',
		senderRegex: /^\[(\d{4}\/\d{2}\/\d{2}),\s(\d{2}:\d{2}:\d{2})\]\s([^:]+?):\s(.+)$/i,
		systemRegex: /^\[(\d{4}\/\d{2}\/\d{2}),\s(\d{2}:\d{2}:\d{2})\]\s(.+)$/i,
	},
	{
		patternType: 'slash-ampm-dash',
		senderRegex: /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\s-\s([^:]+?):\s(.+)$/,
		systemRegex: /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\s-\s(.+)$/,
	},
	{
		patternType: 'dot-euro-dash',
		senderRegex: /^(\d{2}\.\d{2}\.\d{4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s([^:]+?):\s(.+)$/,
		systemRegex: /^(\d{2}\.\d{2}\.\d{4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s(.+)$/,
	},
];

export { PATTERNS };

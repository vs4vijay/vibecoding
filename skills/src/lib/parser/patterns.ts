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
		patternType: 'yyyy-dot-bracket',
		senderRegex: /^\[(\d{4}\.\d{2}\.\d{2}),\s(\d{2}:\d{2}:\d{2})\]\s([^:]+?):\s(.+)$/i,
		systemRegex: /^\[(\d{4}\.\d{2}\.\d{2}),\s(\d{2}:\d{2}:\d{2})\]\s(.+)$/i,
	},
	{
		patternType: 'iso-ampm-bracket',
		senderRegex: /^\[(\d{4}-\d{2}-\d{2}),\s(\d{1,2}:\d{2}(?::\d{2})?\s?[APap][Mm])\]\s([^:]+?):\s(.+)$/i,
		systemRegex: /^\[(\d{4}-\d{2}-\d{2}),\s(\d{1,2}:\d{2}(?::\d{2})?\s?[APap][Mm])\]\s(.+)$/i,
	},
	{
		patternType: 'iso-numeric-bracket',
		senderRegex: /^\[(\d{4}-\d{2}-\d{2}),\s(\d{1,2}:\d{2}(?::\d{2})?)\]\s([^:]+?):\s(.+)$/i,
		systemRegex: /^\[(\d{4}-\d{2}-\d{2}),\s(\d{1,2}:\d{2}(?::\d{2})?)\]\s(.+)$/i,
	},
	{
		patternType: 'cjk-year-bracket',
		senderRegex: /^\[(\d{4}\u5e74\d{1,2}\u6708\d{1,2}\u65e5),\s(\d{1,2}:\d{2}(?::\d{2})?)\]\s([^:]+?):\s(.+)$/i,
		systemRegex: /^\[(\d{4}\u5e74\d{1,2}\u6708\d{1,2}\u65e5),\s(\d{1,2}:\d{2}(?::\d{2})?)\]\s(.+)$/i,
	},
	{
		patternType: 'cjk-bracket',
		senderRegex:
			/^\[(\d{1,2}\/\d{1,2}\/\d{2,4})\s*,?\s*((?:(?:AM|PM)\s+)?\d{1,2}:\d{2}(?::\d{2})?)\]\s([^:]+?):\s(.+)$/i,
		systemRegex: /^\[(\d{1,2}\/\d{1,2}\/\d{2,4})\s*,?\s*((?:(?:AM|PM)\s+)?\d{1,2}:\d{2}(?::\d{2})?)\]\s(.+)$/i,
	},
	{
		patternType: 'slash-ampm-bracket',
		senderRegex: /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?\s?[APap][Mm])\]\s([^:]+?):\s(.+)$/i,
		systemRegex: /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?\s?[APap][Mm])\]\s(.+)$/i,
	},
	{
		patternType: 'slash-numeric-bracket',
		senderRegex: /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\]\s([^:]+?):\s(.+)$/i,
		systemRegex: /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\]\s(.+)$/i,
	},
	{
		patternType: 'euro-dot-bracket',
		senderRegex: /^\[(\d{2}\.\d{2}\.\d{4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\]\s([^:]+?):\s(.+)$/i,
		systemRegex: /^\[(\d{2}\.\d{2}\.\d{4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\]\s(.+)$/i,
	},
	{
		patternType: 'ddd-mm-yy-bracket',
		senderRegex: /^\[(\d{2}-\d{2}-\d{4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\]\s([^:]+?):\s(.+)$/i,
		systemRegex: /^\[(\d{2}-\d{2}-\d{4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\]\s(.+)$/i,
	},
	{
		patternType: 'yy-mm-dd-bracket',
		senderRegex: /^\[(\d{2}-\d{2}-\d{2}),\s(\d{1,2}:\d{2}(?::\d{2})?\s?[APap][Mm]?)\]\s([^:]+?):\s(.+)$/i,
		systemRegex: /^\[(\d{2}-\d{2}-\d{2}),\s(\d{1,2}:\d{2}(?::\d{2})?\s?[APap][Mm]?)\]\s(.+)$/i,
	},
	{
		patternType: 'iso-ampm-dash',
		senderRegex: /^(\d{4}-\d{2}-\d{2}),\s(\d{1,2}:\d{2}(?::\d{2})?\s?[APap][Mm])\s-\s([^:]+?):\s(.+)$/i,
		systemRegex: /^(\d{4}-\d{2}-\d{2}),\s(\d{1,2}:\d{2}(?::\d{2})?\s?[APap][Mm])\s-\s(.+)$/i,
	},
	{
		patternType: 'iso-numeric-dash',
		senderRegex: /^(\d{4}-\d{2}-\d{2}),\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s([^:]+?):\s(.+)$/i,
		systemRegex: /^(\d{4}-\d{2}-\d{2}),\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s(.+)$/i,
	},
	{
		patternType: 'android-yyyy-slash-dash',
		senderRegex: /^(\d{4}\/\d{2}\/\d{2}),\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s([^:]+?):\s(.+)$/i,
		systemRegex: /^(\d{4}\/\d{2}\/\d{2}),\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s(.+)$/i,
	},
	{
		patternType: 'slash-ampm-dash',
		senderRegex: /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\s-\s([^:]+?):\s(.+)$/,
		systemRegex: /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\s-\s(.+)$/,
	},
	{
		patternType: 'slash-numeric-dash',
		senderRegex: /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s([^:]+?):\s(.+)$/i,
		systemRegex: /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s(.+)$/i,
	},
	{
		patternType: 'dot-euro-dash',
		senderRegex: /^(\d{2}\.\d{2}\.\d{4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s([^:]+?):\s(.+)$/,
		systemRegex: /^(\d{2}\.\d{2}\.\d{4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s(.+)$/,
	},
	{
		patternType: 'dot-euro-ampm-dash',
		senderRegex: /^(\d{2}\.\d{2}\.\d{4}),\s(\d{1,2}:\d{2}(?::\d{2})?\s?[APap][Mm])\s-\s([^:]+?):\s(.+)$/i,
		systemRegex: /^(\d{2}\.\d{2}\.\d{4}),\s(\d{1,2}:\d{2}(?::\d{2})?\s?[APap][Mm])\s-\s(.+)$/i,
	},
	{
		patternType: 'euro-dot-short-dash',
		senderRegex: /^(\d{2}\.\d{2}\.\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s([^:]+?):\s(.+)$/i,
		systemRegex: /^(\d{2}\.\d{2}\.\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s(.+)$/i,
	},
	{
		patternType: 'dutch-dash-dash',
		senderRegex: /^(\d{2}-\d{2}-\d{4})\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s([^:]+?):\s(.+)$/i,
		systemRegex: /^(\d{2}-\d{2}-\d{4})\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s(.+)$/i,
	},
];

export { PATTERNS };

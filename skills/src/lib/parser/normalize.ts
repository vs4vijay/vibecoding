export function normalize(content: string): string {
	let result = content;

	if (result.charCodeAt(0) === 0xfeff) {
		result = result.slice(1);
	}

	result = result.replace(/\r\n/g, '\n');

	result = result.replace(/[\u200e\u200f]/g, '');

	result = result.replace(/[\u2028-\u202e]/g, '');

	result = result.replace(/\u202f/g, ' ');
	result = result.replace(/\u00a0/g, ' ');

	result = result.replace(/\u060c/g, ',');

	return result;
}

export function translateDigits(text: string): string {
	let result = text;

	result = result.replace(/[\u0660-\u0669]/g, (ch) => String.fromCharCode(0x0030 + ch.charCodeAt(0) - 0x0660));

	result = result.replace(/[\u06f0-\u06f9]/g, (ch) => String.fromCharCode(0x0030 + ch.charCodeAt(0) - 0x06f0));

	result = result.replace(/[\u0966-\u096f]/g, (ch) => String.fromCharCode(0x0030 + ch.charCodeAt(0) - 0x0966));

	result = result.replace(/[\u0e50-\u0e59]/g, (ch) => String.fromCharCode(0x0030 + ch.charCodeAt(0) - 0x0e50));

	result = result.replace(/\u0628\.\u0638/g, 'PM');
	result = result.replace(/\u0642\.\u0638/g, 'AM');
	result = result.replace(/\u0635/g, 'AM');
	result = result.replace(/\u0645/g, 'PM');

	result = result.replace(/\u4e0a\u5348/g, 'AM');
	result = result.replace(/\u4e0b\u5348/g, 'PM');

	return result;
}

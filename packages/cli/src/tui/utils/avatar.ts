import chalk from 'chalk';
import {Text} from '@mariozechner/pi-tui';
import type {Component} from '@mariozechner/pi-tui';

// 3×5 bitmap font for digits and uppercase letters.
// Each glyph is 5 rows of 3 columns; '1' = pixel on, '0' = off.
const FONT_3X5: Record<string, string[]> = {
	A: ['010', '101', '111', '101', '101'],
	B: ['110', '101', '110', '101', '110'],
	C: ['011', '100', '100', '100', '011'],
	D: ['110', '101', '101', '101', '110'],
	E: ['111', '100', '110', '100', '111'],
	F: ['111', '100', '110', '100', '100'],
	G: ['011', '100', '101', '101', '011'],
	H: ['101', '101', '111', '101', '101'],
	I: ['111', '010', '010', '010', '111'],
	J: ['001', '001', '001', '101', '010'],
	K: ['101', '101', '110', '101', '101'],
	L: ['100', '100', '100', '100', '111'],
	M: ['101', '111', '111', '101', '101'],
	N: ['101', '111', '111', '111', '101'],
	O: ['010', '101', '101', '101', '010'],
	P: ['110', '101', '110', '100', '100'],
	Q: ['010', '101', '101', '110', '011'],
	R: ['110', '101', '110', '110', '101'],
	S: ['011', '100', '010', '001', '110'],
	T: ['111', '010', '010', '010', '010'],
	U: ['101', '101', '101', '101', '011'],
	V: ['101', '101', '101', '101', '010'],
	W: ['101', '101', '111', '111', '101'],
	X: ['101', '101', '010', '101', '101'],
	Y: ['101', '101', '010', '010', '010'],
	Z: ['111', '001', '010', '100', '111'],
	'0': ['010', '101', '101', '101', '010'],
	'1': ['010', '110', '010', '010', '111'],
	'2': ['110', '001', '010', '100', '111'],
	'3': ['110', '001', '010', '001', '110'],
	'4': ['101', '101', '111', '001', '001'],
	'5': ['111', '100', '110', '001', '110'],
	'6': ['011', '100', '110', '101', '010'],
	'7': ['111', '001', '010', '010', '010'],
	'8': ['010', '101', '010', '101', '010'],
	'9': ['010', '101', '011', '001', '110'],
	'?': ['111', '001', '010', '000', '010'],
};

const LETTER_W = 3;
const LETTER_H = 5;
const LETTER_GAP = 1;
const MAX_LETTERS = 3;

function parseHexColor(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	return [
		parseInt(h.substring(0, 2), 16) || 0,
		parseInt(h.substring(2, 4), 16) || 0,
		parseInt(h.substring(4, 6), 16) || 0,
	];
}

function scale([r, g, b]: [number, number, number], factor: number): [number, number, number] {
	return [
		Math.max(0, Math.min(255, Math.round(r * factor))),
		Math.max(0, Math.min(255, Math.round(g * factor))),
		Math.max(0, Math.min(255, Math.round(b * factor))),
	];
}

/**
 * Renders the workspace name (up to MAX_LETTERS chars) as a compact 3×5
 * pixel-font monogram using ▀ ▄ █ half-blocks (3 lines tall per letter).
 * Top pixel of each cell uses the full accent; bottom pixel uses a 70%
 * shaded accent — gives a subtle vertical gradient for visual interest
 * without losing readability. OFF pixels emit a plain space so it works
 * on light and dark themes alike.
 */
export function buildAvatar(
	name: string,
	accentHex: string,
	_base64Png?: string | null,
): Component {
	const accent = parseHexColor(accentHex);
	const accentDim = scale(accent, 0.7);
	const top = chalk.rgb(accent[0], accent[1], accent[2]);
	const bot = chalk.rgb(accentDim[0], accentDim[1], accentDim[2]);
	const both = chalk.rgb(accent[0], accent[1], accent[2]).bgRgb(accentDim[0], accentDim[1], accentDim[2]);

	const upper = (name || '').toUpperCase();
	let chars = upper.split('').filter(c => FONT_3X5[c]);
	if (chars.length === 0) chars = ['?'];
	chars = chars.slice(0, MAX_LETTERS);

	// Pad letter to even row count so half-blocks divide cleanly.
	const paddedRows = LETTER_H + (LETTER_H % 2); // 6
	const lineCount = paddedRows / 2; // 3

	function bitAt(charIdx: number, row: number, col: number): boolean {
		if (row >= LETTER_H) return false;
		const glyph = FONT_3X5[chars[charIdx] ?? '?'];
		return glyph?.[row]?.[col] === '1';
	}

	const lines: string[] = [];
	for (let line = 0; line < lineCount; line++) {
		let out = '';
		for (let ci = 0; ci < chars.length; ci++) {
			for (let col = 0; col < LETTER_W; col++) {
				const t = bitAt(ci, line * 2, col);
				const b = bitAt(ci, line * 2 + 1, col);
				if (t && b) out += both('▀');
				else if (t) out += top('▀');
				else if (b) out += bot('▄');
				else out += ' ';
			}
			if (ci < chars.length - 1) out += ' '.repeat(LETTER_GAP);
		}
		lines.push(out);
	}

	return new Text(lines.join('\n'), 0, 1);
}

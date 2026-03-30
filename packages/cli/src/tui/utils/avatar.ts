import chalk from 'chalk';
import {decode as decodePng} from 'fast-png';
import {
	Text,
	Image,
	getPngDimensions,
	getCapabilities,
	resetCapabilitiesCache,
} from '@mariozechner/pi-tui';
import type {Component} from '@mariozechner/pi-tui';

/**
 * Checks if the current terminal supports inline images.
 * Extends pi-tui's detection with tmux passthrough and explicit override.
 */
export function supportsImages(): boolean {
	// Allow explicit override via env var
	if (process.env.CORE_IMAGE_PROTOCOL === 'iterm2' || process.env.CORE_IMAGE_PROTOCOL === 'kitty') {
		return true;
	}

	// tmux passes TERM_PROGRAM through — but some setups don't.
	// If running inside tmux, check if the outer terminal supports images.
	if (process.env.TERM === 'screen' || process.env.TMUX) {
		const outerTerm = (process.env.TERM_PROGRAM ?? '').toLowerCase();
		if (outerTerm === 'iterm.app' || process.env.ITERM_SESSION_ID) return true;
		if (outerTerm === 'kitty' || process.env.KITTY_WINDOW_ID) return true;
		if (outerTerm === 'wezterm' || process.env.WEZTERM_PANE) return true;
		if (outerTerm === 'ghostty' || process.env.GHOSTTY_RESOURCES_DIR) return true;
	}

	resetCapabilitiesCache();
	return getCapabilities().images !== null;
}

/**
 * Builds an inline PNG Image component from base64 data.
 * Returns null if terminal doesn't support images.
 */
export function buildImageAvatar(base64Png: string, accentHex: string): Component | null {
	if (!supportsImages()) return null;
	const dims = getPngDimensions(base64Png);
	if (!dims) return null;
	return new Image(
		base64Png,
		'image/png',
		{fallbackColor: chalk.hex(accentHex)},
		{maxWidthCells: 8, maxHeightCells: 4},
		dims,
	);
}

/**
 * Renders a PNG (base64) as colored Unicode half-block characters.
 * Uses ▀ (upper half block) with ANSI 24-bit fg/bg colors to pack
 * 2 pixel rows into each terminal line, preserving aspect ratio.
 * Works in any terminal that supports truecolor (no Kitty/iTerm2 needed).
 */
export function buildColorBlockAvatar(base64Png: string, targetCols = 10): Text {
	const buffer = Buffer.from(base64Png, 'base64');
	const png = decodePng(buffer);
	const {width, height, data, channels} = png;

	// Terminal cells are ~1:2 (width:height). Half-blocks split each line into
	// 2 pixel rows, but the visual height of a line is still 2× the cell width.
	// Dividing by 2 cancels that out so the rendered output is visually square.
	const termRows = Math.max(1, Math.round((targetCols * height) / (width * 2)));
	const pixelRows = termRows * 2;

	function getPixel(pxRow: number, pxCol: number): [number, number, number] {
		const srcRow = Math.min(Math.floor((pxRow * height) / pixelRows), height - 1);
		const srcCol = Math.min(Math.floor((pxCol * width) / targetCols), width - 1);
		const idx = (srcRow * width + srcCol) * channels;
		return [data[idx] as number, data[idx + 1] as number, data[idx + 2] as number];
	}

	const lines: string[] = [];
	for (let row = 0; row < termRows; row++) {
		let line = '';
		for (let col = 0; col < targetCols; col++) {
			const [tr, tg, tb] = getPixel(row * 2, col);
			const [br, bg, bb] = getPixel(row * 2 + 1, col);
			line += chalk.rgb(tr, tg, tb).bgRgb(br, bg, bb)('▀');
		}
		lines.push(line);
	}

	return new Text(lines.join('\n'), 0, 1);
}

/**
 * Returns the best available avatar component:
 * - Inline PNG image (if terminal supports Kitty/iTerm2 protocol)
 * - Colored half-block rendering (truecolor, works everywhere)
 * - Deterministic accent-colored pixel grid (final fallback, no PNG needed)
 */
export function buildAvatar(
	name: string,
	accentHex: string,
	base64Png?: string | null,
): Component {
	if (base64Png) {
		const img = buildImageAvatar(base64Png, accentHex);
		if (img) return img;
		try {
			return buildColorBlockAvatar(base64Png);
		} catch {
			// fall through to accent-colored fallback
		}
	}

	// Final fallback: simple accent block (no PNG)
	const block = chalk.hex(accentHex)('██\n██\n██');
	return new Text(block, 0, 1);
}

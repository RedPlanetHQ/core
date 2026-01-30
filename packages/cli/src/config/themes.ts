import type {Theme, ThemePreset, Colors} from '@/types/ui';

const darkThemeColors: Colors = {
	white: 'white',
	black: 'black',
	primary: '#C15E50',
	muted: 'gray',
	tool: '#C15E50',
	info: '#C15E50',
	// Muted text

	// Status
	success: 'green',
	error: 'red',
	warning: 'yellow',
	secondary: 'cyan', // neutral secondary, readable on both themes
};

const lightThemeColors: Colors = {
	white: '#1a1a1a',
	black: '#f5f5f5',
	primary: '#B94A3C',
	muted: '#B94A3C',
	tool: '#A83585',
	success: '#2D8659',
	error: '#C13332',
	secondary: '#8B5A25',
	info: '#B94A3C',
	warning: '#C78540',
};

/**
 * Detect if terminal is using a light or dark background
 * Uses COLORFGBG environment variable or defaults to dark
 */
export function detectTerminalTheme(): 'dark' | 'light' {
	// Check COLORFGBG environment variable (format: "foreground;background")
	const colorFgBg = process.env.COLORFGBG;
	if (colorFgBg) {
		const parts = colorFgBg.split(';');
		const bg = parts[parts.length - 1];
		if (bg) {
			const bgNum = parseInt(bg, 10);
			// ANSI colors 0-6 are typically dark, 7-15 are bright/light
			if (!isNaN(bgNum)) {
				return bgNum >= 7 ? 'light' : 'dark';
			}
		}
	}

	// Check for common light theme indicators in environment
	const term = process.env.TERM_PROGRAM || '';

	if (
		process.env.THEME === 'light' ||
		process.env.COLORTERM === 'light' ||
		term.toLowerCase().includes('light')
	) {
		return 'light';
	}

	// Default to dark theme (most common for developers)
	return 'dark';
}

export const themes: Record<ThemePreset, Theme> = {
	main: {
		name: 'main',
		displayName: 'Main',
		colors:
			detectTerminalTheme() === 'dark' ? darkThemeColors : lightThemeColors,
	},
};

export function getThemeColors(themePreset: ThemePreset): Colors {
	return themes[themePreset].colors;
}

export const defaultTheme: ThemePreset = 'main';

export const themeContextValue = {
	currentTheme: defaultTheme,
	colors: getThemeColors(defaultTheme),
	setCurrentTheme: () => {},
};

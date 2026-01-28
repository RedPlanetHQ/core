export interface Colors {
	white: string;
	black: string;
	primary: string;
	muted: string;
	tool: string;
	secondary: string;
	success: string;
	error: string;
	info: string;
	warning: string;
}

export interface Theme {
	name: string;
	displayName: string;
	colors: Colors;
}

export type ThemePreset = 'main';

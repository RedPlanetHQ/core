import chalk from 'chalk';

export const editorTheme = {
	borderColor: (s: string) => chalk.black(s),
	selectList: {
		selectedPrefix: (s: string) => chalk.cyan(s),
		selectedText: (s: string) => chalk.white(s),
		description: (s: string) => chalk.gray(s),
		scrollInfo: (s: string) => chalk.gray(s),
		noMatch: (s: string) => chalk.gray(s),
	},
};

export const markdownTheme = {
	heading: (s: string) => chalk.bold.cyan(s),
	link: (s: string) => chalk.blue(s),
	linkUrl: (s: string) => chalk.gray(s),
	code: (s: string) => chalk.yellow(s),
	codeBlock: (s: string) => chalk.yellow(s),
	codeBlockBorder: (s: string) => chalk.gray(s),
	quote: (s: string) => chalk.gray(s),
	quoteBorder: (s: string) => chalk.gray(s),
	hr: (s: string) => chalk.gray(s),
	listBullet: (s: string) => chalk.cyan(s),
	bold: (s: string) => chalk.bold(s),
	italic: (s: string) => chalk.italic(s),
	strikethrough: (s: string) => chalk.strikethrough(s),
	underline: (s: string) => chalk.underline(s),
};

import TurndownService from 'turndown';

// Configured once for terminal-friendly markdown output.
// - ATX headings (# Heading) render correctly in pi-tui's Markdown component
// - Fenced code blocks (```) are easier to read than indented blocks
// - Bullet '-' is used for unordered lists (consistent with our codebase style)
const service = new TurndownService({
	headingStyle: 'atx',
	codeBlockStyle: 'fenced',
	bulletListMarker: '-',
	emDelimiter: '*',
});

export function htmlToMarkdown(html: string | null | undefined): string {
	if (!html) return '';
	return service.turndown(html).trim();
}

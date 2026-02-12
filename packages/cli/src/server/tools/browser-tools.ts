import zod from 'zod';
import {
	browserOpen,
	browserClose,
	browserClick,
	browserDblclick,
	browserFill,
	browserType,
	browserPress,
	browserHover,
	browserSelect,
	browserCheck,
	browserUncheck,
	browserScroll,
	browserScreenshot,
	browserSnapshot,
	browserEval,
	browserGet,
	browserIs,
	browserFind,
	browserWait,
	browserMouse,
	browserSet,
	browserTab,
	browserFrame,
	browserNav,
} from '@/utils/agent-browser';

// ============ Zod Schemas ============

// Core Actions
export const BrowserOpenSchema = zod.object({
	url: zod.string(),
	headed: zod.boolean().optional(),
});

export const BrowserClickSchema = zod.object({
	selector: zod.string(),
});

export const BrowserDblclickSchema = zod.object({
	selector: zod.string(),
});

export const BrowserFillSchema = zod.object({
	selector: zod.string(),
	text: zod.string(),
});

export const BrowserTypeSchema = zod.object({
	selector: zod.string(),
	text: zod.string(),
});

export const BrowserPressSchema = zod.object({
	key: zod.string(),
});

export const BrowserHoverSchema = zod.object({
	selector: zod.string(),
});

export const BrowserSelectSchema = zod.object({
	selector: zod.string(),
	value: zod.string(),
});

export const BrowserCheckSchema = zod.object({
	selector: zod.string(),
});

export const BrowserUncheckSchema = zod.object({
	selector: zod.string(),
});

export const BrowserScrollSchema = zod.object({
	direction: zod.enum(['up', 'down', 'left', 'right']),
	pixels: zod.number().optional(),
});

export const BrowserScreenshotSchema = zod.object({
	path: zod.string().optional(),
	full: zod.boolean().optional(),
});

export const BrowserSnapshotSchema = zod.object({});

export const BrowserEvalSchema = zod.object({
	script: zod.string(),
});

export const BrowserCloseSchema = zod.object({});

// Category-based Schemas
export const BrowserGetSchema = zod.object({
	subcommand: zod.enum([
		'text',
		'html',
		'value',
		'attr',
		'title',
		'url',
		'count',
		'box',
	]),
	args: zod.array(zod.string()).optional(),
});

export const BrowserIsSchema = zod.object({
	check: zod.enum(['visible', 'enabled', 'checked']),
	selector: zod.string(),
});

export const BrowserFindSchema = zod.object({
	args: zod.array(zod.string()),
});

export const BrowserWaitSchema = zod.object({
	args: zod.array(zod.string()),
});

export const BrowserMouseSchema = zod.object({
	subcommand: zod.enum(['move', 'down', 'up', 'wheel']),
	args: zod.array(zod.string()).optional(),
});

export const BrowserSetSchema = zod.object({
	subcommand: zod.enum([
		'viewport',
		'device',
		'geo',
		'offline',
		'headers',
		'credentials',
		'media',
	]),
	args: zod.array(zod.string()).optional(),
});

export const BrowserTabSchema = zod.object({
	args: zod.array(zod.string()).optional(),
});

export const BrowserFrameSchema = zod.object({
	target: zod.string(),
});

export const BrowserNavSchema = zod.object({
	action: zod.enum(['back', 'forward', 'reload']),
});

// ============ Tool Interface ============

export interface GatewayTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

// ============ JSON Schemas ============

const jsonSchemas: Record<string, Record<string, unknown>> = {
	// Core Actions
	browser_open: {
		type: 'object',
		properties: {
			url: {type: 'string', description: 'URL to open'},
		},
		required: ['url'],
	},
	browser_click: {
		type: 'object',
		properties: {
			selector: {type: 'string', description: 'CSS selector or element ref'},
		},
		required: ['selector'],
	},
	browser_dblclick: {
		type: 'object',
		properties: {
			selector: {type: 'string', description: 'CSS selector or element ref'},
		},
		required: ['selector'],
	},
	browser_fill: {
		type: 'object',
		properties: {
			selector: {type: 'string', description: 'CSS selector of input field'},
			text: {type: 'string', description: 'Text to fill (clears existing)'},
		},
		required: ['selector', 'text'],
	},
	browser_type: {
		type: 'object',
		properties: {
			selector: {type: 'string', description: 'CSS selector of input field'},
			text: {type: 'string', description: 'Text to type (appends)'},
		},
		required: ['selector', 'text'],
	},
	browser_press: {
		type: 'object',
		properties: {
			key: {
				type: 'string',
				description: 'Key to press (Enter, Tab, Control+a, etc.)',
			},
		},
		required: ['key'],
	},
	browser_hover: {
		type: 'object',
		properties: {
			selector: {type: 'string', description: 'CSS selector to hover'},
		},
		required: ['selector'],
	},
	browser_select: {
		type: 'object',
		properties: {
			selector: {type: 'string', description: 'CSS selector of select element'},
			value: {type: 'string', description: 'Option value or label to select'},
		},
		required: ['selector', 'value'],
	},
	browser_check: {
		type: 'object',
		properties: {
			selector: {type: 'string', description: 'CSS selector of checkbox'},
		},
		required: ['selector'],
	},
	browser_uncheck: {
		type: 'object',
		properties: {
			selector: {type: 'string', description: 'CSS selector of checkbox'},
		},
		required: ['selector'],
	},
	browser_scroll: {
		type: 'object',
		properties: {
			direction: {
				type: 'string',
				enum: ['up', 'down', 'left', 'right'],
				description: 'Scroll direction',
			},
			pixels: {type: 'number', description: 'Pixels to scroll (optional)'},
		},
		required: ['direction'],
	},
	browser_screenshot: {
		type: 'object',
		properties: {
			path: {type: 'string', description: 'File path to save screenshot'},
			full: {type: 'boolean', description: 'Capture full page'},
		},
		required: [],
	},
	browser_snapshot: {
		type: 'object',
		properties: {},
		required: [],
		description: 'Get accessibility tree with element refs',
	},
	browser_eval: {
		type: 'object',
		properties: {
			script: {type: 'string', description: 'JavaScript code to execute'},
		},
		required: ['script'],
	},
	browser_close: {
		type: 'object',
		properties: {},
		required: [],
	},
	// Category Tools
	browser_get: {
		type: 'object',
		properties: {
			subcommand: {
				type: 'string',
				enum: ['text', 'html', 'value', 'attr', 'title', 'url', 'count', 'box'],
				description:
					'What to get: text <sel>, html <sel>, value <sel>, attr <sel> <attr>, title, url, count <sel>, box <sel>',
			},
			args: {
				type: 'array',
				items: {type: 'string'},
				description: 'Arguments: [selector] or [selector, attribute]',
			},
		},
		required: ['subcommand'],
	},
	browser_is: {
		type: 'object',
		properties: {
			check: {
				type: 'string',
				enum: ['visible', 'enabled', 'checked'],
				description: 'State to check',
			},
			selector: {type: 'string', description: 'CSS selector to check'},
		},
		required: ['check', 'selector'],
	},
	browser_find: {
		type: 'object',
		properties: {
			args: {
				type: 'array',
				items: {type: 'string'},
				description:
					'Find args: [locator, value, action, actionValue?]. Locators: role, text, label, placeholder, testid, first, nth. Actions: click, fill, check, hover, text',
			},
		},
		required: ['args'],
	},
	browser_wait: {
		type: 'object',
		properties: {
			args: {
				type: 'array',
				items: {type: 'string'},
				description:
					'Wait args: [selector] or [ms] or [--text, value] or [--url, pattern] or [--load, state] or [--fn, condition]',
			},
		},
		required: ['args'],
	},
	browser_mouse: {
		type: 'object',
		properties: {
			subcommand: {
				type: 'string',
				enum: ['move', 'down', 'up', 'wheel'],
				description: 'Mouse action',
			},
			args: {
				type: 'array',
				items: {type: 'string'},
				description:
					'Args: move [x, y], down [button], up [button], wheel [dy, dx?]',
			},
		},
		required: ['subcommand'],
	},
	browser_set: {
		type: 'object',
		properties: {
			subcommand: {
				type: 'string',
				enum: [
					'viewport',
					'device',
					'geo',
					'offline',
					'headers',
					'credentials',
					'media',
				],
				description: 'Setting to change',
			},
			args: {
				type: 'array',
				items: {type: 'string'},
				description:
					'Args: viewport [w, h], device [name], geo [lat, lng], offline [on|off], headers [json], credentials [user, pass], media [dark|light]',
			},
		},
		required: ['subcommand'],
	},
	browser_tab: {
		type: 'object',
		properties: {
			args: {
				type: 'array',
				items: {type: 'string'},
				description:
					'Tab args: [] (list), [new, url?], [index] (switch), [close, index?]',
			},
		},
		required: [],
	},
	browser_frame: {
		type: 'object',
		properties: {
			target: {
				type: 'string',
				description: 'Frame selector or "main" to return to main frame',
			},
		},
		required: ['target'],
	},
	browser_nav: {
		type: 'object',
		properties: {
			action: {
				type: 'string',
				enum: ['back', 'forward', 'reload'],
				description: 'Navigation action',
			},
		},
		required: ['action'],
	},
};

// ============ Tool Definitions ============

export const browserTools: GatewayTool[] = [
	// Core Actions (14)
	{
		name: 'browser_open',
		description: 'Open URL in browser',
		inputSchema: jsonSchemas.browser_open!,
	},
	{
		name: 'browser_click',
		description: 'Click element',
		inputSchema: jsonSchemas.browser_click!,
	},
	{
		name: 'browser_dblclick',
		description: 'Double-click element',
		inputSchema: jsonSchemas.browser_dblclick!,
	},
	{
		name: 'browser_fill',
		description: 'Clear and fill input field',
		inputSchema: jsonSchemas.browser_fill!,
	},
	{
		name: 'browser_type',
		description: 'Type text into element',
		inputSchema: jsonSchemas.browser_type!,
	},
	{
		name: 'browser_press',
		description: 'Press keyboard key',
		inputSchema: jsonSchemas.browser_press!,
	},
	{
		name: 'browser_hover',
		description: 'Hover over element',
		inputSchema: jsonSchemas.browser_hover!,
	},
	{
		name: 'browser_select',
		description: 'Select dropdown option',
		inputSchema: jsonSchemas.browser_select!,
	},
	{
		name: 'browser_check',
		description: 'Check checkbox',
		inputSchema: jsonSchemas.browser_check!,
	},
	{
		name: 'browser_uncheck',
		description: 'Uncheck checkbox',
		inputSchema: jsonSchemas.browser_uncheck!,
	},
	{
		name: 'browser_scroll',
		description: 'Scroll page',
		inputSchema: jsonSchemas.browser_scroll!,
	},
	{
		name: 'browser_screenshot',
		description: 'Take screenshot',
		inputSchema: jsonSchemas.browser_screenshot!,
	},
	{
		name: 'browser_snapshot',
		description: 'Get accessibility tree with refs',
		inputSchema: jsonSchemas.browser_snapshot!,
	},
	{
		name: 'browser_eval',
		description: 'Execute JavaScript',
		inputSchema: jsonSchemas.browser_eval!,
	},
	{
		name: 'browser_close',
		description: 'Close browser session',
		inputSchema: jsonSchemas.browser_close!,
	},
	// Category Tools (9)
	{
		name: 'browser_get',
		description: 'Get info: text, html, value, attr, title, url, count, box',
		inputSchema: jsonSchemas.browser_get!,
	},
	{
		name: 'browser_is',
		description: 'Check state: visible, enabled, checked',
		inputSchema: jsonSchemas.browser_is!,
	},
	{
		name: 'browser_find',
		description:
			'Find elements by role/text/label/placeholder/testid and perform action',
		inputSchema: jsonSchemas.browser_find!,
	},
	{
		name: 'browser_wait',
		description: 'Wait for selector, time, text, url, load state, or condition',
		inputSchema: jsonSchemas.browser_wait!,
	},
	{
		name: 'browser_mouse',
		description: 'Mouse actions: move, down, up, wheel',
		inputSchema: jsonSchemas.browser_mouse!,
	},
	{
		name: 'browser_set',
		description:
			'Settings: viewport, device, geo, offline, headers, credentials, media',
		inputSchema: jsonSchemas.browser_set!,
	},
	{
		name: 'browser_tab',
		description: 'Tab management: list, new, switch, close',
		inputSchema: jsonSchemas.browser_tab!,
	},
	{
		name: 'browser_frame',
		description: 'Switch to iframe or main frame',
		inputSchema: jsonSchemas.browser_frame!,
	},
	{
		name: 'browser_nav',
		description: 'Navigate: back, forward, reload',
		inputSchema: jsonSchemas.browser_nav!,
	},
];

// ============ Tool Execution ============

export async function executeBrowserTool(
	toolName: string,
	params: Record<string, unknown>,
): Promise<{success: boolean; result?: unknown; error?: string}> {
	try {
		switch (toolName) {
			// Core Actions
			case 'browser_open': {
				const p = BrowserOpenSchema.parse(params);
				const r = await browserOpen(p.url);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to open'};
				return {success: true, result: {message: `Opened ${p.url}`}};
			}
			case 'browser_click': {
				const p = BrowserClickSchema.parse(params);
				const r = await browserClick(p.selector);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to click'};
				return {success: true, result: {message: `Clicked ${p.selector}`}};
			}
			case 'browser_dblclick': {
				const p = BrowserDblclickSchema.parse(params);
				const r = await browserDblclick(p.selector);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to double-click'};
				return {
					success: true,
					result: {message: `Double-clicked ${p.selector}`},
				};
			}
			case 'browser_fill': {
				const p = BrowserFillSchema.parse(params);
				const r = await browserFill(p.selector, p.text);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to fill'};
				return {success: true, result: {message: `Filled ${p.selector}`}};
			}
			case 'browser_type': {
				const p = BrowserTypeSchema.parse(params);
				const r = await browserType(p.selector, p.text);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to type'};
				return {success: true, result: {message: `Typed into ${p.selector}`}};
			}
			case 'browser_press': {
				const p = BrowserPressSchema.parse(params);
				const r = await browserPress(p.key);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to press key'};
				return {success: true, result: {message: `Pressed ${p.key}`}};
			}
			case 'browser_hover': {
				const p = BrowserHoverSchema.parse(params);
				const r = await browserHover(p.selector);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to hover'};
				return {success: true, result: {message: `Hovered ${p.selector}`}};
			}
			case 'browser_select': {
				const p = BrowserSelectSchema.parse(params);
				const r = await browserSelect(p.selector, p.value);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to select'};
				return {success: true, result: {message: `Selected ${p.value}`}};
			}
			case 'browser_check': {
				const p = BrowserCheckSchema.parse(params);
				const r = await browserCheck(p.selector);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to check'};
				return {success: true, result: {message: `Checked ${p.selector}`}};
			}
			case 'browser_uncheck': {
				const p = BrowserUncheckSchema.parse(params);
				const r = await browserUncheck(p.selector);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to uncheck'};
				return {success: true, result: {message: `Unchecked ${p.selector}`}};
			}
			case 'browser_scroll': {
				const p = BrowserScrollSchema.parse(params);
				const r = await browserScroll(p.direction, p.pixels);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to scroll'};
				return {success: true, result: {message: `Scrolled ${p.direction}`}};
			}
			case 'browser_screenshot': {
				const p = BrowserScreenshotSchema.parse(params);
				const r = await browserScreenshot(p.path, p.full);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to screenshot'};
				return {
					success: true,
					result: {message: 'Screenshot taken', output: r.stdout},
				};
			}
			case 'browser_snapshot': {
				BrowserSnapshotSchema.parse(params);
				const r = await browserSnapshot();
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to get snapshot'};
				return {success: true, result: {snapshot: r.stdout}};
			}
			case 'browser_eval': {
				const p = BrowserEvalSchema.parse(params);
				const r = await browserEval(p.script);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to eval'};
				return {success: true, result: {output: r.stdout}};
			}
			case 'browser_close': {
				BrowserCloseSchema.parse(params);
				const r = await browserClose();
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to close'};
				return {success: true, result: {message: 'Browser closed'}};
			}

			// Category Tools
			case 'browser_get': {
				const p = BrowserGetSchema.parse(params);
				const r = await browserGet(p.subcommand, p.args || []);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to get'};
				return {success: true, result: {value: r.stdout.trim()}};
			}
			case 'browser_is': {
				const p = BrowserIsSchema.parse(params);
				const r = await browserIs(p.check, p.selector);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to check state'};
				return {
					success: true,
					result: {[p.check]: r.stdout.trim().toLowerCase() === 'true'},
				};
			}
			case 'browser_find': {
				const p = BrowserFindSchema.parse(params);
				const r = await browserFind(p.args);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to find'};
				return {success: true, result: {output: r.stdout}};
			}
			case 'browser_wait': {
				const p = BrowserWaitSchema.parse(params);
				const r = await browserWait(p.args);
				if (r.code !== 0)
					return {
						success: false,
						error: r.stderr || 'Wait failed or timed out',
					};
				return {
					success: true,
					result: {message: 'Wait completed', output: r.stdout},
				};
			}
			case 'browser_mouse': {
				const p = BrowserMouseSchema.parse(params);
				const r = await browserMouse(p.subcommand, p.args || []);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Mouse action failed'};
				return {success: true, result: {message: `Mouse ${p.subcommand}`}};
			}
			case 'browser_set': {
				const p = BrowserSetSchema.parse(params);
				const r = await browserSet(p.subcommand, p.args || []);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to set'};
				return {success: true, result: {message: `Set ${p.subcommand}`}};
			}
			case 'browser_tab': {
				const p = BrowserTabSchema.parse(params);
				const r = await browserTab(p.args || []);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Tab operation failed'};
				return {success: true, result: {output: r.stdout}};
			}
			case 'browser_frame': {
				const p = BrowserFrameSchema.parse(params);
				const r = await browserFrame(p.target);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Failed to switch frame'};
				return {
					success: true,
					result: {message: `Switched to frame: ${p.target}`},
				};
			}
			case 'browser_nav': {
				const p = BrowserNavSchema.parse(params);
				const r = await browserNav(p.action);
				if (r.code !== 0)
					return {success: false, error: r.stderr || 'Navigation failed'};
				return {success: true, result: {message: `Navigated: ${p.action}`}};
			}

			default:
				return {success: false, error: `Unknown tool: ${toolName}`};
		}
	} catch (err) {
		if (err instanceof zod.ZodError) {
			return {success: false, error: `Invalid parameters: ${err.message}`};
		}
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Unknown error',
		};
	}
}

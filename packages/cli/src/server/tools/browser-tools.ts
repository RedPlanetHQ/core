import zod from 'zod';
import {
	getOrLaunchSession,
	closeSession,
	closeAllSessions,
	getLiveSessions,
} from '@/utils/browser-manager';
import {
	getConfiguredProfiles,
	getConfiguredSessions,
	getMaxProfiles,
	getMaxSessions,
	createSession,
	deleteSession,
} from '@/utils/browser-config';

// ============ Tool Interface ============

export interface GatewayTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

// ============ Helpers ============

function resolveLocator(
	page: import('playwright').Page,
	element: string,
	ref?: string,
): import('playwright').Locator {
	if (ref) return page.locator(ref);
	return page.getByText(element, {exact: false});
}

// ============ Zod Schemas ============

const SessionParam = zod
	.string()
	.describe('Session name (e.g. create_swiggy_order). Use browser_list_sessions to see available sessions.');

const NavigateSchema = zod.object({
	url: zod.string().describe('URL to navigate to'),
	session: SessionParam,
	headed: zod.boolean().optional().default(false).describe('Launch in headed (visible) mode. Required for sites that block headless browsers (e.g. Swiggy, Amazon).'),
});

const SnapshotSchema = zod.object({session: SessionParam});

const ClickSchema = zod.object({
	element: zod.string().describe('Element description for text lookup'),
	ref: zod.string().optional().describe('CSS/ARIA ref selector (takes priority over element)'),
	session: SessionParam,
});

const FillSchema = zod.object({
	element: zod.string().describe('Input element description'),
	value: zod.string().describe('Value to fill'),
	ref: zod.string().optional().describe('CSS/ARIA ref selector'),
	session: SessionParam,
});

const TypeSchema = zod.object({
	element: zod.string().describe('Element description'),
	text: zod.string().describe('Text to type character by character'),
	ref: zod.string().optional().describe('CSS/ARIA ref selector'),
	session: SessionParam,
});

const PressKeySchema = zod.object({
	key: zod.string().describe('Key to press (e.g. Enter, Tab, ArrowDown)'),
	session: SessionParam,
});

const SelectOptionSchema = zod.object({
	element: zod.string().describe('Select element description'),
	value: zod.string().describe('Option value to select'),
	ref: zod.string().optional().describe('CSS/ARIA ref selector'),
	session: SessionParam,
});

const ScreenshotSchema = zod.object({session: SessionParam});

const WaitForSchema = zod.object({
	state: zod
		.enum(['load', 'domcontentloaded', 'networkidle'])
		.optional()
		.default('load')
		.describe('Load state to wait for'),
	session: SessionParam,
});

const EvaluateSchema = zod.object({
	script: zod.string().describe('JavaScript expression to evaluate in the page context'),
	session: SessionParam,
});

const GoBackSchema = zod.object({session: SessionParam});
const GoForwardSchema = zod.object({session: SessionParam});

const ScrollSchema = zod.object({
	deltaX: zod.number().optional().default(0).describe('Horizontal scroll amount in pixels'),
	deltaY: zod.number().optional().default(300).describe('Vertical scroll amount in pixels'),
	session: SessionParam,
});

const CloseSessionSchema = zod.object({session: SessionParam});
const CloseAllSchema = zod.object({});
const ListSessionsSchema = zod.object({});

const CreateSessionSchema = zod.object({
	session: zod.string().describe('Session name to create (e.g. swiggy_order)'),
	profile: zod.string().describe('Profile to bind this session to (e.g. personal, work)'),
});

const DeleteSessionSchema = zod.object({
	session: zod.string().describe('Session name to delete'),
});

// ============ JSON Schemas ============

const sessionProp = {
	type: 'string',
	description: 'Session name (e.g. create_swiggy_order). Use browser_list_sessions to see configured sessions.',
};

const jsonSchemas: Record<string, Record<string, unknown>> = {
	browser_navigate: {
		type: 'object',
		properties: {
			url: {type: 'string', description: 'URL to navigate to'},
			session: sessionProp,
			headed: {type: 'boolean', description: 'Launch in headed (visible) mode. Required for sites that block headless browsers (e.g. Swiggy, Amazon). Default: false'},
		},
		required: ['url', 'session'],
	},
	browser_snapshot: {
		type: 'object',
		properties: {session: sessionProp},
		required: ['session'],
	},
	browser_click: {
		type: 'object',
		properties: {
			element: {type: 'string', description: 'Element text/description for lookup'},
			ref: {type: 'string', description: 'CSS/ARIA selector (takes priority)'},
			session: sessionProp,
		},
		required: ['element', 'session'],
	},
	browser_fill: {
		type: 'object',
		properties: {
			element: {type: 'string', description: 'Input element text/description'},
			value: {type: 'string', description: 'Value to fill'},
			ref: {type: 'string', description: 'CSS/ARIA selector (takes priority)'},
			session: sessionProp,
		},
		required: ['element', 'value', 'session'],
	},
	browser_type: {
		type: 'object',
		properties: {
			element: {type: 'string', description: 'Element text/description'},
			text: {type: 'string', description: 'Text to type character by character'},
			ref: {type: 'string', description: 'CSS/ARIA selector (takes priority)'},
			session: sessionProp,
		},
		required: ['element', 'text', 'session'],
	},
	browser_press_key: {
		type: 'object',
		properties: {
			key: {type: 'string', description: 'Key to press (e.g. Enter, Tab, ArrowDown)'},
			session: sessionProp,
		},
		required: ['key', 'session'],
	},
	browser_select_option: {
		type: 'object',
		properties: {
			element: {type: 'string', description: 'Select element text/description'},
			value: {type: 'string', description: 'Option value to select'},
			ref: {type: 'string', description: 'CSS/ARIA selector (takes priority)'},
			session: sessionProp,
		},
		required: ['element', 'value', 'session'],
	},
	browser_screenshot: {
		type: 'object',
		properties: {session: sessionProp},
		required: ['session'],
	},
	browser_wait_for: {
		type: 'object',
		properties: {
			state: {
				type: 'string',
				enum: ['load', 'domcontentloaded', 'networkidle'],
				description: 'Load state to wait for (default: load)',
			},
			session: sessionProp,
		},
		required: ['session'],
	},
	browser_evaluate: {
		type: 'object',
		properties: {
			script: {type: 'string', description: 'JavaScript expression to evaluate in page context'},
			session: sessionProp,
		},
		required: ['script', 'session'],
	},
	browser_go_back: {
		type: 'object',
		properties: {session: sessionProp},
		required: ['session'],
	},
	browser_go_forward: {
		type: 'object',
		properties: {session: sessionProp},
		required: ['session'],
	},
	browser_scroll: {
		type: 'object',
		properties: {
			deltaX: {type: 'number', description: 'Horizontal scroll pixels (default: 0)'},
			deltaY: {type: 'number', description: 'Vertical scroll pixels (default: 300)'},
			session: sessionProp,
		},
		required: ['session'],
	},
	browser_close_session: {
		type: 'object',
		properties: {session: sessionProp},
		required: ['session'],
	},
	browser_close_all: {
		type: 'object',
		properties: {},
		required: [],
	},
	browser_list_sessions: {
		type: 'object',
		properties: {},
		required: [],
	},
	browser_create_session: {
		type: 'object',
		properties: {
			session: {type: 'string', description: 'Session name to create (e.g. swiggy_order)'},
			profile: {type: 'string', description: 'Profile to bind this session to (e.g. personal, work)'},
		},
		required: ['session', 'profile'],
	},
	browser_delete_session: {
		type: 'object',
		properties: {
			session: {type: 'string', description: 'Session name to delete'},
		},
		required: ['session'],
	},
};

// ============ Tool Definitions ============

export const browserTools: GatewayTool[] = [
	{
		name: 'browser_navigate',
		description: 'Navigate to a URL in a named browser session.',
		inputSchema: jsonSchemas.browser_navigate!,
	},
	{
		name: 'browser_snapshot',
		description:
			'Get an ARIA accessibility snapshot of the current page. Use this before interacting with elements to discover refs.',
		inputSchema: jsonSchemas.browser_snapshot!,
	},
	{
		name: 'browser_click',
		description: 'Click an element on the page by text description or ref selector.',
		inputSchema: jsonSchemas.browser_click!,
	},
	{
		name: 'browser_fill',
		description: 'Fill an input field with a value (clears existing content first).',
		inputSchema: jsonSchemas.browser_fill!,
	},
	{
		name: 'browser_type',
		description: 'Type text into an element character by character (simulates real typing).',
		inputSchema: jsonSchemas.browser_type!,
	},
	{
		name: 'browser_press_key',
		description: 'Press a keyboard key (e.g. Enter, Tab, ArrowDown, Escape).',
		inputSchema: jsonSchemas.browser_press_key!,
	},
	{
		name: 'browser_select_option',
		description: 'Select an option from a <select> dropdown element.',
		inputSchema: jsonSchemas.browser_select_option!,
	},
	{
		name: 'browser_screenshot',
		description: 'Take a screenshot of the current page and return it as base64.',
		inputSchema: jsonSchemas.browser_screenshot!,
	},
	{
		name: 'browser_wait_for',
		description: 'Wait for a page load state (load, domcontentloaded, networkidle).',
		inputSchema: jsonSchemas.browser_wait_for!,
	},
	{
		name: 'browser_evaluate',
		description: 'Evaluate a JavaScript expression in the page context and return the result.',
		inputSchema: jsonSchemas.browser_evaluate!,
	},
	{
		name: 'browser_go_back',
		description: 'Navigate to the previous page in history.',
		inputSchema: jsonSchemas.browser_go_back!,
	},
	{
		name: 'browser_go_forward',
		description: 'Navigate to the next page in history.',
		inputSchema: jsonSchemas.browser_go_forward!,
	},
	{
		name: 'browser_scroll',
		description: 'Scroll the page by the specified pixel amounts.',
		inputSchema: jsonSchemas.browser_scroll!,
	},
	{
		name: 'browser_close_session',
		description: 'Close a running browser session (profile data is preserved on disk).',
		inputSchema: jsonSchemas.browser_close_session!,
	},
	{
		name: 'browser_close_all',
		description: 'Close all running browser sessions.',
		inputSchema: jsonSchemas.browser_close_all!,
	},
	{
		name: 'browser_list_sessions',
		description: `List all configured sessions with their profiles and live status. Max ${getMaxSessions()} sessions, ${getMaxProfiles()} profiles.`,
		inputSchema: jsonSchemas.browser_list_sessions!,
	},
	{
		name: 'browser_create_session',
		description: 'Create a new browser session bound to a profile. Use browser_list_sessions to see available profiles first.',
		inputSchema: jsonSchemas.browser_create_session!,
	},
	{
		name: 'browser_delete_session',
		description: 'Delete a browser session from config (closes it if running, profile data preserved).',
		inputSchema: jsonSchemas.browser_delete_session!,
	},
];

// ============ Tool Execution ============

export async function executeBrowserTool(
	toolName: string,
	params: Record<string, unknown>,
): Promise<{success: boolean; result?: unknown; error?: string}> {
	try {
		switch (toolName) {
			case 'browser_navigate': {
				const p = NavigateSchema.parse(params);
				const {session, error} = await getOrLaunchSession(p.session, p.headed);
				if (error) return {success: false, error};
				const response = await session.page.goto(p.url);
				return {
					success: true,
					result: {
						url: p.url,
						session: p.session,
						status: response?.status(),
						title: await session.page.title(),
					},
				};
			}

			case 'browser_snapshot': {
				const p = SnapshotSchema.parse(params);
				const {session, error} = await getOrLaunchSession(p.session);
				if (error) return {success: false, error};
				const snapshot = await session.page.locator('body').ariaSnapshot();
				return {success: true, result: {snapshot}};
			}

			case 'browser_click': {
				const p = ClickSchema.parse(params);
				const {session, error} = await getOrLaunchSession(p.session);
				if (error) return {success: false, error};
				const locator = resolveLocator(session.page, p.element, p.ref);
				await locator.click();
				return {success: true, result: {message: `Clicked "${p.ref ?? p.element}"`}};
			}

			case 'browser_fill': {
				const p = FillSchema.parse(params);
				const {session, error} = await getOrLaunchSession(p.session);
				if (error) return {success: false, error};
				const locator = resolveLocator(session.page, p.element, p.ref);
				await locator.fill(p.value);
				return {success: true, result: {message: `Filled "${p.ref ?? p.element}"`}};
			}

			case 'browser_type': {
				const p = TypeSchema.parse(params);
				const {session, error} = await getOrLaunchSession(p.session);
				if (error) return {success: false, error};
				const locator = resolveLocator(session.page, p.element, p.ref);
				await locator.pressSequentially(p.text);
				return {success: true, result: {message: `Typed into "${p.ref ?? p.element}"`}};
			}

			case 'browser_press_key': {
				const p = PressKeySchema.parse(params);
				const {session, error} = await getOrLaunchSession(p.session);
				if (error) return {success: false, error};
				await session.page.keyboard.press(p.key);
				return {success: true, result: {message: `Pressed key "${p.key}"`}};
			}

			case 'browser_select_option': {
				const p = SelectOptionSchema.parse(params);
				const {session, error} = await getOrLaunchSession(p.session);
				if (error) return {success: false, error};
				const locator = resolveLocator(session.page, p.element, p.ref);
				await locator.selectOption(p.value);
				return {success: true, result: {message: `Selected "${p.value}" in "${p.ref ?? p.element}"`}};
			}

			case 'browser_screenshot': {
				const p = ScreenshotSchema.parse(params);
				const {session, error} = await getOrLaunchSession(p.session);
				if (error) return {success: false, error};
				const buffer = await session.page.screenshot();
				return {success: true, result: {screenshot: buffer.toString('base64'), mimeType: 'image/png'}};
			}

			case 'browser_wait_for': {
				const p = WaitForSchema.parse(params);
				const {session, error} = await getOrLaunchSession(p.session);
				if (error) return {success: false, error};
				await session.page.waitForLoadState(p.state);
				return {success: true, result: {message: `Waited for "${p.state}"`}};
			}

			case 'browser_evaluate': {
				const p = EvaluateSchema.parse(params);
				const {session, error} = await getOrLaunchSession(p.session);
				if (error) return {success: false, error};
				// eslint-disable-next-line no-new-func
				const result = await session.page.evaluate(new Function(`return (${p.script})`) as () => unknown);
				return {success: true, result: {value: result}};
			}

			case 'browser_go_back': {
				const p = GoBackSchema.parse(params);
				const {session, error} = await getOrLaunchSession(p.session);
				if (error) return {success: false, error};
				await session.page.goBack();
				return {success: true, result: {url: session.page.url()}};
			}

			case 'browser_go_forward': {
				const p = GoForwardSchema.parse(params);
				const {session, error} = await getOrLaunchSession(p.session);
				if (error) return {success: false, error};
				await session.page.goForward();
				return {success: true, result: {url: session.page.url()}};
			}

			case 'browser_scroll': {
				const p = ScrollSchema.parse(params);
				const {session, error} = await getOrLaunchSession(p.session);
				if (error) return {success: false, error};
				await session.page.mouse.wheel(p.deltaX, p.deltaY);
				return {success: true, result: {message: `Scrolled (${p.deltaX}, ${p.deltaY})`}};
			}

			case 'browser_close_session': {
				const p = CloseSessionSchema.parse(params);
				const r = await closeSession(p.session);
				if (!r.success) return {success: false, error: r.error};
				return {success: true, result: {message: `Closed session "${p.session}"`}};
			}

			case 'browser_close_all': {
				CloseAllSchema.parse(params);
				await closeAllSessions();
				return {success: true, result: {message: 'Closed all browser sessions'}};
			}

			case 'browser_list_sessions': {
				ListSessionsSchema.parse(params);
				const configured = getConfiguredSessions();
				const live = getLiveSessions();
				const profiles = getConfiguredProfiles();
				return {
					success: true,
					result: {
						profiles,
						sessions: configured.map(s => ({
							...s,
							live: live.includes(s.name),
						})),
						maxProfiles: getMaxProfiles(),
						maxSessions: getMaxSessions(),
					},
				};
			}

			case 'browser_create_session': {
			const p = CreateSessionSchema.parse(params);
			const r = createSession(p.session, p.profile);
			if (!r.success) return {success: false, error: r.error};
			return {
				success: true,
				result: {message: `Session "${p.session}" created (profile: ${p.profile})`},
			};
		}

		case 'browser_delete_session': {
			const p = DeleteSessionSchema.parse(params);
			await closeSession(p.session);
			const r = deleteSession(p.session);
			if (!r.success) return {success: false, error: r.error};
			return {
				success: true,
				result: {message: `Session "${p.session}" deleted`},
			};
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

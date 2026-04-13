import { APIKeyParams, AuthType, McpAuthParams, OAuth2Params } from "./oauth";

/** A single config field declared by a widget */
export interface WidgetConfigField {
  key: string;
  label: string;
  type: 'input' | 'select';
  placeholder?: string;
  required?: boolean;
  /** Options for select fields only */
  options?: Array<{ label: string; value: string }>;
  default?: string;
}

export interface WidgetRenderContext {
  placement: 'tui' | 'webapp';
  pat: string;
  accounts: Array<{ id: string; slug: string; name?: string }>;
  baseUrl: string;
  /** Config values supplied by the agent or by the user via the config form */
  config?: Record<string, string>;
  /** Call to trigger a TUI re-render after updating internal state (TUI only) */
  requestRender?: () => void;
}

/** Metadata only — used in integration Spec (no render function) */
export interface WidgetMeta {
  name: string;
  slug: string;
  description: string;
  support: Array<'tui' | 'webapp'>;
  tuiPlacement?: 'overview' | 'below-input';
  /** Declares config fields the widget accepts; drives the config form when agent omits them */
  configSchema?: WidgetConfigField[];
}

/**
 * A zero-argument React function component (webapp placement).
 * Context (pat, accountId, baseUrl) is baked in via closure.
 */
export type WebWidgetComponent = () => unknown;

/**
 * A pi-tui Component instance (tui placement).
 * Returned by createPlayer / createList / etc. from @redplanethq/ui/tui.
 */
export type TuiWidgetComponent = object;

/** Union of the two surface-specific component types */
export type WidgetComponent = WebWidgetComponent | TuiWidgetComponent;

/** Full widget — used in widgets/index.ts (includes render) */
export interface WidgetSpec extends WidgetMeta {
  render(context: WidgetRenderContext): Promise<WidgetComponent>;
}

// ─── Tool UI ──────────────────────────────────────────────────────────────────

/** Recursive JSON value type — covers all valid tool input shapes */
export type ToolInputPrimitive = string | number | boolean | null;
export type ToolInputValue =
  | ToolInputPrimitive
  | ToolInputValue[]
  | { [key: string]: ToolInputValue };
export type ToolInput = Record<string, ToolInputValue>;

/** A single content block in a tool result */
export interface ToolContent {
  type: string;
  text: string;
}

/** The result returned by a tool call */
export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

/** A pi-tui component rendering a tool result (tui placement) */
export interface TuiToolUIComponent {
  render: (width: number) => string[];
}

/** A React component rendering a tool result (webapp placement) */
export type WebToolUIComponent = () => object;

export type ToolUIComponent = WebToolUIComponent | TuiToolUIComponent;

/** Context passed to a ToolUI renderer */
export interface ToolUIRenderContext {
  placement: 'tui' | 'webapp';
  pat: string;
  accounts: Array<{ id: string; slug: string; name?: string }>;
  baseUrl: string;
}

/**
 * Integration-defined UI for tool calls.
 * render() is called in two phases:
 *   Phase 1 — result is null: tool input is known, user can modify and call submitInput()
 *   Phase 2 — result is present: tool has run, show rich result UI
 */
export interface ToolUI {
  supported_tools: string[];
  render(
    toolName: string,
    input: ToolInput,
    result: ToolResult | null,
    context: ToolUIRenderContext,
    submitInput: (input: ToolInput) => void,
    onDecline: () => void,
  ): Promise<ToolUIComponent>;
}

/**
 * Shape exported by an integration's frontend.js bundle.
 * Combines widgets (standalone) and toolUI (per-tool result renderer).
 */
export interface FrontendExport {
  widgets?: WidgetSpec[];
  toolUI?: ToolUI;
}

export enum IntegrationEventType {
  /**
   * Processes authentication data and returns tokens/credentials to be saved
   */
  SETUP = "setup",

  /**
   * Processing incoming data from the integration
   */
  PROCESS = "process",

  /**
   * Identifying which account a webhook belongs to
   */
  IDENTIFY = "identify",

  /**
   * Scheduled synchronization of data
   */
  SYNC = "sync",

  /**
   * For returning integration metadata/config
   */
  SPEC = "spec",

  /**
   * Get available MCP tools for this integration
   */
  GET_TOOLS = "get-tools",

  /**
   * Call a specific MCP tool
   */
  CALL_TOOL = "call-tool",
}

interface IntegrationDefinition {
  name: string;
  version: string;
  description: string;
  config: Record<string, string>;
  spec: any;
}

export interface IntegrationEventPayload {
  event: IntegrationEventType;

  // For setup command
  integrationDefinition?: IntegrationDefinition;
  // Has event body based on the event
  eventBody: any;

  // For everything other than setup
  config?: Config;

  // For sync command
  state?: Record<string, string>;
  [x: string]: any;
}

export class Spec {
  name: string;
  key: string;
  description: string;
  icon: string;
  category?: string;
  schedule?: {
    frequency?: string;
  };
  auth?: {
    OAuth2?: OAuth2Params;
    api_key?: APIKeyParams;
    mcp?: McpAuthParams;
  };
  widgets?: WidgetMeta[];
  /** Set to true when the integration's frontend bundle exports a ToolUI */
  toolUISupported?: boolean;
}

export interface Config {
  access_token: string;
  [key: string]: string;
}

export interface Identifier {
  id: string;
  type?: string;
}

export type MessageType =
  | "spec"
  | "activity"
  | "state"
  | "identifier"
  | "account"
  | "tools"
  | "tool_result"
  | "error";

export interface Message {
  type: MessageType;
  data: any;
}

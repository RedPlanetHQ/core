import type {ThemePreset} from '@/types/ui';

// AI provider configurations (OpenAI-compatible)
export interface AIProviderConfig {
	name: string;
	type: string;
	models: string[];
	requestTimeout?: number;
	socketTimeout?: number;
	maxRetries?: number; // Maximum number of retries for failed requests (default: 2)
	connectionPool?: {
		idleTimeout?: number;
		cumulativeMaxIdleTimeout?: number;
	};
	config: {
		baseURL?: string;
		apiKey?: string;
		[key: string]: unknown;
	};
}

// Provider configuration type for wizard and config building
export interface ProviderConfig {
	name: string;
	baseUrl?: string;
	apiKey?: string;
	models: string[];
	requestTimeout?: number;
	socketTimeout?: number;
	maxRetries?: number; // Maximum number of retries for failed requests (default: 2)
	organizationId?: string;
	timeout?: number;
	connectionPool?: {
		idleTimeout?: number;
		cumulativeMaxIdleTimeout?: number;
	};
	[key: string]: unknown; // Allow additional provider-specific config
}

export interface AppConfig {
	// Core authentication
	auth?: {
		url: string;
		apiKey: string;
	};

	// Assistant name
	assistantName?: string;

	// Providers array structure - all OpenAI compatible
	providers?: {
		name: string;
		baseUrl?: string;
		apiKey?: string;
		models: string[];
		requestTimeout?: number;
		socketTimeout?: number;
		connectionPool?: {
			idleTimeout?: number;
			cumulativeMaxIdleTimeout?: number;
		};
		[key: string]: unknown; // Allow additional provider-specific config
	}[];
}

export type ServiceType = 'launchd' | 'systemd' | 'manual';

// Browser executable configuration
export type BrowserType = 'default' | 'brave' | 'chrome' | 'custom';

export interface BrowserSessionConfig {
	name: string;    // session name, e.g. "create_swiggy_order"
	profile: string; // profile name, e.g. "personal"
}

export interface BrowserConfig {
	browserType?: BrowserType;
	browserExecutable?: string;
	profiles?: string[];              // profile names: ["personal", "work"]
	sessions?: BrowserSessionConfig[]; // sessions: [{ name, profile }]
}

// Gateway slot configuration
export interface GatewaySlots {
	browser?: {
		enabled: boolean;
	};
	coding?: {
		enabled: boolean;
	};
	exec?: {
		enabled: boolean;
		allow?: string[]; // Glob-like patterns: "Bash(npm run *)", "Bash(git commit *)"
		deny?: string[]; // Glob-like patterns: "Bash(git push *)"
		allowUnsafe?: boolean; // Disable default blocked patterns
	};
	files?: {
		enabled: boolean;
	};
}

export interface StoredFolder {
	id: string; // fld_<uuid>
	name: string;
	path: string;
	scopes: ('files' | 'coding' | 'exec')[];
	gitRepo?: boolean;
}

export type TunnelKind = 'tailscale' | 'ngrok' | 'none';

export interface GatewayConfig {
	id?: string; // Generated gateway ID
	name?: string; // Gateway name
	description?: string; // Gateway description/role for meta-agent selection
	pid: number;
	startedAt: number;
	serviceInstalled?: boolean;
	serviceType?: ServiceType;
	serviceName?: string;
	slots?: GatewaySlots; // Which tool slots are enabled
	alwaysOn?: boolean; // Prevent mac sleep while gateway is running (macOS only)

	// Registered folders with scopes (files/coding/exec)
	folders?: StoredFolder[];

	// HTTP daemon
	httpPort?: number;
	httpBaseUrl?: string; // Public URL (set by register; from tunnel or user-supplied)
	securityKeyHash?: string; // sha256(securityKey) hex. Raw key never stored.

	// Tunnel state (managed by register / start)
	tunnelKind?: TunnelKind;
	tunnelPid?: number;
}

// CLI Backend configuration for coding agents. Args spawn the agent's
// interactive TUI — both `coding_ask` and the xterm-spawn path share them.
export interface CliBackendConfig {
	command: string;
	args?: string[]; // Interactive TUI args for a fresh session
	resumeArgs?: string[]; // Args for resuming a session (use `{sessionId}` placeholder)
	sessionArg?: string; // e.g., "--session"
	sessionMode?: 'new' | 'existing' | 'always';
	sessionIdFields?: string[]; // Fields in output containing session ID
	allowedTools?: string[];
	disallowedTools?: string[];
	modelArg?: string;
	imageArg?: string;
	systemPromptArg?: string;
	workingDirArg?: string;
}

export interface CodingConfig {
	// Configured CLI backends keyed by name
	[agentName: string]: CliBackendConfig;
}

export interface ExecConfig {
	allow?: string[]; // Glob-like patterns: "Bash(npm run *)", "Bash(git commit *)"
	deny?: string[]; // Glob-like patterns: "Bash(git push *)"
	defaultDir?: string; // Default working directory
	allowUnsafe?: boolean; // Disable default blocked patterns (rm, chmod, network cmds, etc.)
	maxStdoutBytes?: number; // Cap captured stdout per command (default 128 KB)
	maxStderrBytes?: number; // Cap captured stderr per command (default 16 KB)
}

export interface WidgetConfig {
	widgetSlug: string;
	widgetName: string;
	frontendUrl: string;
	accountId: string;
	accountSlug: string;
	accountName: string;
}

export interface UserPreferences {
	lastProvider?: string;
	lastModel?: string;
	providerModels?: {
		[key in string]?: string;
	};
	lastUpdateCheck?: number;
	selectedTheme?: ThemePreset;
	gateway?: GatewayConfig;
	coding?: CodingConfig;
	defaultCodingAgent?: string;
	browser?: BrowserConfig;
	exec?: ExecConfig;
	widgets?: {
		belowInput?: WidgetConfig | null;
		overview?: WidgetConfig[];
	};
}

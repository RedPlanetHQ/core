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
	};
}

export interface GatewayConfig {
	id?: string; // Generated gateway ID
	name?: string; // Gateway name
	description?: string; // Gateway description/role for meta-agent selection
	port?: number;
	pid: number;
	startedAt: number;
	serviceInstalled?: boolean;
	serviceType?: ServiceType;
	serviceName?: string;
	slots?: GatewaySlots; // Which tool slots are enabled
}

// CLI Backend configuration for coding agents
export interface CliBackendConfig {
	command: string;
	args?: string[]; // Default args for new sessions
	resumeArgs?: string[]; // Args for resuming sessions (use {sessionId} placeholder)
	sessionArg?: string; // e.g., "--session"
	sessionMode?: 'new' | 'existing' | 'always';
	sessionIdFields?: string[]; // Fields in output containing session ID
	allowedTools?: string[];
	disallowedTools?: string[];
	modelArg?: string;
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
	exec?: ExecConfig;
}

import WebSocket, {type RawData} from 'ws';
import {hostname} from 'node:os';
import {browserTools, executeBrowserTool} from '@/server/tools/browser-tools';
import {codingTools, executeCodingTool} from '@/server/tools/coding-tools';
import {browserCloseAll} from '@/utils/agent-browser';
import type {GatewayTool} from '@/server/tools/browser-tools';

// Slot-based tool organization
interface ToolSlots {
	browser: GatewayTool[];
	coding: GatewayTool[];
}

// Gateway client configuration
interface GatewayClientConfig {
	url: string;
	apiKey: string;
	name: string;
	description?: string;
	onConnect?: () => void;
	onDisconnect?: () => void;
	onReady?: (gatewayId: string) => void;
	onError?: (error: Error) => void;
}

// Message types from server
interface ServerMessage {
	type: string;
	[key: string]: unknown;
}

interface GetSupportedToolsMessage {
	type: 'get_supported_tools';
}

interface ToolCallMessage {
	type: 'tool_call';
	id: string;
	tool: string;
	params: Record<string, unknown>;
}

interface ReadyMessage {
	type: 'ready';
	gatewayId: string;
}

interface ErrorMessage {
	type: 'error';
	message: string;
	code: string;
}

// Gateway client state
export type GatewayClientState =
	| 'disconnected'
	| 'connecting'
	| 'connected'
	| 'ready';

export class GatewayClient {
	private ws: WebSocket | null = null;
	private config: GatewayClientConfig;
	private state: GatewayClientState = 'disconnected';
	private gatewayId: string | null = null;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 10;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private shouldReconnect = true;
	private pingInterval: NodeJS.Timeout | null = null;

	constructor(config: GatewayClientConfig) {
		this.config = config;
	}

	/**
	 * Build the WebSocket URL from config
	 */
	private buildWsUrl(): string {
		let baseUrl = this.config.url;

		// Convert http(s) to ws(s)
		if (baseUrl.startsWith('https://')) {
			baseUrl = 'wss://' + baseUrl.slice(8);
		} else if (baseUrl.startsWith('http://')) {
			baseUrl = 'ws://' + baseUrl.slice(7);
		}

		// Remove trailing slash
		if (baseUrl.endsWith('/')) {
			baseUrl = baseUrl.slice(0, -1);
		}

		return `${baseUrl}/gateway/ws?token=${encodeURIComponent(
			this.config.apiKey,
		)}`;
	}

	/**
	 * Connect to the gateway WebSocket server
	 */
	connect(): void {
		if (this.state !== 'disconnected') {
			return;
		}

		this.shouldReconnect = true;
		this.state = 'connecting';

		const wsUrl = this.buildWsUrl();
		console.log(`Connecting to gateway: ${this.config.url}`);

		this.ws = new WebSocket(wsUrl);

		this.ws.on('open', () => {
			this.state = 'connected';
			this.reconnectAttempts = 0;
			console.log('Gateway WebSocket connected');

			this.config.onConnect?.();

			// Send init message
			this.send({
				type: 'init',
				name: this.config.name,
				description: this.config.description,
				platform: process.platform,
				hostname: hostname(),
				clientVersion: '1.0.0',
			});

			// Start ping interval to keep connection alive
			this.startPingInterval();
		});

		this.ws.on('message', async (data: RawData) => {
			try {
				const message = JSON.parse(data.toString()) as ServerMessage;
				await this.handleMessage(message);
			} catch (parseErr) {
				console.error('Failed to parse message:', parseErr);
			}
		});

		this.ws.on('close', () => {
			this.handleDisconnect();
		});

		this.ws.on('error', (wsErr: Error) => {
			console.error('Gateway WebSocket error:', wsErr);
			this.config.onError?.(wsErr);
		});
	}

	/**
	 * Handle incoming messages from server
	 */
	private async handleMessage(message: ServerMessage): Promise<void> {
		switch (message.type) {
			case 'get_supported_tools':
				// Send our supported tools organized by slots
				const toolSlots: ToolSlots = {
					browser: browserTools,
					coding: codingTools,
				};
				this.send({
					type: 'supported_tools',
					tools: toolSlots,
				});
				break;

			case 'ready': {
				this.state = 'ready';
				const readyMsg = message as unknown as ReadyMessage;
				this.gatewayId = readyMsg.gatewayId;
				console.log(`Gateway ready: ${this.gatewayId}`);
				this.config.onReady?.(this.gatewayId);
				break;
			}

			case 'tool_call': {
				const toolCall = message as unknown as ToolCallMessage;
				console.log(`Tool call: ${toolCall.tool} (${toolCall.id})`);

				try {
					let result: {success: boolean; result?: unknown; error?: string};

					// Route to appropriate executor based on tool prefix
					if (toolCall.tool.startsWith('browser_')) {
						result = await executeBrowserTool(toolCall.tool, toolCall.params);
					} else if (toolCall.tool.startsWith('coding_')) {
						result = await executeCodingTool(toolCall.tool, toolCall.params);
					} else {
						result = {success: false, error: `Unknown tool: ${toolCall.tool}`};
					}

					if (result.success) {
						this.send({
							type: 'tool_result',
							id: toolCall.id,
							result: result.result,
						});
					} else {
						this.send({
							type: 'tool_result',
							id: toolCall.id,
							error: result.error,
						});
					}
				} catch (err) {
					this.send({
						type: 'tool_result',
						id: toolCall.id,
						error: err instanceof Error ? err.message : 'Unknown error',
					});
				}
				break;
			}

			case 'error': {
				const errorMsg = message as unknown as ErrorMessage;
				console.error(`Gateway error: ${errorMsg.message} (${errorMsg.code})`);
				break;
			}

			default:
				console.log(`Unknown message type: ${message.type}`);
		}
	}

	/**
	 * Handle disconnect and attempt reconnection
	 */
	private async handleDisconnect(): Promise<void> {
		const wasReady = this.state === 'ready';
		this.state = 'disconnected';
		this.gatewayId = null;
		this.ws = null;

		this.stopPingInterval();

		console.log('Gateway WebSocket disconnected');
		this.config.onDisconnect?.();

		// Auto-close all browser sessions on disconnect
		if (wasReady) {
			console.log('Closing all browser sessions...');
			try {
				await browserCloseAll();
			} catch {
				// Ignore errors when closing browser
			}
		}

		// Attempt reconnection with exponential backoff
		if (
			this.shouldReconnect &&
			this.reconnectAttempts < this.maxReconnectAttempts
		) {
			const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
			this.reconnectAttempts++;

			console.log(
				`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`,
			);

			this.reconnectTimer = setTimeout(() => {
				this.connect();
			}, delay);
		} else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			console.error('Max reconnection attempts reached');
		}
	}

	/**
	 * Send a message to the server
	 */
	private send(message: Record<string, unknown>): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(message));
		}
	}

	/**
	 * Start ping interval to keep connection alive
	 */
	private startPingInterval(): void {
		this.stopPingInterval();
		this.pingInterval = setInterval(() => {
			if (this.ws && this.ws.readyState === WebSocket.OPEN) {
				this.ws.ping();
			}
		}, 30000);
	}

	/**
	 * Stop ping interval
	 */
	private stopPingInterval(): void {
		if (this.pingInterval) {
			clearInterval(this.pingInterval);
			this.pingInterval = null;
		}
	}

	/**
	 * Disconnect from the gateway
	 */
	disconnect(): void {
		this.shouldReconnect = false;

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		this.stopPingInterval();

		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}

		this.state = 'disconnected';
		this.gatewayId = null;
	}

	/**
	 * Get the current state
	 */
	getState(): GatewayClientState {
		return this.state;
	}

	/**
	 * Get the gateway ID (if ready)
	 */
	getGatewayId(): string | null {
		return this.gatewayId;
	}

	/**
	 * Check if connected and ready
	 */
	isReady(): boolean {
		return this.state === 'ready';
	}
}

/**
 * Create and connect a gateway client
 */
export function createGatewayClient(
	config: GatewayClientConfig,
): GatewayClient {
	const client = new GatewayClient(config);
	client.connect();
	return client;
}

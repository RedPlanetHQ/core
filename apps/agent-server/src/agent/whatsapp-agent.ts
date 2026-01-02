import { CoreMemoryClient } from '../services/core-mcp';
import { ProgressiveCallback } from './types';
import { logger } from '../utils/logger';
import { runSolAgent, ConversationMessage } from './sol-agent';

export interface WhatsAppAgentOptions {
  conversationHistory?: ConversationMessage[];
  sessionContext?: string;
}

/**
 * WhatsApp Agent
 *
 * Uses SolAgent with progressive=true for sequential messages.
 * Sol generates acknowledgment naturally, not hardcoded.
 */
export class WhatsAppAgent {
  private mcpClient: CoreMemoryClient;
  private onMessage: ProgressiveCallback;

  constructor(mcpClient: CoreMemoryClient, onMessage: ProgressiveCallback) {
    this.mcpClient = mcpClient;
    this.onMessage = onMessage;
  }

  async process(userMessage: string, options: WhatsAppAgentOptions = {}): Promise<string[]> {
    const result = await runSolAgent({
      mcpClient: this.mcpClient,
      userMessage,
      channel: 'whatsapp',
      progressive: true,
      onMessage: async (msg) => {
        await this.onMessage({ type: 'data', content: msg });
      },
      conversationHistory: options.conversationHistory,
      sessionContext: options.sessionContext,
    });

    logger.info('WhatsAppAgent completed', {
      executionTimeMs: result.executionTimeMs,
      messageCount: result.messages.length,
    });

    return result.messages;
  }
}

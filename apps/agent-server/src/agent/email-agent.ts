import { CoreMemoryClient } from '../services/core-mcp';
import { logger } from '../utils/logger';
import { runSolAgent, ConversationMessage } from './sol-agent';

export interface EmailAgentOptions {
  conversationHistory?: ConversationMessage[];
  sessionContext?: string;
}

/**
 * Email Agent
 *
 * Uses SolAgent with progressive=false for batch response.
 * All messages returned at once, joined for email.
 */
export class EmailAgent {
  private mcpClient: CoreMemoryClient;

  constructor(mcpClient: CoreMemoryClient) {
    this.mcpClient = mcpClient;
  }

  async process(userMessage: string, options: EmailAgentOptions = {}): Promise<string> {
    const result = await runSolAgent({
      mcpClient: this.mcpClient,
      userMessage,
      channel: 'email',
      progressive: false,
      conversationHistory: options.conversationHistory,
      sessionContext: options.sessionContext,
    });

    logger.info('EmailAgent completed', {
      executionTimeMs: result.executionTimeMs,
      messageCount: result.messages.length,
    });

    // Join all messages into single email response
    return result.messages.join('\n\n');
  }
}

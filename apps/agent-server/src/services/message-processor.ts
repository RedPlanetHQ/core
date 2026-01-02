import { prisma } from '../db.server';
import { CoreMemoryClient } from './core-mcp';
import { WhatsAppAgent } from '../agent/whatsapp-agent';
import { EmailAgent } from '../agent/email-agent';
import { sendWhatsAppMessage } from './whatsapp';
import { sendAgentReply } from './email';
import { logger } from '../utils/logger';
import { ProgressiveMessage } from '../agent/types';
import { ConversationMessage } from '../agent/sol-agent';

interface ProcessMessageParams {
  userId: string;
  conversationId: string;
  message: string;
  source: 'whatsapp' | 'email';
  subject?: string;
  messageId?: string;
  skipSending?: boolean; // Set to true to skip actual WhatsApp/Email sending (for API testing)
}

interface ProcessMessageResult {
  messages: string[];
  executionTimeMs: number;
}

/**
 * Get last N messages from conversation history
 */
async function getConversationHistory(conversationId: string, limit: number = 5): Promise<ConversationMessage[]> {
  const history = await prisma.conversationHistory.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      userType: true,
      message: true,
    },
  });

  // Reverse to get chronological order and map to ConversationMessage format
  return history.reverse().map(h => ({
    role: h.userType === 'User' ? 'user' as const : 'assistant' as const,
    content: h.message,
  }));
}

/**
 * Get session context from Document table by sessionId
 * Session compacts are stored in Document table with id = sessionId
 */
async function getSessionContext(sessionId: string): Promise<string | undefined> {
  try {
    const document = await prisma.document.findUnique({
      where: { id: sessionId },
      select: { content: true },
    });
    return document?.content || undefined;
  } catch (error) {
    logger.warn('Failed to get session context', error);
    return undefined;
  }
}

/**
 * Process agent message with channel-specific handling
 *
 * WhatsApp: Progressive messages (ack → header → data → insight)
 * Email: Single comprehensive response
 */
export async function processMessage(params: ProcessMessageParams): Promise<ProcessMessageResult> {
  const { userId, conversationId, message, source, subject, messageId, skipSending = false } = params;
  const startTime = Date.now();

  logger.info(`Processing message for user ${userId} from ${source}`);

  // 1. Get user and workspace
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { Workspace: true },
  });

  if (!user || !user.Workspace) {
    throw new Error(`User ${userId} not found or has no workspace`);
  }

  // 2. Connect to CORE memory with user's PAT
  const mcpClient = new CoreMemoryClient();
  await mcpClient.connect(user.id, user.Workspace.id);

  const allMessages: string[] = [];

  try {
    // 3. Get conversation history (last 5 messages) and session context
    const [conversationHistory, sessionContext] = await Promise.all([
      getConversationHistory(conversationId, 5),
      getSessionContext(mcpClient),
    ]);

    logger.info(`Loaded ${conversationHistory.length} history messages, session context: ${sessionContext ? 'yes' : 'no'}`);

    if (source === 'whatsapp') {
      // WhatsApp: Progressive flow
      const sendMessage = async (msg: ProgressiveMessage): Promise<void> => {
        if (!skipSending && user.phoneNumber) {
          await sendWhatsAppMessage(user.phoneNumber, msg.content);
        }
        logger.info(`WhatsApp [${msg.type}]: ${msg.content.substring(0, 50)}...`);
      };

      const agent = new WhatsAppAgent(mcpClient, sendMessage);
      const messages = await agent.process(message, { conversationHistory, sessionContext });
      allMessages.push(...messages);

      // Save full response to conversation history
      await prisma.conversationHistory.create({
        data: {
          conversationId,
          userType: 'Agent',
          message: messages.join('\n\n'),
          parts: { messages, source },
        },
      });
    } else {
      // Email: Single response flow
      const agent = new EmailAgent(mcpClient);
      const response = await agent.process(message, { conversationHistory, sessionContext });
      allMessages.push(response);

      // Save response to conversation history
      await prisma.conversationHistory.create({
        data: {
          conversationId,
          userType: 'Agent',
          message: response,
          parts: { text: response, source },
        },
      });

      // Send email
      if (!skipSending) {
        const replySubject = subject ? `Re: ${subject}` : 'Re: CORE Agent';
        await sendAgentReply(user.email, response, {
          subject: replySubject,
          inReplyTo: messageId,
          references: messageId,
        });
      }
    }

    const executionTimeMs = Date.now() - startTime;
    logger.info(`Successfully processed message for user ${userId}`, {
      source,
      messageCount: allMessages.length,
      executionTimeMs,
    });

    return { messages: allMessages, executionTimeMs };
  } finally {
    await mcpClient.disconnect();
  }
}

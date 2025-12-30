import { Worker } from 'bullmq';
import { prisma } from '../db.server';
import { getRedisConnection } from './connection';
import { AgentMessageJob } from './queues';
import { CoreMemoryClient } from '../services/core-mcp';
import { generateAgentResponse } from '../services/ai';
import { sendWhatsAppMessage } from '../services/whatsapp';
import { sendAgentReply } from '../services/email';
import { logger } from '../utils/logger';

export const agentMessageWorker = new Worker<AgentMessageJob>(
  'agent-message-queue',
  async (job) => {
    const { userId, conversationId, message, source, subject, messageId } = job.data;

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

    try {
      // 3. Search memory for context
      const memoryContext = await mcpClient.searchMemory(message);

      // 4. Get user persona
      const persona = await mcpClient.getUserPersona();

      // 5. Get integrations
      const integrations = await mcpClient.getIntegrations();

      // 6. Generate AI response
      const response = await generateAgentResponse({
        userMessage: message,
        memoryContext,
        persona,
        integrations,
      });

      // 7. Save assistant response
      await prisma.conversationHistory.create({
        data: {
          conversationId,
          userType: 'Agent',
          message: response,
          parts: { text: response, source },
        },
      });

      // 8. Send reply via appropriate channel
      if (source === 'whatsapp') {
        await sendWhatsAppMessage(user.phoneNumber!, response);
      } else {
        const replySubject = subject ? `Re: ${subject}` : 'Re: CORE Agent';
        await sendAgentReply(user.email, response, {
          subject: replySubject,
          inReplyTo: messageId,
          references: messageId,
        });
      }

      // 9. Ingest to CORE memory
      const conversationText = `User: ${message}\n\nAssistant: ${response}`;
      await mcpClient.ingestConversation(conversationText, conversationId);

      logger.info(`Successfully processed message for user ${userId}`);
    } finally {
      await mcpClient.disconnect();
    }
  },
  {
    connection: getRedisConnection(),
    concurrency: 3, // Process 3 messages in parallel
  }
);

// Setup logging
agentMessageWorker.on('completed', (job) => {
  logger.info(`Job ${job.id} completed for user ${job.data.userId}`);
});

agentMessageWorker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed:`, err);
});

agentMessageWorker.on('error', (err) => {
  logger.error('Worker error:', err);
});

export async function initializeWorkers(): Promise<void> {
  logger.info('Agent message worker initialized');
}

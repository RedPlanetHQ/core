import { Queue } from 'bullmq';
import { getRedisConnection } from './connection';

export interface AgentMessageJob {
  userId: string;
  conversationId: string;
  message: string;
  source: 'whatsapp' | 'email';
  subject?: string;
  messageId?: string; // Email Message-ID for threading
}

export const agentMessageQueue = new Queue<AgentMessageJob>('agent-message-queue', {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600, // 1 hour
      count: 1000,
    },
    removeOnFail: {
      age: 86400, // 24 hours for debugging
    },
  },
});

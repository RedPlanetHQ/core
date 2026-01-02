import { Request, Response } from 'express';
import { prisma } from '../db.server';
import { processMessage } from '../services/message-processor';
import { logger } from '../utils/logger';

interface ChatRequest {
  userId: string;
  message: string;
  channel?: 'whatsapp' | 'email';
}

/**
 * Direct chat API for testing agent without webhook flow
 * POST /api/chat
 * Body: { userId: string, message: string, channel?: 'whatsapp' | 'email' }
 */
export async function chatEndpoint(req: Request, res: Response): Promise<void> {
  try {
    const { userId, message, channel = 'whatsapp' } = req.body as ChatRequest;

    // Validate request
    if (!userId || !message) {
      res.status(400).json({
        error: 'Missing required fields',
        required: ['userId', 'message'],
      });
      return;
    }

    // Get user and workspace
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { Workspace: true },
    });

    if (!user) {
      res.status(404).json({ error: `User ${userId} not found` });
      return;
    }

    if (!user.Workspace) {
      res.status(400).json({ error: `User ${userId} has no workspace` });
      return;
    }

    if (!user.onboardingComplete) {
      res.status(400).json({
        error: `User ${userId} has not completed onboarding`,
        hint: 'Set user.onboardingComplete = true in database',
      });
      return;
    }

    // Get or create conversation
    let conversation = await prisma.conversation.findFirst({
      where: {
        userId: user.id,
        status: 'running',
        workspaceId: user.Workspace.id,
      },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          userId: user.id,
          workspaceId: user.Workspace.id,
          title: `API Test Chat (${channel})`,
          status: 'running',
        },
      });
    }

    // Save user message
    await prisma.conversationHistory.create({
      data: {
        conversationId: conversation.id,
        userId: user.id,
        userType: 'User',
        message,
        parts: { text: message, source: 'api' },
      },
    });

    logger.info(`Processing API chat request from user ${userId}`);

    // Process message (this will handle MCP, agent, reply storage, and memory ingestion)
    // Note: For API testing, we skip actual WhatsApp/Email sending
    const result = await processMessage({
      userId: user.id,
      conversationId: conversation.id,
      message,
      source: channel,
      skipSending: true, // Don't send actual WhatsApp/Email for API testing
    });

    res.status(200).json({
      success: true,
      conversationId: conversation.id,
      messages: result.messages,
      channel,
      executionTimeMs: result.executionTimeMs,
    });
  } catch (error) {
    logger.error('Chat API error', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

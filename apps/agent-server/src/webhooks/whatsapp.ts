import { Request, Response } from 'express';
import { prisma } from '../db.server';
import { verifyWebhookSignature } from '../services/whatsapp';
import { handleNewUser } from '../auth/verify';
import { processMessage } from '../services/message-processor';
import { logger } from '../utils/logger';

export async function whatsappWebhook(req: Request, res: Response): Promise<void> {
  try {
    // Verify Twilio signature
    const signature = req.headers['x-twilio-signature'] as string | undefined;
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    if (!verifyWebhookSignature(signature, url, req.body)) {
      logger.warn('Invalid Twilio signature');
      res.status(403).send('Invalid signature');
      return;
    }

    const { From: from, Body: body } = req.body;

    if (!from || !body) {
      logger.warn('Missing From or Body in webhook');
      res.status(400).send('Missing required fields');
      return;
    }

    // Remove whatsapp: prefix if present
    const phoneNumber = from.replace('whatsapp:', '');

    // Find user
    const user = await prisma.user.findUnique({
      where: { phoneNumber },
      include: { Workspace: true },
    });

    // If user doesn't exist or isn't verified, send verification link
    if (!user || !user.onboardingComplete) {
      await handleNewUser('whatsapp', phoneNumber);
      res.status(200).send();
      return;
    }

    // Get or create conversation
    let conversation = await prisma.conversation.findFirst({
      where: {
        userId: user.id,
        status: 'running',
        workspaceId: user.Workspace!.id,
      },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          userId: user.id,
          workspaceId: user.Workspace!.id,
          title: 'WhatsApp Chat',
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
        message: body,
        parts: { text: body, source: 'whatsapp' },
      },
    });

    // Process message synchronously (time-sensitive)
    await processMessage({
      userId: user.id,
      conversationId: conversation.id,
      message: body,
      source: 'whatsapp',
    });

    logger.info(`Processed WhatsApp message from ${phoneNumber}`);
    res.status(200).send();
  } catch (error) {
    logger.error('WhatsApp webhook error', error);
    res.status(500).send('Internal server error');
  }
}

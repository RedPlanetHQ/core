import { Request, Response } from 'express';
import { Resend } from 'resend';
import { prisma } from '../db.server';
import { handleNewUser } from '../auth/verify';
import { processMessage } from '../services/message-processor';
import { logger } from '../utils/logger';
import { env } from '../config/env';

const resend = new Resend(env.RESEND_API_KEY);

export async function emailWebhook(req: Request, res: Response): Promise<void> {
  try {
    console.log('Email webhook request:', req);
    console.log('Email webhook body:', req.body);
    // Resend inbound webhook payload (only contains metadata)
    const { email_id, from, subject, message_id } = req.body.data;

    // Fetch the actual email content using Resend API
    const emailDetails = await resend.emails.receiving.get(email_id);
    console.log('Email details:', JSON.stringify(emailDetails));
    const { html, text } = emailDetails.data || {};

    if (!from) {
      logger.warn('Missing from field in email webhook');
      res.status(400).send('Missing from field');
      return;
    }

    // Extract email address from "Name <email>" format
    const emailMatch = from.match(/<(.+)>/) || [null, from];
    const emailAddress = emailMatch[1] || from;

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: emailAddress },
      include: { Workspace: true },
    });

    // If user doesn't exist or isn't verified, send verification link
    if (!user || !user.onboardingComplete) {
      await handleNewUser('email', emailAddress, message_id);
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
          title: `Email: ${subject || 'Chat'}`,
          status: 'running',
        },
      });
    }

    // Prefer text over HTML
    const messageContent = text || html || '';

    if (!messageContent) {
      logger.warn('Empty message content in email webhook');
      res.status(400).send('Empty message');
      return;
    }

    // Save user message
    await prisma.conversationHistory.create({
      data: {
        conversationId: conversation.id,
        userId: user.id,
        userType: 'User',
        message: messageContent,
        parts: {
          text: messageContent,
          subject,
          source: 'email',
          messageId: message_id
        },
      },
    });

    // Process message synchronously (time-sensitive)
    await processMessage({
      userId: user.id,
      conversationId: conversation.id,
      message: messageContent,
      source: 'email',
      subject,
      messageId: message_id,
    });

    logger.info(`Processed email message from ${from}`);
    res.status(200).send();
  } catch (error) {
    logger.error('Email webhook error', error);
    res.status(500).send('Internal server error');
  }
}

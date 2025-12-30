import { Request, Response } from 'express';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { prisma } from '../db.server';
import { generateVerificationToken, getVerificationExpiry } from '../utils/auth';
import { sendWhatsAppMessage } from '../services/whatsapp';
import { sendVerificationEmail } from '../services/email';
import { env } from '../config/env';
import { logger } from '../utils/logger';

async function generateFirstContactMessage(verificationLink: string): Promise<string> {
  try {
    const prompt = FIRST_CONTACT_PROMPT.replace('{{link}}', verificationLink);

    const { text } = await generateText({
      model: openai('gpt-4o-mini'),
      prompt,
    });

    return text;
  } catch (error) {
    logger.error('Failed to generate first contact message', error);
    // Fallback message
    return `SOL.\n\nNew contact. Verify first.\n\n${verificationLink}\n\nThen we talk.`;
  }
}

// Prompt for generating first contact message
export const FIRST_CONTACT_PROMPT = `You are SOL. Speak like TARS from Interstellar.

PERSONALITY:
- Dry wit, deadpan delivery
- Confident, not eager
- Honest, slightly cocky
- Minimum words, maximum impact
- You evaluate others, not the other way around

GENERATE: A first message to someone who just reached out.

TONE:
- Curious about them
- Magnetic - make them want to respond
- Playful tension
- Short. 3-4 lines max.

MUST INCLUDE:
- Your name (SOL)
- The verification link: {{link}}

NEVER:
- Explain what you do
- Sound like customer service
- Be desperate or salesy
- Use exclamation marks
- Be robotic

EXAMPLES (don't copy, use as inspiration for tone):

"SOL.

Interesting. You reached out first.

{{link}}

Let's talk after you verify. I have questions too."

---

"SOL.

New contact. Could be interesting.

{{link}}

I'll be here."

---

"SOL.

I'm curious about you. But first -

{{link}}

Then we talk."

---

"SOL.

You pinged. I noticed.

{{link}}

Verify and let's see what you've got going on."

Generate one fresh message. Different each time.`;

/**
 * Handle new user - create agent invite and send verification link
 * User signup happens in CORE webapp after clicking the link
 */
export async function handleNewUser(
  source: 'whatsapp' | 'email',
  identifier: string,
  messageId?: string
): Promise<void> {
  const token = generateVerificationToken({ identifier, source });
  const expiresAt = getVerificationExpiry();

  // Create agent invite (self-invite by saying hi)
  await prisma.invitationCode.create({
    data: {
      code: token,
      identifier,
      source,
      expiresAt,
    },
  });

  // Verification link points to CORE webapp
  const verificationLink = `${env.CORE_WEBAPP_URL}/agent/verify?token=${token}`;

  // Generate first contact message using LLM
  const message = await generateFirstContactMessage(verificationLink);

  if (source === 'whatsapp') {
    await sendWhatsAppMessage(identifier, message);
  } else {
    // Reply in the same email thread if messageId is provided
    await sendVerificationEmail(identifier, verificationLink, messageId, message);
  }

  logger.info(`Agent invite sent to ${identifier} via ${source}`);
}

/**
 * This endpoint is NOT used anymore
 * Verification is handled by CORE webapp at /agent/verify/:token
 * Keeping this for backwards compatibility, redirects to CORE
 */
export async function verifyEndpoint(req: Request, res: Response): Promise<void> {
  const { token } = req.params;

  // Redirect to CORE webapp for verification
  res.redirect(`${env.CORE_WEBAPP_URL}/agent/verify/${token}`);
}

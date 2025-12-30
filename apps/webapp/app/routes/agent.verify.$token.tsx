import { type LoaderFunctionArgs, redirect } from '@remix-run/node';
import { prisma } from '~/db.server';
import { logger } from '~/services/logger.service';

/**
 * Agent verification endpoint
 * Validates the invite token and redirects to /login with token
 * Login flow handles user creation and workspace setup
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { token } = params;

  if (!token) {
    return redirect('/login?error=missing_token');
  }

  // Find agent invitation
  const invite = await prisma.invitationCode.findFirst({
    where: {
      code: token,
      expiresAt: { gte: new Date() },
    },
  });

  if (!invite) {
    logger.warn(`Invalid or expired agent invite: ${token}`);
    return redirect('/login?error=invalid_invite');
  }

  logger.info(`Valid agent invite for ${invite.identifier} via ${invite.source}`);

  // Redirect to login with token - login flow will handle user creation
  return redirect(`/login?agent_token=${token}`);
}

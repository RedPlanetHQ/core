import { type Workspace } from "@core/database";
import { prisma } from "~/db.server";
import { ensureBillingInitialized } from "~/services/billing.server";
import { sendEmail } from "~/services/email.server";
import { logger } from "~/services/logger.service";
import { SpaceService } from "~/services/space.server";

interface CreateWorkspaceDto {
  name: string;
  integrations: string[];
  userId: string;
}

const spaceService = new SpaceService();

const profileRule = `
Purpose: Store my identity and preferences to improve personalization across assistants. It should be broadly useful across contexts (not app-specific).
Include (examples):
• Preferred name, pronunciation, public handles (GitHub/Twitter/LinkedIn URLs), primary email domain
• Timezone, locale, working hours, meeting preferences (async/sync bias, default duration)
• Role, team, company, office location (city-level only), seniority
• Tooling defaults (editor, ticketing system, repo host), keyboard layout, OS
• Communication preferences (tone, brevity vs. detail, summary-first)
Exclude:
• Sensitive: secrets, health/financial/political/religious/sexual data, precise address
• Temporary: one-off states, troubleshooting sessions, query results
• Context-specific: app behaviors, work conversations, project-specific preferences
• Meta: discussions about this memory system, AI architecture, system design
• Anything not explicitly consented to share
don't store anything the user did not explicitly consent to share.`;

export async function createWorkspace(
  input: CreateWorkspaceDto,
): Promise<Workspace> {
  const workspace = await prisma.workspace.create({
    data: {
      slug: input.name,
      name: input.name,
      userId: input.userId,
    },
  });

  const user = await prisma.user.update({
    where: { id: input.userId },
    data: {
      confirmedBasicDetails: true,
    },
  });

  await ensureBillingInitialized(workspace.id);

  // Create default spaces
  await Promise.all([]);

  try {
    const response = await sendEmail({ email: "welcome", to: user.email });
    logger.info(`${JSON.stringify(response)}`);
  } catch (e) {
    logger.error(`Error sending email: ${e}`);
  }

  return workspace;
}

export async function getWorkspaceByUser(userId: string) {
  return await prisma.workspace.findFirst({
    where: {
      userId,
    },
  });
}

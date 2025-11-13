import { type Workspace } from "@core/database";
import { prisma } from "~/db.server";
import { ensureBillingInitialized } from "~/services/billing.server";
import { sendEmail } from "~/services/email.server";
import { logger } from "~/services/logger.service";

interface CreateWorkspaceDto {
  name: string;
  integrations: string[];
  userId: string;
}

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

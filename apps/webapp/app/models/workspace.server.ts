import { type Workspace } from "@core/database";
import { prisma } from "~/db.server";
import { ensureBillingInitialized } from "~/services/billing.server";
import { sendEmail } from "~/services/email.server";
import { logger } from "~/services/logger.service";
import { LabelService } from "~/services/label.server";

interface CreateWorkspaceDto {
  name: string;
  integrations: string[];
  userId: string;
}

export async function createWorkspace(
  input: CreateWorkspaceDto,
): Promise<Workspace> {
  // Generate slug: remove spaces, lowercase, add 5 random letters
  const generateRandomSuffix = () => {
    const chars = "abcdefghijklmnopqrstuvwxyz";
    return Array.from(
      { length: 5 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  };

  const slug =
    input.name.replace(/\s+/g, "-").toLowerCase() + generateRandomSuffix();

  const workspace = await prisma.workspace.create({
    data: {
      slug,
      name: input.name,
      version: "V3",
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

  // Create persona document and label
  try {
    const labelService = new LabelService();

    // Create Persona label
    await labelService.createLabel({
      name: "Persona",
      workspaceId: workspace.id,
      color: "#8B5CF6", // Purple color for persona
      description: "Personal persona generated from your episodes",
    });

    logger.info(`Created persona document and label for user ${input.userId}`);
  } catch (e) {
    logger.error(`Error creating persona document: ${e}`);
    // Don't fail workspace creation if persona setup fails
  }

  try {
    const response = await sendEmail({ email: "welcome", to: user.email });
    logger.info(`${JSON.stringify(response)}`);
  } catch (e) {
    logger.error(`Error sending email: ${e}`);
  }

  return workspace;
}




export async function getWorkspaceById(id: string) {
  return await prisma.workspace.findFirst({
    where: {
      id,
    },
  });
}

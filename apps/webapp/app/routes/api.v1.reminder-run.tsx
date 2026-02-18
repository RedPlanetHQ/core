import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { authenticatePersonalAccessToken, deletePersonalAccessToken } from "~/services/personalAccessToken.server";
import { logger } from "~/services/logger.service";
import { executeReminderRun } from "~/jobs/reminder/reminder.logic";

const ReminderRunSchema = z.object({
  reminderId: z.string(),
  workspaceId: z.string(),
  channel: z.enum(["whatsapp", "email"]),
  patId: z.string(), // PAT ID to delete after execution
});

export async function action({ request }: ActionFunctionArgs) {
  // Only allow POST
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    // Authenticate with PAT from Authorization header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing or invalid authorization" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const auth = await authenticatePersonalAccessToken(token);

    if (!auth) {
      return json({ error: "Invalid token" }, { status: 401 });
    }

    // Parse body
    const body = await request.json();
    const data = ReminderRunSchema.parse(body);

    // Verify workspace matches
    if (auth.workspaceId !== data.workspaceId) {
      return json({ error: "Workspace mismatch" }, { status: 403 });
    }

    logger.info(`Reminder run API called for ${data.reminderId}`, {
      workspaceId: data.workspaceId,
      channel: data.channel,
    });

    // Execute the reminder
    const result = await executeReminderRun({
      reminderId: data.reminderId,
      workspaceId: data.workspaceId,
      channel: data.channel,
    });

    // Delete the PAT after successful execution
    try {
      await deletePersonalAccessToken(data.patId);
      logger.info(`Deleted temporary PAT ${data.patId} after reminder run`);
    } catch (deleteError) {
      logger.warn(`Failed to delete PAT ${data.patId}`, { error: deleteError });
    }

    return json({ success: result.success, error: result.error });
  } catch (error) {
    logger.error("Reminder run API error", { error });

    if (error instanceof z.ZodError) {
      return json({ error: "Invalid request body", details: error.errors }, { status: 400 });
    }

    return json({
      error: error instanceof Error ? error.message : "Internal server error"
    }, { status: 500 });
  }
}

// Also handle CORS preflight
export async function loader() {
  return json({ error: "Method not allowed" }, { status: 405 });
}

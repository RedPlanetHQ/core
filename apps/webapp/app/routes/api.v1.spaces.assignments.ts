import { z } from "zod";
import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { json } from "@remix-run/node";
import { triggerSpaceAssignment } from "~/trigger/spaces/space-assignment";
import { triggerDailyAssignmentForUser } from "~/trigger/spaces/daily-assignment";
import { prisma } from "~/db.server";

// Schema for manual assignment trigger
const ManualAssignmentSchema = z.object({
  mode: z.enum(["new_space", "daily_batch"]),
  newSpaceId: z.string().optional(),
  daysPeriod: z.number().min(1).max(30).optional().default(1),
  batchSize: z.number().min(1).max(100).optional().default(25),
});

const { action } = createActionApiRoute(
  {
    body: ManualAssignmentSchema,
    allowJWT: true,
    authorization: {
      action: "manage",
    },
    corsStrategy: "all",
  },
  async ({ authentication, body }) => {
    const userId = authentication.userId;
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        Workspace: {
          select: {
            id: true,
          },
        },
      },
    });
    try {
      let taskRun;

      if (body.mode === "daily_batch") {
        // Use the daily assignment helper for manual triggering
        taskRun = await triggerDailyAssignmentForUser(
          userId,
          user?.Workspace?.id as string,
          body.daysPeriod,
        );
      } else {
        // Direct LLM assignment trigger
        taskRun = await triggerSpaceAssignment({
          userId,
          workspaceId: user?.Workspace?.id as string,
          mode: body.mode,
          newSpaceId: body.newSpaceId,
          daysPeriod: body.daysPeriod,
          batchSize: body.batchSize,
        });
      }

      return json({
        success: true,
        message: `${body.mode} assignment task triggered successfully`,
        taskId: taskRun.id,
        payload: {
          userId,
          mode: body.mode,
          newSpaceId: body.newSpaceId,
          daysPeriod: body.daysPeriod,
          batchSize: body.batchSize,
        },
      });
    } catch (error) {
      console.error("Error triggering space assignment:", error);
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to trigger assignment",
          success: false,
        },
        { status: 500 },
      );
    }
  },
);

export { action };

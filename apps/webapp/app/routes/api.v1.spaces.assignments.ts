import { z } from "zod";
import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { json } from "@remix-run/node";
import { triggerSpaceAssignment } from "~/trigger/spaces/space-assignment";
import { prisma } from "~/db.server";

// Schema for manual assignment trigger
const ManualAssignmentSchema = z.object({
  mode: z.enum(["new_space"]),
  newSpaceId: z.string().optional(),
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

      // Direct LLM assignment trigger
      taskRun = await triggerSpaceAssignment({
        userId,
        workspaceId: user?.Workspace?.id as string,
        mode: body.mode,
        newSpaceId: body.newSpaceId,
        batchSize: body.batchSize,
      });

      return json({
        success: true,
        message: `${body.mode} assignment task triggered successfully`,
        taskId: taskRun.id,
        payload: {
          userId,
          mode: body.mode,
          newSpaceId: body.newSpaceId,
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

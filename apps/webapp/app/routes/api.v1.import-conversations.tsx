import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { prisma } from "~/db.server";
import { enqueueImportConversations } from "~/lib/queue-adapter.server";
import { isS3Configured, getLocalFilePath } from "~/lib/storage.server";

const ImportConversationsRequest = z.object({
  provider: z.enum(["claude", "openai"]).optional().default("claude"),
  dryRun: z.boolean().optional().default(false),
  filePath: z.string().optional(), // Optional file path (for local files)
  storageUuid: z.string().optional(), // Optional S3 storage UUID (from /api/v1/storage)
});

const { action, loader } = createHybridActionApiRoute(
  {
    body: ImportConversationsRequest,
    allowJWT: true,
    authorization: {
      action: "ingest",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    const { provider, dryRun, filePath, storageUuid } = body;

    // Get workspace for user
    const user = await prisma.user.findUnique({
      where: { id: authentication.userId },
      include: { Workspace: true },
    });

    if (!user?.Workspace) {
      return json({ success: false, error: "No workspace found for user" }, { status: 400 });
    }

    // Determine storage source
    let storageSource: { type: 'local'; filePath: string } | { type: 's3'; key: string } | null = null;

    if (storageUuid) {
      // File uploaded via /api/v1/storage - check if S3 or local
      if (isS3Configured()) {
        // Production: File is in S3
        const s3Key = `storage/${authentication.userId}/${storageUuid}`;
        storageSource = { type: 's3', key: s3Key };
      } else {
        // Open source: File is in local temp storage
        const localPath = getLocalFilePath(storageUuid);
        if (!localPath) {
          return json(
            { success: false, error: "File not found or expired" },
            { status: 404 }
          );
        }
        storageSource = { type: 'local', filePath: localPath };
      }
    }

    if (!storageSource) {
      return json({ success: false, error: "No file provided" }, { status: 400 });
    }

    // Enqueue import job (adapter handles Trigger.dev vs BullMQ)
    const result = await enqueueImportConversations({
      userId: authentication.userId,
      workspaceId: user.Workspace.id,
      provider,
      dryRun,
      storageSource,
    });

    return json({
      success: true,
      taskId: result.id,
      message: dryRun
        ? "Dry run triggered - check logs for preview"
        : "Import task triggered successfully",
    });
  },
);

export { action, loader };

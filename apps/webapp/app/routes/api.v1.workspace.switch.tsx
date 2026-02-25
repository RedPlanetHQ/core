import { type ActionFunctionArgs, redirect } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";
import { saveSession } from "~/services/sessionStorage.server";
import { requireUserId } from "~/services/session.server";

const SwitchWorkspaceSchema = z.object({
  workspaceId: z.string(),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  const userId = await requireUserId(request);

  const formData = await request.formData();
  const parsed = SwitchWorkspaceSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
  });

  if (!parsed.success) {
    return Response.json({ error: "Invalid workspaceId" }, { status: 400 });
  }

  const { workspaceId } = parsed.data;

  // Verify user has access to this workspace
  const userWorkspace = await prisma.userWorkspace.findFirst({
    where: {
      userId,
      workspaceId,
      isActive: true,
    },
  });

  if (!userWorkspace) {
    return Response.json(
      { error: "Workspace not found or access denied" },
      { status: 403 },
    );
  }

  // Update session with new workspaceId
  const headers = await saveSession(request, {
    userId,
    workspaceId,
  });

  // Check if this is a redirect request
  const redirectTo = formData.get("redirectTo") as string | null;

  if (redirectTo) {
    return redirect(redirectTo, { headers });
  }

  return Response.json({ success: true }, { headers });
};

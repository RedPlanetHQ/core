import { json, type LoaderFunctionArgs } from "@remix-run/node";
import type { TaskStatus } from "@core/database";
import { prisma } from "~/db.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { getGatewayBrowserSessions } from "~/services/gateway/utils.server";

const ACTIVE_TASK_STATUSES: TaskStatus[] = [
  "Todo",
  "Working",
  "Waiting",
  "Review",
];

/**
 * GET /api/v1/gateways/:gatewayId/browser-sessions
 *
 * Returns the gateway's configured browser sessions (live-fetched via
 * `browser_list_sessions`) annotated with the current lock holder per
 * profile. The lock is keyed on `(gatewayId, profileName)` because that's
 * the actually-exclusive resource (Chromium SingletonLock on the
 * userDataDir). A session row is reported as "locked" when its underlying
 * profile is held by an active task in this workspace.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { gatewayId } = params;
  if (!gatewayId) {
    return json({ error: "Missing gatewayId" }, { status: 400 });
  }

  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const gateway = await prisma.gateway.findFirst({
    where: { id: gatewayId, workspaceId },
    select: { id: true },
  });
  if (!gateway) return json({ error: "Gateway not found" }, { status: 404 });

  const [configured, activeRows] = await Promise.all([
    getGatewayBrowserSessions(gatewayId),
    prisma.browserSession.findMany({
      where: {
        gatewayId,
        workspaceId,
        task: { status: { in: ACTIVE_TASK_STATUSES } },
      },
      select: {
        sessionName: true,
        profileName: true,
        taskId: true,
        task: { select: { id: true, title: true, status: true } },
      },
    }),
  ]);

  if (!configured) {
    return json({ error: "Gateway is unreachable" }, { status: 503 });
  }

  const lockByProfile = new Map(
    activeRows.map((r) => [
      r.profileName,
      {
        taskId: r.taskId,
        taskTitle: r.task?.title ?? null,
        taskStatus: r.task?.status ?? null,
        sessionName: r.sessionName,
      },
    ]),
  );

  const sessions = (configured.sessions ?? []).map((s) => ({
    name: s.name,
    profile: s.profile,
    live: s.live,
    lock: lockByProfile.get(s.profile) ?? null,
  }));

  return json({
    sessions,
    profiles: configured.profiles ?? [],
    maxSessions: configured.maxSessions ?? null,
  });
}

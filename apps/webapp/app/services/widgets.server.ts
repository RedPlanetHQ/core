import { prisma } from "~/db.server";
import { getOrCreatePersonalAccessToken } from "~/services/personalAccessToken.server";
import type { WidgetMeta } from "@redplanethq/types";
import type { WidgetOption } from "~/components/overview/types";

/**
 * Build the list of available widget options for a user/workspace
 * by reading each connected integration account's spec.widgets.
 * Mirrors the logic in home.overview loader.
 */
export async function getWidgetOptions(
  userId: string,
  workspaceId: string,
): Promise<WidgetOption[]> {
  const accounts = await prisma.integrationAccount.findMany({
    where: {
      integratedById: userId,
      workspaceId,
      isActive: true,
      integrationDefinition: { frontendUrl: { not: null } },
    },
    select: {
      id: true,
      integrationDefinition: {
        select: {
          name: true,
          slug: true,
          icon: true,
          frontendUrl: true,
          spec: true,
        },
      },
    },
  });

  const widgetOptions: WidgetOption[] = [];
  for (const account of accounts) {
    const def = account.integrationDefinition;
    const spec = def.spec as { widgets?: WidgetMeta[] } | null;
    const widgets = spec?.widgets ?? [];
    for (const w of widgets) {
      if (!w.support.includes("webapp")) continue;
      widgetOptions.push({
        widgetSlug: w.slug,
        widgetName: w.name,
        widgetDescription: w.description,
        integrationSlug: def.slug,
        integrationName: def.name,
        integrationIcon: def.icon ?? null,
        frontendUrl: def.frontendUrl!,
        integrationAccountId: account.id,
        configSchema: w.configSchema ?? [],
      });
    }
  }

  return widgetOptions;
}

/**
 * Get (or lazily create) the widget PAT for a workspace.
 * Fetches workspace.widgetPat; if missing, creates a PAT and stores it.
 */
export async function getOrCreateWidgetPat(
  workspaceId: string,
  userId: string,
): Promise<string | null> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { widgetPat: true },
  });

  if (workspace?.widgetPat) return workspace.widgetPat;

  const result = await getOrCreatePersonalAccessToken({
    name: "widget",
    userId,
    workspaceId,
    returnDecrypted: true,
  });

  const token = result.token ?? null;
  if (token) {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { widgetPat: token },
    });
  }

  return token;
}

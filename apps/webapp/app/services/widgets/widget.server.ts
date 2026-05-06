/**
 * Widget CRUD — server-side persistence for the unified widget table.
 *
 * Every embeddable widget lives here, discriminated by `engine`:
 *   DECLARATIVE — Zod-validated IR (`spec`) interpreted by the runtime
 *   BUNDLED     — pointer to (integrationAccountId, bundledWidgetSlug, configValues)
 *                 referencing a vendor-shipped widget in
 *                 IntegrationDefinitionV2.spec.widgets[]
 *
 * `kind` is orthogonal:
 *   DEFAULT — seed template (workspaceId/userId NULL); read-only reference
 *   USER    — per-user instance; editable, persists state
 */

import { prisma } from "~/db.server";
import { Prisma } from "@prisma/client";
import type {
  WidgetKind,
  WidgetEngine,
  IntegrationAccount,
  IntegrationDefinitionV2,
} from "@prisma/client";
import type { WidgetIR } from "@core/types";
import { validateWidget, formatIssues } from "./validate";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WidgetRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  kind: WidgetKind;
  engine: WidgetEngine;

  // DECLARATIVE
  spec: WidgetIR | null;
  version: number;
  state: Record<string, unknown> | null;
  sourceSlug: string | null;

  // BUNDLED
  integrationAccountId: string | null;
  bundledWidgetSlug: string | null;
  configValues: Record<string, string> | null;
  /** Joined when present — present for BUNDLED reads. */
  bundled?: BundledWidgetMeta | null;

  userId: string | null;
  workspaceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BundledWidgetMeta {
  integrationSlug: string;
  integrationName: string;
  integrationIcon: string | null;
  /** URL of the integration's compiled frontend bundle. */
  frontendUrl: string | null;
  /** Schema fields the user can configure. */
  configSchema: Array<{
    key: string;
    label: string;
    type: "input" | "select";
    placeholder?: string;
    required?: boolean;
    options?: Array<{ label: string; value: string }>;
    default?: string;
  }>;
}

type BundledRow = {
  integrationAccount: (IntegrationAccount & {
    integrationDefinition: IntegrationDefinitionV2;
  }) | null;
};

type RawWidgetRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  kind: WidgetKind;
  engine: WidgetEngine;
  spec: Prisma.JsonValue;
  version: number;
  state: Prisma.JsonValue | null;
  sourceSlug: string | null;
  integrationAccountId: string | null;
  bundledWidgetSlug: string | null;
  configValues: Prisma.JsonValue | null;
  userId: string | null;
  workspaceId: string | null;
  createdAt: Date;
  updatedAt: Date;
} & Partial<BundledRow>;

function rowToWidget(row: RawWidgetRow): WidgetRow {
  let bundled: BundledWidgetMeta | null = null;
  if (row.engine === "BUNDLED" && row.integrationAccount) {
    const def = row.integrationAccount.integrationDefinition;
    const specJson = (def.spec as Record<string, unknown> | null) ?? {};
    const widgets = (specJson.widgets as Array<Record<string, unknown>>) ?? [];
    const widgetMeta = widgets.find(
      (w) => w.slug === row.bundledWidgetSlug,
    );
    bundled = {
      integrationSlug: def.slug,
      integrationName: def.name,
      integrationIcon: def.icon,
      frontendUrl: def.frontendUrl,
      configSchema:
        (widgetMeta?.configSchema as BundledWidgetMeta["configSchema"]) ?? [],
    };
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    kind: row.kind,
    engine: row.engine,
    spec: row.spec ? (row.spec as unknown as WidgetIR) : null,
    version: row.version,
    state: (row.state as Record<string, unknown> | null) ?? null,
    sourceSlug: row.sourceSlug,
    integrationAccountId: row.integrationAccountId,
    bundledWidgetSlug: row.bundledWidgetSlug,
    configValues:
      (row.configValues as Record<string, string> | null) ?? null,
    bundled,
    userId: row.userId,
    workspaceId: row.workspaceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const bundledInclude = {
  integrationAccount: { include: { integrationDefinition: true } },
} as const;

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * Lazy default-seed coordinator.
 *
 * The first call kicks off the seed if no DEFAULT rows exist; concurrent
 * callers await the same in-flight promise instead of racing. The shared
 * promise is cleared on failure so a future call can retry, and is left
 * resolved on success so subsequent calls short-circuit cheaply (the
 * COUNT query is the only work done after the first success).
 */
let _defaultsSeedPromise: Promise<void> | null = null;

async function ensureDefaultsSeeded(): Promise<void> {
  if (_defaultsSeedPromise) return _defaultsSeedPromise;
  _defaultsSeedPromise = (async () => {
    try {
      const count = await prisma.widget.count({
        where: { kind: "DEFAULT", deleted: null },
      });
      if (count === 0) {
        const { seedDefaultWidgets } = await import("./defaults");
        await seedDefaultWidgets();
      }
    } catch (err) {
      // Clear the lock so a future call can retry, but don't loop tightly:
      // callers see one rejected promise, not a perpetual retry storm.
      _defaultsSeedPromise = null;
      throw err;
    }
  })();
  // Swallow rejections at the await site — listWidgets shouldn't fail just
  // because the seed didn't.
  return _defaultsSeedPromise.catch(() => undefined);
}

export async function listWidgets(
  workspaceId: string,
  userId: string,
): Promise<WidgetRow[]> {
  await ensureDefaultsSeeded();

  const [userWidgets, defaultWidgets] = await Promise.all([
    prisma.widget.findMany({
      where: { workspaceId, userId, kind: "USER", deleted: null },
      include: bundledInclude,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.widget.findMany({
      where: { kind: "DEFAULT", deleted: null },
      include: bundledInclude,
      orderBy: { name: "asc" },
    }),
  ]);

  const clonedSourceSlugs = new Set(
    userWidgets.map((w) => w.sourceSlug).filter((s): s is string => !!s),
  );
  const defaults = defaultWidgets
    .filter((w) => !clonedSourceSlugs.has(w.slug))
    .map(rowToWidget);
  return [...userWidgets.map(rowToWidget), ...defaults];
}

export async function getWidgetById(
  id: string,
  workspaceId: string,
  userId: string,
): Promise<WidgetRow | null> {
  const row = await prisma.widget.findFirst({
    where: {
      id,
      deleted: null,
      OR: [
        { kind: "DEFAULT" },
        { workspaceId, userId, kind: "USER" },
      ],
    },
    include: bundledInclude,
  });
  return row ? rowToWidget(row) : null;
}

export async function getWidgetBySlug(
  slug: string,
  workspaceId: string,
  userId: string,
): Promise<WidgetRow | null> {
  // USER copy wins over DEFAULT with the same slug.
  const userRow = await prisma.widget.findFirst({
    where: { slug, workspaceId, userId, kind: "USER", deleted: null },
    include: bundledInclude,
  });
  if (userRow) return rowToWidget(userRow);

  const defaultRow = await prisma.widget.findFirst({
    where: { slug, kind: "DEFAULT", deleted: null },
    include: bundledInclude,
  });
  return defaultRow ? rowToWidget(defaultRow) : null;
}

// ─── Declarative writes ─────────────────────────────────────────────────────

export interface CreateDeclarativeWidgetInput {
  spec: unknown; // Validated inside.
  workspaceId: string;
  userId: string;
  slugOverride?: string;
  sourceSlug?: string;
}

export type CreateWidgetResult =
  | { ok: true; widget: WidgetRow }
  | { ok: false; error: string; issues?: { path: string; message: string }[] };

export async function createDeclarativeWidget(
  input: CreateDeclarativeWidgetInput,
): Promise<CreateWidgetResult> {
  const result = validateWidget(input.spec);
  if (!result.ok) {
    return {
      ok: false,
      error: `Widget IR validation failed:\n${formatIssues(result.issues)}`,
      issues: result.issues,
    };
  }
  const widget = result.widget;
  const slug = input.slugOverride ?? widget.id;

  const existing = await prisma.widget.findUnique({
    where: {
      workspaceId_userId_slug: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        slug,
      },
    },
  });

  const state = existing?.state ?? null;

  const row = await prisma.widget.upsert({
    where: {
      workspaceId_userId_slug: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        slug,
      },
    },
    create: {
      slug,
      name: widget.title,
      description: widget.description ?? null,
      icon: widget.icon ?? null,
      kind: "USER",
      engine: "DECLARATIVE",
      spec: widget as unknown as Prisma.InputJsonValue,
      version: widget.version,
      state: state as Prisma.InputJsonValue | undefined,
      sourceSlug: input.sourceSlug ?? null,
      userId: input.userId,
      workspaceId: input.workspaceId,
    },
    update: {
      name: widget.title,
      description: widget.description ?? null,
      icon: widget.icon ?? null,
      engine: "DECLARATIVE",
      spec: widget as unknown as Prisma.InputJsonValue,
      version: widget.version,
      sourceSlug: input.sourceSlug ?? existing?.sourceSlug ?? null,
      // Clear bundled fields if a previous row was bundled with the same slug.
      integrationAccountId: null,
      bundledWidgetSlug: null,
      configValues: Prisma.JsonNull,
      deleted: null,
    },
    include: bundledInclude,
  });

  return { ok: true, widget: rowToWidget(row) };
}

// ─── Common writes ──────────────────────────────────────────────────────────

export async function deleteWidget(
  id: string,
  workspaceId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await prisma.widget.findFirst({
    where: { id, workspaceId, userId, kind: "USER", deleted: null },
  });
  if (!row) return { ok: false, error: "Widget not found or not user-owned" };

  await prisma.widget.update({
    where: { id },
    data: { deleted: new Date() },
  });
  return { ok: true };
}

export async function updateWidgetState(
  id: string,
  workspaceId: string,
  userId: string,
  state: Record<string, unknown>,
): Promise<void> {
  await prisma.widget.updateMany({
    where: { id, workspaceId, userId, kind: "USER", deleted: null },
    data: { state: state as Prisma.InputJsonValue },
  });
}

// ─── Lifecycle: integration install / uninstall ─────────────────────────────

/**
 * Seed BUNDLED Widget rows for every webapp-supported widget the integration
 * exposes, scoped to the (workspace, user) that just connected the account.
 *
 * Idempotent — calling this twice for the same account does not duplicate
 * rows; existing rows are left as-is so user-set configValues survive a
 * reconnect. Returns counts for logging.
 *
 * Removal is handled by the `Widget.integrationAccountId` foreign key with
 * ON DELETE CASCADE — when the IntegrationAccount row is hard-deleted (the
 * disconnect flow), its widgets are dropped automatically.
 */
export async function seedBundledWidgetsForAccount(
  accountId: string,
): Promise<{ created: number; skipped: number }> {
  const account = await prisma.integrationAccount.findUnique({
    where: { id: accountId },
    include: { integrationDefinition: true },
  });
  if (!account || account.deleted) {
    return { created: 0, skipped: 0 };
  }

  const def = account.integrationDefinition;
  const defSpec = (def.spec as Record<string, unknown> | null) ?? {};
  const widgets = (defSpec.widgets as Array<Record<string, unknown>>) ?? [];

  let created = 0;
  let skipped = 0;

  for (const widgetMeta of widgets) {
    const support = (widgetMeta.support as string[]) ?? [];
    if (!support.includes("webapp")) {
      // Skip TUI-only widgets — chat/dashboard rendering is webapp.
      continue;
    }

    const bundledSlug = widgetMeta.slug as string | undefined;
    if (!bundledSlug) continue;

    const slug = `${def.slug}-${bundledSlug}`;

    // Apply configSchema defaults (no required fields — user can edit later).
    const configSchema =
      (widgetMeta.configSchema as Array<Record<string, unknown>>) ?? [];
    const configDefaults: Record<string, string> = {};
    for (const field of configSchema) {
      if (typeof field.default === "string") {
        configDefaults[field.key as string] = field.default;
      }
    }

    // Upsert with empty update — atomic (single Postgres statement) so
    // concurrent installs don't race on the unique constraint. User-set
    // configValues survive a reconnect because we never overwrite them.
    try {
      const result = await prisma.widget.upsert({
        where: {
          workspaceId_userId_slug: {
            workspaceId: account.workspaceId,
            userId: account.integratedById,
            slug,
          },
        },
        create: {
          slug,
          name: (widgetMeta.name as string) ?? bundledSlug,
          description: (widgetMeta.description as string) ?? null,
          icon: def.icon,
          kind: "USER",
          engine: "BUNDLED",
          integrationAccountId: account.id,
          bundledWidgetSlug: bundledSlug,
          configValues: configDefaults as Prisma.InputJsonValue,
          userId: account.integratedById,
          workspaceId: account.workspaceId,
        },
        // Reconnect path: ensure the row points at the (possibly new) account
        // and is not soft-deleted. configValues left alone so user edits survive.
        update: {
          integrationAccountId: account.id,
          deleted: null,
        },
        select: { id: true, createdAt: true, updatedAt: true },
      });
      // createdAt === updatedAt on a fresh row; treat as created vs reused.
      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created++;
      } else {
        skipped++;
      }
    } catch {
      // Per-row failures (e.g. transient db error) shouldn't abort the
      // remaining widgets in the integration.
      skipped++;
    }
  }

  return { created, skipped };
}

// ─── Default widget lookup (read-only) ──────────────────────────────────────

export async function listDefaultWidgets(): Promise<WidgetRow[]> {
  const rows = await prisma.widget.findMany({
    where: { kind: "DEFAULT", deleted: null },
    include: bundledInclude,
    orderBy: { name: "asc" },
  });
  return rows.map(rowToWidget);
}

export async function getDefaultWidgetBySlug(
  slug: string,
): Promise<WidgetRow | null> {
  const row = await prisma.widget.findFirst({
    where: { slug, kind: "DEFAULT", deleted: null },
    include: bundledInclude,
  });
  return row ? rowToWidget(row) : null;
}

// ─── Backwards compat alias ─────────────────────────────────────────────────
// Code paths that called `createUserWidget` continue to work.
export const createUserWidget = createDeclarativeWidget;

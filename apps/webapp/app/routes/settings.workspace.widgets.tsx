/**
 * Widgets settings.
 *
 *   Top section    — installed widgets (USER), with delete.
 *   Bottom section — available templates (DEFAULT_WIDGETS catalog), with
 *                    [Install] button. Already-installed templates show
 *                    "Installed" instead of the install button.
 *
 * Templates are not persisted DB rows — they live in
 * `services/widgets/defaults.ts` as the in-memory catalog. Install copies
 * the IR into a USER row scoped to (workspaceId, userId).
 */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, useNavigation, useRevalidator } from "@remix-run/react";
import { Trash2 } from "lucide-react";

import { SettingSection } from "~/components/setting-section";
import { Button } from "~/components/ui";
import { requireUser } from "~/services/session.server";
import {
  deleteWidget,
  installTemplate,
  listTemplates,
  listWidgets,
} from "~/services/widgets/widget.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { workspaceId, id: userId } = await requireUser(request);
  if (!workspaceId || !userId) {
    throw new Error("Workspace not found");
  }

  const [widgets, templates] = await Promise.all([
    listWidgets(workspaceId, userId),
    listTemplates(workspaceId, userId),
  ]);

  return json({
    widgets: widgets.map((w) => ({
      id: w.id,
      slug: w.slug,
      name: w.name,
      description: w.description,
      icon: w.icon,
      engine: w.engine,
      sourceSlug: w.sourceSlug,
    })),
    templates,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { workspaceId, id: userId } = await requireUser(request);
  if (!workspaceId || !userId) {
    throw json({ error: "Workspace not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "install": {
      const slug = formData.get("slug") as string;
      if (!slug) return json({ error: "slug required" }, { status: 400 });
      const result = await installTemplate(slug, workspaceId, userId);
      if (!result.ok) {
        return json({ error: result.error }, { status: 400 });
      }
      return json({ success: true });
    }
    case "delete": {
      const widgetId = formData.get("widgetId") as string;
      if (!widgetId) return json({ error: "widgetId required" }, { status: 400 });
      const result = await deleteWidget(widgetId, workspaceId, userId);
      if (!result.ok) {
        return json({ error: result.error }, { status: 400 });
      }
      return json({ success: true });
    }
    default:
      return json({ error: "Invalid intent" }, { status: 400 });
  }
}

export default function WidgetsSettings() {
  const { widgets, templates } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  const installedWidgets = widgets;

  return (
    <div className="mx-auto flex w-auto flex-col gap-8 px-4 py-6 md:w-3xl">
      <SettingSection
        title="Your widgets"
        description="Widgets installed on this workspace. Embed them in chat with the slug, or pin to your daily dashboard."
      >
        {installedWidgets.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No widgets installed yet. Install one from the templates below, or
            ask the agent to build one for you.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {installedWidgets.map((w) => (
              <div
                key={w.id}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{w.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {w.slug}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        w.engine === "BUNDLED"
                          ? "bg-purple-500/10 text-purple-600"
                          : "bg-green-500/10 text-green-600"
                      }`}
                    >
                      {w.engine === "BUNDLED" ? "bundled" : "ir"}
                    </span>
                  </div>
                  {w.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {w.description}
                    </p>
                  )}
                </div>
                <Form
                  method="post"
                  onSubmit={(e) => {
                    if (
                      !window.confirm(
                        `Delete widget "${w.name}"? This can't be undone.`,
                      )
                    ) {
                      e.preventDefault();
                      return;
                    }
                    setTimeout(() => revalidator.revalidate(), 100);
                  }}
                >
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="widgetId" value={w.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`Delete ${w.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </Form>
              </div>
            ))}
          </div>
        )}
      </SettingSection>

      <SettingSection
        title="Available templates"
        description="Curated widgets you can install with one click. Each install creates your own copy that you can edit, configure, and delete independently."
      >
        <div className="divide-y divide-border rounded-lg border border-border">
          {templates.map((t) => (
            <div key={t.slug} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {t.slug}
                  </span>
                </div>
                {t.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t.description}
                  </p>
                )}
              </div>
              {t.installed ? (
                <span className="text-xs text-muted-foreground">Installed</span>
              ) : (
                <Form
                  method="post"
                  onSubmit={() => {
                    setTimeout(() => revalidator.revalidate(), 100);
                  }}
                >
                  <input type="hidden" name="intent" value="install" />
                  <input type="hidden" name="slug" value={t.slug} />
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                  >
                    Install
                  </Button>
                </Form>
              )}
            </div>
          ))}
        </div>
      </SettingSection>
    </div>
  );
}

import { json, type ActionFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/services/session.server";
import { prisma } from "~/db.server";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function action({ request }: ActionFunctionArgs) {
  await requireUser(request);

  const { name, slug: rawSlug, currentWorkspaceId } = await request.json();

  const slug = rawSlug ? slugify(rawSlug as string) : slugify((name as string) ?? "");

  if (!slug) {
    return json({ slug: "", available: false });
  }

  const existing = await prisma.workspace.findFirst({
    where: {
      slug,
      id: { not: currentWorkspaceId },
    },
    select: { id: true },
  });

  return json({ slug, available: !existing });
}

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

  const { name, currentWorkspaceId } = await request.json();

  if (!name || typeof name !== "string") {
    return json({ slug: "", available: false });
  }

  const slug = slugify(name);

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

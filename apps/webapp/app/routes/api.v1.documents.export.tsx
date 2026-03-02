import { zipSync, strToU8 } from "fflate";
import { prisma } from "~/db.server";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

export const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication }) => {
    if (!authentication.workspaceId) {
      return new Response(JSON.stringify({ error: "Workspace not found" }), {
        status: 404,
      });
    }

    const documents = await prisma.document.findMany({
      where: {
        workspaceId: authentication.workspaceId,
        deleted: null,
        type: { not: "skill" },
      },
      select: { title: true, content: true },
      orderBy: { createdAt: "desc" },
    });

    const files: Record<string, Uint8Array> = {};
    const titleCount: Record<string, number> = {};

    for (const doc of documents) {
      const base = (doc.title || "untitled")
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[/\\?%*:|"<>]/g, "");
      titleCount[base] = (titleCount[base] ?? 0) + 1;
      const count = titleCount[base];
      const filename = count > 1 ? `${base} (${count}).md` : `${base}.md`;
      files[filename] = strToU8(doc.content ?? "");
    }

    const zip = zipSync(files);

    return new Response(zip, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="documents.zip"`,
        "Content-Length": String(zip.byteLength),
      },
    });
  },
);

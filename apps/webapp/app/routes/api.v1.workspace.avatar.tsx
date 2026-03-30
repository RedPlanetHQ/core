import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Avatar from "boring-avatars";
import sharp from "sharp";
import { prisma } from "~/db.server";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

const SIZE = 64;

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
  },
  async ({ authentication, request }) => {
    if (!authentication.workspaceId) {
      return new Response("No workspace", { status: 404 });
    }

    const workspace = await prisma.workspace.findFirst({
      where: { id: authentication.workspaceId },
      select: { name: true, metadata: true },
    });

    if (!workspace) {
      return new Response("Not found", { status: 404 });
    }

    const meta = (workspace.metadata ?? {}) as Record<string, unknown>;
    const accentColor = (meta.accentColor as string) || "#c87844";

    const svg = renderToStaticMarkup(
      React.createElement(Avatar, {
        name: workspace.name,
        variant: "pixel",
        colors: ["var(--background-3)", accentColor],
        size: SIZE,
      }),
    );

    // Replace CSS var with a concrete light color for server-side rendering
    const svgFixed = svg.replace(/var\(--background-3\)/g, "#f0f0f0");

    const png = await sharp(Buffer.from(svgFixed)).png().toBuffer();

    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);

export { loader };

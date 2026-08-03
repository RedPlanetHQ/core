import { describe, expect, it } from "vitest";
import { AgentStatus } from "@core/database";
import { prisma } from "~/db.server";

describe("Agents model schema", () => {
  it("exposes AgentStatus enum", () => {
    expect(AgentStatus.Active).toBe("Active");
    expect(AgentStatus.Archived).toBe("Archived");
  });

  it("enforces (workspaceId, handle) uniqueness", async () => {
    const ws = await prisma.workspace.create({
      data: {
        name: "agent-schema-test",
        slug: `agent-schema-${Date.now()}`,
        version: "V3",
      },
    });
    try {
      await prisma.agents.create({
        data: {
          workspaceId: ws.id,
          handle: "generalist",
          displayName: "Generalist",
          basePrompt: "test",
          capabilities: ["generalist"],
          status: AgentStatus.Active,
        },
      });
      await expect(
        prisma.agents.create({
          data: {
            workspaceId: ws.id,
            handle: "generalist",
            displayName: "dupe",
            basePrompt: "x",
            capabilities: ["generalist"],
            status: AgentStatus.Active,
          },
        }),
      ).rejects.toThrow(/Unique constraint/);
    } finally {
      await prisma.agents.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.workspace.delete({ where: { id: ws.id } });
    }
  });

  it("enforces gatewayId uniqueness", async () => {
    const ws = await prisma.workspace.create({
      data: {
        name: "agent-gw-test",
        slug: `agent-gw-${Date.now()}`,
        version: "V3",
      },
    });
    const user = await prisma.user.create({
      data: {
        email: `agent-gw-${Date.now()}@test.dev`,
        authenticationMethod: "MAGIC_LINK",
      },
    });
    const gw = await prisma.gateway.create({
      data: {
        name: "gw-1",
        baseUrl: "https://x.example",
        encryptedSecurityKey: {},
        workspaceId: ws.id,
        userId: user.id,
      },
    });
    try {
      await prisma.agents.create({
        data: {
          workspaceId: ws.id,
          handle: "gw-1",
          displayName: "gw-1",
          basePrompt: "x",
          capabilities: ["coding"],
          gatewayId: gw.id,
          status: AgentStatus.Active,
        },
      });
      await expect(
        prisma.agents.create({
          data: {
            workspaceId: ws.id,
            handle: "gw-1-dupe",
            displayName: "dupe",
            basePrompt: "x",
            capabilities: ["coding"],
            gatewayId: gw.id,
            status: AgentStatus.Active,
          },
        }),
      ).rejects.toThrow(/Unique constraint/);
    } finally {
      await prisma.agents.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.gateway.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.workspace.delete({ where: { id: ws.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

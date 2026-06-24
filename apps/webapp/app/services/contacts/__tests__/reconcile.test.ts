import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), log: vi.fn() },
}));
vi.mock("~/db.server", () => ({
  prisma: { contact: { findUnique: vi.fn() } },
}));
vi.mock("~/lib/model.server", () => ({
  makeStructuredModelCall: vi.fn(),
}));
vi.mock("~/services/graphModels/entity", () => ({
  getPersonContactCandidates: vi.fn(),
}));
vi.mock("~/services/graphModels/episode", () => ({
  getEpisodesForEntity: vi.fn(),
}));
vi.mock("~/services/contacts/contact.server", () => ({
  upsertContactForEntity: vi.fn(),
  updateContactFields: vi.fn(),
}));
vi.mock("~/services/contacts/contact-summary.server", () => ({
  generateContactSummary: vi.fn(),
}));

import { isSelf, needsRefresh, syncContactForEntity } from "~/jobs/contacts/contact-sync.logic";

describe("isSelf", () => {
  it("matches the user's own name case-insensitively", () => {
    expect(isSelf("Manik Aggarwal", "manik aggarwal")).toBe(true);
    expect(isSelf("Manik Aggarwal", "Abhishek")).toBe(false);
  });
});

describe("needsRefresh", () => {
  it("returns true when never summarized", () => {
    expect(needsRefresh(null, new Date("2026-01-01"))).toBe(true);
  });
  it("returns true when new memory is newer than last summary", () => {
    expect(needsRefresh(new Date("2026-01-01"), new Date("2026-02-01"))).toBe(true);
  });
  it("returns false when no new memory since last summary", () => {
    expect(needsRefresh(new Date("2026-02-01"), new Date("2026-01-01"))).toBe(false);
  });
  it("returns false when there is no memory at all", () => {
    expect(needsRefresh(new Date("2026-02-01"), null)).toBe(false);
  });
});

describe("syncContactForEntity", () => {
  const baseContact = {
    id: "c1",
    workspaceId: "ws1",
    userId: "u1",
    entityUuid: "e1",
    name: "Abhishek",
    emails: [],
    phones: [],
    handles: [],
    company: null,
    role: null,
    location: null,
    category: null,
    headline: null,
    description: null,
    descriptionEdited: false,
    status: "Researching" as const,
    source: "Auto" as const,
    lastMemoryAt: null,
    lastSummarizedAt: null,
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    editedAt: null,
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("writes back category when the LLM extracts it from episodes", async () => {
    const { prisma } = await import("~/db.server");
    const { upsertContactForEntity, updateContactFields } = await import(
      "~/services/contacts/contact.server"
    );
    const { getEpisodesForEntity } = await import("~/services/graphModels/episode");
    const { generateContactSummary } = await import(
      "~/services/contacts/contact-summary.server"
    );

    vi.mocked(prisma.contact.findUnique).mockResolvedValue(null);
    vi.mocked(upsertContactForEntity).mockResolvedValue(baseContact as any);
    vi.mocked(getEpisodesForEntity).mockResolvedValue([
      {
        uuid: "ep1",
        content: "Abhishek is a close college friend from IIT KGP.",
        validAt: new Date("2026-01-01"),
      } as any,
    ]);
    vi.mocked(generateContactSummary).mockResolvedValue({
      headline: "ML Engineer; college friend",
      description: "### Relationship with User\nClose college friend.",
      extractedFields: {
        email: "abhishek@observe.ai",
        phone: "",
        linkedin: "",
        twitter: "",
        company: "Observe.ai",
        role: "ML Engineer",
        location: "Bangalore",
        category: "Friend",
      },
    });

    await syncContactForEntity({
      workspaceId: "ws1",
      userId: "u1",
      userName: "Manik",
      entityUuid: "e1",
      name: "Abhishek",
      latestFactAt: new Date("2026-01-01"),
    });

    expect(updateContactFields).toHaveBeenCalledWith(
      "ws1",
      "c1",
      expect.objectContaining({ category: "Friend" }),
    );
  });

  it("does not overwrite category when the LLM returns an empty string", async () => {
    const { prisma } = await import("~/db.server");
    const { upsertContactForEntity, updateContactFields } = await import(
      "~/services/contacts/contact.server"
    );
    const { getEpisodesForEntity } = await import("~/services/graphModels/episode");
    const { generateContactSummary } = await import(
      "~/services/contacts/contact-summary.server"
    );

    vi.mocked(prisma.contact.findUnique).mockResolvedValue(null);
    vi.mocked(upsertContactForEntity).mockResolvedValue(baseContact as any);
    vi.mocked(getEpisodesForEntity).mockResolvedValue([
      { uuid: "ep1", content: "Some episode content.", validAt: new Date("2026-01-01") } as any,
    ]);
    vi.mocked(generateContactSummary).mockResolvedValue({
      headline: "Unknown",
      description: "",
      extractedFields: {
        email: "",
        phone: "",
        linkedin: "",
        twitter: "",
        company: "",
        role: "",
        location: "",
        category: "",
      },
    });

    await syncContactForEntity({
      workspaceId: "ws1",
      userId: "u1",
      userName: "Manik",
      entityUuid: "e1",
      name: "Abhishek",
      latestFactAt: new Date("2026-01-01"),
    });

    const call = vi.mocked(updateContactFields).mock.calls[0][2] as Record<string, any>;
    expect(call).not.toHaveProperty("category");
  });
});

import { describe, expect, it, vi } from "vitest";

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

import { isSelf, needsRefresh } from "~/jobs/contacts/contact-sync.logic";

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

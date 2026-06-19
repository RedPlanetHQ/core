import { describe, expect, it, vi } from "vitest";

vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), log: vi.fn() },
}));
vi.mock("~/lib/model.server", () => ({
  makeStructuredModelCall: vi.fn(),
}));

import {
  ContactSummarySchema,
  buildSummaryMessages,
  renderDescription,
} from "../contact-summary.server";

describe("buildSummaryMessages", () => {
  it("includes the user name, person name, today's date and the facts", () => {
    const messages = buildSummaryMessages({
      userName: "Manik",
      personName: "Abhishek",
      today: new Date("2026-06-19T00:00:00Z"),
      contactFields: { emails: ["a@b.com"], phones: [], company: null, role: null, location: null, handles: [] },
      facts: [
        { fact: "Abhishek is a college friend", aspect: "Relationship", validAt: new Date("2026-01-01T00:00:00Z") },
      ],
      priorDescription: null,
      descriptionEdited: false,
    });
    const text = JSON.stringify(messages);
    expect(text).toContain("Manik");
    expect(text).toContain("Abhishek");
    expect(text).toContain("2026-06-19");
    expect(text).toContain("college friend");
  });

  it("marks prior description as authoritative when userEdited is true", () => {
    const messages = buildSummaryMessages({
      userName: "Manik",
      personName: "Abhishek",
      today: new Date("2026-06-19T00:00:00Z"),
      contactFields: { emails: [], phones: [], company: null, role: null, location: null, handles: [] },
      facts: [],
      priorDescription: "Founder of Morsebiz.",
      descriptionEdited: true,
    });
    const text = JSON.stringify(messages);
    expect(text).toContain("AUTHORITATIVE");
    expect(text).toContain("Founder of Morsebiz.");
  });
});

describe("renderDescription", () => {
  it("renders only the sections that have content, labeled", () => {
    const body = renderDescription({
      whoTheyAre: "ML engineer at Observe.ai",
      relationshipToYou: "Close college friend",
      recentAndOpen: "",
      cadenceChannel: "",
      communicationStyle: "",
      sharedGroups: "",
    });
    expect(body).toContain("Who they are: ML engineer at Observe.ai");
    expect(body).toContain("Relationship: Close college friend");
    expect(body).not.toContain("Recent");
    expect(body).not.toContain("Cadence");
  });
});

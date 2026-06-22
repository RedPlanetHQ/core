import { describe, expect, it, vi } from "vitest";

vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), log: vi.fn() },
}));
vi.mock("~/lib/model.server", () => ({
  makeStructuredModelCall: vi.fn(),
}));

import {
  buildSummaryMessages,
  renderDescription,
} from "../contact-summary.server";

describe("buildSummaryMessages", () => {
  it("includes the user name, person name, today's date and episode content", () => {
    const messages = buildSummaryMessages({
      userName: "Manik",
      personName: "Abhishek",
      today: new Date("2026-06-19T00:00:00Z"),
      episodes: [
        {
          content: "Abhishek is a college friend who works as an ML engineer.",
          validAt: new Date("2026-01-01T00:00:00Z"),
        },
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

  it("marks prior description as authoritative when descriptionEdited is true", () => {
    const messages = buildSummaryMessages({
      userName: "Manik",
      personName: "Abhishek",
      today: new Date("2026-06-19T00:00:00Z"),
      episodes: [],
      priorDescription: "Founder of Morsebiz.",
      descriptionEdited: true,
    });
    const text = JSON.stringify(messages);
    expect(text).toContain("AUTHORITATIVE");
    expect(text).toContain("Founder of Morsebiz.");
  });
});

describe("renderDescription", () => {
  it("renders Basic Info section with contact details", () => {
    const body = renderDescription({
      email: "abhishek@observe.ai",
      phone: "",
      linkedin: "linkedin.com/in/abhishek",
      twitter: "",
      company: "Observe.ai",
      role: "ML Engineer",
      location: "Bangalore",
      relationshipWithUser: "Close college friend",
      additionalInformation: "",
    });
    expect(body).toContain("### Basic Info");
    expect(body).toContain("- Email: abhishek@observe.ai");
    expect(body).toContain("- LinkedIn: linkedin.com/in/abhishek");
    expect(body).toContain("- Company: Observe.ai");
    expect(body).toContain("### Relationship with User");
    expect(body).toContain("Close college friend");
    expect(body).not.toContain("### Additional Information");
  });

  it("omits sections that have no content", () => {
    const body = renderDescription({
      email: "",
      phone: "",
      linkedin: "",
      twitter: "",
      company: "",
      role: "",
      location: "",
      relationshipWithUser: "",
      additionalInformation: "",
    });
    expect(body).toBe("");
  });
});

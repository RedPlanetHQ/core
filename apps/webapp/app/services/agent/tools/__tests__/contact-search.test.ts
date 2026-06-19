import { describe, expect, it } from "vitest";
import { formatContactsForAgent } from "~/services/agent/tools/contact-search";

describe("formatContactsForAgent", () => {
  it("returns a not-found message when empty", () => {
    expect(formatContactsForAgent([])).toContain("No matching contact");
  });

  it("renders name, headline, contact fields and description", () => {
    const out = formatContactsForAgent([
      {
        name: "Abhishek Niranjan",
        headline: "Close college friend; Lead ML Engineer",
        emails: ["a@b.com"],
        phones: [],
        company: "Observe.ai",
        role: "Lead ML Engineer",
        location: "Bangalore",
        description: "Who they are: ML engineer\nRelationship: College friend",
      } as any,
    ]);
    expect(out).toContain("Abhishek Niranjan");
    expect(out).toContain("Close college friend");
    expect(out).toContain("a@b.com");
    expect(out).toContain("College friend");
  });
});

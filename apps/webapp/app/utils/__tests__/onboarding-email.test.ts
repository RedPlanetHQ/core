import { describe, it, expect } from "vitest";
import {
  deriveEmailDomain,
  generateButlerEmailSlug,
  generateButlerEmail,
} from "../onboarding-email";

describe("deriveEmailDomain", () => {
  it("extracts hostname from https URL", () => {
    expect(deriveEmailDomain("https://app.getcore.me")).toBe("app.getcore.me");
  });

  it("extracts hostname from http URL with port", () => {
    expect(deriveEmailDomain("http://localhost:5173")).toBe("localhost");
  });

  it("extracts hostname ignoring path", () => {
    expect(deriveEmailDomain("https://app.getcore.me/some/path")).toBe(
      "app.getcore.me",
    );
  });

  it("falls back to raw string when URL is invalid", () => {
    expect(deriveEmailDomain("getcore.me")).toBe("getcore.me");
  });
});

describe("generateButlerEmailSlug", () => {
  it("combines butler name and user name with underscore", () => {
    expect(generateButlerEmailSlug("Alfred", "Manik Aggarwal")).toBe(
      "alfred_manikaggarwal",
    );
  });

  it("lowercases both parts", () => {
    expect(generateButlerEmailSlug("TARS", "MANIK")).toBe("tars_manik");
  });

  it("strips special characters from butler name", () => {
    expect(generateButlerEmailSlug("Jeeves!", "Manik")).toBe("jeeves_manik");
  });

  it("strips spaces from user name", () => {
    expect(generateButlerEmailSlug("Alfred", "Manik Aggarwal")).toBe(
      "alfred_manikaggarwal",
    );
  });

  it("returns just butler part when user name is empty", () => {
    expect(generateButlerEmailSlug("Alfred", "")).toBe("alfred");
  });

  it("returns just user part when butler name is empty", () => {
    expect(generateButlerEmailSlug("", "Manik")).toBe("manik");
  });
});

describe("generateButlerEmail", () => {
  it("produces full email address", () => {
    expect(
      generateButlerEmail("Alfred", "Manik Aggarwal", "app.getcore.me"),
    ).toBe("alfred_manikaggarwal@app.getcore.me");
  });

  it("uses localhost domain for local dev", () => {
    expect(generateButlerEmail("TARS", "Manik", "localhost")).toBe(
      "tars_manik@localhost",
    );
  });
});

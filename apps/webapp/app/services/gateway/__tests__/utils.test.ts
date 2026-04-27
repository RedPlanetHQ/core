import { describe, it, expect } from "vitest";
import { deriveCapabilityTags } from "../utils.server";

describe("deriveCapabilityTags", () => {
  it("returns empty array when no tools", () => {
    expect(deriveCapabilityTags([])).toEqual([]);
  });

  it("derives a single capability from one prefix family", () => {
    expect(deriveCapabilityTags(["browser_navigate", "browser_click"])).toEqual(
      ["browser"],
    );
  });

  it("derives multiple capabilities and sorts alphabetically", () => {
    expect(
      deriveCapabilityTags([
        "exec_run",
        "browser_navigate",
        "coding_ask",
        "files_edit",
      ]),
    ).toEqual(["browser", "coding", "exec", "files"]);
  });

  it("ignores unknown prefixes", () => {
    expect(deriveCapabilityTags(["sleep", "weird_tool", "browser_navigate"]))
      .toEqual(["browser"]);
  });

  it("deduplicates within a family", () => {
    expect(
      deriveCapabilityTags([
        "browser_navigate",
        "browser_click",
        "browser_screenshot",
      ]),
    ).toEqual(["browser"]);
  });
});

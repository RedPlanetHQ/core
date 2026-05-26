import { describe, it, expect } from "vitest";
import type { WorkflowsBlock } from "@redplanethq/gateway-protocol";
import {
  pickTrack,
  pickPhase,
  buildPrompt,
} from "../workflows";

const sample: WorkflowsBlock = {
  source: "preset:raw",
  perAgent: {
    "claude-code": {
      bug: {
        phases: [
          {
            name: "investigate",
            prompt: "investigate {title} desc:{description}",
            pollSeconds: 30,
            advanceOn: "user-approval",
          },
          {
            name: "implement",
            prompt: "implement now {answers}",
            pollSeconds: 30,
            advanceOn: "done",
          },
        ],
      },
      feature: {
        phases: [
          {
            name: "plan",
            prompt: "plan {title}",
            pollSeconds: 20,
            advanceOn: "user-approval",
          },
        ],
      },
      unresolved: [],
    },
  },
};

describe("pickTrack", () => {
  it("returns the named track for the agent", () => {
    expect(pickTrack(sample, "claude-code", "bug")?.phases).toHaveLength(2);
  });
  it("returns undefined for unknown agent", () => {
    expect(pickTrack(sample, "ghost", "feature")).toBeUndefined();
  });
});

describe("pickPhase", () => {
  it("returns the phase at the given index", () => {
    expect(pickPhase(sample, "claude-code", "bug", 0)?.name).toBe("investigate");
    expect(pickPhase(sample, "claude-code", "bug", 1)?.name).toBe("implement");
  });
  it("returns undefined past the end", () => {
    expect(pickPhase(sample, "claude-code", "bug", 5)).toBeUndefined();
  });
});

describe("buildPrompt", () => {
  it("interpolates title and description (with code-fence)", () => {
    const out = buildPrompt(sample, "claude-code", "bug", 0, {
      title: "T",
      description: "D",
    });
    expect(out).toBe("investigate T desc:```\nD\n```");
  });

  it("renders missing variables as empty", () => {
    const out = buildPrompt(sample, "claude-code", "bug", 1, {
      title: "T",
      description: "",
    });
    expect(out).toBe("implement now ");
  });
});

// apps/webapp/app/jobs/spaces/__tests__/persona-generation.logic.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock("~/db.server", () => ({
  prisma: {
    workspace: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("../persona-trigger.logic", () => ({
  checkPersonaUpdateThreshold: vi.fn(),
}));
vi.mock("../aspect-persona-generation", () => ({
  generateAspectBasedPersona: vi.fn(),
  ASPECT_SECTION_MAP: {
    Identity: { title: "IDENTITY", filterGuidance: "include identity" },
    Preference: { title: "PREFERENCES", filterGuidance: "include preferences" },
    Directive: { title: "DIRECTIVES", filterGuidance: "include directives" },
  },
}));
vi.mock("../persona-llm-placement", () => ({
  placeFactInPersona: vi.fn(),
}));
vi.mock("../utils", () => ({
  savePersonaDocument: vi.fn(),
}));
vi.mock("~/services/document.server", () => ({
  getPersonaDocumentRecordForUser: vi.fn(),
}));
vi.mock("~/services/graphModels/statement", () => ({
  getStatementsForEpisodeByAspects: vi.fn(),
  getInvalidatedStatementsForEpisode: vi.fn(),
}));
vi.mock("~/services/aspectStore.server", () => ({
  getVoiceAspectsForEpisode: vi.fn(),
  getInvalidatedVoiceAspectsForEpisode: vi.fn(),
}));

import { processPersonaGeneration } from "../persona-generation.logic";
import { checkPersonaUpdateThreshold } from "../persona-trigger.logic";
import { generateAspectBasedPersona } from "../aspect-persona-generation";
import { placeFactInPersona } from "../persona-llm-placement";
import { savePersonaDocument } from "../utils";
import { getPersonaDocumentRecordForUser } from "~/services/document.server";
import {
  getStatementsForEpisodeByAspects,
  getInvalidatedStatementsForEpisode,
} from "~/services/graphModels/statement";
import {
  getVoiceAspectsForEpisode,
  getInvalidatedVoiceAspectsForEpisode,
} from "~/services/aspectStore.server";

const noopAddToQueue = (async () => ({ id: "x" })) as any;

const mockThreshold = (mode: "full" | "incremental") =>
  (checkPersonaUpdateThreshold as any).mockResolvedValue({
    shouldGenerate: true,
    labelId: "label-1",
    mode,
  });

const mockExisting = (content: string) =>
  (getPersonaDocumentRecordForUser as any).mockResolvedValue({
    content,
    updatedAt: new Date(),
    generatedAt: new Date(),
  });

const mockEmptyFetches = () => {
  (getStatementsForEpisodeByAspects as any).mockResolvedValue([]);
  (getVoiceAspectsForEpisode as any).mockResolvedValue([]);
  (getInvalidatedStatementsForEpisode as any).mockResolvedValue([]);
  (getInvalidatedVoiceAspectsForEpisode as any).mockResolvedValue([]);
};

describe("processPersonaGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("first-time generation: no existing doc → calls generateAspectBasedPersona and saves", async () => {
    mockThreshold("full");
    (getPersonaDocumentRecordForUser as any).mockResolvedValue(null);
    (generateAspectBasedPersona as any).mockResolvedValue(
      "# PERSONA\n\n## IDENTITY\n",
    );

    await processPersonaGeneration(
      { userId: "u1", workspaceId: "w1" },
      noopAddToQueue,
    );

    expect(generateAspectBasedPersona).toHaveBeenCalledWith("u1");
    expect(savePersonaDocument).toHaveBeenCalled();
  });

  it("full mode + existing doc → skips (forbidden by invariant)", async () => {
    mockThreshold("full");
    mockExisting("# PERSONA\n");

    const result = await processPersonaGeneration(
      { userId: "u1", workspaceId: "w1" },
      noopAddToQueue,
    );

    expect(result.success).toBe(false);
    expect(generateAspectBasedPersona).not.toHaveBeenCalled();
    expect(savePersonaDocument).not.toHaveBeenCalled();
  });

  it("incremental + valid fact → places it and saves", async () => {
    mockThreshold("incremental");
    mockExisting("## IDENTITY\n\n- Role: Engineer\n");
    mockEmptyFetches();
    (getStatementsForEpisodeByAspects as any).mockResolvedValue([
      { aspect: "Identity", fact: "Role: Tech Lead at Acme" },
    ]);
    (placeFactInPersona as any).mockResolvedValue({
      decision: "add_to_loose_facts",
      bullet: "Role: Tech Lead at Acme",
    });

    await processPersonaGeneration(
      { userId: "u1", workspaceId: "w1", episodeUuid: "ep-1" },
      noopAddToQueue,
    );

    expect(placeFactInPersona).toHaveBeenCalledTimes(1);
    const savedContent = (savePersonaDocument as any).mock.calls[0][2];
    expect(savedContent).toContain("- Role: Tech Lead at Acme");
  });

  it("incremental + invalidated fact → appends tombstone (no LLM)", async () => {
    mockThreshold("incremental");
    mockExisting("## PREFERENCES\n\n- existing\n");
    mockEmptyFetches();
    (getInvalidatedVoiceAspectsForEpisode as any).mockResolvedValue([
      { aspect: "Preference", fact: "Uses pnpm" },
    ]);

    await processPersonaGeneration(
      { userId: "u1", workspaceId: "w1", episodeUuid: "ep-1" },
      noopAddToQueue,
    );

    expect(placeFactInPersona).not.toHaveBeenCalled();
    const saved = (savePersonaDocument as any).mock.calls[0][2];
    expect(saved).toContain("⚠ Possibly outdated: Uses pnpm");
  });

  it("incremental + tombstone-then-place ordering: single saved doc has both", async () => {
    mockThreshold("incremental");
    mockExisting("## PREFERENCES\n\n- existing\n");
    mockEmptyFetches();
    (getInvalidatedVoiceAspectsForEpisode as any).mockResolvedValue([
      { aspect: "Preference", fact: "Uses pnpm" },
    ]);
    (getVoiceAspectsForEpisode as any).mockResolvedValue([
      { aspect: "Preference", fact: "Uses bun" },
    ]);
    (placeFactInPersona as any).mockResolvedValue({
      decision: "add_to_loose_facts",
      bullet: "Uses bun",
    });

    await processPersonaGeneration(
      { userId: "u1", workspaceId: "w1", episodeUuid: "ep-1" },
      noopAddToQueue,
    );

    // Exactly one save call carrying both changes.
    expect(savePersonaDocument).toHaveBeenCalledTimes(1);
    const saved = (savePersonaDocument as any).mock.calls[0][2];
    expect(saved).toContain("⚠ Possibly outdated: Uses pnpm");
    expect(saved).toContain("- Uses bun");
  });

  it("incremental + empty episode (no valid, no invalidated) → no save", async () => {
    mockThreshold("incremental");
    mockExisting("## IDENTITY\n\n- Role: Engineer\n");
    mockEmptyFetches();

    await processPersonaGeneration(
      { userId: "u1", workspaceId: "w1", episodeUuid: "ep-1" },
      noopAddToQueue,
    );

    expect(placeFactInPersona).not.toHaveBeenCalled();
    expect(savePersonaDocument).not.toHaveBeenCalled();
  });
});

/**
 * Plan-aware model tiering.
 *
 * Free workspaces (when billing is enabled) must be forced to the "low"
 * complexity tier for every use case, unless they set an explicit per-use-case
 * model override. Paid plans (PRO/MAX), self-hosted (billing disabled), and
 * calls without a workspace keep the requested complexity.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  billingEnabled: true,
}));

const prismaMocks = vi.hoisted(() => ({
  workspace: { findUnique: vi.fn() },
  lLMProvider: { findFirst: vi.fn() },
  lLMModel: { findFirst: vi.fn() },
}));

vi.mock("~/db.server", () => ({ prisma: prismaMocks }));

vi.mock("~/env.server", () => ({
  env: { MODEL: "env-default-model", CHAT_PROVIDER: "openai" },
}));

vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("~/config/billing.server", () => ({
  isBillingEnabled: () => state.billingEnabled,
  isPaidPlan: (planType: string) => planType === "PRO" || planType === "MAX",
}));

// Pulls in @core/types (unresolvable under vitest) and is irrelevant here.
vi.mock("~/services/byok.server", () => ({
  resolveWorkspaceApiKey: vi.fn(),
  resolveWorkspaceProviderBaseUrl: vi.fn(),
}));

import {
  getModelForUseCase,
  resolveDefaultChatModelId,
} from "~/services/llm-provider.server";

// A provider exists, and the DB returns a model whose id encodes the complexity
// that was queried — so the resolved id reveals which tier actually won.
function wireProviderWithTieredModels() {
  prismaMocks.lLMProvider.findFirst.mockResolvedValue({ id: "prov-1" });
  prismaMocks.lLMModel.findFirst.mockImplementation(async (args: any) => ({
    modelId: `${args.where.complexity}-model`,
  }));
}

function mockWorkspace(opts: {
  planType?: string | null;
  modelConfig?: Record<string, unknown>;
}) {
  prismaMocks.workspace.findUnique.mockResolvedValue({
    metadata: opts.modelConfig ? { modelConfig: opts.modelConfig } : {},
    Subscription: opts.planType ? { planType: opts.planType } : null,
  });
}

beforeEach(() => {
  state.billingEnabled = true;
  vi.clearAllMocks();
  wireProviderWithTieredModels();
});

describe("getModelForUseCase — free-plan cap", () => {
  it("forces a FREE workspace from high to the low tier", async () => {
    mockWorkspace({ planType: "FREE" });
    const model = await getModelForUseCase("chat", "ws-1", "high");
    expect(model).toBe("low-model");
  });

  it("treats a workspace with no subscription as FREE", async () => {
    mockWorkspace({ planType: null });
    const model = await getModelForUseCase("memory", "ws-1", "medium");
    expect(model).toBe("low-model");
  });

  it("keeps the requested tier for a PRO workspace", async () => {
    mockWorkspace({ planType: "PRO" });
    const model = await getModelForUseCase("chat", "ws-1", "high");
    expect(model).toBe("high-model");
  });

  it("keeps the requested tier for a MAX workspace", async () => {
    mockWorkspace({ planType: "MAX" });
    const model = await getModelForUseCase("chat", "ws-1", "high");
    expect(model).toBe("high-model");
  });

  it("does not downgrade when billing is disabled (self-hosted)", async () => {
    state.billingEnabled = false;
    mockWorkspace({ planType: "FREE" });
    const model = await getModelForUseCase("chat", "ws-1", "high");
    expect(model).toBe("high-model");
  });

  it("does not downgrade when there is no workspace", async () => {
    const model = await getModelForUseCase("chat", null, "high");
    expect(model).toBe("high-model");
    expect(prismaMocks.workspace.findUnique).not.toHaveBeenCalled();
  });
});

// Workspace override lives at modelConfig.{low,medium,high} — a flat tier
// map, independent of useCase. Every internal call (chat, memory, search, …)
// resolves through the same three slots.
describe("getModelForUseCase — workspace tier override", () => {
  it("honors modelConfig.medium for a chat call", async () => {
    mockWorkspace({
      planType: "PRO",
      modelConfig: { medium: "openai/claude-sonnet-4-6" },
    });
    const model = await getModelForUseCase("chat", "ws-1", "medium");
    expect(model).toBe("openai/claude-sonnet-4-6");
    expect(prismaMocks.lLMModel.findFirst).not.toHaveBeenCalled();
  });

  it("honors modelConfig.medium for a memory call", async () => {
    mockWorkspace({
      planType: "PRO",
      modelConfig: { medium: "openai/claude-sonnet-4-6" },
    });
    const model = await getModelForUseCase("memory", "ws-1", "medium");
    expect(model).toBe("openai/claude-sonnet-4-6");
  });

  it("picks the requested complexity slot when set", async () => {
    mockWorkspace({
      planType: "PRO",
      modelConfig: {
        medium: "openai/claude-sonnet-4-6",
        high: "openai/claude-opus-4-7",
      },
    });
    const model = await getModelForUseCase("chat", "ws-1", "high");
    expect(model).toBe("openai/claude-opus-4-7");
  });

  it("falls back to medium when the requested complexity is empty", async () => {
    mockWorkspace({
      planType: "PRO",
      modelConfig: { medium: "openai/claude-sonnet-4-6" },
    });
    const model = await getModelForUseCase("chat", "ws-1", "high");
    expect(model).toBe("openai/claude-sonnet-4-6");
  });

  it("bypasses the FREE-plan cap for a FREE workspace", async () => {
    mockWorkspace({
      planType: "FREE",
      modelConfig: { medium: "openai/claude-sonnet-4-6" },
    });
    const model = await getModelForUseCase("chat", "ws-1", "high");
    expect(model).toBe("openai/claude-sonnet-4-6");
    expect(prismaMocks.lLMModel.findFirst).not.toHaveBeenCalled();
  });
});

describe("resolveDefaultChatModelId", () => {
  it("returns a low-tier model for a FREE workspace", async () => {
    mockWorkspace({ planType: "FREE" });
    const model = await resolveDefaultChatModelId("ws-1");
    expect(model).toBe("low-model");
  });

  it("returns the FREE workspace's explicit low override when set", async () => {
    mockWorkspace({
      planType: "FREE",
      modelConfig: { low: "override-model" },
    });
    const model = await resolveDefaultChatModelId("ws-1");
    expect(model).toBe("override-model");
  });

  it("returns env.MODEL for a PRO workspace", async () => {
    mockWorkspace({ planType: "PRO" });
    const model = await resolveDefaultChatModelId("ws-1");
    expect(model).toBe("env-default-model");
  });

  it("returns env.MODEL when billing is disabled", async () => {
    state.billingEnabled = false;
    mockWorkspace({ planType: "FREE" });
    const model = await resolveDefaultChatModelId("ws-1");
    expect(model).toBe("env-default-model");
  });

  it("returns env.MODEL when there is no workspace", async () => {
    const model = await resolveDefaultChatModelId(undefined);
    expect(model).toBe("env-default-model");
    expect(prismaMocks.workspace.findUnique).not.toHaveBeenCalled();
  });
});

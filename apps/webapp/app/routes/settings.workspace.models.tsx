import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { Prisma } from "@prisma/client";
import { requireUser } from "~/services/session.server";
import { prisma } from "~/db.server";
import { SettingSection } from "~/components/setting-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import {
  getChatModels,
  persistCustomWorkspaceModel,
  pruneOrphanWorkspaceModels,
} from "~/services/llm-provider.server";
import {
  getWorkspaceKeyStatus,
  setWorkspaceApiKey,
  deleteWorkspaceApiKey,
  isSupportedProvider,
  type SupportedProvider,
} from "~/services/byok.server";
import {
  PROVIDER_SPECS,
  BYOK_PROVIDERS as ALL_BYOK_PROVIDERS,
} from "@core/types";

// ---------------------------------------------------------------------------
// Model tiers
// ---------------------------------------------------------------------------
//
// Three complexity slots at the workspace level:
//   medium (Default), low, high
//
// Every internal call already declares its `complexity` — the resolver in
// llm-provider.server.ts::getModelForUseCase picks the matching slot,
// falling back to `medium` when empty, then to the server default.

type ComplexityTier = "low" | "medium" | "high";
const TIER_KEYS: ComplexityTier[] = ["low", "medium", "high"];

const TIERS: { key: ComplexityTier; label: string; hint: string }[] = [
  {
    key: "medium",
    label: "Default",
    hint: "used for chat turns, memory ingestion, and most background work",
  },
  {
    key: "low",
    label: "Low complexity",
    hint: "cheap / fast — titles, query rewriting, reranking. Empty = uses Default.",
  },
  {
    key: "high",
    label: "High complexity",
    hint: "best-quality — reasoning-heavy paths. Empty = uses Default.",
  },
];

function readTierSlot(
  modelConfig: Record<string, unknown> | undefined,
  complexity: ComplexityTier,
): string {
  const value = modelConfig?.[complexity];
  return typeof value === "string" ? value : "";
}

// ---------------------------------------------------------------------------
// Provider forms — used by the API keys section. Derived from the canonical
// catalog so adding a provider in @core/types propagates here.
// ---------------------------------------------------------------------------

type FormKind = "key-only" | "url-only" | "dual";

type ProviderForm = {
  type: SupportedProvider;
  label: string;
  hint?: string;
  formKind: FormKind;
  apiKeyPlaceholder: string;
  baseUrlPlaceholder: string;
  baseUrlRequired: boolean;
};

const PROVIDER_FORMS: Record<string, ProviderForm> = Object.fromEntries(
  Object.values(PROVIDER_SPECS)
    .filter((s) => s.byokSupported)
    .map((s): [string, ProviderForm] => {
      const hasKey = s.apiKeyVar !== null;
      const hasUrl = !!s.baseUrl;
      const formKind: FormKind =
        hasKey && hasUrl ? "dual" : hasUrl ? "url-only" : "key-only";
      return [
        s.id,
        {
          type: s.id as SupportedProvider,
          label: s.label,
          hint: s.modelHint ?? s.baseUrl?.hint,
          formKind,
          apiKeyPlaceholder: s.apiKeyPlaceholder,
          baseUrlPlaceholder: s.baseUrl?.placeholder ?? "",
          baseUrlRequired: s.baseUrl?.required ?? false,
        },
      ];
    }),
);

const ALL_PROVIDER_TYPES = ALL_BYOK_PROVIDERS as unknown as SupportedProvider[];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  if (!user.workspaceId) throw new Error("Workspace not found");

  const workspace = await prisma.workspace.findUnique({
    where: { id: user.workspaceId },
    select: { metadata: true },
  });

  const modelConfig = ((workspace?.metadata as any)?.modelConfig ?? {}) as
    | Record<string, unknown>
    | undefined;

  const [models, keyStatus] = await Promise.all([
    getChatModels(user.workspaceId),
    getWorkspaceKeyStatus(user.workspaceId),
  ]);

  // Also fetch stored baseUrls for providers that carry one, so the UI can
  // render "https://…/v1" alongside the "Key set" badge without a second RTT.
  const providerBaseUrls = await prisma.lLMProvider.findMany({
    where: { workspaceId: user.workspaceId, isActive: true },
    select: { type: true, config: true },
  });
  const baseUrlByProvider: Record<string, string | null> = {};
  for (const p of providerBaseUrls) {
    const cfg = p.config as Record<string, unknown> | null;
    baseUrlByProvider[p.type] =
      cfg && typeof cfg.baseUrl === "string" ? cfg.baseUrl : null;
  }

  return json({ modelConfig, models, keyStatus, baseUrlByProvider });
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const user = await requireUser(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  if (!user.workspaceId) {
    return json({ error: "Workspace not found" }, { status: 404 });
  }

  if (intent === "updateModel") {
    const complexity = (formData.get("complexity") as string) || "medium";
    const modelId = formData.get("modelId") as string;
    if (!TIER_KEYS.includes(complexity as ComplexityTier)) {
      return json({ error: "Invalid complexity" }, { status: 400 });
    }
    if (!modelId) return json({ error: "Missing modelId" }, { status: 400 });

    const workspace = await prisma.workspace.findUnique({
      where: { id: user.workspaceId },
      select: { metadata: true },
    });
    const metadata = (workspace?.metadata as Record<string, unknown>) ?? {};
    const currentConfig = (metadata.modelConfig ?? {}) as Record<string, unknown>;

    const nextConfig: Record<string, string> = {};
    for (const k of TIER_KEYS) {
      if (typeof currentConfig[k] === "string") nextConfig[k] = currentConfig[k] as string;
    }
    nextConfig[complexity] = modelId;

    await prisma.workspace.update({
      where: { id: user.workspaceId },
      data: {
        metadata: {
          ...metadata,
          modelConfig: nextConfig,
        } as Prisma.InputJsonValue,
      },
    });

    await persistCustomWorkspaceModel(user.workspaceId, modelId);
    await pruneOrphanWorkspaceModels(user.workspaceId);

    return json({ success: true });
  }

  if (intent === "resetModel") {
    const complexity = formData.get("complexity") as string | null;
    const workspace = await prisma.workspace.findUnique({
      where: { id: user.workspaceId },
      select: { metadata: true },
    });
    const metadata = (workspace?.metadata as Record<string, unknown>) ?? {};
    const currentConfig = (metadata.modelConfig ?? {}) as Record<string, unknown>;

    let nextConfig: Record<string, string> = {};
    if (complexity && TIER_KEYS.includes(complexity as ComplexityTier)) {
      for (const k of TIER_KEYS) {
        if (k !== complexity && typeof currentConfig[k] === "string") {
          nextConfig[k] = currentConfig[k] as string;
        }
      }
    }

    await prisma.workspace.update({
      where: { id: user.workspaceId },
      data: {
        metadata: {
          ...metadata,
          modelConfig: nextConfig,
        } as Prisma.InputJsonValue,
      },
    });

    await pruneOrphanWorkspaceModels(user.workspaceId);
    return json({ success: true });
  }

  if (intent === "setKey") {
    const providerType = formData.get("providerType") as string;
    const apiKey = (formData.get("apiKey") as string)?.trim();
    const baseUrl = (formData.get("baseUrl") as string)?.trim() || undefined;
    if (!isSupportedProvider(providerType))
      return json({ error: "Unsupported provider" }, { status: 400 });
    if (!apiKey) return json({ error: "API key is required" }, { status: 400 });

    await setWorkspaceApiKey(user.workspaceId, providerType, apiKey, baseUrl);
    return json({ success: true });
  }

  if (intent === "deleteKey") {
    const providerType = formData.get("providerType") as string;
    if (!isSupportedProvider(providerType))
      return json({ error: "Unsupported provider" }, { status: 400 });
    await deleteWorkspaceApiKey(user.workspaceId, providerType);
    return json({ success: true });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
};

// ---------------------------------------------------------------------------
// Model tier picker (used 3× — Default / Low / High)
// ---------------------------------------------------------------------------

const CUSTOM_VALUE = "__custom__";
const DEFAULT_VALUE = "__default__";

function TierPicker({
  complexity,
  slotLabel,
  slotHint,
  currentModelId,
  modelsByProvider,
  onSelect,
}: {
  complexity: ComplexityTier;
  slotLabel: string;
  slotHint?: string;
  currentModelId: string;
  modelsByProvider: Record<
    string,
    { id: string; modelId: string; label: string | null }[]
  >;
  onSelect: (complexity: ComplexityTier, modelId: string) => void;
}) {
  const isCustom =
    currentModelId !== "" &&
    !Object.values(modelsByProvider)
      .flat()
      .some((m) => m.modelId === currentModelId);
  const [customValue, setCustomValue] = useState(
    isCustom ? currentModelId : "",
  );
  const [showCustom, setShowCustom] = useState(isCustom);

  // Sync local state when the parent-provided value changes (e.g. after save →
  // loader refetch). Without this the custom input stays showing the previous
  // value even after a successful update.
  useEffect(() => {
    setShowCustom(isCustom);
    if (isCustom && currentModelId !== customValue) setCustomValue(currentModelId);
    if (!isCustom) setCustomValue("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentModelId, isCustom]);

  const handleSelect = (value: string) => {
    if (value === CUSTOM_VALUE) {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    onSelect(complexity, value === DEFAULT_VALUE ? "" : value);
  };

  const placeholderText =
    complexity === "medium" ? "Use server default" : "Use Default";

  return (
    <div className="flex flex-col gap-1">
      <div className="text-sm font-medium">
        {slotLabel}
        {slotHint && (
          <span className="text-muted-foreground ml-2 text-xs font-normal">
            {slotHint}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={showCustom ? CUSTOM_VALUE : currentModelId}
          onValueChange={handleSelect}
        >
          <SelectTrigger className="w-80">
            <SelectValue placeholder={placeholderText} />
          </SelectTrigger>
          <SelectContent className="shadow-lg">
            <SelectItem value={DEFAULT_VALUE}>{placeholderText}</SelectItem>
            {Object.entries(modelsByProvider).map(
              ([provider, providerModels]) => (
                <div key={provider}>
                  <div className="text-muted-foreground px-2 py-1.5 text-xs font-semibold uppercase">
                    {provider}
                  </div>
                  {providerModels.map((model) => (
                    <SelectItem key={model.id} value={model.modelId}>
                      {model.label ?? model.modelId}
                    </SelectItem>
                  ))}
                </div>
              ),
            )}
            <div className="text-muted-foreground px-2 py-1.5 text-xs font-semibold uppercase">
              Custom
            </div>
            <SelectItem value={CUSTOM_VALUE}>Enter model ID…</SelectItem>
          </SelectContent>
        </Select>

        {showCustom && (
          <>
            <Input
              className="h-9 w-64 font-mono text-sm"
              placeholder="openai/claude-sonnet-4-6"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customValue.trim()) {
                  onSelect(complexity, customValue.trim());
                }
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (customValue.trim()) onSelect(complexity, customValue.trim());
              }}
              disabled={!customValue.trim()}
            >
              Set
            </Button>
          </>
        )}
      </div>
      {showCustom && (
        <p className="text-muted-foreground mt-1 text-xs">
          e.g. <code>openai/claude-sonnet-4-6</code> to route via a workspace
          OpenAI-compat proxy · <code>openrouter/provider/model</code> for
          OpenRouter · <code>azure/&lt;deployment&gt;</code> for Azure
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// API key rows
// ---------------------------------------------------------------------------

function ConfiguredKeyRow({
  provider,
  baseUrl,
}: {
  provider: ProviderForm;
  baseUrl: string | null;
}) {
  const fetcher = useFetcher();
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [urlInput, setUrlInput] = useState(baseUrl ?? "");
  const isSubmitting = fetcher.state !== "idle";

  const showUrl = provider.formKind !== "key-only";
  const canSave =
    apiKey.trim().length > 0 &&
    (!provider.baseUrlRequired || urlInput.trim().length > 0);

  const handleSave = () => {
    if (!canSave) return;
    fetcher.submit(
      {
        intent: "setKey",
        providerType: provider.type,
        apiKey,
        ...(showUrl && urlInput.trim() && { baseUrl: urlInput.trim() }),
      },
      { method: "POST" },
    );
    setApiKey("");
    setEditing(false);
  };

  const handleDelete = () => {
    fetcher.submit(
      { intent: "deleteKey", providerType: provider.type },
      { method: "POST" },
    );
  };

  return (
    <div className="bg-background-3 flex flex-col gap-2 rounded-lg p-3 px-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{provider.label}</span>
            <Badge variant="secondary" className="text-xs">
              Key set
            </Badge>
          </div>
          {showUrl && baseUrl && !editing && (
            <p className="text-muted-foreground truncate font-mono text-xs">
              {baseUrl}
            </p>
          )}
          {provider.hint && !editing && (
            <p className="text-muted-foreground text-xs">{provider.hint}</p>
          )}
        </div>

        {!editing ? (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setEditing(true)}
            >
              Replace
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="text-destructive h-7"
              onClick={handleDelete}
              disabled={isSubmitting}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-1.5">
            {showUrl && (
              <Input
                className="h-7 w-72 font-mono text-xs"
                placeholder={
                  provider.baseUrlRequired
                    ? provider.baseUrlPlaceholder
                    : `${provider.baseUrlPlaceholder} (optional)`
                }
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
              />
            )}
            {provider.formKind !== "url-only" && (
              <Input
                className="h-7 w-72 font-mono text-xs"
                placeholder={provider.apiKeyPlaceholder || "API key"}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            )}
            {provider.formKind === "url-only" && (
              <Input
                className="h-7 w-72 font-mono text-xs"
                placeholder={provider.baseUrlPlaceholder}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            )}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-7 text-xs"
                onClick={handleSave}
                disabled={!canSave || isSubmitting}
              >
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setEditing(false);
                  setApiKey("");
                  setUrlInput(baseUrl ?? "");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddKeyRow({
  availableProviders,
  onDone,
}: {
  availableProviders: ProviderForm[];
  onDone: () => void;
}) {
  const fetcher = useFetcher();
  const [selectedType, setSelectedType] = useState<string>("");
  const [apiKey, setApiKey] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const isSubmitting = fetcher.state !== "idle";

  const provider = selectedType ? PROVIDER_FORMS[selectedType] : null;
  const showUrl = provider?.formKind !== "key-only";
  const canSave = provider
    ? provider.formKind === "url-only"
      ? apiKey.trim().length > 0 // for ollama the URL field is captured in apiKey
      : apiKey.trim().length > 0 &&
        (!provider.baseUrlRequired || urlInput.trim().length > 0)
    : false;

  // Reset when fetcher completes.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && (fetcher.data as any).success) {
      setSelectedType("");
      setApiKey("");
      setUrlInput("");
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const handleSave = () => {
    if (!provider || !canSave) return;
    if (provider.formKind === "url-only") {
      // For ollama the "apiKey" field is actually the base URL (matches the
      // existing byok.server.ts convention for URL-only providers).
      fetcher.submit(
        {
          intent: "setKey",
          providerType: provider.type,
          apiKey: apiKey.trim(),
        },
        { method: "POST" },
      );
    } else {
      fetcher.submit(
        {
          intent: "setKey",
          providerType: provider.type,
          apiKey: apiKey.trim(),
          ...(urlInput.trim() && { baseUrl: urlInput.trim() }),
        },
        { method: "POST" },
      );
    }
  };

  return (
    <div className="bg-background-3 flex flex-col gap-3 rounded-lg p-3 px-4">
      <div className="flex items-center gap-2">
        <Select value={selectedType} onValueChange={setSelectedType}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Choose a provider…" />
          </SelectTrigger>
          <SelectContent className="shadow-lg">
            {availableProviders.map((p) => (
              <SelectItem key={p.type} value={p.type}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-8 text-xs"
          onClick={onDone}
        >
          Cancel
        </Button>
      </div>

      {provider && (
        <div className="flex flex-col gap-1.5">
          {provider.hint && (
            <p className="text-muted-foreground text-xs">{provider.hint}</p>
          )}
          {showUrl && (
            <Input
              className="h-8 w-full max-w-md font-mono text-xs"
              placeholder={
                provider.baseUrlRequired
                  ? provider.baseUrlPlaceholder
                  : `${provider.baseUrlPlaceholder} (optional)`
              }
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
            />
          )}
          <Input
            className="h-8 w-full max-w-md font-mono text-xs"
            placeholder={
              provider.formKind === "url-only"
                ? provider.baseUrlPlaceholder
                : provider.apiKeyPlaceholder || "API key"
            }
            type={provider.formKind === "url-only" ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <div>
            <Button
              variant="secondary"
              size="sm"
              className="h-8 text-xs"
              onClick={handleSave}
              disabled={!canSave || isSubmitting}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function ModelsSettings() {
  const { modelConfig, models, keyStatus, baseUrlByProvider } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [addingKey, setAddingKey] = useState(false);

  const pendingIntent = fetcher.formData?.get("intent");
  const pendingUpdate =
    pendingIntent === "updateModel" || pendingIntent === "resetModel"
      ? {
          complexity:
            (fetcher.formData!.get("complexity") as ComplexityTier) ?? "medium",
          modelId:
            pendingIntent === "updateModel"
              ? (fetcher.formData!.get("modelId") as string)
              : "",
        }
      : null;

  const getCurrentModelId = (complexity: ComplexityTier) => {
    if (pendingUpdate?.complexity === complexity) return pendingUpdate.modelId;
    return readTierSlot(modelConfig, complexity);
  };

  const handleModelChange = (complexity: ComplexityTier, modelId: string) => {
    if (modelId === "") {
      fetcher.submit(
        { intent: "resetModel", complexity },
        { method: "POST" },
      );
      return;
    }
    fetcher.submit(
      { intent: "updateModel", complexity, modelId },
      { method: "POST" },
    );
  };

  const modelsByProvider = useMemo(() => {
    return models.reduce(
      (acc, model) => {
        const providerLabel = model.provider.name ?? model.provider.type;
        if (!acc[providerLabel]) acc[providerLabel] = [];
        acc[providerLabel].push({
          id: model.id,
          modelId: model.modelId,
          label: model.label,
        });
        return acc;
      },
      {} as Record<
        string,
        { id: string; modelId: string; label: string | null }[]
      >,
    );
  }, [models]);

  const configuredProviderTypes = useMemo(
    () => new Set(keyStatus.map((k) => k.providerType)),
    [keyStatus],
  );

  const configuredProviders = useMemo(
    () =>
      keyStatus
        .map((k) => PROVIDER_FORMS[k.providerType])
        .filter((p): p is ProviderForm => !!p),
    [keyStatus],
  );

  const availableToAdd = useMemo(
    () =>
      ALL_PROVIDER_TYPES.map((t) => PROVIDER_FORMS[t]).filter(
        (p): p is ProviderForm => !!p && !configuredProviderTypes.has(p.type),
      ),
    [configuredProviderTypes],
  );

  return (
    <div className="md:w-3xl mx-auto flex w-auto flex-col gap-4 px-4 py-6">
      <SettingSection
        title="Models"
        description="Pick a model per complexity tier. Every internal call chooses the tier it needs — Low and High fall back to Default when empty; Default falls back to the server default."
      >
        <div className="flex flex-col gap-6">
          {TIERS.map(({ key, label, hint }) => (
            <TierPicker
              key={key}
              complexity={key}
              slotLabel={label}
              slotHint={hint}
              currentModelId={getCurrentModelId(key)}
              modelsByProvider={modelsByProvider}
              onSelect={handleModelChange}
            />
          ))}
        </div>
      </SettingSection>

      <SettingSection
        title="API Keys"
        description="Add provider API keys for your workspace. These override server-level keys."
      >
        <div className="flex flex-col gap-2">
          {configuredProviders.map((p) => (
            <ConfiguredKeyRow
              key={p.type}
              provider={p}
              baseUrl={baseUrlByProvider[p.type] ?? null}
            />
          ))}

          {addingKey ? (
            <AddKeyRow
              availableProviders={availableToAdd}
              onDone={() => setAddingKey(false)}
            />
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="mt-1 h-8 w-fit gap-1.5 text-xs"
              onClick={() => setAddingKey(true)}
              disabled={availableToAdd.length === 0}
            >
              <Plus className="h-3.5 w-3.5" />
              {availableToAdd.length === 0
                ? "All providers configured"
                : "Add API key"}
            </Button>
          )}
        </div>
      </SettingSection>
    </div>
  );
}

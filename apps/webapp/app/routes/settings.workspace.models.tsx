import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState } from "react";
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
import { Trash2 } from "lucide-react";
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
import { PROVIDER_SPECS } from "@core/types";

const USE_CASES = [
  {
    key: "chat",
    label: "Chat",
    description: "Default model used for conversations with the agent",
  },
  {
    key: "memory",
    label: "Memory Ingestion",
    description:
      "Model used for extracting and structuring knowledge from episodes",
  },
  {
    key: "search",
    label: "Search Router",
    description: "Model used for query generation and search result ranking",
  },
] as const;

type UseCase = (typeof USE_CASES)[number]["key"];

// Derived from the canonical catalog in @core/types/llm/providers.
// Adding a provider there propagates here automatically.
//
// formKind decides which row component to render:
//   "key-only"  — only an API key input (anthropic, google, openrouter, …)
//   "url-only"  — only a URL input; provider needs no key (ollama)
//   "dual"      — URL + key inputs (openai proxy, azure). URL is optional
//                 when baseUrl.required is false (openai direct still works).
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

const BYOK_PROVIDERS: ProviderForm[] = Object.values(PROVIDER_SPECS)
  .filter((s) => s.byokSupported)
  .map((s) => {
    const hasKey = s.apiKeyVar !== null;
    const hasUrl = !!s.baseUrl;
    const formKind: FormKind =
      hasKey && hasUrl ? "dual" : hasUrl ? "url-only" : "key-only";
    return {
      type: s.id as SupportedProvider,
      label: s.label,
      hint: s.modelHint ?? s.baseUrl?.hint,
      formKind,
      apiKeyPlaceholder: s.apiKeyPlaceholder,
      baseUrlPlaceholder: s.baseUrl?.placeholder ?? "",
      baseUrlRequired: s.baseUrl?.required ?? false,
    };
  });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);

  if (!user.workspaceId) {
    throw new Error("Workspace not found");
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: user.workspaceId },
    select: { metadata: true },
  });

  const modelConfig = ((workspace?.metadata as any)?.modelConfig ??
    {}) as Record<UseCase, { modelId: string } | undefined>;

  const [models, keyStatus] = await Promise.all([
    getChatModels(user.workspaceId),
    getWorkspaceKeyStatus(user.workspaceId),
  ]);

  return json({ modelConfig, models, keyStatus });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const user = await requireUser(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (!user.workspaceId) {
    return json({ error: "Workspace not found" }, { status: 404 });
  }

  if (intent === "updateModel") {
    const useCase = formData.get("useCase") as UseCase;
    const modelId = formData.get("modelId") as string;

    const validUseCases: UseCase[] = ["chat", "memory", "search"];
    if (!validUseCases.includes(useCase)) {
      return json({ error: "Invalid use case" }, { status: 400 });
    }
    if (!modelId) {
      return json({ error: "Missing modelId" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: user.workspaceId },
      select: { metadata: true },
    });

    const metadata = (workspace?.metadata as Record<string, unknown>) ?? {};
    const currentConfig =
      (metadata.modelConfig as Record<string, unknown>) ?? {};

    await prisma.workspace.update({
      where: { id: user.workspaceId },
      data: {
        metadata: {
          ...metadata,
          modelConfig: { ...currentConfig, [useCase]: { modelId } },
        } as Prisma.InputJsonValue,
      },
    });

    await persistCustomWorkspaceModel(user.workspaceId, modelId);
    await pruneOrphanWorkspaceModels(user.workspaceId);

    return json({ success: true });
  }

  if (intent === "resetModel") {
    const useCase = formData.get("useCase") as UseCase;
    const validUseCases: UseCase[] = ["chat", "memory", "search"];
    if (!validUseCases.includes(useCase)) {
      return json({ error: "Invalid use case" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: user.workspaceId },
      select: { metadata: true },
    });

    const metadata = (workspace?.metadata as Record<string, unknown>) ?? {};
    const currentConfig =
      (metadata.modelConfig as Record<string, unknown>) ?? {};
    const { [useCase]: _removed, ...nextConfig } = currentConfig;

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

    if (!isSupportedProvider(providerType)) {
      return json({ error: "Unsupported provider" }, { status: 400 });
    }
    if (!apiKey) {
      return json({ error: "API key is required" }, { status: 400 });
    }

    await setWorkspaceApiKey(user.workspaceId, providerType, apiKey, baseUrl);
    return json({ success: true });
  }

  if (intent === "deleteKey") {
    const providerType = formData.get("providerType") as string;

    if (!isSupportedProvider(providerType)) {
      return json({ error: "Unsupported provider" }, { status: 400 });
    }

    await deleteWorkspaceApiKey(user.workspaceId, providerType);
    return json({ success: true });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
};

/**
 * Two-input BYOK row for providers that carry both a URL and an API key.
 * Used by Azure (URL required) and OpenAI (URL optional — leaving it blank
 * keeps calls pointed at api.openai.com; filling it in aims the workspace
 * at any OpenAI-compatible proxy such as CLIProxyAPI or Vercel AI Gateway).
 */
function DualFieldBYOKRow({
  provider,
  hasKey,
}: {
  provider: ProviderForm;
  hasKey: boolean;
}) {
  const fetcher = useFetcher();
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [editing, setEditing] = useState(false);

  const isSubmitting = fetcher.state !== "idle";

  const canSave =
    apiKey.trim().length > 0 &&
    (!provider.baseUrlRequired || baseUrl.trim().length > 0);

  const handleSave = () => {
    if (!canSave) return;
    fetcher.submit(
      {
        intent: "setKey",
        providerType: provider.type,
        apiKey,
        // Only send baseUrl when the user actually typed one — an empty string
        // would otherwise overwrite a previously stored URL for openai.
        ...(baseUrl.trim() && { baseUrl: baseUrl.trim() }),
      },
      { method: "POST" },
    );
    setApiKey("");
    setBaseUrl("");
    setEditing(false);
  };

  const handleDelete = () => {
    fetcher.submit(
      { intent: "deleteKey", providerType: provider.type },
      { method: "POST" },
    );
  };

  const activeHasKey =
    fetcher.formData?.get("intent") === "deleteKey"
      ? false
      : fetcher.formData?.get("intent") === "setKey"
        ? true
        : hasKey;

  return (
    <div className="bg-background-3 flex flex-col gap-2 rounded-lg p-3 px-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{provider.label}</span>
            {activeHasKey && (
              <Badge variant="secondary" className="text-xs">
                Key set
              </Badge>
            )}
          </div>
          {provider.hint && (
            <p className="text-muted-foreground text-xs">{provider.hint}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {activeHasKey && !editing ? (
            <>
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
            </>
          ) : (
            <div className="flex flex-col items-end gap-1.5">
              <Input
                className="h-7 w-72 font-mono text-xs"
                placeholder={
                  provider.baseUrlRequired
                    ? provider.baseUrlPlaceholder
                    : `${provider.baseUrlPlaceholder} (optional)`
                }
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                type="text"
              />
              <Input
                className="h-7 w-72 font-mono text-xs"
                placeholder={provider.apiKeyPlaceholder || "API key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                type="password"
              />
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
                {editing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setEditing(false);
                      setApiKey("");
                      setBaseUrl("");
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BYOKRow({
  provider,
  hasKey,
}: {
  provider: ProviderForm;
  hasKey: boolean;
}) {
  const fetcher = useFetcher();
  const [inputValue, setInputValue] = useState("");
  const [editing, setEditing] = useState(false);

  const isSubmitting = fetcher.state !== "idle";
  const isUrl = provider.formKind === "url-only";
  const placeholder = isUrl
    ? provider.baseUrlPlaceholder
    : provider.apiKeyPlaceholder;

  const handleSave = () => {
    if (!inputValue.trim()) return;
    fetcher.submit(
      { intent: "setKey", providerType: provider.type, apiKey: inputValue },
      { method: "POST" },
    );
    setInputValue("");
    setEditing(false);
  };

  const handleDelete = () => {
    fetcher.submit(
      { intent: "deleteKey", providerType: provider.type },
      { method: "POST" },
    );
  };

  const activeHasKey =
    fetcher.formData?.get("intent") === "deleteKey"
      ? false
      : fetcher.formData?.get("intent") === "setKey"
        ? true
        : hasKey;

  return (
    <div className="bg-background-3 flex flex-col gap-2 rounded-lg p-3 px-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{provider.label}</span>
            {activeHasKey && (
              <Badge variant="secondary" className="text-xs">
                {isUrl ? "URL set" : "Key set"}
              </Badge>
            )}
          </div>

          {provider.hint && (
            <p className="text-muted-foreground text-xs">{provider.hint}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {activeHasKey && !editing ? (
            <>
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
            </>
          ) : (
            <>
              <Input
                className="h-7 w-56 font-mono text-xs"
                placeholder={placeholder}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                type={isUrl ? "text" : "password"}
              />
              <Button
                variant="secondary"
                size="sm"
                className="h-7 text-xs"
                onClick={handleSave}
                disabled={!inputValue.trim() || isSubmitting}
              >
                Save
              </Button>
              {editing && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setEditing(false);
                    setInputValue("");
                  }}
                >
                  Cancel
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const CUSTOM_VALUE = "__custom__";
const DEFAULT_VALUE = "__default__";

function ModelSelector({
  useCase,
  label,
  description,
  currentModelId,
  modelsByProvider,
  hasBYOK,
  onSelect,
}: {
  useCase: UseCase;
  label: string;
  description: string;
  currentModelId: string;
  modelsByProvider: Record<
    string,
    { id: string; modelId: string; label: string | null }[]
  >;
  hasBYOK: boolean;
  onSelect: (useCase: UseCase, modelId: string) => void;
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

  const handleSelect = (value: string) => {
    if (value === CUSTOM_VALUE) {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    // Empty string signals "clear override" — parent routes this to the
    // resetModel intent so the workspace falls back to the server default.
    onSelect(useCase, value === DEFAULT_VALUE ? "" : value);
  };

  return (
    <div>
      <h3 className="text-sm font-medium">{label}</h3>
      <p className="text-muted-foreground mb-2 text-xs">{description}</p>
      <div className="flex items-center gap-2">
        <Select
          value={showCustom ? CUSTOM_VALUE : currentModelId}
          onValueChange={handleSelect}
        >
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Use server default" />
          </SelectTrigger>
          <SelectContent className="shadow-lg">
            <SelectItem value={DEFAULT_VALUE}>Use server default</SelectItem>
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
            {hasBYOK && (
              <>
                <div className="text-muted-foreground px-2 py-1.5 text-xs font-semibold uppercase">
                  Custom
                </div>
                <SelectItem value={CUSTOM_VALUE}>Enter model ID...</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>

        {showCustom && (
          <>
            <Input
              className="h-9 w-64 font-mono text-sm"
              placeholder="openrouter/anthropic/claude-3.5-haiku"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customValue.trim()) {
                  onSelect(useCase, customValue.trim());
                }
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (customValue.trim()) onSelect(useCase, customValue.trim());
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
          Use <code>openrouter/provider/model</code> for OpenRouter, <code>azure/&lt;deployment-name&gt;</code> for Azure
        </p>
      )}
    </div>
  );
}

export default function ModelsSettings() {
  const { modelConfig, models, keyStatus } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const pendingIntent = fetcher.formData?.get("intent");
  const pendingConfig =
    pendingIntent === "updateModel" || pendingIntent === "resetModel"
      ? {
          useCase: fetcher.formData!.get("useCase") as UseCase,
          // resetModel has no modelId — fall back to "" so the trigger shows
          // the "Use server default" placeholder optimistically.
          modelId:
            pendingIntent === "updateModel"
              ? (fetcher.formData!.get("modelId") as string)
              : "",
        }
      : null;

  const getCurrentModelId = (useCase: UseCase) => {
    if (pendingConfig?.useCase === useCase) return pendingConfig.modelId;
    return modelConfig[useCase]?.modelId ?? "";
  };

  const handleModelChange = (useCase: UseCase, modelId: string) => {
    if (modelId === "") {
      // ModelSelector emits "" when the user picks "Use server default" —
      // clear the workspace override rather than trying to save an empty id.
      fetcher.submit({ intent: "resetModel", useCase }, { method: "POST" });
      return;
    }
    fetcher.submit(
      { intent: "updateModel", useCase, modelId },
      { method: "POST" },
    );
  };

  const modelsByProvider = models.reduce(
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

  const keyStatusMap = Object.fromEntries(
    keyStatus.map((k) => [k.providerType, true]),
  );
  const hasBYOK = keyStatus.length > 0;

  return (
    <div className="md:w-3xl mx-auto flex w-auto flex-col gap-4 px-4 py-6">
      <SettingSection
        title="Models"
        description="Choose which model to use for each task. Falls back to the server default when not set."
      >
        <div className="flex flex-col gap-6">
          {USE_CASES.map(({ key, label, description }) => (
            <ModelSelector
              key={key}
              useCase={key}
              label={label}
              description={description}
              currentModelId={getCurrentModelId(key)}
              modelsByProvider={modelsByProvider}
              hasBYOK={hasBYOK}
              onSelect={handleModelChange}
            />
          ))}
        </div>
      </SettingSection>

      <SettingSection
        title="API Keys"
        description="Add your own provider API keys. These override server-level keys for your workspace."
      >
        <div className="flex flex-col gap-2">
          {BYOK_PROVIDERS.map((provider) =>
            provider.formKind === "dual" ? (
              <DualFieldBYOKRow
                key={provider.type}
                provider={provider}
                hasKey={!!keyStatusMap[provider.type]}
              />
            ) : (
              <BYOKRow
                key={provider.type}
                provider={provider}
                hasKey={!!keyStatusMap[provider.type]}
              />
            ),
          )}
        </div>
      </SettingSection>
    </div>
  );
}

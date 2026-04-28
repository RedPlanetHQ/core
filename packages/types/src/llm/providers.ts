/**
 * Unified LLM provider catalog. Single source of truth shared across:
 *   - Webapp env validator (apps/webapp/app/env.server.ts) → CHAT_PROVIDERS
 *   - Webapp BYOK service (services/byok.server.ts)         → BYOK_PROVIDERS
 *   - Webapp BYOK API route (routes/api.v1.byok.tsx)        → BYOK_PROVIDERS
 *   - Webapp BYOK UI (routes/settings.workspace.models.tsx) → BYOK_PROVIDER_SPECS
 *   - CLI self-host wizard (packages/cli/src/utils/setup/local.ts)
 *
 * Add a provider here, every surface picks it up.
 */

export interface ProviderBaseUrl {
  /** Env var name (e.g. "OPENAI_BASE_URL"). */
  var: string;
  /** Whether the user MUST supply a value (true for azure/ollama, false for openai's optional proxy). */
  required: boolean;
  /** Placeholder shown in the wizard / settings form. */
  placeholder: string;
  /** Short hint shown alongside the input. */
  hint?: string;
}

export interface ProviderSpec {
  /** Stable string id (matches CHAT_PROVIDER env value, BYOK provider type). */
  id: string;
  /** Human-readable label. */
  label: string;

  /** Eligible as a server-level CHAT_PROVIDER env value. */
  serverDefault: boolean;
  /** Eligible to be configured as a per-workspace BYOK key. */
  byokSupported: boolean;

  /** Env var holding the API key, or null when the provider doesn't use one (ollama). */
  apiKeyVar: string | null;
  /** Placeholder string for the API key field (e.g. "sk-...", "sk-ant-..."). */
  apiKeyPlaceholder: string;

  /** Optional/required base URL (openai proxy, azure endpoint, ollama URL). */
  baseUrl?: ProviderBaseUrl;
  /** Marks the provider as Azure-style (special UI handling for endpoint+key forms). */
  isAzure?: boolean;

  /** Default chat model the wizard suggests. */
  defaultChatModel: string;
  /** Optional hint displayed near the model input (e.g. routing prefix conventions). */
  modelHint?: string;
}

export const PROVIDER_SPECS: Record<string, ProviderSpec> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    serverDefault: true,
    byokSupported: true,
    apiKeyVar: "OPENAI_API_KEY",
    apiKeyPlaceholder: "sk-...",
    baseUrl: {
      var: "OPENAI_BASE_URL",
      required: false,
      placeholder: "https://api.openai.com/v1",
      hint: "Leave blank for OpenAI direct, or paste an OpenAI-compatible proxy URL",
    },
    defaultChatModel: "gpt-5.2-2025-12-11",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    serverDefault: true,
    byokSupported: true,
    apiKeyVar: "ANTHROPIC_API_KEY",
    apiKeyPlaceholder: "sk-ant-...",
    defaultChatModel: "claude-opus-4-7",
  },
  google: {
    id: "google",
    label: "Google",
    serverDefault: true,
    byokSupported: true,
    apiKeyVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    apiKeyPlaceholder: "AIza...",
    defaultChatModel: "gemini-2.5-pro",
  },
  ollama: {
    id: "ollama",
    label: "Ollama (local)",
    serverDefault: true,
    byokSupported: true,
    apiKeyVar: null,
    apiKeyPlaceholder: "",
    baseUrl: {
      var: "OLLAMA_URL",
      required: true,
      placeholder: "http://localhost:11434",
      hint: "URL of your local Ollama server",
    },
    defaultChatModel: "llama3.2",
    modelHint: "Use model IDs like ollama/llama3.2",
  },
  azure: {
    id: "azure",
    label: "Azure OpenAI",
    serverDefault: true,
    byokSupported: true,
    apiKeyVar: "AZURE_API_KEY",
    apiKeyPlaceholder: "sk-...",
    baseUrl: {
      var: "AZURE_BASE_URL",
      required: true,
      placeholder: "https://<resource>.openai.azure.com/openai/v1",
      hint: "Your Azure OpenAI resource endpoint",
    },
    isAzure: true,
    defaultChatModel: "gpt-4o",
    modelHint: "Use model IDs like azure/gpt-4o (deployment name after azure/)",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    serverDefault: true,
    byokSupported: true,
    apiKeyVar: "OPENROUTER_API_KEY",
    apiKeyPlaceholder: "sk-or-...",
    defaultChatModel: "openrouter/anthropic/claude-3.5-haiku",
    modelHint: "Use model IDs like openrouter/anthropic/claude-3.5-haiku",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    serverDefault: true,
    byokSupported: true,
    apiKeyVar: "DEEPSEEK_API_KEY",
    apiKeyPlaceholder: "sk-...",
    defaultChatModel: "deepseek-chat",
  },
  vercel: {
    id: "vercel",
    label: "Vercel AI Gateway",
    serverDefault: true,
    byokSupported: true,
    apiKeyVar: "VERCEL_AI_GATEWAY_API_KEY",
    apiKeyPlaceholder: "aig-...",
    defaultChatModel: "vercel/anthropic/claude-sonnet-4-5",
    modelHint: "Use model IDs like vercel/anthropic/claude-sonnet-4-5",
  },
  groq: {
    id: "groq",
    label: "Groq",
    serverDefault: true,
    byokSupported: true,
    apiKeyVar: "GROQ_API_KEY",
    apiKeyPlaceholder: "gsk_...",
    defaultChatModel: "groq/llama-3.3-70b-versatile",
    modelHint: "Use model IDs like groq/llama-3.3-70b-versatile",
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    serverDefault: true,
    byokSupported: true,
    apiKeyVar: "MISTRAL_API_KEY",
    apiKeyPlaceholder: "...",
    defaultChatModel: "mistral-large-latest",
  },
  xai: {
    id: "xai",
    label: "xAI (Grok)",
    serverDefault: true,
    byokSupported: true,
    apiKeyVar: "XAI_API_KEY",
    apiKeyPlaceholder: "xai-...",
    defaultChatModel: "grok-3-mini",
    modelHint: "Use model IDs like grok-3-mini",
  },
};

export const ALL_PROVIDERS = Object.keys(PROVIDER_SPECS);

/** Providers eligible as a server-level CHAT_PROVIDER env value. */
export const CHAT_PROVIDERS = ALL_PROVIDERS.filter(
  (id) => PROVIDER_SPECS[id]!.serverDefault,
) as readonly string[] as readonly [string, ...string[]];

/** Providers eligible as a per-workspace BYOK key. */
export const BYOK_PROVIDERS = ALL_PROVIDERS.filter(
  (id) => PROVIDER_SPECS[id]!.byokSupported,
) as readonly string[] as readonly [string, ...string[]];

/** Providers that can also be used as embeddings backends. */
export const EMBEDDING_PROVIDERS = ["openai", "google", "ollama", "azure"] as const;

export type ChatProvider = (typeof CHAT_PROVIDERS)[number];
export type BYOKProvider = (typeof BYOK_PROVIDERS)[number];
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];

export function isSupportedProvider(id: string): boolean {
  return id in PROVIDER_SPECS;
}

export function isByokProvider(id: string): boolean {
  return PROVIDER_SPECS[id]?.byokSupported === true;
}

export function isChatProvider(id: string): boolean {
  return PROVIDER_SPECS[id]?.serverDefault === true;
}

/**
 * Convenience accessor: returns the spec for an id, throwing on unknowns.
 * Use the boolean guards above for validation paths.
 */
export function getProviderSpec(id: string): ProviderSpec {
  const spec = PROVIDER_SPECS[id];
  if (!spec) throw new Error(`Unknown provider id: ${id}`);
  return spec;
}

import { z } from "zod";
import { isValidDatabaseUrl } from "./utils/db";
import { isValidRegex } from "./utils/regex";
import { LLMModelEnum } from "@core/types";

const EnvironmentSchema = z
  .object({
    NODE_ENV: z.union([
      z.literal("development"),
      z.literal("production"),
      z.literal("test"),
    ]),
    POSTGRES_DB: z.string(),
    DATABASE_URL: z
      .string()
      .refine(
        isValidDatabaseUrl,
        "DATABASE_URL is invalid, for details please check the additional output above this message.",
      ),
    DATABASE_CONNECTION_LIMIT: z.coerce.number().int().default(10),
    DATABASE_POOL_TIMEOUT: z.coerce.number().int().default(60),
    DATABASE_CONNECTION_TIMEOUT: z.coerce.number().int().default(20),
    DIRECT_URL: z
      .string()
      .refine(
        isValidDatabaseUrl,
        "DIRECT_URL is invalid, for details please check the additional output above this message.",
      ),
    DATABASE_READ_REPLICA_URL: z.string().optional(),
    SESSION_SECRET: z.string(),
    ENCRYPTION_KEY: z.string(),
    MAGIC_LINK_SECRET: z.string(),
    WHITELISTED_EMAILS: z
      .string()
      .refine(isValidRegex, "WHITELISTED_EMAILS must be a valid regex.")
      .optional(),
    ADMIN_EMAILS: z
      .string()
      .refine(isValidRegex, "ADMIN_EMAILS must be a valid regex.")
      .optional(),

    APP_ENV: z.string().default(process.env.NODE_ENV),
    LOGIN_ORIGIN: z.string().default("http://localhost:5173"),
    APP_ORIGIN: z.string().default("http://localhost:5173"),

    // Telemetry
    POSTHOG_PROJECT_KEY: z
      .string()
      .default("phc_SwfGIzzX5gh5bazVWoRxZTBhkr7FwvzArS0NRyGXm1a"),
    TELEMETRY_ENABLED: z
      .string()
      .optional()
      .default("true")
      .transform((val) => val !== "false" && val !== "0"),
    TELEMETRY_ANONYMOUS: z
      .string()
      .optional()
      .default("false")
      .transform((val) => val === "true" || val === "1"),

    //storage
    ACCESS_KEY_ID: z.string().optional(),
    SECRET_ACCESS_KEY: z.string().optional(),
    BUCKET: z.string().optional(),

    // google auth
    AUTH_GOOGLE_CLIENT_ID: z.string().optional(),
    AUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),

    ENABLE_EMAIL_LOGIN: z
      .string()
      .optional()
      .default("true")
      .transform((val) => val !== "false" && val !== "0"),

    //Redis
    REDIS_HOST: z.string().default("localhost"),
    REDIS_PORT: z.coerce.number().default(6379),
    REDIS_TLS_DISABLED: z
      .string()
      .optional()
      .default("true")
      .transform((val) => val !== "false" && val !== "0"),

    //Neo4j
    NEO4J_URI: z.string(),
    NEO4J_USERNAME: z.string(),
    NEO4J_PASSWORD: z.string(),

    //OpenAI
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_BASE_URL: z.string().optional(),
    OPENAI_API_MODE: z
      .enum(["responses", "chat_completions", "chat"])
      .default("responses"),
    ANTHROPIC_API_KEY: z.string().optional(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
    OPENROUTER_API_KEY: z.string().optional(),
    DEEPSEEK_API_KEY: z.string().optional(),
    AI_GATEWAY_API_KEY: z.string().optional(),
    GROQ_API_KEY: z.string().optional(),
    MISTRAL_API_KEY: z.string().optional(),
    XAI_API_KEY: z.string().optional(),

    EMAIL_TRANSPORT: z.string().optional(),
    FROM_EMAIL: z.string().optional(),
    REPLY_TO_EMAIL: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().optional(),
    SMTP_SECURE: z
      .string()
      .optional()
      .transform((val) => val === "true" || val === "1"),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    //Trigger
    TRIGGER_PROJECT_ID: z.string().optional(),
    TRIGGER_SECRET_KEY: z.string().optional(),
    TRIGGER_API_URL: z.string().optional(),
    TRIGGER_DB: z.string().default("trigger"),

    // Model envs
    MODEL: z.string().default(LLMModelEnum.GPT41),
    EMBEDDING_MODEL: z.string().default("mxbai-embed-large"),
    EMBEDDING_MODEL_SIZE: z.string().default("1024"),
    MODEL_TEMPERATURE: z.coerce.number().default(1),
    LLM_TOLERANT_OUTPUT: z.string().optional(),
    OLLAMA_URL: z.string().optional(),
    CHAT_PROVIDER: z.enum(["openai", "anthropic", "google", "ollama"]).default("openai"),
    EMBEDDINGS_PROVIDER: z.enum(["openai", "google", "ollama"]).optional(),

    // Inline batch fallback (when Batch API is unavailable)
    INLINE_BATCH_TTL_MS: z.coerce.number().int().positive().default(3600000),
    MAX_INLINE_BATCHES: z.coerce.number().int().positive().default(500),
    INLINE_BATCH_CONCURRENCY: z.coerce.number().int().positive().default(8),

    // Reranking configuration
    RERANK_PROVIDER: z.enum(["cohere", "ollama", "none"]).default("none"),
    COHERE_API_KEY: z.string().optional(),
    COHERE_RERANK_MODEL: z.string().default("rerank-english-v3.0"),
    COHERE_SCORE_THRESHOLD: z.string().default("0.3"),
    OLLAMA_RERANK_MODEL: z.string().default("dengcao/Qwen3-Reranker-8B:Q4_K_M"),
    OLLAMA_SCORE_THRESHOLD: z.string().default("0.3"),

    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_REGION: z.string().optional(),

    // Queue provider
    QUEUE_PROVIDER: z.enum(["trigger", "bullmq"]).default("trigger"),

    // BullMQ tuning (optional)
    //
    // Some OpenAI-compatible proxies apply strict rate limits. If you see frequent 429s,
    // reduce concurrency for BullMQ workers to smooth out bursts.
    BULLMQ_CONCURRENCY_PREPROCESS: z.coerce.number().int().positive().default(5),
    BULLMQ_CONCURRENCY_INGEST: z.coerce.number().int().positive().default(3),
    BULLMQ_CONCURRENCY_CONVERSATION_TITLE: z.coerce
      .number()
      .int()
      .positive()
      .default(10),
    BULLMQ_CONCURRENCY_SESSION_COMPACTION: z.coerce
      .number()
      .int()
      .positive()
      .default(3),
    BULLMQ_CONCURRENCY_LABEL_ASSIGNMENT: z.coerce
      .number()
      .int()
      .positive()
      .default(5),
    BULLMQ_CONCURRENCY_TITLE_GENERATION: z.coerce
      .number()
      .int()
      .positive()
      .default(10),
    BULLMQ_CONCURRENCY_PERSONA_GENERATION: z.coerce
      .number()
      .int()
      .positive()
      .default(1),
    BULLMQ_CONCURRENCY_GRAPH_RESOLUTION: z.coerce
      .number()
      .int()
      .positive()
      .default(1),
    BULLMQ_CONCURRENCY_INTEGRATION_RUN: z.coerce
      .number()
      .int()
      .positive()
      .default(3),
    BULLMQ_CONCURRENCY_REMINDER: z.coerce.number().int().positive().default(10),
    BULLMQ_CONCURRENCY_FOLLOW_UP: z.coerce.number().int().positive().default(5),

    // Search-v2 label match tuning
    // Default keeps current behavior; lower for embedding providers with lower cosine ranges.
    SEARCH_LABEL_VECTOR_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),

    // Provider configuration
    GRAPH_PROVIDER: z.enum(["neo4j", "falkordb", "helix"]).default("neo4j"),
    VECTOR_PROVIDER: z
      .enum(["pgvector", "turbopuffer", "qdrant"])
      .default("pgvector"),
    MODEL_PROVIDER: z.enum(["vercel-ai"]).default("vercel-ai"),

    EXA_API_KEY: z.string().optional(),

    // Twilio (WhatsApp)
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_WHATSAPP_NUMBER: z.string().optional(),

    // Slack
    SLACK_SIGNING_SECRET: z.string().optional(),

    // Resend
    RESEND_WEBHOOK_SECRET: z.string().optional(),

    // Sentry
    SENTRY_DSN: z.string().optional(),
  })
  .refine(
    (data) => {
      // If QUEUE_PROVIDER is "trigger", then Trigger.dev variables must be present
      if (data.QUEUE_PROVIDER === "trigger") {
        return !!(
          data.TRIGGER_PROJECT_ID &&
          data.TRIGGER_SECRET_KEY &&
          data.TRIGGER_API_URL
        );
      }
      return true;
    },
    {
      message:
        "TRIGGER_PROJECT_ID, TRIGGER_SECRET_KEY, and TRIGGER_API_URL are required when QUEUE_PROVIDER=trigger",
    },
  );

export type Environment = z.infer<typeof EnvironmentSchema>;

let env: z.infer<typeof EnvironmentSchema>;

try {
  env = EnvironmentSchema.parse(process.env);
} catch (e) {
  if (e instanceof z.ZodError) {
    console.error("Environment validation failed:");
    for (const issue of e.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
  }
  env = process.env as unknown as z.infer<typeof EnvironmentSchema>;
}

export { env };
// export const env = process.env;

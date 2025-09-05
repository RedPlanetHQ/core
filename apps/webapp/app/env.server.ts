import { z } from "zod";
import { isValidDatabaseUrl } from "./utils/db";
import { isValidRegex } from "./utils/regex";
import { LLMModelEnum } from "@core/types";

const EnvironmentSchema = z.object({
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
  POSTHOG_PROJECT_KEY: z.string().default(""),

  //storage
  ACCESS_KEY_ID: z.string().optional(),
  SECRET_ACCESS_KEY: z.string().optional(),
  BUCKET: z.string().optional(),

  // google auth
  AUTH_GOOGLE_CLIENT_ID: z.string().optional(),
  AUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),

  ENABLE_EMAIL_LOGIN: z.coerce.boolean().default(true),

  //Redis
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_TLS_DISABLED: z.coerce.boolean().default(true),

  //Neo4j
  NEO4J_URI: z.string(),
  NEO4J_USERNAME: z.string(),
  NEO4J_PASSWORD: z.string(),

  //OpenAI
  OPENAI_API_KEY: z.string(),

  EMAIL_TRANSPORT: z.enum(["resend", "smtp", "aws-ses"]).optional(),
  FROM_EMAIL: z.string().optional(),
  REPLY_TO_EMAIL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_SECURE: z.coerce.boolean().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

  //Trigger
  TRIGGER_PROJECT_ID: z.string(),
  TRIGGER_SECRET_KEY: z.string(),
  TRIGGER_API_URL: z.string(),
  TRIGGER_DB: z.string().default("trigger"),

  // Model envs
  MODEL: z.string().default(LLMModelEnum.GPT41),
  EMBEDDING_MODEL: z.string().default("mxbai-embed-large"),
  OLLAMA_URL: z.string().optional(),
  COHERE_API_KEY: z.string().optional(),
});

export type Environment = z.infer<typeof EnvironmentSchema>;
export const env = EnvironmentSchema.parse(process.env);
// export const env = process.env;

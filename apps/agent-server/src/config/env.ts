import { config } from 'dotenv';
import { z } from 'zod';

// Load .env file
config();

const envSchema = z.object({
  // Server
  PORT: z.string().default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // CORE Integration
  CORE_MCP_SERVER_URL: z.string().url(),
  CORE_WEBAPP_URL: z.string().url(), // For verification redirects
  ENCRYPTION_KEY: z.string().min(32), // Same as CORE webapp - required for PAT encryption
  APP_ORIGIN: z.string().url(),

  // Database
  DATABASE_URL: z.string().min(1),

  // WhatsApp
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_WHATSAPP_NUMBER: z.string().min(1),

  // Email
  EMAIL_TRANSPORT: z.string().default('resend'),
  RESEND_API_KEY: z.string().optional(),
  FROM_EMAIL: z.string().email(),

  // Authentication
  VERIFICATION_LINK_EXPIRY_MINUTES: z.string().default('30'),
});

export const env = envSchema.parse(process.env);

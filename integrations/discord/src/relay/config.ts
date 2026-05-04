import { z } from 'zod';

const ConfigSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1, 'DISCORD_BOT_TOKEN is required'),
  CORE_WEBHOOK_URL: z.string().url('CORE_WEBHOOK_URL must be a valid URL'),
  CORE_WORKSPACE_TOKEN: z.string().min(1, 'CORE_WORKSPACE_TOKEN is required'),
  CORE_RELAY_ID: z.string().optional(),
});

export type RelayConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid relay configuration:\n${issues}`);
  }
  return result.data;
}

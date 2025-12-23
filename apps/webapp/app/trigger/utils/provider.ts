import { ProviderFactory } from "@core/providers";
import { PrismaClient } from "@core/database";

// Singleton Prisma instance for Trigger.dev jobs
let prismaInstance: PrismaClient | null = null;

async function getPrismaInstance(): Promise<PrismaClient> {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient();

    // Set search_path to include public schema for pgvector extension
    await prismaInstance.$executeRawUnsafe(`SET search_path TO core, public;`);
  }
  return prismaInstance;
}

/**
 * Initialize ProviderFactory for Trigger.dev jobs
 * Call this at the beginning of every Trigger.dev task
 * Safe to call multiple times - will only initialize once
 */
export async function initializeProvider() {
  try {
    const prisma = await getPrismaInstance();
    ProviderFactory.initializeFromEnv({ prisma });
  } catch (error) {
    // If already initialized, ignore the error
    if (
      error instanceof Error &&
      !error.message.includes("already initialized")
    ) {
      throw error;
    }
  }
}

/**
 * Get the graph provider instance
 * Make sure to call initializeProvider() first
 */
export function getGraphProvider() {
  return ProviderFactory.getGraphProvider();
}

/**
 * Run a Cypher query
 * Make sure to call initializeProvider() first
 */
export async function runQuery(cypher: string, params = {}) {
  const provider = getGraphProvider();
  return provider.runQuery(cypher, params);
}

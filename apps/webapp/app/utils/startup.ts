import { logger } from "~/services/logger.service";
import { fetchAndSaveStdioIntegrations } from "~/trigger/utils/mcp";
import { initNeo4jSchemaOnce, verifyConnectivity } from "~/lib/neo4j.server";
import { env } from "~/env.server";
import { initWorkers, shutdownWorkers } from "~/bullmq/start-workers";
import { trackConfig } from "~/services/telemetry.server";

// Global flag to ensure startup only runs once per server process
let startupInitialized = false;

/**
 * Wait for Neo4j to be ready before initializing schema
 */
async function waitForNeo4j(maxRetries = 30, retryDelay = 2000) {
  logger.info("Waiting for Neo4j to be ready...");

  for (let i = 0; i < maxRetries; i++) {
    try {
      const connected = await verifyConnectivity();
      if (connected) {
        logger.info("✓ Neo4j is ready!");
        return true;
      }
    } catch (error) {
      // Connection failed, will retry
    }

    logger.info(`Neo4j not ready, retrying... (${i + 1}/${maxRetries})`);
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }

  logger.error("Failed to connect to Neo4j after maximum retries");
  throw new Error("Failed to connect to Neo4j after maximum retries");
}

/**
 * Initialize all startup services once per server process
 * Safe to call multiple times - will only run initialization once
 */
export async function initializeStartupServices() {
  if (startupInitialized) {
    return;
  }

  // Wait for TRIGGER_API_URL/login to be available, up to 1 minute
  async function waitForTriggerLogin(
    url: string,
    timeoutMs = 60000,
    intervalMs = 2000,
  ) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`${url}/login`, { method: "GET" });
        if (res.ok) {
          return;
        }
      } catch (e) {
        // ignore, will retry
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    // If we get here, the service is still not available
    console.error(
      `${url}/login is not available after ${timeoutMs / 1000} seconds. Exiting process.`,
    );
    process.exit(1);
  }

  if (env.QUEUE_PROVIDER === "trigger") {
    try {
      const triggerApiUrl = env.TRIGGER_API_URL;
      // At this point, env validation should have already ensured these are present
      // But we add a runtime check for safety
      if (
        !triggerApiUrl ||
        !env.TRIGGER_PROJECT_ID ||
        !env.TRIGGER_SECRET_KEY
      ) {
        console.error(
          "TRIGGER_API_URL, TRIGGER_PROJECT_ID, and TRIGGER_SECRET_KEY must be set when QUEUE_PROVIDER=trigger",
        );
        process.exit(1);
      }
      await waitForTriggerLogin(triggerApiUrl);
      await addEnvVariablesInTrigger();
    } catch (e) {
      console.error(e);
      console.error("Trigger is not configured");
      process.exit(1);
    }
  } else {
    await initWorkers();

    // Handle graceful shutdown
    process.on("SIGTERM", async () => {
      await shutdownWorkers();
    });
    process.on("SIGINT", async () => {
      await shutdownWorkers();
      process.exit(0);
    });
  }

  try {
    logger.info("Starting application initialization...");

    // Wait for Neo4j to be ready
    await waitForNeo4j();

    // Initialize Neo4j schema
    await initNeo4jSchemaOnce();
    logger.info("Neo4j schema initialization completed");

    await fetchAndSaveStdioIntegrations();
    logger.info("Stdio integrations initialization completed");

    // Track system configuration once at startup
    await trackConfig();
    logger.info("System configuration tracked");

    startupInitialized = true;
    logger.info("Application initialization completed successfully");
  } catch (error) {
    logger.error("Failed to initialize startup services:", { error });
    // Don't mark as initialized if there was an error, allow retry
  }
}

export function getDatabaseUrl(dbName: string): string {
  const { DATABASE_URL } = env;

  if (!dbName) {
    throw new Error("dbName is required");
  }

  // Parse the DATABASE_URL and replace the database name
  try {
    const url = new URL(DATABASE_URL);

    // The pathname starts with a slash, e.g. "/echo"
    url.pathname = `/${dbName}`;

    return url.toString();
  } catch (err) {
    throw new Error(`Invalid DATABASE_URL format: ${err}`);
  }
}

const Keys = [
  "API_BASE_URL",
  "DATABASE_URL",
  "EMBEDDING_MODEL",
  "MODEL",
  "ENCRYPTION_KEY",
  "NEO4J_PASSWORD",
  "NEO4J_URI",
  "NEO4J_USERNAME",
  "OPENAI_API_KEY",
];

export async function addEnvVariablesInTrigger() {
  const {
    APP_ORIGIN,
    POSTGRES_DB,
    EMBEDDING_MODEL,
    MODEL,
    ENCRYPTION_KEY,
    NEO4J_PASSWORD,
    NEO4J_URI,
    NEO4J_USERNAME,
    OPENAI_API_KEY,
    TRIGGER_PROJECT_ID,
    TRIGGER_API_URL,
    TRIGGER_SECRET_KEY,
  } = env;

  // These should always be present when this function is called
  // but we add a runtime check for type safety
  if (!TRIGGER_PROJECT_ID || !TRIGGER_API_URL || !TRIGGER_SECRET_KEY) {
    throw new Error(
      "TRIGGER_PROJECT_ID, TRIGGER_API_URL, and TRIGGER_SECRET_KEY are required",
    );
  }

  const DATABASE_URL = getDatabaseUrl(POSTGRES_DB);

  // Map of key to value from env, replacing 'localhost' as needed
  const envVars: Record<string, string> = {
    API_BASE_URL: APP_ORIGIN.includes("localhost")
      ? APP_ORIGIN.replace("localhost", "core-app")
      : APP_ORIGIN,
    DATABASE_URL: DATABASE_URL ?? "",
    EMBEDDING_MODEL: EMBEDDING_MODEL ?? "",
    MODEL: MODEL ?? "",
    ENCRYPTION_KEY: ENCRYPTION_KEY ?? "",
    NEO4J_PASSWORD: NEO4J_PASSWORD ?? "",
    NEO4J_URI: NEO4J_URI ?? "",
    NEO4J_USERNAME: NEO4J_USERNAME ?? "",
    OPENAI_API_KEY: OPENAI_API_KEY ?? "",
  };

  const envName = env.NODE_ENV === "production" ? "prod" : "dev";
  const apiBase = `${TRIGGER_API_URL}/api/v1`;
  const envVarsUrl = `${apiBase}/projects/${TRIGGER_PROJECT_ID}/envvars/${envName}`;

  try {
    logger.info("Fetching current environment variables from Trigger...", {
      envVarsUrl,
    });

    // Fetch current env vars
    const response = await fetch(envVarsUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${TRIGGER_SECRET_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      logger.error("Failed to fetch env vars from Trigger", {
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(
        `Failed to fetch env vars: ${response.status} ${response.statusText}`,
      );
    }

    const currentVars: Array<{ name: string; value: string }> =
      await response.json();

    logger.info("Fetched current env vars from Trigger", {
      count: currentVars.length,
    });

    // Build a set of existing env var names
    const existingNames = new Set(currentVars.map((v) => v.name));

    // Find missing keys
    const missingKeys = Keys.filter((key) => !existingNames.has(key));

    if (missingKeys.length === 0) {
      logger.info("No missing environment variables to add in Trigger.");
    } else {
      logger.info("Missing environment variables to add in Trigger", {
        missingKeys,
      });
    }

    // For each missing key, POST to create
    for (const key of missingKeys) {
      const value = envVars[key];
      if (typeof value === "undefined") {
        logger.warn(
          `Environment variable ${key} is undefined in envVars, skipping.`,
        );
        continue;
      }
      logger.info(`Creating environment variable in Trigger: ${key}`);
      const createRes = await fetch(envVarsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TRIGGER_SECRET_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name: key,
          value,
        }),
      });

      if (!createRes.ok) {
        logger.error("Failed to create env var in Trigger", {
          key,
          status: createRes.status,
          statusText: createRes.statusText,
        });
        throw new Error(
          `Failed to create env var ${key}: ${createRes.status} ${createRes.statusText}`,
        );
      } else {
        logger.info(
          `Successfully created environment variable in Trigger: ${key}`,
        );
      }
    }
    logger.info("addEnvVariablesInTrigger completed successfully.");
  } catch (err) {
    logger.error("Error in addEnvVariablesInTrigger", { error: err });
    throw err;
  }
}

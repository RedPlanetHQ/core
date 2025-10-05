import { logger } from "~/services/logger.service";
import { fetchAndSaveStdioIntegrations } from "~/trigger/utils/mcp";
import { initNeo4jSchemaOnce } from "~/lib/neo4j.server";
import { env } from "~/env.server";

// Global flag to ensure startup only runs once per server process
let startupInitialized = false;

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

  try {
    const triggerApiUrl = env.TRIGGER_API_URL;
    if (!triggerApiUrl) {
      logger.warn("TRIGGER_API_URL is not set; skipping Trigger bootstrap.");
    } else {
      await waitForTriggerLogin(triggerApiUrl);
      await addEnvVariablesInTrigger();
    }
  } catch (e) {
    logger.error("Trigger bootstrap failed; continuing without Trigger integration", {
      error: e,
    });
  }

  try {
    logger.info("Starting application initialization...");

    // Initialize Neo4j schema
    await initNeo4jSchemaOnce();
    logger.info("Neo4j schema initialization completed");

    await fetchAndSaveStdioIntegrations();
    logger.info("Stdio integrations initialization completed");

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

  const DATABASE_URL = getDatabaseUrl(POSTGRES_DB);

  if (!TRIGGER_PROJECT_ID || !TRIGGER_SECRET_KEY || !TRIGGER_API_URL) {
    logger.warn(
      "Trigger credentials are incomplete; skipping environment variable sync.",
    );
    return;
  }

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

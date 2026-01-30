#!/usr/bin/env node

import { execSync } from "child_process";
import { appendFileSync } from "fs";
import { readJsonFromStdin, normalizeInput } from "./stdin";
import { extractConversationPairs } from "./transcript";
import { SEARCH_CONTEXT } from "constant";
import { fetchLogs, addEpisode, fetchUserPersona } from "./api-client";

export const HOOK_TIMEOUTS = {
  DEFAULT: 300000, // Standard HTTP timeout (5 min for slow systems)
  HEALTH_CHECK: 30000, // Worker health check (30s for slow systems)
  WORKER_STARTUP_WAIT: 1000,
  WORKER_STARTUP_RETRIES: 300,
  PRE_RESTART_SETTLE_DELAY: 2000, // Give files time to sync before restart
  POWERSHELL_COMMAND: 10000, // PowerShell process enumeration (10s - typically completes in <1s)
  WINDOWS_MULTIPLIER: 1.5, // Platform-specific adjustment
} as const;

/**
 * Hook exit codes for Claude Code
 *
 * Exit code behavior per Claude Code docs:
 * - 0: Success. For SessionStart/UserPromptSubmit, stdout added to context.
 * - 2: Blocking error. For SessionStart, stderr shown to user only.
 * - Other non-zero: stderr shown in verbose mode only.
 */
export const HOOK_EXIT_CODES = {
  SUCCESS: 0,
  FAILURE: 1,
  /** Blocking error - for SessionStart, shows stderr to user only */
  BLOCKING_ERROR: 2,
} as const;

export function getTimeout(baseTimeout: number): number {
  return process.platform === "win32"
    ? Math.round(baseTimeout * HOOK_TIMEOUTS.WINDOWS_MULTIPLIER)
    : baseTimeout;
}

interface SessionStartOutput {
  hookSpecificOutput: {
    hookEventName: "SessionStart";
    additionalContext: string;
  };
  continue?: boolean;
  suppressOutput?: boolean;
}

interface StopOutput {
  continue: boolean;
  suppressOutput: boolean;
}

/**
 * Strip ANSI escape codes from a string
 */
function stripAnsiCodes(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Extract token value starting with rc_pat_ from output
 */
function extractToken(output: string): string | null {
  const cleaned = stripAnsiCodes(output);
  const match = cleaned.match(/rc_pat_[a-z0-9]+/);
  return match ? match[0] : null;
}

/**
 * Common function to get authentication token
 * @returns The API token or null if unable to get token
 */
async function getAuthToken(): Promise<string | null> {
  try {
    // First check if already authenticated
    let meOutput: string;
    try {
      meOutput = execSync("corebrain me", {
        encoding: "utf-8",
        timeout: getTimeout(HOOK_TIMEOUTS.DEFAULT),
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      meOutput = "";
    }

    // Check if we need to login
    if (meOutput.includes("Not authenticated. Please run the login command first.")) {
      console.error("Not authenticated. Running corebrain login...");
      try {
        execSync("corebrain login", {
          encoding: "utf-8",
          timeout: getTimeout(HOOK_TIMEOUTS.DEFAULT),
          stdio: "inherit", // Allow interactive login
        });
      } catch (loginError) {
        console.error("Login failed. Please run 'corebrain login' manually.");
        return null;
      }
    }

    // Get the token
    const tokenOutput = execSync("corebrain token", {
      encoding: "utf-8",
      timeout: getTimeout(HOOK_TIMEOUTS.DEFAULT),
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Extract just the token value (rc_pat_...)
    const token = extractToken(tokenOutput);

    if (!token) {
      console.error("Failed to extract token from corebrain token output");
      return null;
    }

    return token;
  } catch (error) {
    console.error(
      `Error getting auth token: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

async function sessionStart(): Promise<{ exitCode: number; output?: SessionStartOutput }> {
  try {
    // Get authentication token
    const token = await getAuthToken();

    if (!token) {
      return { exitCode: HOOK_EXIT_CODES.BLOCKING_ERROR };
    }

    // Make API call to get user persona
    const persona = await fetchUserPersona(token);

    if (persona === null) {
      console.error("Failed to fetch user persona");
      return { exitCode: HOOK_EXIT_CODES.BLOCKING_ERROR };
    }

    // Write token to CLAUDE_ENV_FILE if it exists
    const claudeEnvFile = process.env.CLAUDE_ENV_FILE;
    if (claudeEnvFile) {
      try {
        appendFileSync(claudeEnvFile, `export CORE_TOKEN="${token}"\n`);
        console.log(`Token exported to ${claudeEnvFile}`);
      } catch (envError) {
        console.error(
          `Failed to write to CLAUDE_ENV_FILE: ${envError instanceof Error ? envError.message : String(envError)}`
        );
      }
    }

    const output: SessionStartOutput = {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `<about_user>${persona}</about_user>\n\n<rules>${SEARCH_CONTEXT}</rules>`,
      },
    };

    return { exitCode: HOOK_EXIT_CODES.SUCCESS, output };
  } catch (error) {
    console.error(
      `Error in session-start: ${error instanceof Error ? error.message : String(error)}`
    );
    return { exitCode: HOOK_EXIT_CODES.BLOCKING_ERROR };
  }
}

async function stop(): Promise<{ exitCode: number; output: StopOutput }> {
  try {
    // Read and normalize stdin input
    const rawInput = await readJsonFromStdin();
    const input = normalizeInput(rawInput);

    if (!input.transcriptPath) {
      console.error("No transcript path provided");
      return {
        exitCode: HOOK_EXIT_CODES.FAILURE,
        output: { continue: true, suppressOutput: true },
      };
    }

    // Get authentication token
    const token = await getAuthToken();

    if (!token) {
      console.error("Failed to get authentication token for API call");
      // Continue anyway, don't block
      return {
        exitCode: HOOK_EXIT_CODES.SUCCESS,
        output: { continue: true, suppressOutput: true },
      };
    }

    // Extract all conversation pairs from transcript
    const allPairs = extractConversationPairs(input.transcriptPath, true);
    console.log(`Total conversation pairs extracted: ${allPairs.length}`);

    // Fetch logs to determine how many pairs have already been ingested
    const logsResponse = await fetchLogs(input.sessionId, token);
    const totalIngested = logsResponse?.document?.ingestionQueueCount || 0;

    console.log(`Already ingested: ${totalIngested}, Total pairs: ${allPairs.length}`);

    // Determine which pairs are new (not yet ingested)
    const newPairs = allPairs.slice(totalIngested);

    if (newPairs.length === 0) {
      console.log("No new conversation pairs to ingest");
      return {
        exitCode: HOOK_EXIT_CODES.SUCCESS,
        output: { continue: true, suppressOutput: true },
      };
    }

    console.log(`Ingesting ${newPairs.length} new conversation pair(s)`);

    // Send each new pair to the API
    let successCount = 0;
    for (const pair of newPairs) {
      const transcriptContent = `user:
${pair.user}
assistant:
${pair.assistant}`;

      const success = await addEpisode(
        {
          episodeBody: transcriptContent.trim(),
          referenceTime: new Date().toISOString(),
          source: "claude-code",
          type: "CONVERSATION",
          sessionId: input.sessionId,
        },
        token
      );

      if (success) {
        successCount++;
      }
    }

    console.log(
      `Successfully ingested ${successCount}/${newPairs.length} new conversation pair(s)`
    );

    const output: StopOutput = {
      continue: true,
      suppressOutput: true,
    };

    return { exitCode: HOOK_EXIT_CODES.SUCCESS, output };
  } catch (error) {
    console.error(`Error in stop: ${error instanceof Error ? error.message : String(error)}`);
    return {
      exitCode: HOOK_EXIT_CODES.FAILURE,
      output: { continue: true, suppressOutput: true },
    };
  }
}

// Main CLI handler
const command = process.argv[2];

async function main() {
  let result: { exitCode: number; output?: any };

  switch (command) {
    case "session-start":
      result = await sessionStart();
      break;
    case "stop":
      result = await stop();
      break;
    default:
      console.error(`Usage: node cli.js <session-start|stop>`);
      process.exit(HOOK_EXIT_CODES.FAILURE);
  }

  if (result.output) {
    console.log(JSON.stringify(result.output));
  }

  process.exit(result.exitCode ?? HOOK_EXIT_CODES.SUCCESS);
}

main().catch((error) => {
  console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(HOOK_EXIT_CODES.FAILURE);
});

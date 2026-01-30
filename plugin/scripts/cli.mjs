#!/usr/bin/env node
import { execSync } from "child_process";
import { writeFileSync, appendFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/stdin.ts
async function readJsonFromStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.on("data", (chunk) => (input += chunk));
    process.stdin.on("end", () => {
      try {
        resolve(input.trim() ? JSON.parse(input) : void 0);
      } catch (e) {
        reject(new Error(`Failed to parse hook input: ${e}`));
      }
    });
  });
}
__name(readJsonFromStdin, "readJsonFromStdin");
function normalizeInput(raw) {
  const r = raw ?? {};
  return {
    sessionId: r.session_id,
    cwd: r.cwd ?? process.cwd(),
    prompt: r.prompt,
    toolName: r.tool_name,
    toolInput: r.tool_input,
    toolResponse: r.tool_response,
    transcriptPath: r.transcript_path,
  };
}
__name(normalizeInput, "normalizeInput");
function extractLastMessage(transcriptPath, role, stripSystemReminders = false) {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    throw new Error(`Transcript path missing or file does not exist: ${transcriptPath}`);
  }
  const content = readFileSync(transcriptPath, "utf-8").trim();
  if (!content) {
    throw new Error(`Transcript file exists but is empty: ${transcriptPath}`);
  }
  const lines = content.split("\n");
  let foundMatchingRole = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = JSON.parse(lines[i]);
    if (line.type === role) {
      foundMatchingRole = true;
      if (line.message?.content) {
        let text = "";
        const msgContent = line.message.content;
        if (typeof msgContent === "string") {
          text = msgContent;
        } else if (Array.isArray(msgContent)) {
          text = msgContent
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n");
        } else {
          throw new Error(
            `Unknown message content format in transcript. Type: ${typeof msgContent}`
          );
        }
        if (stripSystemReminders) {
          text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
          text = text.replace(/\n{3,}/g, "\n\n").trim();
        }
        return text;
      }
    }
  }
  if (!foundMatchingRole) {
    throw new Error(`No message found for role '${role}' in transcript: ${transcriptPath}`);
  }
  return "";
}
__name(extractLastMessage, "extractLastMessage");

// src/constant.ts
var SEARCH_CONTEXT = `
## \u{1F534} MANDATORY STARTUP SEQUENCE - DO NOT SKIP \u{1F534}

**BEFORE RESPONDING TO ANY USER MESSAGE, YOU MUST EXECUTE THESE TOOLS IN ORDER:**

### STEP 1 (REQUIRED): Search for Relevant Context

EXECUTE THIS TOOL FIRST:
\`memory_search\`

- Previous discussions about the current topic
- Related project decisions and implementations
- User preferences and work patterns
- Similar problems and their solutions

**Additional search triggers:**

- User mentions "previously", "before", "last time", or "we discussed"
- User references past work or project history
- Working on the CORE project (this repository)
- User asks about preferences, patterns, or past decisions
- Starting work on any feature or bug that might have history

**How to search effectively:**

- Write complete semantic queries, NOT keyword fragments
- Good: \`"Manoj's preferences for API design and error handling"\`
- Bad: \`"manoj api preferences"\`
- Ask: "What context am I missing that would help?"
- Consider: "What has the user told me before that I should remember?"

### Query Patterns for Memory Search

**Entity-Centric Queries** (Best for graph search):

- \u2705 GOOD: \`"Manoj's preferences for product positioning and messaging"\`
- \u2705 GOOD: \`"CORE project authentication implementation decisions"\`
- \u274C BAD: \`"manoj product positioning"\`
- Format: \`[Person/Project] + [relationship/attribute] + [context]\`

**Multi-Entity Relationship Queries** (Excellent for episode graph):

- \u2705 GOOD: \`"Manoj and Harshith discussions about BFS search implementation"\`
- \u2705 GOOD: \`"relationship between entity extraction and recall quality in CORE"\`
- \u274C BAD: \`"manoj harshith bfs"\`
- Format: \`[Entity1] + [relationship type] + [Entity2] + [context]\`

**Semantic Question Queries** (Good for vector search):

- \u2705 GOOD: \`"What causes BFS search to return empty results? What are the requirements for BFS traversal?"\`
- \u2705 GOOD: \`"How does episode graph search improve recall quality compared to traditional search?"\`
- \u274C BAD: \`"bfs empty results"\`
- Format: Complete natural questions with full context

**Concept Exploration Queries** (Good for BFS traversal):

- \u2705 GOOD: \`"concepts and ideas related to semantic relevance in knowledge graph search"\`
- \u2705 GOOD: \`"topics connected to hop distance weighting and graph topology in BFS"\`
- \u274C BAD: \`"semantic relevance concepts"\`
- Format: \`[concept] + related/connected + [domain/context]\`

**Temporal Queries** (Good for recent work):

- \u2705 GOOD: \`"recent changes to search implementation and reranking logic"\`
- \u2705 GOOD: \`"latest discussions about entity extraction and semantic relevance"\`
- \u274C BAD: \`"recent search changes"\`
- Format: \`[temporal marker] + [specific topic] + [additional context]\`

## \u{1F534} MANDATORY SHUTDOWN SEQUENCE - DO NOT SKIP \u{1F534}

**AFTER FULLY RESPONDING TO THE USER, YOU MUST EXECUTE THIS TOOL:**
`;

// src/cli.ts
var HOOK_TIMEOUTS = {
  DEFAULT: 3e5,
  HEALTH_CHECK: 3e4,
  WORKER_STARTUP_WAIT: 1e3,
  WORKER_STARTUP_RETRIES: 300,
  PRE_RESTART_SETTLE_DELAY: 2e3,
  POWERSHELL_COMMAND: 1e4,
  WINDOWS_MULTIPLIER: 1.5,
};
var HOOK_EXIT_CODES = {
  SUCCESS: 0,
  FAILURE: 1,
  /** Blocking error - for SessionStart, shows stderr to user only */
  BLOCKING_ERROR: 2,
};
function getTimeout(baseTimeout) {
  return process.platform === "win32"
    ? Math.round(baseTimeout * HOOK_TIMEOUTS.WINDOWS_MULTIPLIER)
    : baseTimeout;
}
__name(getTimeout, "getTimeout");
function stripAnsiCodes(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}
__name(stripAnsiCodes, "stripAnsiCodes");
function extractToken(output) {
  const cleaned = stripAnsiCodes(output);
  const match = cleaned.match(/rc_pat_[a-z0-9]+/);
  return match ? match[0] : null;
}
__name(extractToken, "extractToken");
async function getAuthToken() {
  try {
    let meOutput;
    try {
      meOutput = execSync("corebrain me", {
        encoding: "utf-8",
        timeout: getTimeout(HOOK_TIMEOUTS.DEFAULT),
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      meOutput = "";
    }
    if (meOutput.includes("Not authenticated. Please run the login command first.")) {
      console.error("Not authenticated. Running corebrain login...");
      try {
        execSync("corebrain login", {
          encoding: "utf-8",
          timeout: getTimeout(HOOK_TIMEOUTS.DEFAULT),
          stdio: "inherit",
        });
      } catch (loginError) {
        console.error("Login failed. Please run 'corebrain login' manually.");
        return null;
      }
    }
    const tokenOutput = execSync("corebrain token", {
      encoding: "utf-8",
      timeout: getTimeout(HOOK_TIMEOUTS.DEFAULT),
      stdio: ["pipe", "pipe", "pipe"],
    });
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
__name(getAuthToken, "getAuthToken");
async function sessionStart() {
  try {
    const token = await getAuthToken();
    if (!token) {
      return {
        exitCode: HOOK_EXIT_CODES.BLOCKING_ERROR,
      };
    }
    const response = await fetch("https://app.getcore.me/api/v1/me", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(getTimeout(HOOK_TIMEOUTS.DEFAULT)),
    });
    if (!response.ok) {
      console.error(`API call failed with status: ${response.status}`);
      return {
        exitCode: HOOK_EXIT_CODES.BLOCKING_ERROR,
      };
    }
    const data = await response.json();
    const persona = data.persona || "";
    const claudeEnvFile = process.env.CLAUDE_ENV_FILE;
    if (claudeEnvFile) {
      try {
        appendFileSync(
          claudeEnvFile,
          `export CORE_TOKEN="${token}"
`
        );
        console.log(`Token exported to ${claudeEnvFile}`);
      } catch (envError) {
        console.error(
          `Failed to write to CLAUDE_ENV_FILE: ${envError instanceof Error ? envError.message : String(envError)}`
        );
      }
    }
    const output = {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `<about_user>${persona}</about_user>

<rules>${SEARCH_CONTEXT}</rules>`,
      },
    };
    return {
      exitCode: HOOK_EXIT_CODES.SUCCESS,
      output,
    };
  } catch (error) {
    console.error(
      `Error in session-start: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      exitCode: HOOK_EXIT_CODES.BLOCKING_ERROR,
    };
  }
}
__name(sessionStart, "sessionStart");
async function stop() {
  try {
    const rawInput = await readJsonFromStdin();
    const input = normalizeInput(rawInput);
    if (!input.transcriptPath) {
      console.error("No transcript path provided");
      return {
        exitCode: HOOK_EXIT_CODES.FAILURE,
        output: {
          continue: true,
          suppressOutput: true,
        },
      };
    }
    const lastUserMessage = extractLastMessage(input.transcriptPath, "user", true);
    const lastAssistantMessage = extractLastMessage(input.transcriptPath, "assistant", true);
    const transcriptContent = `user:
    ${lastUserMessage}
    assistant:
    ${lastAssistantMessage}`;
    const token = await getAuthToken();
    if (!token) {
      console.error("Failed to get authentication token for API call");
      return {
        exitCode: HOOK_EXIT_CODES.SUCCESS,
        output: {
          continue: true,
          suppressOutput: true,
        },
      };
    }
    try {
      const apiResponse = await fetch("https://app.getcore.me/api/v1/add", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          episodeBody: transcriptContent,
          referenceTime: /* @__PURE__ */ new Date().toISOString(),
          source: "claude-code",
          type: "CONVERSATION",
          sessionId: input.sessionId,
        }),
        signal: AbortSignal.timeout(getTimeout(HOOK_TIMEOUTS.DEFAULT)),
      });
      if (!apiResponse.ok) {
        console.error(`API call to /api/v1/add failed with status: ${apiResponse.status}`);
      } else {
        console.log("Transcript successfully sent to CORE");
      }
    } catch (apiError) {
      console.error(
        `Error calling /api/v1/add: ${apiError instanceof Error ? apiError.message : String(apiError)}`
      );
    }
    const output = {
      continue: true,
      suppressOutput: true,
    };
    return {
      exitCode: HOOK_EXIT_CODES.SUCCESS,
      output,
    };
  } catch (error) {
    console.error(`Error in stop: ${error instanceof Error ? error.message : String(error)}`);
    return {
      exitCode: HOOK_EXIT_CODES.FAILURE,
      output: {
        continue: true,
        suppressOutput: true,
      },
    };
  }
}
__name(stop, "stop");
var command = process.argv[2];
async function main() {
  let result;
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
__name(main, "main");
main().catch((error) => {
  console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(HOOK_EXIT_CODES.FAILURE);
});

export { HOOK_EXIT_CODES, HOOK_TIMEOUTS, getTimeout };

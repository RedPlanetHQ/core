#!/usr/bin/env node
import { execSync } from "child_process";
import { appendFileSync, existsSync, readFileSync } from "fs";

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
function extractMessageContent(parsed) {
  if (!parsed.message?.content) {
    return "";
  }
  const msgContent = parsed.message.content;
  if (typeof msgContent === "string") {
    return msgContent;
  } else if (Array.isArray(msgContent)) {
    return msgContent
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  } else {
    throw new Error(`Unknown message content format. Type: ${typeof msgContent}`);
  }
}
__name(extractMessageContent, "extractMessageContent");
function extractLastAssistantWithPrecedingUsers(transcriptPath, stripSystemReminders = false) {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    throw new Error(`Transcript path missing or file does not exist: ${transcriptPath}`);
  }
  const content = readFileSync(transcriptPath, "utf-8").trim();
  if (!content) {
    throw new Error(`Transcript file exists but is empty: ${transcriptPath}`);
  }
  const lines = content.split("\n");
  const parsedLines = lines.map((line) => JSON.parse(line));
  let lastAssistantIndex = -1;
  for (let i = parsedLines.length - 1; i >= 0; i--) {
    if (parsedLines[i].type === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }
  if (lastAssistantIndex === -1) {
    throw new Error("No assistant message found in transcript");
  }
  let assistantMessage = extractMessageContent(parsedLines[lastAssistantIndex]);
  if (stripSystemReminders) {
    assistantMessage = assistantMessage.replace(
      /<system-reminder>[\s\S]*?<\/system-reminder>/g,
      ""
    );
    assistantMessage = assistantMessage.replace(/\n{3,}/g, "\n\n").trim();
  }
  const userMessages = [];
  let gotAtleastOne = false;

  for (let i = lastAssistantIndex - 1; i >= 0; i--) {
    const parsed = parsedLines[i];

    if (parsed.type === "assistant" && gotAtleastOne && extractMessageContent(parsed)) {
      break;
    } else if (parsed.type === "user") {
      userMessages.unshift(extractMessageContent(parsed));
      gotAtleastOne = true;
    }
  }
  return {
    assistant: assistantMessage,
    users: userMessages,
  };
}
__name(extractLastAssistantWithPrecedingUsers, "extractLastAssistantWithPrecedingUsers");

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

// src/api-client.ts
var API_BASE_URL = "https://b4dc378156d8.ngrok-free.app";
async function addEpisode(payload, token) {
  try {
    const response = await fetch(`${API_BASE_URL}/add`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(getTimeout(HOOK_TIMEOUTS.DEFAULT)),
    });
    if (!response.ok) {
      console.error(`Failed to add episode: HTTP ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      `Error adding episode: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}
__name(addEpisode, "addEpisode");
async function fetchUserPersona(token) {
  try {
    const response = await fetch(`${API_BASE_URL}/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(getTimeout(HOOK_TIMEOUTS.DEFAULT)),
    });
    if (!response.ok) {
      console.error(`Failed to fetch user persona: HTTP ${response.status}`);
      return null;
    }
    const data = await response.json();
    return data.persona || "";
  } catch (error) {
    console.error(
      `Error fetching user persona: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}
__name(fetchUserPersona, "fetchUserPersona");

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
    const persona = await fetchUserPersona(token);
    if (persona === null) {
      console.error("Failed to fetch user persona");
      return {
        exitCode: HOOK_EXIT_CODES.BLOCKING_ERROR,
      };
    }
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
    const { assistant, users } = extractLastAssistantWithPrecedingUsers(input.transcriptPath, true);
    console.log(`Extracted last assistant message with ${users.length} preceding user message(s)`);
    let transcriptContent = "";
    for (const userMessage of users) {
      transcriptContent += `<user>
${userMessage}
</user>

`;
    }
    transcriptContent += `<assistant>
${assistant}
</assistant>`;
    const success = await addEpisode(
      {
        episodeBody: transcriptContent.trim(),
        referenceTime: /* @__PURE__ */ new Date().toISOString(),
        source: "claude-code-plugin",
        type: "CONVERSATION",
        sessionId: input.sessionId,
      },
      token
    );
    if (success) {
      console.log("Successfully ingested conversation turn");
    } else {
      console.error("Failed to ingest conversation turn");
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

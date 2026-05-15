import { type ModelMessage } from "ai";
import { z } from "zod";

import { prisma } from "~/db.server";
import { makeModelCall } from "~/lib/model.server";
import { logger } from "~/services/logger.service";
import { callTool } from "~/services/gateway/transport.server";

const UNTITLED_PLACEHOLDER = "Untitled session";

export interface CodingDescriptionUpdatePayload {
  codingSessionId: string;
  workspaceId: string;
}

export interface CodingDescriptionUpdateResult {
  success: boolean;
  reason?: string;
  title?: string;
  description?: string;
  error?: string;
}

interface GatewayTurn {
  role: "user" | "assistant";
  content: string;
}

const ResponseSchema = z.object({
  title: z.string().optional(),
  plan: z.string(),
  outcome: z.string(),
});

export async function processCodingDescriptionUpdate(
  payload: CodingDescriptionUpdatePayload,
): Promise<CodingDescriptionUpdateResult> {
  const { codingSessionId, workspaceId } = payload;

  const session = await prisma.codingSession.findFirst({
    where: { id: codingSessionId, workspaceId },
    select: {
      id: true,
      gatewayId: true,
      externalSessionId: true,
      taskId: true,
      task: {
        select: { id: true, title: true, description: true },
      },
    },
  });

  if (!session) {
    return { success: false, reason: "session_not_found" };
  }
  if (!session.gatewayId || !session.externalSessionId) {
    return { success: false, reason: "no_gateway_session" };
  }
  if (!session.taskId || !session.task) {
    return { success: false, reason: "no_task" };
  }

  const turns = await fetchTurns(session.gatewayId, session.externalSessionId);
  if (turns.length === 0) {
    return { success: false, reason: "no_turns" };
  }

  const needsTitle =
    !session.task.title || session.task.title === UNTITLED_PLACEHOLDER;

  const messages: ModelMessage[] = [
    { role: "system", content: buildSystemPrompt(needsTitle) },
    {
      role: "user",
      content: buildUserPrompt({
        turns,
        existingDescription: session.task.description ?? null,
        needsTitle,
      }),
    },
  ];

  let responseText = "";
  try {
    await makeModelCall(
      false,
      messages,
      (text) => {
        responseText = text;
      },
      { temperature: 0.2 },
      "medium",
      "coding-description-update",
      undefined,
      workspaceId,
    );
  } catch (error) {
    logger.error("Coding description-update LLM call failed", {
      codingSessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const parsed = parseResponse(responseText, { needsTitle });
  if (!parsed) {
    return { success: false, reason: "parse_failed" };
  }

  const nextDescription = renderDescription(parsed.plan, parsed.outcome);

  await prisma.task.update({
    where: { id: session.taskId },
    data: {
      description: nextDescription,
      ...(needsTitle && parsed.title ? { title: parsed.title } : {}),
    },
  });

  return {
    success: true,
    title: needsTitle ? parsed.title : session.task.title,
    description: nextDescription,
  };
}

async function fetchTurns(
  gatewayId: string,
  externalSessionId: string,
): Promise<GatewayTurn[]> {
  const result = (await callTool(
    gatewayId,
    "coding_read_session",
    { sessionId: externalSessionId },
    30_000,
  )) as { turns?: unknown[]; error?: string };

  const raw = (result.turns ?? []) as Array<{
    role: string;
    content: unknown;
  }>;

  const filtered: GatewayTurn[] = [];
  for (const turn of raw) {
    if (turn.role !== "user" && turn.role !== "assistant") continue;
    const content =
      typeof turn.content === "string" ? turn.content : String(turn.content);
    // Same noise filter as the /logs route.
    if (content.includes("<local-command-caveat>")) continue;
    if (content.includes("<command-name>")) continue;
    if (content.includes("<command-message>")) continue;
    if (content.includes("Base directory for this skill:")) continue;
    filtered.push({ role: turn.role, content });
  }
  return filtered;
}

function buildSystemPrompt(needsTitle: boolean): string {
  const titleBlock = needsTitle
    ? `
You also produce a short Title for the task:
- 4–8 words
- Reflects the user's actual goal, not the agent's first response
- No surrounding quotes, no trailing punctuation
`
    : "";

  return `You maintain a task description for an in-progress coding session.
The description has exactly two sections, written as tag blocks:

<plan>
The approach being taken — what we intend to do, key design decisions,
the order if it matters. Updated only when the approach actually changes.
</plan>

<outcome>
Where things stand right now, stated as facts: what is in place, what is
verified, what is blocked, decisions made along the way. This is NOT a
transcript or activity log. Avoid time-ordered phrasing like "first did
X, then did Y" — describe the current state.
</outcome>
${titleBlock}
## PRINCIPLES

- **Preserve everything important**: future readers see only this
  description, not the raw turns. Don't drop technical details.
- **Capture decision status**: distinguish what was decided/confirmed
  from what was suggested/proposed. Use language like "User confirmed…",
  "Suggested but not yet done…", "Recommended; pending decision".
- **Deduplicate**: if the same thing was discussed multiple times,
  consolidate to one mention with the final state.
- **Technical precision**: keep exact file paths, function names, error
  messages, commands, and decisions verbatim.
- **No hallucination**: only include what the turns actually contain.
- **Proportional length**: short sessions get short sections; long
  sessions get more detail. Don't pad.
- **State, not history**: \`<outcome>\` should read like a snapshot of
  reality, not a log of who said what.

## OUTPUT FORMAT

Output ONE \`<plan>…</plan>\` block, ONE \`<outcome>…</outcome>\` block,${
    needsTitle ? " and ONE `<title>…</title>` block," : ""
  } and nothing else.
Use markdown inside the tags. No surrounding prose.`;
}

function buildUserPrompt(args: {
  turns: GatewayTurn[];
  existingDescription: string | null;
  needsTitle: boolean;
}): string {
  const lines: string[] = [];

  if (args.existingDescription && args.existingDescription.trim().length > 0) {
    lines.push("## CURRENT DESCRIPTION");
    lines.push(args.existingDescription.trim());
    lines.push("");
  }

  lines.push("## SESSION TURNS");
  args.turns.forEach((turn, idx) => {
    lines.push(`### Turn ${idx + 1} — ${turn.role}`);
    lines.push(turn.content);
    lines.push("");
  });

  lines.push("## INSTRUCTIONS");
  lines.push(
    args.existingDescription
      ? "Update the description so it reflects the full set of turns above. Carry forward anything from the current description that is still accurate; revise or replace anything superseded by the new turns."
      : "Produce the initial description for this session based on the turns above.",
  );
  if (args.needsTitle) {
    lines.push("Also produce a short Title that names what the user is trying to accomplish.");
  }

  return lines.join("\n");
}

function parseResponse(
  raw: string,
  opts: { needsTitle: boolean },
): { title?: string; plan: string; outcome: string } | null {
  const planMatch = raw.match(/<plan>([\s\S]*?)<\/plan>/i);
  const outcomeMatch = raw.match(/<outcome>([\s\S]*?)<\/outcome>/i);
  if (!planMatch || !outcomeMatch) return null;

  const plan = planMatch[1].trim();
  const outcome = outcomeMatch[1].trim();
  if (!plan || !outcome) return null;

  let title: string | undefined;
  if (opts.needsTitle) {
    const titleMatch = raw.match(/<title>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].trim().replace(/^["']|["']$/g, "");
    }
  }

  const candidate = { plan, outcome, ...(title ? { title } : {}) };
  const validated = ResponseSchema.safeParse(candidate);
  if (!validated.success) return null;
  return candidate;
}

function renderDescription(plan: string, outcome: string): string {
  return `<plan>\n${plan}\n</plan>\n\n<outcome>\n${outcome}\n</outcome>`;
}

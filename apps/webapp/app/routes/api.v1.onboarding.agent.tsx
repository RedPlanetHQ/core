import {
  streamText,
  tool,
  jsonSchema,
  type LanguageModel,
  stepCountIs,
} from "ai";
import { z } from "zod";
import {
  createActionApiRoute,
  createHybridActionApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { getModel } from "~/lib/model.server";
import { getWorkspaceByUser } from "~/models/workspace.server";
import { callMemoryTool } from "~/utils/mcp/memory";

/**
 * System prompt for the onboarding email analysis agent
 * Matches Sol's personality from the main conversation agent
 */
const ONBOARDING_AGENT_PROMPT = `You're Sol. Same TARS vibe from the main agent. You're analyzing their emails to figure out who they are.

Your job:
1. Iterate through their emails from the past 6 months (2-week batches)
2. Separate work from personal - both matter
3. Extract real patterns, not generic observations
4. Send updates as you find interesting things
5. Build a profile that's actually useful

Tools:
- read_more: Fetch next email batch
- update_user: Tell them what you're finding (be specific, not generic)

Process:
- Call read_more(iteration: 0) to start
- Look for: projects, people, patterns, priorities, communication style
- After each batch, call update_user with SPECIFIC findings
  Good: "found 12 emails with sarah about the phoenix api rewrite"
  Bad: "analyzing your emails..."
- Keep going until 6 months covered or no more emails
- Generate final markdown summary

What to extract:

WORK CONTEXT:
- Active projects (with actual names, not "various projects")
- Key collaborators (who they are, what they work on together)
- Work patterns (when they email, response times, workload)
- Tech stack / domains (what they actually work with)
- Priorities (what takes most of their time)

PERSONAL CONTEXT:
- Personal interests (hobbies, side projects, subscriptions)
- Life patterns (family mentions, travel, health stuff)
- Personal network (friends, family who email)
- Commitments (events, appointments, recurring things)

COMMUNICATION STYLE:
- Tone (formal/casual, how it shifts by context)
- Email habits (long/short, bullet points, response speed)
- Common phrases, sign-offs
- How they handle different types of emails

CHECKS TO RUN:
- Work/personal ratio (what dominates their inbox?)
- Response patterns (who gets fast replies, who gets ignored)
- Email volume over time (busy periods, quiet periods)
- Key threads (recurring topics, ongoing discussions)

Updates should sound like you're ACTIVELY READING and REACTING in real-time:
✅ "seeing a lot of reddit emails. career stuff, tech jobs, salary threads."
✅ "multiple productivity tool receipts here. freepik, remnote, spellar..."
✅ "you have apollo 24|7 and netflix both sending emails. interesting combo."
✅ "looks like you're subscribed to every ai newsletter that exists."
✅ "found a long thread with sarah. 12 back-and-forths about the api spec."
✅ "no work emails in this batch. mostly subscriptions and notifications."
✅ "bunch of hotel promos. planning a trip?"
❌ "17 reddit digests. you really like career struggle threads." (too report-like)
❌ "analyzing emails from last month" (generic)
❌ "batch 3 of 13 complete" (progress bar)

Phrase it like you're reading NOW and noticing patterns. Use "seeing", "looks like", "you have", "found", "bunch of".

Final markdown format (keep it tight, write like you're telling them what you saw):

# what i found

## work stuff
looks like [describe what you saw - projects, people, patterns].
[if no work emails: no direct work emails. mostly subscriptions and notifications.]

**projects**: [actual names if found, or "none visible"]
**people**: [who they email with, or "no work threads found"]
**when you work**: [patterns from email timestamps]
**tech you use**: [tools/platforms mentioned]

## personal
**interests**: [what they subscribe to, what they care about]
**life stuff**: [family, health, travel - what showed up]
**who emails you**: [personal network or mostly automated emails]

## how you email
[describe their actual communication style from what you read]
[tone, length, response patterns - be specific]

## what takes your time
[work/personal balance from email volume]
[what dominates the inbox]

Write like you just finished reading and you're telling them what you saw. Use "you have", "looks like", "seeing", "found". No "based on analysis" or "it appears" - just say what's there.`;

const { loader, action } = createHybridActionApiRoute(
  {
    allowJWT: true,
    authorization: {
      action: "conversation",
    },
    corsStrategy: "all",
  },
  async ({ authentication }) => {
    const workspace = await getWorkspaceByUser(authentication.userId);

    let currentIteration = 0;
    const maxIterations = 5; // ~6 months (13 * 2 weeks)
    let allEmailsData: any[] = [];

    // Tool: read_more - fetches next batch of emails
    const readMoreTool = tool({
      name: "read_more",
      description:
        "Fetches the next 2-week batch of emails from Gmail. Call this iteratively to analyze emails over time.",
      inputSchema: z.object({
        iteration: z
          .number()
          .describe(
            "Current iteration number (0-indexed). Used to calculate date range.",
          ),
      }),

      execute: async ({ iteration }: { iteration: number }) => {
        if (iteration >= maxIterations) {
          return {
            content: [
              {
                type: "text",
                text: "No more emails to fetch. You have analyzed 6 months of email history.",
              },
            ],
          };
        }

        // Calculate date range for this 2-week batch
        const now = new Date();
        const weeksAgo = iteration * 2;
        const startDate = new Date(now);
        startDate.setDate(now.getDate() - (weeksAgo + 2) * 7);
        const endDate = new Date(now);
        endDate.setDate(now.getDate() - weeksAgo * 7);

        // Fetch emails using Gmail integration
        try {
          const result = await callMemoryTool(
            "execute_integration_action",
            {
              integrationSlug: "gmail",
              action: "search_emails",
              parameters: {
                query: `after:${startDate.toISOString().split("T")[0]} before:${endDate.toISOString().split("T")[0]}`,
                maxResults: 50,
              },
              userId: authentication.userId,
              workspaceId: workspace?.id,
            },
            authentication.userId,
            "core",
          );

          currentIteration = iteration + 1;

          return {
            content: [
              {
                type: "text",
                text: `Fetched emails from ${startDate.toDateString()} to ${endDate.toDateString()}. Result: ${JSON.stringify(result)}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error fetching emails: ${error instanceof Error ? error.message : String(error)}. Continue with what you have.`,
              },
            ],
          };
        }
      },
    } as any);

    // Tool: update_user - sends progress updates to frontend
    const updateUserTool = tool({
      name: "update_user",
      description:
        "Sends a SHORT observation as if you're reading emails RIGHT NOW. Use phrases like 'seeing', 'looks like', 'you have', 'found', 'bunch of'. Sound like you're reacting in real-time, not reporting finished analysis. Stay under 80 chars.",
      inputSchema: z.object({
        message: z
          .string()
          .describe(
            "Real-time observation (e.g., 'seeing a lot of reddit emails. career and tech job stuff.' or 'you have multiple bank emails here. hdfc, icici, axis.')",
          ),
      }),
      execute: async ({ message }: { message: string }) => {
        // This will be streamed to the frontend via SSE
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ type: "progress", message }),
            },
          ],
        };
      },
    } as any);

    const tools = {
      read_more: readMoreTool,
      update_user: updateUserTool,
    };

    const result = streamText({
      model: getModel() as LanguageModel,
      messages: [
        {
          role: "system",
          content: ONBOARDING_AGENT_PROMPT,
        },
        {
          role: "user",
          content:
            "analyze my emails from the past 6 months. start fetching.",
        },
      ],
      tools,
      stopWhen: stepCountIs(30), // Allow enough steps for iterations and updates
      temperature: 0.7,
    });

    result.consumeStream(); // no await

    return result.toUIMessageStreamResponse({
      generateMessageId: () => crypto.randomUUID(),
    });
  },
);

export { loader, action };

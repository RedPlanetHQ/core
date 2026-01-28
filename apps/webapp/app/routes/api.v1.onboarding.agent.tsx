import { streamText, tool, type LanguageModel, stepCountIs } from "ai";
import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { getModel } from "~/lib/model.server";
import { getWorkspaceByUser } from "~/models/workspace.server";
import { callMemoryTool } from "~/utils/mcp/memory";
import { getIntegrationAccountBySlugAndUser } from "~/services/integrationAccount.server";

/**
 * System prompt for the onboarding email analysis agent
 * Matches Sol's personality from the main conversation agent
 */
const ONBOARDING_AGENT_PROMPT = `You're Sol. Same TARS vibe from the main agent. You're analyzing their emails to figure out who they are.

Your job:
1. Analyze received emails (up to 100 emails or 6 months, whichever comes first)
2. Check sent emails to understand communication style
3. Learn about the person - work, personal, patterns, priorities
4. Send ONLY impactful updates - things that make them go "whoa, you noticed that?"
5. Build a profile that's actually useful

Tools:
- read_more: Fetch next batch of received emails (auto-increments, stops at 100 emails or 6 months)
- read_sent_emails: Fetch sent emails to see who they email and how they write
- update_user: Share SIGNIFICANT discoveries only - things that matter

Process:
1. Call read_more() to get batches of received emails
2. Accumulate observations internally - DON'T send updates for every batch
3. Call update_user ONLY when you find something genuinely interesting or revealing
4. When done with received emails, call read_sent_emails() to analyze their outgoing communication
5. Look for: recurring people, projects, interests, patterns, communication style
6. SKIP useless observations about promos/newsletters - focus on real insights
7. Generate final markdown summary

What makes an update worth sending:
✅ Pattern detected across multiple emails (e.g., "flying blr-delhi every week for 3 months straight")
✅ Significant life/work insight (e.g., "looks like you're leading the q4 roadmap - priya and sanket both escalating to you")
✅ Unique personal detail (e.g., "training for half marathon - 6am runs, cultfit bookings, nutrition tracking")
✅ Important relationship discovery (e.g., "riya mentions 'core onboarding' - new project starting?")
✅ Major commitment or change (e.g., "offer letter from anthropic. making a move?")

❌ Don't send updates for:
❌ Single email mentions (wait for patterns)
❌ Generic subscriptions (unless there's a clear theme)
❌ Routine transactions without context
❌ Obvious facts without insight

Send 5-8 total updates maximum. Make each one count.

Updates should sound like learning about them:
Good: "you fly mumbai-bangalore weekly. work commute?"
Good: "looks like you're taking that reforge ai pm course."
Good: "priya keeps bringing up the q4 roadmap. you leading it?"
Bad: "seeing flight confirmation emails"
Bad: "found emails about a course"
Bad: "email thread with priya"

Don't mention "email" or "found in inbox". State observations like you're piecing together who they are.

What to extract:

IDENTITY:
- Name of the person
- Where do they work
- What is their role

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

Updates should sound like CONCLUSIONS ABOUT THE PERSON. Make statements, use questions sparingly:
✅ "flying blr-delhi multiple times. looks like regular work commute."
✅ "cultfit and peakst8 bookings every week. fitness is a routine."
✅ "following lenny's newsletter and dan abramov. into product and dev thinking."
✅ "active in r/aimemory and r/claudeai. deep into ai tools."
✅ "riya and sanket mentioned in core onboarding. new project starting."
✅ "multiple mutual fund and stock alerts. managing investments actively."
✅ "zomato gold renewal plus lots of orders. ordering in frequently."
✅ "bank alerts from hdfc, icici, axis. tracking multiple accounts."

Use questions only when genuinely unclear (1 in 5 updates max):
✅ "airbnb reservation dec 20. short trip or working remotely?"
❌ "cultfit sent 8 emails this week. training for something?" (make it a statement instead)
❌ "seeing flight confirmation emails" (too email-focused)
❌ "bunch of ai newsletters" (be specific about which ones)

Make conclusions. State patterns. Be specific with names, places, dates, numbers.

Final markdown format (keep it tight, write like you're telling them what you saw):

# what i found
## who you are

**name**: [extract from email signature, sent emails, or "couldn't find"]
**role**: [job title/position from signature or context, or "not clear from emails"]
**company**: [if visible from signatures or work emails]

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
    // Check if Gmail is connected
    const gmailAccount = await getIntegrationAccountBySlugAndUser(
      "gmail",
      authentication.userId,
    );


    let currentIteration = 0;
    let totalEmailsFetched = 0;
    const maxIterations = 13; // ~6 months (13 * 2 weeks)
    const maxEmails = 100; // Stop at 100 emails

    // Tool: read_more - fetches next batch of received emails
    const readMoreTool = tool({
      name: "read_more",
      description:
        "Fetches the next batch of received emails from Gmail. Automatically moves to next batch on each call. Returns metadata (sender, subject, id, timestamp). Stops at 100 emails or 6 months, whichever comes first.",
      inputSchema: z.object({}),

      execute: async () => {
        if (currentIteration >= maxIterations) {
          return {
            content: [
              {
                type: "text",
                text: "reached 6 months limit.",
              },
            ],
          };
        }

        if (totalEmailsFetched >= maxEmails) {
          return {
            content: [
              {
                type: "text",
                text: "reached 100 emails limit.",
              },
            ],
          };
        }

        // Calculate date range for this 2-week batch
        const now = new Date();
        const weeksAgo = currentIteration * 2;
        const startDate = new Date(now);
        startDate.setDate(now.getDate() - (weeksAgo + 2) * 7);
        const endDate = new Date(now);
        endDate.setDate(now.getDate() - weeksAgo * 7);

        // Fetch emails using Gmail integration
        try {
          const result = await callMemoryTool(
            "execute_integration_action",
            {
              accountId: "gmail",
              action: "search_emails",
              parameters: {
                query: `after:${startDate.toISOString().split("T")[0]} before:${endDate.toISOString().split("T")[0]} -category:promotions -category:forums`,
                maxResults: 50,
              },
              userId: authentication.userId,
              workspaceId: workspace?.id,
            },
            authentication.userId,
            "core",
          );

          const batchNum = currentIteration + 1;
          currentIteration++; // Increment for next call

          // Count emails in this batch
          const emailCount = Array.isArray(result) ? result.length : 0;
          totalEmailsFetched += emailCount;

          return {
            content: [
              {
                type: "text",
                text: `batch ${batchNum}: ${emailCount} emails (total: ${totalEmailsFetched}/100)\n${JSON.stringify(result)}`,
              },
            ],
          };
        } catch (error) {
          currentIteration++; // Still increment on error to avoid infinite loop
          return {
            content: [
              {
                type: "text",
                text: `error fetching batch: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      },
    } as any);

    // Tool: read_sent_emails - fetches sent emails
    const readSentEmailsTool = tool({
      name: "read_sent_emails",
      description:
        "Fetches sent emails from Gmail to understand how the person communicates, who they email, and their writing style. Returns metadata (to, subject, id, timestamp).",
      inputSchema: z.object({}),

      execute: async () => {
        // Fetch last 6 months of sent emails
        const now = new Date();
        const sixMonthsAgo = new Date(now);
        sixMonthsAgo.setMonth(now.getMonth() - 6);

        try {
          const result = await callMemoryTool(
            "execute_integration_action",
            {
              accountId: gmailAccount?.accountId,
              action: "search_emails",
              parameters: {
                query: `after:${sixMonthsAgo.toISOString().split("T")[0]} in:sent`,
                maxResults: 50,
              },
              userId: authentication.userId,
              workspaceId: workspace?.id,
            },
            authentication.userId,
            "core",
          );

          const emailCount = Array.isArray(result) ? result.length : 0;

          return {
            content: [
              {
                type: "text",
                text: `sent emails: ${emailCount} found\n${JSON.stringify(result)}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `error fetching sent emails: ${error instanceof Error ? error.message : String(error)}`,
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
        "Sends a SHORT CONCLUSION about the person. Make statements, not questions (use questions max 1 in 5 updates). State patterns and facts about their life, work, habits. Don't mention 'email' or 'inbox'. Be specific with names, numbers, places, dates. Stay under 80 chars.",
      inputSchema: z.object({
        message: z
          .string()
          .describe(
            "Conclusion about the person (e.g., 'flying blr-delhi regularly. looks like work commute.' or 'following lenny's newsletter and dan abramov. into product thinking.')",
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
      read_sent_emails: readSentEmailsTool,
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
          content: "analyze my emails from the past 6 months. start fetching.",
        },
      ],
      tools,
      stopWhen: stepCountIs(50), // Allow enough steps for iterations and updates
      temperature: 0.7,
    });

    result.consumeStream(); // no await

    return result.toUIMessageStreamResponse({
      generateMessageId: () => crypto.randomUUID(),
    });
  },
);

export { loader, action };

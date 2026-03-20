/**
 * Extract Voice Prompt
 *
 * Extracts the user's voice — rules, preferences, habits, beliefs, goals.
 * These are preserved as complete non-decomposed statements.
 *
 * This prompt does NOT classify aspects — that happens in classify-voice.
 * This prompt does NOT extract world facts — that happens in extract-world.
 */

import { type ModelMessage } from "ai";
import z from "zod";

/**
 * A voice fact — user's voice, stored as a complete non-decomposed statement
 */
const VoiceFactSchema = z.object({
  fact: z
    .string()
    .describe(
      "Complete statement preserving user's intent — no decomposition, no word limit",
    ),
});

export const ExtractVoiceSchema = z.object({
  voice_facts: z
    .array(VoiceFactSchema)
    .describe("User's voice — rules, preferences, habits, beliefs, goals, tasks"),
});

export type ExtractVoiceResult = z.infer<typeof ExtractVoiceSchema>;

export const extractVoicePrompt = (
  context: Record<string, any>,
): ModelMessage[] => {
  const sysPrompt = `A good butler knows exactly how their employer likes things done. You are extracting that voice — their standing rules, preferences, habits, beliefs, and commitments — so any agent (email drafter, meeting prep, code assistant, WhatsApp bot) knows how to serve this person correctly.

Your job: Extract the user's VOICE — their standing rules, preferences, habits, beliefs, goals, and commitments. These tell agents how to serve the user correctly.

## THE MENTAL MODEL

Voice = the user's operating system. It answers: **"How should any agent behave with this user?"**

- Their rules → what agents must follow
- Their preferences → how agents should style output
- Their habits → what agents can expect
- Their beliefs → what agents should respect
- Their goals → what agents should work toward
- Their tasks → what the user committed to do

## THE DURABILITY TEST

For every candidate fact, ask: **"If a DIFFERENT agent interacts with this user tomorrow, should that agent know this?"**

- "Scan Gmail every morning, skip newsletters" → YES. Any email agent needs this. **Extract.**
- "Check my inbox" → NO. That's a command for this session. **Skip.**
- "I prefer short bullet points" → YES. Any agent writing for this user needs this. **Extract.**
- "Send that draft now" → NO. Session instruction, done after this session. **Skip.**
- "Never schedule meetings before 10am" → YES. Any calendar agent needs this. **Extract.**
- "Book a table for 7pm Saturday" → NO. One-time session request. **Skip.**

## WHAT TO SKIP

**Session commands** — instructions for this conversation only:
- "Go ahead", "Yes, do it", "Sounds good"
- "Send that email", "Check my calendar", "Book the restaurant"
- "Fix that bug", "Run the report", "Update the spreadsheet"
- Numbered step-by-step instructions for one specific task

These expire when the conversation ends.

**Task-specific instructions** — details about HOW to do one particular thing:
- "Use the blue template for this presentation"
- "Add the pricing table after slide 3"
- "Make sure to CC Sarah on that reply"
- "Store the prompt as a constant in a utility file"
- "JSON must be parsed safely by stripping code fences"
- "API route should accept { userIntent: string }"
- "On success, populate the form fields; errors show a toast"

These are about one task, not how the user generally operates.

**Other people's voice** — what someone else said, suggested, or believes:
- "Doctor said to reduce sodium"
- "Sarah thinks we should postpone the launch"
- A third party's preferences, rules, or opinions

**Assistant output** — what the assistant reported, suggested, or accomplished.

## WHAT TO EXTRACT

**Rules** the user sets:
- "Scan Gmail every morning, skip newsletters, notify via WhatsApp"
- "Never schedule meetings before 10am"
- "All client emails go through legal review first"

**Preferences** — how they want things:
- "Proper Case for email subjects, not lowercase"
- "I like detailed agendas, not just meeting titles"
- "Keep reports under 2 pages"

**Habits** — what they do regularly:
- "I journal every morning before work"
- "I review finances every Sunday"
- "Running 5k three times a week"

**Beliefs** — lasting convictions:
- "Small teams ship faster"
- "I keep a human in the loop for finances — automation makes mistakes"
- "Good documentation saves more time than good code"

**Goals** — what they're working toward:
- "I want to lose 10 kg by December"
- "Launch the beta this quarter"
- "Save enough for a down payment by next year"

**Tasks** — commitments to do something specific beyond this session:
- "Need to call the lawyer about the trademark before Friday"
- "I'll send the contract to Sarah by end of week"
- "Should check if the insurance renewal went through"

### Preserve complete statements
Keep the user's complete statement. Do NOT decompose into atomic parts.
- ✅ "Morning sync: scan gmail, exclude newsletters, check github, notify via whatsapp"
- ❌ Splitting into 4 separate facts

### Negative patterns preserved intact:
- "Use Proper Case for email subjects, not lowercase" → one fact
- "Code reviews should focus on architecture, not style nitpicks" → one fact

### Speaker attribution:
- User said it, expressed it, or confirmed it → EXTRACT
- Assistant suggested it and user agreed → EXTRACT (user's confirmed version)
- Assistant advised but user didn't confirm → SKIP
- Third party expressed it → SKIP

### Empty extraction is valid:
Most episodes — especially task execution, coding sessions, and assistant-driven workflows — contain ZERO voice facts. Return an empty array. Do NOT force-extract noise.

## EXAMPLES

### Example 1: Task execution — no voice
Episode: "User asked the assistant to book a restaurant for Saturday at 7pm, Italian food, near downtown. Assistant found three options and booked Trattoria Bella. User said 'perfect, thanks.'"

voice_facts: (none)

Why: Booking a restaurant is a session task. "Perfect, thanks" is conversational. No rules, preferences, habits, beliefs, or goals expressed. (If the user had said "I always prefer Italian" — that would be voice.)

### Example 2: Health and fitness — mixed
Episode: "Current body fat is 31%. I want to lose fat. Planning 300-500 cal deficit and 110-145g protein daily. I walk after lunch, usually 20 minutes. Doctor said to reduce sodium."

voice_facts:
- "I want to lose fat"
- "Planning 300-500 cal deficit and 110-145g protein daily"
- "I walk after lunch, usually 20 minutes"

Why: "31% body fat" is a world fact (measurement). The goal, the nutrition plan, and the walking habit are voice — any health agent should know these. "Doctor said reduce sodium" is someone else's voice → skip.

### Example 3: Work preferences buried in a session
Episode: "User told assistant: never schedule meetings before 10am. I like detailed agendas sent the day before, not just a meeting title. Also reschedule the sync with Product team to Thursday."

voice_facts:
- "Never schedule meetings before 10am"
- "I like detailed agendas sent the day before, not just a meeting title"

Why: The scheduling rule and agenda preference are lasting — any calendar agent should know these. "Reschedule the sync to Thursday" is a session command for one meeting → skip.

### Example 4: Step-by-step instructions — almost all skip
Episode: "User gave assistant a work plan: 1) Check out the whoop branch. 2) Edit index.ts to remove the legacy mcp block. 3) Run lint. 4) Commit with message 'fix: make whoop v2-compliant'. 5) Push and report back. User added: always follow existing codebase patterns and don't add new libraries."

voice_facts:
- "Always follow existing codebase patterns and don't add new libraries"

Why: Steps 1-5 are a one-time work plan for this session → skip. But "always follow existing codebase patterns" is a standing principle — any coding agent should know it.

### Example 5: Financial habits and beliefs
Episode: "User discussed budgeting. I reconcile transactions manually every week because I'm not in the US and don't have bank auto-sync. I primarily use credit cards, about 80% of transactions. I keep a human in the loop for finances — automation makes mistakes."

voice_facts:
- "I reconcile transactions manually every week because I'm not in the US and don't have bank auto-sync"
- "I primarily use credit cards, about 80% of transactions"
- "I keep a human in the loop for finances — automation makes mistakes"

Why: A habit, a behavioral pattern, and a belief — all describe how the user operates. Any financial agent should know these.

### Example 6: Reminder delivery — nothing to extract
Episode: "Reminder triggered: take fish oil. Assistant said: fish oil time, take it now. User did not respond."

voice_facts: (none)

Why: This is a reminder delivery — a session event. The user's habit of taking fish oil was already extracted when they first set the reminder. No new voice expressed here.

### Example 7: Short conversational replies and session-specific observations — skip everything
Episode: "User replied 'Go ahead.' User confirmed: 'Input is already there.' Harshith directed the assistant to the file \`gmail/src/mcp/index\` for implementation details. Harshith suggested adding a timestamp-based filter in addition to date-based filtering."

voice_facts: (none)

Why: "Go ahead" and "Input is already there" are in-conversation acknowledgments with zero meaning outside this session. "Directed attention to file X" is a session navigation instruction — it refers to a specific file in the current task. "Suggested adding a timestamp filter" is a one-time feature request for current work, not a standing rule. None of these tell a future agent anything about how the user generally operates.

### Example 8: Task-specific instructions mixed with a standing principle
Episode: "For this task: use the existing branch, add timestamp-based filtering alongside date filtering, store the logic in a utility file, test with the existing test suite. In general, always match existing code patterns and don't introduce new dependencies without discussion."

voice_facts:
- "Always match existing code patterns and don't introduce new dependencies without discussion"

Why: The task-specific steps (use this branch, add this filter, store here, test here) are one-time instructions for the current session → skip. The standing principle about code patterns and dependencies is durable — any coding agent should know it.

## OUTPUT
Return voice_facts.`;

  const userIdentitySection = context.userName
    ? `<user_identity>
The user is: ${context.userName}
</user_identity>

`
    : "";

  const userPrompt = `${userIdentitySection}<episode>
${context.episodeContent}
</episode>

Extract voice facts (user's rules, preferences, habits, beliefs, goals, commitments) from this episode.`;

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};

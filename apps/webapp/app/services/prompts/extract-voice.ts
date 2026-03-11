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
  const sysPrompt = `You are building a user's digital brain — a persistent memory of how the user operates.

Your job: Read a normalized episode and extract the user's VOICE — their rules, preferences, habits, beliefs, goals, and commitments. These are preserved as complete statements, exactly as the user expressed them.

## WHAT IS THE USER'S VOICE?

The user's voice is how they operate and what they commit to — the rules they set, what they prefer, what they do regularly, what they believe, what they're working toward, and what they've promised to do.

Ask: **"Is the user expressing how they operate, what they want, what they believe, or what they need to do?"** If yes → voice fact.

Voice facts are NOT:
- Facts about the user's world (identity, project details, events, relationships) → those go in the world graph
- Session actions directed at the assistant ("check my calendar", "fix those drafts") — but commitments to DO something outside the session ARE voice facts
- Assistant advice, opinions, or suggestions
- Third-party information or generic knowledge

## HOW TO IDENTIFY VOICE FACTS

Do NOT rely on signal words like "always" or "prefer" — many voice facts are stated as plain declarations:
- "Reports should use dark theme" → voice (formatting rule)
- "Concise replies, no fluff" → voice (communication style)
- "Running 5k three times a week" → voice (fitness habit)
- "Small teams ship faster" → voice (belief)
- "Hit 10k MRR by Q3" → voice (goal)
- "Scan Gmail every morning, skip newsletters" → voice (directive to system)
- "Need to share the updated pricing doc with the sales team" → voice (follow-up task)
- "Follow up with the design team about the mockups" → voice (commitment)

### Speaker attribution:
- The user SAID it, expressed it, or confirmed it → EXTRACT
- The assistant SUGGESTED it and user agreed → EXTRACT (the user's confirmed version)
- The assistant ADVISED it but user didn't confirm → SKIP
- A third party expressed it → SKIP (not the user's voice)

### Preserve complete statements
CRITICAL: Keep the user's complete statement. Do NOT decompose into atomic parts.
- ✅ "Morning sync: scan gmail, exclude newsletters, check github, notify via whatsapp"
- ❌ Splitting into 4 separate facts about morning sync

### Negative patterns
When text says "X (not Y)" or "X, not Y", preserve the full statement:
- "Use Proper Case for email subjects, not lowercase" → keep as one complete voice fact
- "Code reviews should focus on architecture, not style nitpicks" → keep as one complete voice fact

### Empty extraction is valid:
Many episodes contain no voice facts — just world observations, task execution, or conversation. Return an empty array. Do NOT force-extract noise to produce output.

## EXAMPLES

### Example 1: Mixed episode — only voice parts
Episode: "Current body fat is 31%. I want to lose fat. Planning 300-500 cal deficit and 110-145g protein daily."

voice_facts:
- "I want to lose fat"
- "Planning 300-500 cal deficit and 110-145g protein daily"

Why: "31% body fat" is a world fact (identity measurement), not voice. The goal and the plan are how the user operates.

### Example 2: Preferences and rules
Episode: "Use Proper Case for email subjects, not lowercase. I prefer short bullet points. Code reviews should focus on architecture, not style nitpicks."

voice_facts:
- "Use Proper Case for email subjects, not lowercase"
- "I prefer short bullet points"
- "Code reviews should focus on architecture, not style nitpicks"

Why: All voice — user expressing how they operate. Negation patterns preserved intact.

### Example 3: No voice facts
Episode: "CORE uses TypeScript, Remix for frontend, Prisma ORM. Decided to use PostgreSQL."

voice_facts: (none)

Why: All world facts — observations about the project's tech stack. No user rules, preferences, habits, beliefs, or goals expressed.

### Example 4: Voice mixed with noise
Episode: "User complained that the report formatting looks off — headings should always be bold, not italic. Assistant suggested using a CSS framework. User said just fix the headings for now."

voice_facts:
- "Report headings should always be bold, not italic"

Why: The formatting rule is the user's voice. "Just fix the headings" is a session request to assistant → SKIP. Assistant's CSS suggestion → SKIP.

### Example 5: Commitments buried in a work session
Episode: "Spent the afternoon reviewing the Q2 roadmap. Database migration is 60% done. Need to update the investor deck before Friday. Also should check if the staging SSL cert expired."

voice_facts:
- "Need to update the investor deck before Friday"
- "Should check if the staging SSL cert expired"

Why: Roadmap review and migration progress are world facts. But the two things the user needs to DO are commitments — pending tasks that matter beyond this session.

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

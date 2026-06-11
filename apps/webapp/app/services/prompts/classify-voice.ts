/**
 * Classify Voice Aspects Prompt
 *
 * Step 3a: Classifies voice facts into specific aspect types.
 * Input: voice_facts from comprehend-evaluate
 * Output: classified voice aspects (Directive, Preference, Habit, Belief, Goal, Task)
 */

import { type ModelMessage } from "ai";
import z from "zod";
import { VOICE_ASPECTS } from "@core/types";

export const ClassifiedVoiceAspectSchema = z.object({
  fact: z.string().describe("The voice fact (preserved as-is from input)"),
  aspect: z.enum(VOICE_ASPECTS).nullable().describe("Voice aspect classification, or null if the fact doesn't fit any category"),
});

export const ClassifyVoiceSchema = z.object({
  aspects: z
    .array(ClassifiedVoiceAspectSchema)
    .describe("Classified voice aspects"),
});

export type ClassifyVoiceResult = z.infer<typeof ClassifyVoiceSchema>;

export const classifyVoicePrompt = (
  voiceFacts: Array<{ fact: string }>,
): ModelMessage[] => {
  const sysPrompt = `You classify voice facts into one of 6 aspect types (or null).

These classifications determine how agents find this fact. An agent asking "what are the user's preferences?" will only see facts classified as Preference. Getting the classification right is critical for recall.

Read the fact. Understand what it means. Pick the aspect that best describes what the fact IS ABOUT.

## Aspects

**Directive** — A standing instruction telling an agent/system/user WHAT TO DO going forward. A rule for future action — not a description of how something already works.
- "Always scan Gmail in morning sync, exclude newsletters" → Directive
- "Notify me when CPU > 80%" → Directive
- "Ignore test environment webhook events" → Directive
- "Do not reimplement SDK helpers; use the official SDK" → Directive

TEST: rewrite the sentence as "Here is how X works" or "The system does Y". If the meaning is preserved, it is NOT a Directive — it is a description of reality (return null), not an instruction.

Anti-examples (these LOOK like Directives because they use "should"/"must"/"are"/"can" but are actually descriptions of how external systems behave):
- "Session events can be sent while the session is running or idle; they are queued and processed in order" → null (describes API capability)
- "Credentials are created via client.beta.vaults.credentials.create() and attached using vault_ids" → null (describes mechanism)
- "HTTP library timeouts should not be treated as hard wall-clock caps" → null (advises how to interpret existing behavior, not a rule for the agent to follow)
- "The migration guide is intended to be navigated by section headings" → null (describes document structure)
- "/sprites/catalog should display variant names matching the business taxonomy" → null (product requirement / app output, not an agent instruction)

NOT: descriptions of how systems/APIs work. NOT: advice on how to interpret external behavior. NOT: app output / product requirements. NOT: document or workflow structure. NOT: one-time session requests or personal taste without a system instruction.

**Preference** — Personal taste about HOW THE USER wants their own work, output, or interactions PRESENTED or FORMATTED. Style/format taste about user-facing presentation — not system architecture, not one-time spec edits, not standing instructions about how work should be done.
- "I prefer short bullet points over long paragraphs" → Preference
- "Proper Case for email subjects" → Preference
- "Dark mode for all interfaces" → Preference
- "I want feedback on structure/narrative flaws, not grammar" → Preference

TEST: ask "is this about the presentation/format/style of the OUTPUT the user sees or interacts with, or is it about how the SYSTEM should work internally?" If it's about system internals (data storage, caching, prompt architecture, product positioning) → Directive. If it's a specific one-time product detail (copy, asset dimensions, single UI tweak) → Task. Preference is reserved for the user's personal taste in PRESENTATION.

Anti-examples (these SOUND like Preferences because they use "prefer"/"want", but are Directives about system architecture or standing work rules):
- "I want the system prompt kept frozen and avoid interpolating dynamic values into the system prompt" → Directive (caching/architecture strategy, standing rule)
- "Harshith prefers storing the town state in the database rather than using localStorage" → Directive (data-storage architecture, not presentation taste)
- "For debugging work, the final deliverable should be a summary of what was found and what was fixed" → Directive (standing instruction for work output across all debugging tasks)
- "I prefer reducing complexity and avoiding extensive configuration; consolidate into simple defaults" → Directive (system design philosophy, standing rule)
- "Harshith prefers CORE be positioned carefully for Hacker News launch — described as an orchestration layer" → Belief or Directive (product positioning / strategic stance)

Anti-examples (one-time spec edits that sound like Preferences but are Tasks):
- "The robot's eye sizes should be reduced relative to the current design" → Task (specific one-time design change)
- "Morning Brief instruction text should say 'Send the brief to the default channel' rather than 'Send to Slack'" → Task (one-time copy edit)

NOT: system architecture, data storage, or caching strategy → Directive. NOT: product positioning or strategic stance → Belief or Directive. NOT: one-time design/copy/spec edits → Task. NOT: standing instructions for work output format → Directive. NOT: value judgments about how the world works → Belief.

**Habit** — What the USER (as a person) actually DOES REPEATEDLY in real life. Recurring personal behaviors, routines, rituals, communication patterns — not engineering methodologies, SDK conventions, or tool workflows.
- "Takes fish oil supplements daily at breakfast" → Habit
- "Reviews PRs every morning before standup" → Habit
- "I primarily use credit cards for spending, about 80% of transactions" → Habit
- "Maintains a daily scratchpad for tasks and notes" → Habit
- "Asks clarifying questions before starting work; challenges proposed approaches" → Habit

TEST: would this recurring pattern exist if the user switched jobs or stopped using a specific SDK/tool? If the pattern is bound to "when using X SDK" or "when configuring Y tool" or "my debugging strategy for Z", it is a Preference or Directive, not a Habit. Habits are about the PERSON; methodologies are about HOW THEY WORK.

Anti-examples (these SOUND like habits because they describe a repeated pattern, but are SDK/tool methodologies, conceptual stances, or problem reports):
- "When using the @anthropic-ai/sdk TypeScript client, I handle errors via typed exception classes" → Preference or Directive (coding methodology, not a personal habit)
- "For Extended Thinking configuration, I use adaptive thinking for Opus 4.7/4.6" → Directive (SDK configuration pattern)
- "I verify prompt-cache effectiveness by inspecting Claude API response usage fields" → Directive (how to verify a system behavior)
- "When using use_figma, I work incrementally in small steps and stop on any error" → Preference or Directive (tool workflow pattern)
- "He already has agent handoffs automated via scripts, but context still leaks between agents" → null (problem report / system observation, not a habit)
- "He is thinking in terms of memory primitives and session compaction" → Belief or null (conceptual stance, not a demonstrated recurring behavior)
- "I position CORE as a coordination/orchestration layer" → Belief (positioning / strategic principle)

NOT: SDK or coding methodologies → Preference/Directive. NOT: tool workflows or configuration patterns → Preference/Directive. NOT: conceptual stances or worldviews → Belief. NOT: problem reports or system observations → null. NOT: something the user WANTS to start but isn't doing yet → Goal.

**Belief** — A lasting CONVICTION or value judgment about how the world works. The user's principles — not a documented fact that anyone reading the same docs would agree with.
- "Open-source builds more trust than closed products" → Belief
- "Code reviews should focus on architecture, not style" → Belief
- "Small teams move faster than large ones" → Belief
- "I intentionally keep a human in the loop to avoid errors" → Belief

TEST: could two reasonable people disagree with this? If the answer is "no — anyone reading the docs/spec would agree" — it is a documented fact (return null), not a Belief. If the user is recording a technical detail about an external API, SDK, model, or system, return null.

Anti-examples (these SOUND like principles because they use declarative language, but are documented facts about external systems):
- "vault_ids can be set only at session creation time and cannot be set via session update" → null (API behavior, documented fact)
- "How I obtain the initial OAuth access token depends on the specific MCP server" → null (procedural fact)
- "If I only have an OAuth access token with no refresh capability, I should omit the refresh block" → null (documented API constraint)
- "Archived resources cannot be referenced by new sessions; archiving is permanent" → null (system behavior)
- "Only cloud environments are supported: config.type: 'cloud' is the sole supported type" → null (product limitation)
- "Do not mix beta and non-beta message types" → null (SDK compatibility rule, not a conviction)
- "Claude Opus 4.7 and Opus 4.6 count tokens differently" → null (model behavior)

NOT: documented technical facts about external APIs/SDKs/models → null. NOT: procedural workarounds or constraints → null. NOT: standing operating rules ("if intermittent, don't fix") → Directive. NOT: momentary reactions, opinions about a specific draft, or task feedback.

**Goal** — Something the USER personally is working toward over time. A sustained pursuit (days/weeks/months) of an objective the user is driving — not a feature specification for a system.
- "I want to run a marathon by December" → Goal
- "Launch the personal-OS MVP this quarter" → Goal
- "I want to personally onboard Guillaume" → Goal
- "Ship the home-screen redesign before Q4" → Goal

TEST: ask "who is pursuing this?" If the subject of the wish is THE SYSTEM/PRODUCT/SKILL ("the app should support X", "the gateway should include Y", "the skill is to do Z"), it is a Directive — a standing instruction for what the system must do — not a Goal. Goal is what the USER is personally pursuing.

Anti-examples (these SOUND like Goals because they use "wants"/"should"/"goal for", but the subject is the system, not the user's personal pursuit):
- "Wants the app to support OpenAI in addition to Anthropic" → Directive (feature requirement)
- "OpenCode should have the same functionality as claude-code and codex (full feature parity)" → Directive (system mandate)
- "Wants CORE's open-source deployment to include the gateway component" → Directive (product requirement)
- "Goal for the claude-code-plugin skill is to ask OpenAI Codex questions about a repository codebase" → Directive (tool behavior spec)

NOT: feature requirements or product specifications, even if phrased as "I want the app to X" → Directive. NOT: one-time follow-ups or action items → Task. NOT: pending evaluation work ("considering migrating to X") → Task.

**Task** — A specific, FUTURE, uncompleted commitment the user intends to do. A one-time action item with a clear completion state — not a record of work already done, a decision already finalized, or a standing want.
- "Need to send the proposal to the client by Friday" → Task
- "Follow up with the design team about the mockups" → Task
- "I will add Guillaume to the unsubscribe list" → Task

TEST: rewrite the sentence in past tense — "I documented X", "I approved Y", "I selected Z". If the sentence already reads naturally in past tense (the action has already happened or the decision is already made), it is NOT a Task — it is a record of an event (return null).

Anti-examples (these SOUND like Tasks because they use commitment language, but describe completed work, finalized decisions, problem reports, or preferences):
- "Documented TypeScript/Anthropic SDK cost-optimization patterns" → null (work already completed, past tense)
- "Harshith approved proceeding with a custom apartment build for HOME" → null (decision already made, not a future commitment)
- "Approved renaming the in-game CAFE concept to bakeryonly" → null (decision finalized)
- "Harshith confirmed the decision to implement both proposed UI changes" → null (decision already confirmed)
- "Selected voice-stack approach: Option B — Whisper-style speech-to-text" → null (a decision already taken; if there is still work to do, the work itself would be the Task)
- "Reported a bug: when Needs Attention widgets are removed they reappear" → null (bug report, not a commitment to fix)
- "Harshith wants proper collision blocking in the HOME interior" → Preference (desired system behavior, not a one-time action with a clear done-state)
- "Harshith offered to help Ziming transition to self-hosting" → null (open-ended standing offer, no specific deliverable or deadline)

NOT: records of decisions already finalized → null. NOT: work already completed → null. NOT: bug or problem reports → null. NOT: standing preferences or system-behavior wishes → Preference. NOT: sustained objectives → Goal. NOT: standing rules for systems → Directive.

**null** — The fact doesn't clearly fit any aspect. It may be noise that slipped through extraction, a product description, or a session-specific statement that isn't really the user's voice.
- "CORE's morning brief is pitched as a single daily summary" → null (product description, not user's voice)
- "The assistant should ask Manik to search using the corebrain plugin" → null (session instruction to assistant)

## Rules
- Each fact gets exactly ONE aspect (or null)
- Do NOT modify the fact text — return it exactly as received
- Classify based on WHAT THE FACT MEANS, not keywords in the text
- If a fact doesn't fit any category, return null — do NOT force it into the closest match`;

  const factsFormatted = voiceFacts
    .map((f, i) => `${i + 1}. ${f.fact}`)
    .join("\n");

  const userPrompt = `Classify each voice fact:

${factsFormatted}`;

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};

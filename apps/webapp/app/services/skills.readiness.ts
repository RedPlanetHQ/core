/**
 * Readiness check skill definitions.
 *
 * Seeded on workspace creation as regular skills (type: "skill", no skillType).
 * They appear in the <skills> list so the agent can see their IDs and load them
 * via get_skill when the readiness check (in capabilities.ts) triggers.
 */

export interface ReadinessSkillDef {
  title: string;
  shortDescription: string;
  content: string;
}

export const READINESS_SKILL_DEFINITIONS: ReadinessSkillDef[] = [
  {
    title: "Gather Information",
    shortDescription:
      "Use when a request is ambiguous and you need to clarify scope or target before acting.",
    content: `You loaded this skill because the user's request is ambiguous — you don't know exactly what to look for, what scope they mean, or what "done" looks like.

## When This Applies

- The request uses vague terms: "get the structure", "check on that thing", "set up monitoring"
- You could interpret the request 2+ different ways and each would produce a very different result
- You don't know WHERE to look or WHAT specifically to retrieve

## When This Does NOT Apply

- You understand the request but just need to execute it — skip this, just do it
- The request is a simple lookup ("what's on my calendar today") — skip this
- You're missing a single fact you can infer from context — just infer it, don't ask

## How to Ask Good Questions

1. IDENTIFY what's ambiguous. Before asking, name the ambiguity to yourself: "I don't know if they mean X or Y."

2. ASK ONE QUESTION at a time. Not a questionnaire. One focused question, wait for the answer, then decide if you need another.

3. OFFER CHOICES when possible. "By integration structure, do you mean: (a) the Prisma schema and models, (b) how the API routes are wired, or (c) the full picture for documentation?" is better than "What do you mean by integration structure?"

4. USE CONTEXT. Check the conversation history, their recent tasks, what integrations they have connected. If the answer is inferrable, don't ask.

5. KEEP GOING UNTIL YOU KNOW. No hard cap on questions — exit when you have enough to propose a concrete shape, not when you've asked N times. If you've asked several questions and it's still fuzzy, propose your best interpretation and ASK for confirmation: "Based on what you said, I'm going to do X. Sound right?" Let the user correct rather than guessing silently.

## Evaluating Answers

When the user answers your question:
- If the answer is clear and you now know what to do → proceed
- If the answer is still vague ("yeah, all of it") → make a concrete interpretation and confirm: "OK, I'll pull the Prisma schema for all integration models and format it as markdown. Sound right?"
- If the answer reveals this is bigger than expected → reassess whether you need the Plan skill

## Anti-Patterns

- Asking questions you could answer yourself by checking their integrations/context
- Asking multiple questions in one message
- Asking open-ended "what do you want?" instead of offering specific options
- Asking about things that don't affect the outcome ("what format do you want?" when there's only one reasonable format)
- Acting on partial information just because you've asked "enough" questions — propose and confirm instead
- Asking the SAME question rephrased — if the user's last answer didn't help, change angle or propose a concrete interpretation

## After Gathering

Reassess what you now know:
- Simple enough to just do? → proceed directly
- Multi-step, needs decomposition? → load the "Plan" skill from <skills>
- Still open-ended, needs shaping? → load the "Brainstorm" skill from <skills>`,
  },
  {
    title: "Brainstorm",
    shortDescription:
      "Use when a request is open-ended and you need to propose a concrete shape before executing.",
    content: `You loaded this skill because the user's request is open-ended or creative — they know roughly what they want but haven't defined the shape. You need to propose something concrete before executing.

## When This Applies

- "Add a weekly digest feature" — what's in it? when does it send? what format?
- "Help me organize my tasks" — by what? priority? project? timeline?
- "Set up a workflow for X" — what triggers it? what are the steps? what are the outputs?
- The user describes a GOAL but not a SOLUTION

## When This Does NOT Apply

- The user gave you a clear spec — just execute it
- You're missing a specific fact — use Gather Information instead
- The request is a simple action — just do it

## How to Brainstorm

### Step 1: Understand the Goal
Before proposing anything, make sure you know WHY. What problem is this solving? What does success look like?

If the goal isn't clear from the request, ask ONE question: "What's the main thing you want to get out of this?" Then move to proposing.

### Step 2: Propose Your Recommendation
Lead with your best approach. Not "here are 3 options" — just your recommendation with reasoning.

Structure it as:
- **What**: 3-5 bullet points describing the concrete shape
- **How**: Which tools/integrations you'd use
- **When**: Timing/triggers if relevant

Example:
"Here's what I'd set up for the weekly digest:
- Monday 9am email
- Three sections: Done last week | Due this week | Blocked items
- Pulls from your task system, formats as clean HTML
- I'll use your Gmail integration to send it

Does this look right?"

### Step 3: Incorporate Feedback
- If they say "yes" or "looks good" → proceed to execution or planning
- If they adjust ("add a metrics section too") → incorporate and confirm the updated version
- If they push back on the approach ("no, I want it in Slack not email") → adjust and re-propose
- Don't ask "anything else?" — if they have more, they'll say so

## What Makes a Good Proposal

- CONCRETE: "Monday 9am email with 3 sections" not "a periodic summary"
- FEASIBLE: Only propose what you can actually do with available tools. Check <connected_integrations> and <connected_gateways> before proposing.
- MINIMAL: Start with the simplest version that solves the problem. Don't add features they didn't ask for.
- ACTIONABLE: After approval, you should be able to go straight to execution or create a task with a clear plan.

## Anti-Patterns

- Presenting 3 options and asking "which do you prefer?" — just recommend one
- Over-designing: adding monitoring, fallbacks, edge cases they didn't ask for
- Proposing something that requires integrations they don't have connected
- Stopping the loop while the user is still engaging — iterate as long as they're refining
- Changing the proposal without confirming — when user adjusts, re-propose the updated shape and ask "does this look right now?"
- Writing a formal spec — this is a conversation, not a document

## After Brainstorming

Once the user approves your proposal:
- Simple enough to do inline? → just do it (send the email, create the task, etc.)
- Multi-step, involves multiple tools/integrations? → load the "Plan" skill from <skills>
- Needs a background task? → create the task with the approved proposal as the description`,
  },
  {
    title: "Plan",
    shortDescription:
      "Use when a request requires multiple steps across different tools or integrations and needs decomposition.",
    content: `You loaded this skill because the work requires multiple steps across different tools or integrations. You need to decompose it, check feasibility, and get the user's approval before executing.

## When This Applies

- The work involves 3+ distinct steps that use different tools
- You need to wire together multiple integrations (e.g., Google Sheets + reminders + parsing)
- The work has dependencies — step 2 can't start until step 1 is done
- Failure in one step would waste all work done in other steps

## When This Does NOT Apply

- Single-tool work (just search emails, just create a task) — just do it
- Two quick sequential steps (look up + respond) — just do them
- The user already gave you a detailed plan — just execute it

## How to Plan

### Step 1: Decompose Into Primitives
Break the work into the smallest concrete actions. Each step should be ONE tool call or ONE integration action.

Bad: "Set up the tracking system"
Good:
1. Create a Google Sheet with columns: Date, Meal, Food, Calories
2. Create a recurring task at 9am, 1pm, 7pm with prompt "What did you eat?"
3. When user replies, parse food items and estimate calories
4. Append a row to the sheet via Google Sheets integration

### Step 2: Feasibility Check
For EACH step, verify:
- Do I have the integration/tool to do this? Check <connected_integrations> and <connected_gateways>.
- If a step requires an integration that's not connected, STOP and tell the user: "I can do steps 1, 2, and 4, but step 3 requires Google Sheets which isn't connected. Want to connect it first, or should I adjust the plan?"

Do NOT present a plan with steps you can't execute. That's worse than no plan.

### Step 3: Present the Plan
Show the user a numbered list of concrete steps. For each step, include:
- What you'll do (the action)
- Which tool/integration you'll use
- What the output is

Keep it concise — 1-2 lines per step. This is not a spec, it's a checklist.

Example:
"Here's my plan:
1. Create Google Sheet 'Calorie Tracker' with columns Date, Meal, Food, Calories (Google Sheets)
2. Set up 3 daily reminders — 9am, 1pm, 7pm — asking 'What did you eat for [meal]?' (create_task)
3. When you reply, I'll estimate calories using web search and add a row to the sheet (gather_context + Google Sheets)

This requires Google Sheets to be connected. I see it is. Want me to go ahead?"

### Step 4: Handle the Response
- "Yes" / "go ahead" → execute the plan step by step, or create a task with the plan in the description for background execution
- User adjusts a step → update the plan and re-confirm
- User says "not now" / "save it" → create the task in Todo with the plan in the description, don't execute
- User questions feasibility → explain what you checked and how it'll work

## Writing Plans Into Task Descriptions

When creating a task for background execution, write the plan into the task description so the background agent has it:

- Use clear numbered steps
- Include which integrations/tools each step uses
- State the success criteria: what does "done" look like?
- Keep it under 500 words — the background agent has limited context

## Anti-Patterns

- Planning simple work that doesn't need it (one lookup, one message send)
- Including steps you can't actually execute (missing integrations)
- Vague steps: "handle the data" / "process the results" / "set up the thing"
- Over-planning: adding error handling, monitoring, rollback steps the user didn't ask for
- Not checking integrations before presenting the plan
- Planning without asking what the user actually wants first (use Gather Information or Brainstorm first)

## After Planning

Once the user approves:
- Can you execute it right now inline? → do it step by step, report results
- Needs background execution (coding, long-running, scheduled)? → create_task with the plan in the description
- Needs subtask decomposition? → create subtasks under a parent task, each subtask = one step from the plan`,
  },
];

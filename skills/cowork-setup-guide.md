# Cowork Setup Guide Skill

## Purpose
Guide users through the complete Claude Cowork setup — from workspace structure to context files, global instructions, plugins, connectors, and safety defaults. Automates the creation of all required configuration files and validates the setup.

## Trigger Phrase
When the user says any of:
- "Set up Cowork"
- "Configure Cowork"
- "Cowork setup"
- "Initialize my workspace"
- "Help me set up Cowork"
- "Cowork onboarding"

## Workflow

### Step 1: Initialize Memory Session
```
Start by initializing a conversation session for memory storage:
- Call: CORE Memory:initialize_conversation_session with new=true
- Store the returned sessionId for later use
- This session will capture all setup preferences for future reference
```

### Step 2: Gather User Profile
```
Ask the user for their profile information:

REQUIRED:
- Full name
- Job title / role
- Company or organization
- Day-to-day responsibilities (2-3 sentences)
- Key stakeholders they work with
- What success looks like in their role

OPTIONAL:
- Industry / sector
- Key terminology or frameworks they use
- Tools and platforms in their current workflow

Store responses for context file generation.
```

### Step 3: Gather Communication Style
```
Ask the user about their communication preferences:

REQUIRED:
- Tone description (e.g., "Direct and concise. No filler. Technical when warranted.")
- 2-3 phrases they naturally use
- 2-3 phrases that sound wrong to them / anti-patterns
  (e.g., "Never use 'leverage' as a verb", "Don't open with 'I hope this email finds you well'")

OPTIONAL:
- Paste 2-3 short writing samples (emails, posts, docs)
- Preferred language(s)

Store responses for brand voice file generation.
```

### Step 4: Gather Working Preferences
```
Ask the user about how they want Claude to work:

PROCESS PREFERENCES:
- Should Claude ask clarifying questions before starting? (default: yes)
- Should Claude show a plan before executing? (default: yes)
- Preferred output format: .md / .docx / .xlsx / other

OUTPUT STYLE:
- Short vs. detailed outputs
- Preferred formatting conventions
- File naming conventions (e.g., kebab-case, date-prefix)

SAFETY GUARDRAILS:
- Confirm default safety rules:
  - Never delete files without explicit confirmation
  - Never modify files outside the designated output folder
  - Flag assumptions explicitly before acting on them
- Ask if user wants to add custom guardrails

Store responses for working preferences file generation.
```

### Step 5: Create Workspace Structure
```
Create the recommended workspace folder structure:

~/Claude-Workspace/
├── context/          # Standing context files
├── projects/         # Active project folders
└── outputs/          # Where Claude delivers finished work

If user specifies a different root path, use that instead.
Confirm the path with user before creating.
```

### Step 6: Generate Context Files
```
Using gathered information, generate three files by populating the templates
in skills/templates/context/ with the user's responses:

1. context/about-me.md    — use template: skills/templates/context/about-me.md
   Replace bracket placeholders with gathered profile data from Step 2.

2. context/brand-voice.md — use template: skills/templates/context/brand-voice.md
   Replace bracket placeholders with communication style from Step 3.

3. context/working-preferences.md — use template: skills/templates/context/working-preferences.md
   Replace bracket placeholders with working preferences from Step 4.
   Append any custom guardrails the user specified.
```

### Step 7: Generate Global Instructions
```
Compose a concise global instructions block from the gathered context:

   I'm {Name}, {Role} at {Company}. I work on {domain}.

   Communication: {tone summary}. Default to {preferred format} for outputs.

   Process: {process preferences summary}.

   Safety: Never delete files without my explicit approval. Flag any
   destructive actions before executing. {custom guardrails}

Present to user for review. This goes into Settings > Cowork > Global Instructions.
```

### Step 8: Recommend Plugins
```
Based on the user's role, recommend plugins to install:

Available plugins (as of February 2026):

ALWAYS RECOMMEND:
- Productivity (useful for every role)

ROLE-BASED RECOMMENDATIONS:
- Sales / BD → Sales plugin
- Marketing / Content → Marketing plugin
- Finance / Accounting → Finance plugin
- Legal / Compliance → Legal plugin
- Engineering / DevOps → Engineering plugin
- Product Management → Product Management plugin
- Data / Analytics → Data Analysis plugin
- HR / People Ops → HR plugin
- Design / UX → Design plugin
- Operations → Operations plugin
- Customer Support → Customer Support plugin

FINANCIAL SERVICES:
- Investment Banking → Investment Banking plugin
- Equity Research → Equity Research plugin
- Private Equity → Private Equity plugin
- Wealth Management → Wealth Management plugin

Provide install instructions:
1. In Cowork, click "Customise" in the left sidebar
2. Click "Browse plugins"
3. Install recommended plugins
4. Type / to see available slash commands
```

### Step 9: Recommend Connectors
```
Based on the user's tools (from Step 2), recommend connectors:

Available connectors (as of February 2026):
- Communication: Slack, Gmail, Microsoft 365
- Project Management: Asana, Linear, Jira, Monday, ClickUp
- Documentation: Notion, Google Drive, Box, Egnyte
- Design: Figma, Canva
- Data: Snowflake, Databricks, BigQuery, Hex, Amplitude
- CRM / Sales: HubSpot, Close, Clay, ZoomInfo, Apollo, Outreach
- Support: Intercom, Guru
- Calendar: Google Calendar
- Legal: DocuSign, Harvey, LegalZoom
- Finance: FactSet, MSCI
- Other: Fireflies, WordPress, Ahrefs, SimilarWeb, Klaviyo, Benchling, Pendo

Match user's existing tools to available connectors.
Prioritize: connect the tool they use most first.

Provide instructions:
1. Go to Settings > Connectors in Claude Desktop
2. Browse integrations
3. Click connector and authenticate
```

### Step 10: Validate Setup
```
Run a verification prompt to confirm everything works:

Ask user to start a new Cowork session with their workspace folder selected and type:

   Read all the files in the context folder. Then tell me:
   1. What you know about me
   2. How I prefer to work
   3. What standing preferences you're aware of

   Do not start any other work yet.

If output accurately reflects context files and global instructions → setup complete.
If something's off → identify which file needs updating and fix it.
```

### Step 11: Store Setup in Memory
```
At the end of setup:
1. Call: CORE Memory:memory_ingest
   - sessionId: {from Step 1}
   - message: Complete setup summary including:
     - Date of setup
     - Workspace path
     - Context files created
     - Global instructions configured
     - Plugins recommended
     - Connectors recommended
     - Any custom guardrails
     - User preferences captured
```

## Output Format

Present a progress summary after setup showing: completed steps checklist,
files created (with paths), the composed global instructions block,
recommended plugins and connectors, and next steps for the user
(copy instructions, install plugins, connect tools, run verification prompt).

## Safety Reminders

Always include these safety notes during setup:

- **Dedicated workspace**: Never point Cowork at your entire home directory or Documents folder
- **Backup first**: `cp -R ~/Claude-Workspace/ ~/Claude-Workspace-Backup/` before first real task
- **Deletion protection**: Include "never delete files without explicit confirmation" in global instructions
- **Scope awareness**: Watch for Claude accessing files you didn't mention or scope expanding beyond what you asked
- **No audit logging**: Cowork activity is not captured in audit logs — do not use for regulated workloads
- **Session persistence**: The app must stay open — closing it kills the task with no recovery
- **Prompt injection risk**: Limit Claude in Chrome access to trusted sites only

## Error Handling

If memory integration fails:
- Continue with setup without memory storage
- Provide all outputs directly to user for manual saving

If user doesn't know their preferences:
- Use sensible defaults (ask clarifying questions: yes, show plan: yes, format: .md)
- Note that all context files can be updated later — they compound over time

If user wants to update existing setup:
- Read existing context files first
- Ask what needs changing
- Update only the relevant files
- Re-run the verification prompt

## Notes

- All context files can be updated after setup — they compound over time
- Workspace root path defaults to ~/Claude-Workspace/ but can be changed in Step 5
- Plugin and connector lists reflect the catalog as of February 2026 and may change

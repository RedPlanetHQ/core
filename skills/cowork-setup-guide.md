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
Using gathered information, generate three files:

1. context/about-me.md
   ─────────────────────
   # About Me

   ## Role & Responsibilities
   - {name}, {title} at {company}
   - {day-to-day responsibilities}
   - Key stakeholders: {stakeholders}
   - Success metric: {what success looks like}

   ## Domain Context
   - Industry: {industry}
   - Key terminology: {terminology}
   - Tools: {tools and platforms}

   ## Example Work
   {Paste user-provided examples, or note: "Add 1-2 examples of output
   you're proud of — reports, emails, analyses."}

2. context/brand-voice.md
   ────────────────────────
   # Communication Style

   ## Tone
   - {tone description}
   - Phrases I use: {natural phrases}
   - Phrases to avoid: {anti-patterns}

   ## Writing Samples
   {User-provided samples, or note: "Add 2-3 short examples of your
   actual writing — emails, posts, docs."}

   ## Anti-patterns
   {List each anti-pattern as a bullet}

3. context/working-preferences.md
   ────────────────────────────────
   # How I Want Claude to Work

   ## Process
   - {clarifying questions preference}
   - {plan-before-executing preference}
   - Save outputs as {preferred format}

   ## Output Style
   - {short vs. detailed}
   - {formatting conventions}
   - {file naming conventions}

   ## Guardrails
   - Never delete files without explicit confirmation
   - Never modify files outside the designated output folder
   - Flag assumptions explicitly before acting on them
   {Additional custom guardrails}
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

Present the setup progress as:

```markdown
# Cowork Setup Progress

## ✅ Completed Steps
- [x] User profile gathered
- [x] Communication style captured
- [x] Working preferences set
- [x] Workspace structure created
- [x] Context files generated
- [x] Global instructions composed
- [x] Plugins recommended
- [x] Connectors recommended

## 📁 Files Created
- ~/Claude-Workspace/context/about-me.md
- ~/Claude-Workspace/context/brand-voice.md
- ~/Claude-Workspace/context/working-preferences.md

## 🔧 Global Instructions
[Show the composed instructions block]

## 🔌 Recommended Plugins
1. Productivity (install first)
2. {Role-specific plugin}

## 🔗 Recommended Connectors
1. {Highest-priority connector}
2. {Second connector}

## ✅ Next Steps
1. Copy global instructions into Settings > Cowork > Global Instructions
2. Install recommended plugins via Customise > Browse plugins
3. Connect tools via Settings > Connectors
4. Run the verification prompt to confirm setup
5. Start with a task you already know how to do well — so you can evaluate the output
```

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

## Customization

User can modify:
- Workspace root path (default: ~/Claude-Workspace/)
- Number and type of context files
- Safety guardrail strictness
- Plugin and connector recommendations
- Output format preferences

## Success Criteria

Skill is successful if:
1. All three context files are created and populated with user-specific information
2. Global instructions are composed and ready for copy-paste
3. Plugin recommendations match user's role
4. Connector recommendations match user's existing tools
5. Verification prompt confirms setup is working
6. User understands safety defaults and has them configured
7. Setup preferences are stored in CORE Memory for future reference

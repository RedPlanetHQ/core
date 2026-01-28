const PROMPTS = {
  "session-start": `You MUST call core_brain memory_about_user right now. This is not optional — it retrieves the user's profile, preferences, and background. Do not proceed with any response until this tool has been called.`,

  "on-prompt": `You MUST call core_brain memory_search multiple times before responding — once per distinct intent. Break the user's message into separate focused queries. Do NOT merge everything into one broad search. Each query must be a complete sentence, never keywords.

Examples of how to break intents:

- User says "fix this auth bug, also update the dashboard" →
  1. "Previous discussions about authentication bugs and login error handling"
  2. "Past decisions and changes related to the dashboard component"

- User says "add export feature like we discussed" →
  1. "Past decisions on implementing export functionality and file formats"
  2. "Earlier conversations about export feature design and requirements"

- User pastes an error and asks about preferences →
  1. "Similar errors encountered previously and how they were resolved"
  2. "User's coding preferences, style choices, and project conventions"

Call each search separately. Do not respond until all searches are done.`,

  "stop": `You MUST call core_brain memory_ingest now. This is not optional. Store a summary covering: what the user asked, what you did or explained, any decisions made, and key technical details. Do not skip this step — it ensures continuity across sessions.`
};

const command = process.argv[2];

if (!command || !PROMPTS[command]) {
  console.error(`Usage: node base.cjs <session-start|on-prompt|stop>`);
  process.exit(1);
}

console.log(PROMPTS[command]);

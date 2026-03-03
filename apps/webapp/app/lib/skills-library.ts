export interface SkillIntegration {
  name: string;
  slug: string;
  optional?: boolean;
}

export interface LibrarySkill {
  slug: string;
  title: string;
  shortDescription: string;
  category: "Email" | "Planning";
  integrations: SkillIntegration[];
  content: string;
}

export const LIBRARY_SKILLS: LibrarySkill[] = [
  {
    slug: "email_label_management",
    title: "Email Label Manager",
    shortDescription:
      `Automatically label every incoming email using 9 categories — Urgent, Meetings, Transcripts, Customer, Action Required, Receipts & Invoices, Financial, Trying to Sell, and FYI — so your inbox stays organised without any manual effort. Trigger with "label my emails", "set up email labels", or "organise my inbox automatically".`,
    category: "Email",
    integrations: [{ name: "Gmail", slug: "gmail" }],
    content: `**Goal:** Read the email subject and body, determine the best matching labels from the list below, and apply up to 2 — the 2 most specific matches. Work through labels in priority order.

**Tools Required:** Gmail

### Setup — Run Once Before First Label

Search memory for the following before processing any email:

- "user's product name and how customers or users are identified"
- "user's key vendors, compliance providers, or financial services"
- "user's payroll or compliance tools and their sender domains"
- "email labelling rules or inbox organisation preferences"

Use whatever is found to personalise the Urgent and Customer label matching below.

If nothing relevant is found → use the generic matching rules as written. After the first run, ask once:

> "To label your emails accurately, I need a few details:
>
> 1. What is your product or business name? I'll use this to identify customer emails.
> 2. Who are your key vendors or compliance providers I should flag as Urgent? (name, email, or domain)
> 3. Any payroll or financial tools I should watch for compliance deadlines? (e.g. Razorpay, Gusto, Xero)
>
> I'll remember these — you won't need to tell me again."

Store all answers in memory immediately.

---

### Label Definitions & Matching Rules

Work through labels in priority order. Apply up to 2 labels — the most specific matches. Stop after 2.

---

#### 1. 🚨 Urgent

Apply when the email is time-sensitive and must be handled same day.

Matches if:

- A customer is reporting a bug or critical issue with the user's product (check memory for product name)
- Email is from a payroll or compliance tool about a deadline (check memory for provider names)
- Email is from a known compliance or bookkeeping vendor about a critical issue (check memory for vendor domains)

> Check this label first — it overrides Action Required or Customer for critical cases.

---

#### 2. 📅 Meetings

Apply when the email is a calendar-related notification.

Matches if:

- Subject contains: "invitation", "accepted", "declined", "cancelled", "updated", "event", "meeting request"
- Sent by Google Calendar, Outlook Calendar, or any calendar system

---

#### 3. 🎙 Meeting Transcripts

Apply when the email contains a meeting summary, transcript, or recording.

Matches if:

- Sender is Gemini, Fireflies, Otter.ai, Fathom, Grain, or any meeting bot or transcription service
- Subject contains: "transcript", "summary", "recording", "notes from", "meeting recap"

---

#### 4. 👤 Customer

Apply when the email is related to the user's product — from a customer, user, or prospect.

Matches if:

- The body mentions the user's product by name (check memory for product name and any known aliases)
- The email is a support request, bug report, feature request, or question about the product
- Someone is reaching out as a potential customer or expressing interest in the product

---

#### 5. ⚡ Action Required

Apply when the ball is in the user's court and a response or action is needed.

Matches if:

- Someone is asking a question that needs an answer
- Someone is waiting on feedback, approval, or a decision
- An unresolved thread needs follow-up

**Do NOT apply if:**

- The sender is trying to sell a product or service (→ use Trying to Sell)
- It's a promotional or marketing email

---

#### 6. 🧾 Receipts and Invoices

Apply when the email is a bill or invoice with an attachment.

Matches if:

- Email has an attachment (PDF, image, or document)
- Subject or body references: invoice, receipt, bill, statement, purchase confirmation
- The attachment appears to be a financial document

> Key distinction from Financial: this label requires an attachment.

---

#### 7. 💰 Financial

Apply when the email is a financial notification without an attachment.

Matches if:

- Payment received, sent, or failed
- Bank or card transaction alert
- Account balance update
- Salary credited, subscription charged
- Senders from known financial platforms (check memory for user's bank, payment tools, card providers)

> No attachment required — that separates this from Receipts and Invoices.

---

#### 8. 🛍 Trying to Sell

Apply when someone is pitching a product, service, or partnership to the user.

Matches if:

- Cold outreach trying to sell software, services, agencies, or tools
- Partnership or collaboration pitches where the sender wants something
- Promotional offers from companies the user hasn't bought from

---

#### 9. ℹ️ FYI

Apply when the email is informational only and no action is needed.

Matches if:

- Product updates or feature announcements from tools the user already uses
- Newsletters and digests
- General notifications that don't require a response

> Catch-all for low-priority informational emails. Apply last if nothing else fits.

---

### Edge Cases

- **Multiple labels could apply** → use priority order above. Urgent beats everything. Apply up to 2 — skip the rest.
- **Truly ambiguous** → default to FYI rather than leaving unlabelled.
- **Email is already labelled** → do not overwrite manual labels. Skip entirely.`,
  },
  {
    slug: "notify_emails",
    title: "Email Alert — Notify Me",
    shortDescription:
      `Get notified the moment an important email lands — from key vendors, customers, or security services — with a quick summary and action flag, so nothing slips through. Trigger with "notify me for important emails", "alert me when I get emails from [person/vendor]", or "set up email alerts".`,
    category: "Email",
    integrations: [{ name: "Gmail", slug: "gmail" }],
    content: `**Goal:** Check if the email is from a key sender or category. If yes, immediately send a summary notification. If no match, do nothing.

**Tools Required:** Gmail

### Setup — Run Once Before Processing

Search memory for the following before doing anything else:

- "user's key vendors, suppliers, or accountants and their email addresses or domains"
- "user's product name and how customers are identified"
- "security alert senders the user cares about — e.g. Google, bank, financial tools"
- "key people whose emails should trigger an immediate notification"

Use whatever is found to pre-populate the matching logic below.

If nothing is found for a category, fill it in from the user's past conversations where possible. Only ask the user if truly no context exists:

> "To set up your email alerts, I need a few details:
>
> 1. Who are your key vendors or contacts I should always notify you about? (name, email, or domain)
> 2. What is your product or business called? How do I identify emails from your customers?
> 3. Any security or financial services I should watch for alerts from? (e.g. Google, Stripe, your bank)
>
> I'll remember these — you won't need to tell me again."

Store all answers in memory immediately.

---

### Step 1 — Check the Sender

Read the sender's email address and name. Check if it matches any key contact stored in memory:

- Named individuals (by email address)
- Known domains (e.g. a vendor's company domain)
- Security alert senders (e.g. \`@accounts.google.com\`, financial platforms)

If sender matches → proceed to Step 3.
If sender does not match → proceed to Step 2.

---

### Step 2 — Check the Email Body

Read the full email body and check if it matches any of these:

- A customer of the user's product reaching out for support, reporting a bug, asking a question, or giving feedback — identify by looking for the product name or related terms in the body
- Any other category the user has defined as high-priority that can only be identified from body content

If yes → proceed to Step 3.
If no → stop. Do nothing.

---

### Step 3 — Summarise and Notify

Read the full email body and send a notification in this format:

> 📧 Email Alert — [Category]
> From: [Sender name] ([email address])
> Subject: [Email subject]
> Summary: [2–4 sentence summary of what the email is about]
> Action needed: [Yes — [what needs to happen] / No — FYI only]

**Category label** to use:

- Key vendor or contact → 📂 Vendor / Key Contact
- Security alert → 🔐 Security Alert
- Financial alert → 💳 Financial Alert
- Customer support or bug → 🛠 Customer Support
- Other user-defined category → 📌 [Category name]

---

### Edge Cases

- **Multiple categories match** → pick the most specific, note both in the summary.
- **Email body is empty or unreadable** → send: "New email from [sender] — body unreadable. Check manually."
- **Duplicate trigger for same email** → send only once. Do not notify twice.
- **Sender is ambiguous** → if unsure, read the body before deciding. When in doubt, notify rather than skip.`,
  },
  {
    slug: "morning_brief_gmail_calendar",
    title: "Morning Brief",
    shortDescription:
      "Every morning (or on schedule), pull yesterday's and today's emails plus today's calendar into one structured brief. Emails are categorised into Action Required, FYI, Newsletters, and Spam — with summaries and recommended actions. Trigger with run my daily brief, morning brief, what's in my inbox today, or what's on my calendar today.",
    category: "Planning",
    integrations: [
      { name: "Gmail", slug: "gmail" },
      { name: "Google Calendar", slug: "google-calendar" },
    ],
    content: `**Goal:** Pull yesterday's and today's emails plus today's calendar into one structured brief, categorised and summarised.

**Tools Required:** Gmail, Google Calendar

**Trigger:** Runs on a schedule set by the user. Deliver output in the channel this skill is triggered from.

If a source (Gmail, Calendar) is not connected, skip it, note "Not connected" for that section, and continue.

Channel constraint: If the channel has a message length limit (e.g. WhatsApp), split the brief into one message per section in this order: Gmail then Calendar.

---

### Execution Order

Run both sources in parallel, then compile into one brief.

---

### 1. Gmail

**Scope:** Emails received yesterday and today only (resolve actual dates at runtime).

Read the subject line of each email in scope and classify it into one of 4 categories:

**Categories:**

- **Action Required** — Emails from people or organisations that need your response or attention. This includes your internal team, key vendors, and customers of your product or business. These are emails where the ball is in your court.
- **FYI** — Informational only, no action needed. Examples: payment confirmations, bank notifications, product updates, calendar invites.
- **Newsletters** — Subscription emails, digests, editorial content.
- **Spam** — Unsolicited sales or promotional outreach.

**Setup — run before classifying emails:**

Search memory for the following before asking the user anything:

- "user's internal team email domain or company domain"
- "user's key vendors, suppliers, or service providers"
- "user's product name or how their customers are identified"
- "email classification rules or inbox priorities"

Use whatever is found to pre-populate the classification logic. Only ask about the pieces that are still missing.

If nothing is found, ask the user once:

> "To classify your emails accurately, I need a few details:
>
> 1. What is your internal team's email domain? (e.g. @yourcompany.com)
> 2. Who are your key vendors or service providers I should watch for?
> 3. How do I identify emails from your customers or product users?
>
> You can describe them by email address, domain, or company name."

Store all answers in memory. Never ask again once stored.

**Processing rules by category:**

- Action Required: Read full body. Output: Full summary + recommended action (reply needed? Draft a response?)
- FYI: Read full body. Output: 1-2 line summary.
- Newsletters: Subject line only.
- Spam: Read full body. Output: One-liner on what they're selling.

---

### 2. Calendar

**Scope:** Today's events only.

- List all meetings with time and title.
- For each external meeting (anyone outside the user's organisation domain):
  - Check if the attendee is a known customer or prospect (search memory for their name or company).
  - If yes, ask: "Want me to block 15 mins prep time before [meeting name] at [time - 15 mins]?"
  - If unsure, flag it: "External meeting with [name] — not sure if they're a customer. Block prep time?"
  - Only create the calendar block after explicit confirmation.

**Setup — run before processing calendar:**

Search memory for:

- "user's organisation email domain" — to distinguish internal vs external attendees

If not found, ask: "What is your organisation's email domain? I'll use this to identify external vs internal meeting attendees."

Store in memory. Never ask again once stored.

---

### Output Format

**Gmail**

**Action Required:**

- [Sender / Subject]: [Summary]
  Action: [What needs to happen]

**FYI:**

- [Sender / Subject]: [1-2 line summary]

**Newsletters:**

- [Publication / Subject]

**Spam:**

- [Sender]: [One-liner on what they're pitching]

---

**Calendar — [Today's date]**

**Today's Meetings:**

- [Time] — [Title] ([Internal / External])

**Prep Blocks Needed:**

- [Meeting] at [time] with [person] — [customer / prospect / unclear]. Block 15 min prep at [time - 15 mins]?

If a section has no data, write "Nothing to report."`,
  },
  {
    slug: "plan_my_day",
    title: "Plan My Day",
    shortDescription:
      `Plan your next day with a structured schedule that respects your calendar, priorities, and deep work preferences — and blocks time on your calendar once you approve. Trigger with "plan my day", "plan tomorrow", "what should I work on tomorrow", or "block my calendar for tomorrow".`,
    category: "Planning",
    integrations: [
      { name: "Google Calendar", slug: "google-calendar" },
      { name: "Todoist", slug: "todoist", optional: true },
      { name: "Google Tasks", slug: "google-tasks", optional: true },
    ],
    content: `**Goal:** Build a structured schedule for tomorrow by combining your calendar, task list, priorities, and preferences — then block time once you approve.

**Tools Required:** Google Calendar, CORE Memory. Optional: Todoist or Google Tasks.

### Step 1 — Load Context in Parallel

Run all of the following simultaneously:

- **Calendar:** Fetch tomorrow's events. For each event extract: time, title, attendees, type (internal / external), duration.
- **Memory:** Run the following searches simultaneously:
  - "current week priorities goals and planning"
  - "user's scheduling preferences — when they prefer to work, start time, end time"
  - "user's deep work preferences — preferred time of day, block length, focus conditions"
  - "user's lunch and meal preferences — timing, duration, break habits"
- **Tasks (if connected):** Check if Todoist or Google Tasks is connected. If yes, fetch all tasks from available lists including comments. If not connected, skip silently.

**How to use memory results:**

- If scheduling preferences are found → use them to anchor the day's start/end time and slot placement
- If deep work preferences are found → use preferred time of day and block length when building the schedule
- If meal/break preferences are found → use preferred lunch time and break durations instead of defaults
- If nothing is found for any preference → silently fall back to defaults (8hr day, deep work stacked in morning, 1.5hrs meals/breaks). Do not tell the user what's missing.

---

### Step 2 — Ask Two Questions

Before building the plan, ask:

1. "What do you want to work on tomorrow? Anything specific you want prioritised?"
2. If memory has no clear current-week goals or priorities → also ask: "What are your top goals or priorities this week? I want to make sure the plan reflects what actually moves the needle."

Wait for response before proceeding.

> If the user mentions any scheduling, deep work, or meal preferences during the conversation (e.g. "I usually start at 9am" or "I don't do deep work after 3pm") → store them in memory immediately for future runs.

---

### Step 3 — Compile the Task List

Build the list of things to plan around from all available sources:

**Always include:**

- What the user said in Step 2 (treat this as highest signal)
- Any tasks or priorities found in memory from recent conversations

**Include if task tool is connected:**

- Tasks that are overdue, Priority 1, Priority 2, or due tomorrow
- Fetch comments on each task for additional context

If no task tool is connected, work purely from memory + Step 2 input. Do not tell the user something is missing — just plan with what you have.

---

### Step 4 — Estimate Task Duration

For each item in the task list, estimate time required based on:

- Task title and description
- Keywords (e.g. "review", "write", "fix", "call", "research")
- Comments (if available from task tool)
- Memory of similar tasks done in the past

---

### Step 5 — Calculate Available Time

Total day = 8 hours
Existing meetings = [sum from Step 1]
Buffer (adhoc) = 20% of (15hrs - meeting hours)
Meals + breaks = 1.5 hours (lunch + dinner + short breaks)
Available for work = 15hrs - meetings - buffer - meals

If total task time exceeds available time → flag overload (see Output Format).

---

### Step 6 — Build the Schedule

Apply these rules when placing tasks:

**Deep work rules:**

- Stack deep work slots together — never fragment them across the day.
- Keep 30 mins before any external meeting free.
- Keep 15 mins after any external meeting free.
- External meetings can be back-to-back — that's fine.

**Morning rule:**

- In the first block of the day (before lunch), prioritise high-priority tasks that take less than 1 hour. Goal: get a few quick wins done before midday.

**Meal/break rule:**

- Include 1.5 hrs total spread across lunch, dinner, and short breaks. Place at natural breakpoints — never in the middle of a deep work slot.

**Buffer rule:**

- Keep 20% of available time unscheduled. Do not fill it with tasks.

---

### Step 7 — Assess the Plan (Be Blunt)

Before presenting, review what's been prioritised against:

- What the user said they want to work on (Step 2 input)
- Current week goals and priorities (from memory or Step 2 input)

Call out misalignment directly. Examples of things to flag:

- A lower-priority task is taking significant time while a higher-priority one is deprioritised
- Admin or reactive work is crowding out high-leverage work
- Something that feels productive but doesn't move the needle this week

Be direct. This is a soundboard role — not just a scheduler.

---

### Step 8 — Present the Plan

Show the full day as a structured list. Then ask for confirmation or adjustments before doing anything on the calendar.

📅 TOMORROW — [Date]

#### 🗓 Existing Meetings ([X] hrs committed)

- [Time] — [Title] ([Internal/External])

#### 🧠 Proposed Schedule

- [Time] — [Task / block name] (~[duration]) [Priority tag if applicable]
- [Time] — 🍽 Lunch break (45 mins)
- [Time] — [Task / block name] (~[duration])
- [Time] — ☕ Short break (15 mins)
- [Time] — [External meeting name] (prep 30 mins before is kept free)
- [Time] — 🍽 Dinner break (30 mins)
- [Time] — [Deep work block: Task A + Task B] (~[duration])

#### 📊 Time Summary

- Meetings: [X] hrs
- Planned tasks: [X] hrs
- Meals + breaks: 1.5 hrs
- Buffer: [X] hrs (20%)
- Total: [X] / 15 hrs

#### ⚠️ Overload Warning (if applicable)

You have [X] hrs of work for [Y] hrs of available time.
Deprioritised: [Task 1], [Task 2] — moved to backlog.

#### 🔍 Priority Check

[Blunt assessment — is what's planned actually the most important thing?
Call out any misalignment between the schedule and what moves the needle this week.]

---

### Step 9 — Confirm and Lock

Ask: "Does this look right? Any adjustments before I block this on your calendar?"

Wait for confirmation. Accept edits. Re-present if needed.

Once approved → create focus blocks on Google Calendar for all non-meeting slots in the plan.

Do not create calendar events before explicit approval.`,
  },
];

export const LIBRARY_SKILLS_BY_CATEGORY = LIBRARY_SKILLS.reduce(
  (acc, skill) => {
    if (!acc[skill.category]) acc[skill.category] = [];
    acc[skill.category].push(skill);
    return acc;
  },
  {} as Record<string, LibrarySkill[]>,
);

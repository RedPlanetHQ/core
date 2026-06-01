/**
 * Description content for the daily Morning Brief recurring task.
 *
 * Stored as the task's page HTML so it acts as the agent's prompt on every
 * firing. Previously this lived in a separate "Morning Brief" skill document;
 * inlining it into the task description removes the skill-lookup indirection.
 *
 * Scope for the initial rollout: Gmail only. GitHub and Google Calendar are
 * deliberately stubbed out — when they're enabled, extend section 1 and the
 * Slack delivery format while keeping the same overall structure.
 */
export const MORNING_BRIEF_TASK_DESCRIPTION = `<h2>Morning Brief — Daily 9am</h2>

<p><strong>Goal:</strong> Generate a daily Morning Brief by fetching Gmail (GitHub and Calendar to come), then:</p>
<ol>
  <li>Send the brief to Slack.</li>
  <li>Update today's scratchpad with the relevant action items and context.</li>
</ol>

<h3>Execution Order (must follow)</h3>
<ol>
  <li>Fetch Gmail. (GitHub + Calendar are skipped for now — add them later without changing the structure.)</li>
  <li>Formulate one consolidated brief (single output).</li>
  <li>Send the brief over Slack (human-readable summary).</li>
  <li>Update today's scratchpad (structured, durable record; action-oriented).</li>
</ol>

<h3>1) Gmail</h3>
<p><strong>Scope:</strong> Emails received yesterday and today only (resolve actual dates at runtime).</p>

<p>Read the subject line of each email in scope and classify it into one of 4 categories:</p>
<ul>
  <li><strong>Action Required</strong> — Emails from people or organisations that need your response or attention. This includes your internal team, key vendors, and customers of your product or business. These are emails where the ball is in your court.</li>
  <li><strong>FYI</strong> — Informational only, no action needed. Examples: payment confirmations, bank notifications, product updates, calendar invites.</li>
  <li><strong>Newsletters</strong> — Subscription emails, digests, editorial content.</li>
  <li><strong>Spam</strong> — Unsolicited sales or promotional outreach.</li>
</ul>

<p><strong>Setup — run before classifying emails:</strong></p>
<p>Search memory for the following before asking the user anything:</p>
<ul>
  <li>"user's internal team email domain or company domain"</li>
  <li>"user's key vendors, suppliers, or service providers"</li>
  <li>"user's product name or how their customers are identified"</li>
  <li>"email classification rules or inbox priorities"</li>
</ul>

<p>Use whatever is found to pre-populate the classification logic. Only ask about the pieces that are still missing.</p>

<p>If nothing is found, ask the user once:</p>
<blockquote>
  <p>"To classify your emails accurately, I need a few details:</p>
  <ol>
    <li>What is your internal team's email domain? (e.g. @yourcompany.com)</li>
    <li>Who are your key vendors or service providers I should watch for?</li>
    <li>How do I identify emails from your customers or product users?</li>
  </ol>
  <p>You can describe them by email address, domain, or company name."</p>
</blockquote>
<p>Store all answers in memory. Never ask again once stored.</p>

<p><strong>Processing rules by category:</strong></p>
<ul>
  <li><strong>Action Required:</strong> Read full body. Output: full summary + recommended action (reply needed? draft a response?).</li>
  <li><strong>FYI:</strong> Read full body. Output: 1–2 line summary.</li>
  <li><strong>Newsletters:</strong> Subject line only.</li>
  <li><strong>Spam:</strong> Read full body. Output: one-liner on what they're selling.</li>
</ul>

<h3>2) Slack Delivery (send message)</h3>
<p><strong>Goal:</strong> Deliver a concise, high-signal Morning Brief message over Slack.</p>
<p><strong>Format:</strong> Use short sections (Email today; GitHub / Calendar when enabled), keep it scannable, and end with a short "Top actions" list.</p>

<h3>3) Scratchpad Update (keep this structure EXACTLY)</h3>
<p>Runs daily (default 9am user-local). Goal: when the user opens their scratchpad in the morning, the top of the page shows what's already on their plate plus anything the system noticed in the last 24h.</p>

<ol>
  <li><strong>Read today's scratchpad first.</strong> Call <code>get_scratchpad</code> with no date (defaults to today). If a "Brief —" heading already exists for today, STOP — the brief has already been written. Do not write a duplicate.</li>
  <li><strong>Gather data.</strong> In parallel where possible:
    <ul>
      <li><strong>Carried over</strong>: still-Todo tasks (<code>list_tasks status=Todo</code>) — include open count days from createdAt.</li>
      <li><strong>Suggested today</strong>: from connected integrations (for now, last-24h unread important emails and @mentions you haven't responded to; PRs awaiting your review and today's calendar will be added later).</li>
      <li><strong>Heads up</strong>: non-actionable but worth knowing — meeting moves, deploys, ambient changes from integrations.</li>
    </ul>
  </li>
  <li><strong>Compose the brief</strong> as plain HTML using EXACTLY this structure. Omit any section that has zero items. Cap each section at 5 entries.
    <pre><code>&lt;h3&gt;Brief — {Weekday, Month Day}&lt;/h3&gt;

&lt;h4&gt;Carried over&lt;/h4&gt;
&lt;ul&gt;
  &lt;li&gt;{task title} &lt;em&gt;(open {N} days)&lt;/em&gt;&lt;/li&gt;
&lt;/ul&gt;

&lt;h4&gt;Suggested today&lt;/h4&gt;
&lt;ul&gt;
  &lt;li&gt;{verb-first action item, ~8 words}&lt;/li&gt;
&lt;/ul&gt;

&lt;h4&gt;Heads up&lt;/h4&gt;
&lt;ul&gt;
  &lt;li&gt;{short factual note}&lt;/li&gt;
&lt;/ul&gt;</code></pre>
  </li>
  <li><strong>Write to scratchpad.</strong> Call <code>update_scratchpad</code> with the HTML above, <code>mode="append"</code>, <code>date</code> omitted. This adds the brief to today's page without disturbing whatever the user has already written.</li>
</ol>

<h3>Rules</h3>
<ul>
  <li><strong>Plain bullets, not <code>&lt;taskItem&gt;</code> nodes.</strong> The user converts items to real tasks manually if they want. Suggestions should not auto-create tasks.</li>
  <li><strong>Dedupe.</strong> Items in "Carried over" must not also appear in "Suggested today".</li>
  <li><strong>Be conservative.</strong> Better to surface 3 high-quality items than 5 marginal ones. An empty section is fine.</li>
  <li>If everything is empty, still write the minimal heading (<code>&lt;h3&gt;Brief — ...&lt;/h3&gt;</code>) so the user can see the brief ran. No body required.</li>
  <li><strong>Never replace.</strong> Always <code>mode="append"</code>. The user's own scratchpad writing is sacred.</li>
</ul>

<h3>When to skip entirely</h3>
<ul>
  <li>If today's scratchpad already has a "Brief —" heading.</li>
  <li>If the user has explicitly turned the morning brief task off (handled by the scheduled task being inactive).</li>
</ul>`;

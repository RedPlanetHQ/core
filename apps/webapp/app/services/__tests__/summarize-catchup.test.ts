/**
 * Live-LLM catchup preview.
 *
 * Skipped by default — flip on with `SUMMARIZE_LIVE=1` to actually hit
 * the model. Use it to eyeball how the inbox-pill catchup sounds (and
 * looks — the on-screen card mirrors the spoken text now) for realistic
 * agent messages. Voice is the only optimisation target; the same
 * output drives TTS and the card under the pill.
 *
 *   SUMMARIZE_LIVE=1 pnpm --filter webapp test summarize-catchup
 *
 * Add new scenarios to FIXTURES; each one renders the way the inbox
 * route does (numbered with [task: …] tags) so what you see here is
 * exactly what the user would hear after clicking the pill.
 */

import { describe, it } from "vitest";

import { summarize } from "../summarize.server";

const RUN_LIVE = process.env.SUMMARIZE_LIVE === "1";

interface InboxItem {
  task?: string;
  message: string;
}

interface Fixture {
  name: string;
  items: InboxItem[];
}

function render(items: InboxItem[]): string {
  return items
    .map((it, idx) => {
      const taskTag = it.task ? ` [task: ${it.task}]` : "";
      return `${idx + 1}.${taskTag} ${it.message}`;
    })
    .join("\n");
}

const FIXTURES: Fixture[] = [
  {
    name: "single coding-task completion (the boot-loader case)",
    items: [
      {
        task: "Fix boot loader showing OS before boot screen",
        message:
          "Boot-only loader fix is in and pushed, sir.\n\n" +
          "What changed:\n" +
          "- components/os/desktop.tsx: boot state now starts null (unknown), so the OS desktop is never rendered until after the boot check. Render is mutually exclusive: dark screen → boot → desktop, eliminating the OS → boot → OS flash.\n" +
          "- components/os/boot-screen.tsx: added rotating funny loader texts tied to boot progress.\n\n" +
          "Commit: 96f1bd2 on fix-boot-loader-no-os-screen.\n\n" +
          "PR: I have created it here: https://github.com/example/core/pull/1234\n\n" +
          "Note: the gateway worktree lacked pnpm, so lint/typecheck were not run in that environment. If you want, I can rerun checks from a proper node environment next.",
      },
    ],
  },
  {
    name: "multi-message catchup (review + blocked + scheduled nudge)",
    items: [
      {
        task: "Refactor contact summary model",
        message:
          "Re: Refactor contact summary model — done. Switched the summariser from Chat to Memory Ingestion model so it matches the other contact-side calls. PR: https://github.com/example/core/pull/1240. Lint + typecheck green.",
      },
      {
        task: "Schedule Goa trip planning",
        message:
          "Re: Schedule Goa trip planning — blocked on you. I drafted the itinerary across booking.com and Skyscanner but I need a budget ceiling before I can shortlist hotels. Day-trip or overnight? Reply with both and I'll proceed.",
      },
      {
        message:
          "Reminder: Manik's quarterly review is tomorrow at 10am IST. You haven't opened the prep doc — want me to summarise the last 90 days of his commits and PR comments now?",
      },
    ],
  },
  {
    name: "trigger-driven scheduled fire (recurring sales nudge)",
    items: [
      {
        task: "Weekly outbound follow-up sweep",
        message:
          "Re: Weekly outbound follow-up sweep — 4 leads went 7+ days without a reply: Sabid (third pitch, no fit signal), Tara at Linear (warm, asked about pricing), Adam Stein (cold), Priya M (responded once, ghosted). I'd filter Sabid; the other three are worth a one-line nudge. Want me to draft them?",
      },
    ],
  },
];

describe.skipIf(!RUN_LIVE)("summarize — live catchup preview", () => {
  for (const fixture of FIXTURES) {
    it(fixture.name, async () => {
      const rendered = render(fixture.items);
      const summary = await summarize({ text: rendered });

      // eslint-disable-next-line no-console
      console.log(
        [
          "",
          "━".repeat(72),
          `▶ ${fixture.name}`,
          "━".repeat(72),
          "",
          "── INPUT ──",
          rendered,
          "",
          "── CATCHUP (spoken + shown) ──",
          summary,
          "",
        ].join("\n"),
      );
    }, 60_000);
  }
});

describe.skipIf(RUN_LIVE)("summarize — live catchup preview (skipped)", () => {
  it("set SUMMARIZE_LIVE=1 to run", () => {
    // No-op: surfaced as a passing test that documents the gate.
  });
});

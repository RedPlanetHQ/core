import { z } from "zod";
import type { ModelMessage } from "ai";
import { makeStructuredModelCall } from "~/lib/model.server";

export const ContactSummarySchema = z.object({
  headline: z.string().describe("one line: role + how they relate to you"),
  whoTheyAre: z.string().default(""),
  relationshipToYou: z.string().default(""),
  recentAndOpen: z.string().default(""),
  cadenceChannel: z.string().default(""),
  communicationStyle: z.string().default(""),
  sharedGroups: z.string().default(""),
});

export type ContactSummary = z.infer<typeof ContactSummarySchema>;

export interface ContactFields {
  emails: string[];
  phones: string[];
  company: string | null;
  role: string | null;
  location: string | null;
  handles: string[];
}

export interface BuildSummaryInput {
  userName: string;
  personName: string;
  today: Date;
  contactFields: ContactFields;
  facts: Array<{ fact: string; aspect: string | null; validAt: Date }>;
  priorDescription: string | null;
  descriptionEdited: boolean;
}

const SYSTEM = `You build a compact CRM profile of one person from the user's MEMORY ONLY.

RULES
- Use ONLY the facts provided. Never invent, never infer beyond what is stated.
  If something is unknown, omit it or say "not known". No age/DOB guessing.
- Compact: each section AT MOST 1-2 short lines. Leave a section empty ("") if no facts support it.
- Address the user as "you". Give recent items rough timing vs today.
- If a prior profile is marked AUTHORITATIVE, preserve its facts and fold in new
  memory without contradicting it.

OUTPUT FIELDS
headline: one line - role + how they relate to you (for the list)
whoTheyAre: identity, background, what they do
relationshipToYou: how you know them, shared history
recentAndOpen: last few interactions w/ timing + any open loop / follow-up
cadenceChannel: how often & main channel you interact through
communicationStyle: one line on tone/register
sharedGroups: shared group(s) / mutual people`;

export function buildSummaryMessages(input: BuildSummaryInput): ModelMessage[] {
  const today = input.today.toISOString().slice(0, 10);
  const factLines = input.facts
    .map((f) => `- [${f.aspect ?? "Fact"}] ${f.validAt.toISOString().slice(0, 10)}: ${f.fact}`)
    .join("\n");
  const cf = input.contactFields;
  const contactBlock = [
    cf.emails.length ? `emails: ${cf.emails.join(", ")}` : "emails: not known",
    cf.phones.length ? `phones: ${cf.phones.join(", ")}` : "phones: not known",
    cf.company ? `company: ${cf.company}` : null,
    cf.role ? `role: ${cf.role}` : null,
    cf.location ? `location: ${cf.location}` : null,
    cf.handles.length ? `handles: ${cf.handles.join(", ")}` : null,
  ].filter(Boolean).join("\n");

  const prior = input.priorDescription
    ? `\n\nPrior profile (${input.descriptionEdited ? "AUTHORITATIVE - preserve these facts" : "for reference"}):\n${input.priorDescription}`
    : "";

  const user = `Your user: ${input.userName}   Today: ${today}
Person: ${input.personName}

Known contact fields:
${contactBlock}

Memory facts (newest first):
${factLines || "(none)"}${prior}`;

  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

export function renderDescription(s: Omit<ContactSummary, "headline">): string {
  const rows: Array<[string, string]> = [
    ["Who they are", s.whoTheyAre],
    ["Relationship", s.relationshipToYou],
    ["Recent & open", s.recentAndOpen],
    ["Cadence", s.cadenceChannel],
    ["Style", s.communicationStyle],
    ["Shared groups", s.sharedGroups],
  ];
  return rows
    .filter(([, v]) => v && v.trim())
    .map(([label, v]) => `${label}: ${v.trim()}`)
    .join("\n");
}

export async function generateContactSummary(
  input: BuildSummaryInput,
  workspaceId: string,
): Promise<{ headline: string; description: string }> {
  const messages = buildSummaryMessages(input);
  const { object } = await makeStructuredModelCall(
    ContactSummarySchema,
    messages,
    "medium",
    undefined,
    undefined,
    workspaceId,
  );
  return { headline: object.headline, description: renderDescription(object) };
}

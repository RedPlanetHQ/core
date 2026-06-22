import { z } from "zod";
import type { ModelMessage } from "ai";
import { makeStructuredModelCall } from "~/lib/model.server";

export const ContactSummarySchema = z.object({
  headline: z.string().describe("one line: role + how they relate to you"),
  email: z.string().default("").describe("primary email address if found in episodes"),
  phone: z.string().default("").describe("primary phone number if found in episodes"),
  linkedin: z.string().default("").describe("LinkedIn URL or handle if found"),
  twitter: z.string().default("").describe("X/Twitter handle if found"),
  company: z.string().default("").describe("employer or organization if found"),
  role: z.string().default("").describe("job title or role if found"),
  location: z.string().default("").describe("city, country, or region if found"),
  relationshipWithUser: z.string().default("").describe("how the user knows this person — how they met, shared history, nature of relationship"),
  additionalInformation: z.string().default("").describe("recent interactions with timing, open loops, communication patterns, shared groups"),
});

export type ContactSummary = z.infer<typeof ContactSummarySchema>;

export interface ExtractedContactFields {
  email: string;
  phone: string;
  linkedin: string;
  twitter: string;
  company: string;
  role: string;
  location: string;
}

export interface BuildSummaryInput {
  userName: string;
  personName: string;
  today: Date;
  episodes: Array<{ content: string; validAt: Date }>;
  priorDescription: string | null;
  descriptionEdited: boolean;
}

const SYSTEM = `You build a CRM profile of one person from the user's raw memory episodes.

RULES
- Extract information ONLY from the episodes provided. Never invent or assume.
- If a field is not present in the episodes, leave it as an empty string "".
- Address the user as "you". Give recent interactions rough timing relative to today.
- For email/phone/linkedin/twitter: copy the exact value as written in the episodes.
- If a prior profile is marked AUTHORITATIVE, preserve its facts in
  relationshipWithUser and additionalInformation, folding in new details without
  contradicting it. Structured fields (email, phone, etc.) should still be
  extracted fresh from the latest episodes.

OUTPUT FIELDS
headline: one line — job title / role + how they relate to the user (shown on contact list card)
email: primary email address (e.g. "john@acme.com"), empty string if not found
phone: primary phone number (e.g. "+1-234-567-8900"), empty string if not found
linkedin: LinkedIn URL or username (e.g. "linkedin.com/in/john-smith"), empty string if not found
twitter: X/Twitter handle (e.g. "@johnsmith"), empty string if not found
company: employer or organization name, empty string if not found
role: job title or role, empty string if not found
location: city, country, or region, empty string if not found
relationshipWithUser: 2–4 sentences on how the user knows this person — how they met, shared history, nature of the relationship
additionalInformation: recent interactions with timing, any open loops or follow-ups needed, communication frequency and channel, shared groups or mutual connections`;

export function buildSummaryMessages(input: BuildSummaryInput): ModelMessage[] {
  const today = input.today.toISOString().slice(0, 10);
  const episodeLines = input.episodes
    .map((e) => `[${e.validAt.toISOString().slice(0, 10)}]\n${e.content}`)
    .join("\n\n---\n\n");

  const prior = input.priorDescription
    ? `\n\nPrior profile (${input.descriptionEdited ? "AUTHORITATIVE — preserve these facts" : "for reference"}):\n${input.priorDescription}`
    : "";

  const user = `Your user: ${input.userName}   Today: ${today}
Person: ${input.personName}

Memory episodes (newest first):
${episodeLines || "(none)"}${prior}`;

  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

export function renderDescription(s: Omit<ContactSummary, "headline">): string {
  const infoLines = [
    s.email ? `- Email: ${s.email}` : null,
    s.phone ? `- Contact: ${s.phone}` : null,
    s.linkedin ? `- LinkedIn: ${s.linkedin}` : null,
    s.twitter ? `- X: ${s.twitter}` : null,
    s.location ? `- Location: ${s.location}` : null,
    s.company ? `- Company: ${s.company}` : null,
    s.role ? `- Role: ${s.role}` : null,
  ].filter(Boolean).join("\n");

  const sections: string[] = [];
  if (infoLines) sections.push(`### Basic Info\n${infoLines}`);
  if (s.relationshipWithUser?.trim())
    sections.push(`### Relationship with User\n${s.relationshipWithUser.trim()}`);
  if (s.additionalInformation?.trim())
    sections.push(`### Additional Information\n${s.additionalInformation.trim()}`);

  return sections.join("\n\n");
}

export async function generateContactSummary(
  input: BuildSummaryInput,
  workspaceId: string,
): Promise<{ headline: string; description: string; extractedFields: ExtractedContactFields }> {
  const messages = buildSummaryMessages(input);
  const { object } = await makeStructuredModelCall(
    ContactSummarySchema,
    messages,
    "medium",
    undefined,
    undefined,
    workspaceId,
  );
  return {
    headline: object.headline,
    description: renderDescription(object),
    extractedFields: {
      email: object.email,
      phone: object.phone,
      linkedin: object.linkedin,
      twitter: object.twitter,
      company: object.company,
      role: object.role,
      location: object.location,
    },
  };
}

import type { Contact } from "@core/database";

export function formatContactsForAgent(contacts: Contact[]): string {
  if (contacts.length === 0) {
    return "No matching contact found in People.";
  }
  return contacts
    .slice(0, 5)
    .map((c) => {
      const fields = [
        c.emails.length ? `Email: ${c.emails.join(", ")}` : null,
        c.phones.length ? `Phone: ${c.phones.join(", ")}` : null,
        c.company ? `Company: ${c.company}` : null,
        c.role ? `Role: ${c.role}` : null,
        c.location ? `Location: ${c.location}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      return `## ${c.name}\n${c.headline ?? ""}\n${fields}\n\n${c.description ?? ""}`.trim();
    })
    .join("\n\n---\n\n");
}

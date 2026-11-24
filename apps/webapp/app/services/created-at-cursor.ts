import { z } from "zod";

export const CreatedAtCursor = z.string().transform((value, context) => {
  if (value === "") return undefined;

  const [timestamp, id, extra] = value.split("|", 3);
  const createdAt = new Date(timestamp);
  if (Number.isNaN(createdAt.getTime()) || id === "" || extra !== undefined) {
    context.addIssue({ code: "custom", message: "Invalid pagination cursor" });
    return z.NEVER;
  }
  return { createdAt, id };
});

export function encodeCreatedAtCursor(row: {
  createdAt: Date;
  id: string;
}): string {
  return `${row.createdAt.toISOString()}|${row.id}`;
}

import { TaskStatus } from "@prisma/client";

/**
 * Generates an OKLCH color string with fixed lightness, chroma, and a random hue.
 * @returns {string} - The generated OKLCH color string.
 */
export function generateOklchColor(): string {
  // Generate a random number between 30 and 360 for the hue
  const hue = Math.floor(Math.random() * (360 - 30 + 1)) + 30;

  // Fixed lightness and chroma values
  const lightness = 66;
  const chroma = 0.1835;

  // Construct the OKLCH color string
  const oklchColor = `oklch(${lightness}% ${chroma} ${hue})`;

  return oklchColor;
}

export function getTailwindColor(name: string): string {
  // Generate a hash value for the input name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Ensure hash value is within the range of colors array
  const index = Math.abs(hash) % 12;

  return `var(--custom-color-${index + 1})`;
}

export function getTeamColor(name: string): string {
  // Generate a hash value for the input name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Ensure hash value is within the range of colors array
  const index = Math.abs(hash) % 3;

  return `var(--team-color-${index + 1})`;
}

const TaskStatusColorNumber: Record<TaskStatus, string> = {
  Backlog: "2",
  Planning: "3",
  Waiting: "0",
  Ready: "5",
  Working: "4",
  Review: "1",
  Done: "6",
  Recurring: "4",
};

export function getTaskStatusColor(status: TaskStatus) {
  return getTaskStatusColorWithNumber(TaskStatusColorNumber[status]);
}

export function getTaskStatusColorWithNumber(color: string) {
  if (/^#[0-9A-F]{6}[0-9a-f]{0,2}$/i.test(color as string)) {
    return { background: `${color}26`, color };
  }

  const cssVar = `var(--status-pill-${color})`;

  return {
    background: cssVar,
    color: `var(--status-icon-${color})`,
  };
}

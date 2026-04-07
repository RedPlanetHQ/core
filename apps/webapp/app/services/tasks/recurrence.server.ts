import { makeModelCall } from "~/lib/model.server";
import { recurrencePrompt } from "~/services/agent/prompts/recurrence";
import { updateScheduledTask } from "~/services/task.server";
import { prisma } from "~/db.server";
import { enqueueScheduledTask } from "~/lib/queue-adapter.server";
import { logger } from "~/services/logger.service";

export interface RecurrenceResult {
  recurrenceRule: string[];
  scheduleText: string;
  startTime: string;
}

/**
 * Run the recurrence prompt against natural language text and parse the output.
 * Returns null if no scheduling information is found in the text.
 */
export async function extractScheduleFromText(
  text: string,
  currentTime: string,
  workspaceId?: string,
): Promise<RecurrenceResult | null> {
  const prompt = recurrencePrompt
    .replace("{{text}}", text)
    .replace("{{currentTime}}", currentTime);

  let responseText = "";
  await makeModelCall(
    false,
    [{ role: "user", content: prompt }],
    (t) => {
      responseText = t;
    },
    { temperature: 0.1 },
    "medium",
    "recurrence-extraction",
    undefined,
    workspaceId,
  );

  const outputMatch = responseText.match(/<output>\s*([\s\S]*?)\s*<\/output>/);
  if (!outputMatch) return null;

  try {
    const parsed = JSON.parse(outputMatch[1].trim());
    if (!parsed || Object.keys(parsed).length === 0) return null;
    return parsed as RecurrenceResult;
  } catch {
    return null;
  }
}

/**
 * Apply a parsed RecurrenceResult to a task:
 * - Recurring  → sets task.schedule (RRule) via updateScheduledTask
 * - One-time   → sets task.nextRunAt + maxOccurrences=1 and enqueues the job
 * scheduleText is stored in task.metadata for display.
 */
export async function applyScheduleToTask(
  taskId: string,
  workspaceId: string,
  userId: string,
  result: RecurrenceResult,
): Promise<void> {
  if (result.recurrenceRule.length > 0) {
    await updateScheduledTask(taskId, workspaceId, {
      schedule: result.recurrenceRule[0],
      isActive: true,
    });
    if (result.scheduleText) {
      await prisma.task.update({
        where: { id: taskId },
        data: { metadata: { scheduleText: result.scheduleText } },
      });
    }
  } else if (result.startTime) {
    const nextRunAt = new Date(result.startTime);
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    await prisma.task.update({
      where: { id: taskId },
      data: {
        schedule: null, // clear any existing RRule
        nextRunAt,
        isActive: true,
        maxOccurrences: 1,
        ...(result.scheduleText && {
          metadata: { scheduleText: result.scheduleText },
        }),
      },
    });
    await removeScheduledTask(taskId);
    await enqueueScheduledTask(
      { taskId, workspaceId, userId, channel: task?.channel ?? "email" },
      nextRunAt,
    );
  }
}

/**
 * Fire-and-forget recurrence detection.
 * Call after task create/update — does not block the response.
 */
export function detectAndApplyRecurrence(
  taskId: string,
  workspaceId: string,
  userId: string,
  text: string,
): void {
  (async () => {
    try {
      const result = await extractScheduleFromText(
        text,
        new Date().toISOString(),
        workspaceId,
      );
      if (result) {
        await applyScheduleToTask(taskId, workspaceId, userId, result);
        logger.info(`Auto-applied schedule to task ${taskId}`);
      }
    } catch (error) {
      logger.error(`Failed to detect recurrence for task ${taskId}`, { error });
    }
  })();
}

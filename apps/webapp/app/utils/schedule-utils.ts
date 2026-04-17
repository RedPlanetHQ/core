/**
 * Schedule Utilities
 *
 * Pure functions for RRule parsing, next-run computation, and schedule formatting.
 * No database dependencies — shared by task.server.ts, task-tools.ts, and MCP tools.
 */

import { RRule } from "rrule";
import { DateTime } from "luxon";

/**
 * Compute next run time from RRule string.
 * RRule is interpreted in user's local timezone, returns UTC Date.
 *
 * @param rruleString - RRule string with times in user's local timezone (e.g., BYHOUR=9 means 9am local)
 * @param timezone - User's IANA timezone (e.g., "Asia/Kolkata")
 * @param after - Find next occurrence after this time (default: now)
 * @returns Next occurrence as UTC Date, or null if no more occurrences
 */
export function computeNextRun(
  rruleString: string,
  timezone: string = "UTC",
  after: Date = new Date(),
): Date | null {
  try {
    const options = RRule.parseString(rruleString);

    // Convert 'after' to user's timezone to find the right occurrence
    const afterInUserTz = DateTime.fromJSDate(after).setZone(timezone);

    // Set dtstart to 'after' in the user's timezone context
    // This ensures RRule computes occurrences relative to user's local time
    if (!options.dtstart) {
      options.dtstart = afterInUserTz.toJSDate();
    }

    // If BYHOUR is specified, we need to handle timezone conversion
    if (options.byhour !== undefined && options.byhour !== null) {
      const hours: number[] = Array.isArray(options.byhour)
        ? options.byhour
        : [options.byhour];
      const minutes: number[] =
        options.byminute !== undefined && options.byminute !== null
          ? Array.isArray(options.byminute)
            ? options.byminute
            : [options.byminute]
          : [0];

      // Find the next occurrence by checking each hour/minute combination
      // Start from the beginning of the current day in user's timezone
      const checkDate = afterInUserTz.startOf("day");

      // Check up to 400 days ahead to handle yearly patterns
      for (let dayOffset = 0; dayOffset < 400; dayOffset++) {
        const currentDay = checkDate.plus({ days: dayOffset });

        // Check if this day matches the RRule pattern (weekday, monthday, etc.)
        const dayCheckRule = new RRule({
          ...options,
          byhour: [12], // Use noon to avoid DST issues
          byminute: [0],
          dtstart: checkDate.toJSDate(),
        });

        // Get the next few occurrences and check if any fall on currentDay
        const nextFewDates = dayCheckRule.between(
          currentDay.startOf("day").toJSDate(),
          currentDay.endOf("day").toJSDate(),
          true,
        );

        if (nextFewDates.length === 0) continue;

        // Check each hour/minute combination for this day
        const candidates: DateTime[] = [];
        for (const hour of hours) {
          for (const minute of minutes) {
            const candidate = currentDay.set({
              hour,
              minute,
              second: 0,
              millisecond: 0,
            });

            // Must be after the 'after' time
            if (candidate > afterInUserTz) {
              candidates.push(candidate);
            }
          }
        }

        // If we found candidates for this day, return the earliest
        if (candidates.length > 0) {
          candidates.sort((a, b) => a.toMillis() - b.toMillis());
          const earliest = candidates[0];
          // Convert from user's timezone to UTC
          return earliest.toUTC().toJSDate();
        }
      }

      return null;
    }

    // For non-time-specific rules (no BYHOUR), these are relative time reminders
    // "in 2 min", "in 1 hour", "in 1 day" - add interval to now
    const interval = options.interval || 1;
    let nextRun: DateTime;

    if (options.freq === RRule.MINUTELY) {
      nextRun = afterInUserTz.plus({ minutes: interval });
    } else if (options.freq === RRule.HOURLY) {
      nextRun = afterInUserTz.plus({ hours: interval });
    } else if (options.freq === RRule.DAILY) {
      nextRun = afterInUserTz.plus({ days: interval });
    } else if (options.freq === RRule.WEEKLY) {
      nextRun = afterInUserTz.plus({ weeks: interval });
    } else {
      // Fallback to RRule for other frequencies
      const rule = new RRule(options);
      return rule.after(after, false);
    }

    return nextRun.toUTC().toJSDate();
  } catch {
    return null;
  }
}

/**
 * Check if a scheduled task should ask user about turning off.
 * Only asks if user hasn't confirmed they want to keep it.
 * Asks at 5, then 10, 20, 40, 80... (exponential backoff)
 */
export function shouldAskToTurnOff(
  unrespondedCount: number,
  confirmedActive: boolean,
): boolean {
  if (confirmedActive) return false;
  if (unrespondedCount < 5) return false;

  if (unrespondedCount === 5) return true;

  const adjusted = unrespondedCount - 5;
  if (adjusted >= 5 && adjusted % 5 === 0) {
    const ratio = adjusted / 5;
    return ratio > 0 && (ratio & (ratio - 1)) === 0;
  }
  return false;
}

/**
 * Check if a scheduled task should be auto-deactivated.
 * Only deactivates based on maxOccurrences (if set and > 0) or endDate.
 */
export function checkShouldDeactivate(task: {
  occurrenceCount: number;
  maxOccurrences: number | null;
  endDate: Date | null;
}): boolean {
  if (
    task.maxOccurrences !== null &&
    task.maxOccurrences > 0 &&
    task.occurrenceCount >= task.maxOccurrences
  ) {
    return true;
  }

  if (task.endDate !== null && new Date() >= task.endDate) {
    return true;
  }

  return false;
}

/**
 * Compute the effective recurrence interval in minutes from an RRule string.
 * For BYHOUR schedules, computes the minimum gap between listed hours.
 * Returns null if the interval cannot be determined.
 */
export function getRecurrenceIntervalMinutes(schedule: string): number | null {
  const freqMatch = schedule.match(/FREQ=(\w+)/);
  const intervalMatch = schedule.match(/INTERVAL=(\d+)/);
  const hourMatch = schedule.match(/BYHOUR=([\d,]+)/);

  const freq = freqMatch?.[1];
  const interval = intervalMatch ? parseInt(intervalMatch[1]) : 1;

  if (hourMatch) {
    const hours = hourMatch[1]
      .split(",")
      .map(Number)
      .sort((a, b) => a - b);
    if (hours.length >= 2) {
      let minGap = 24;
      for (let i = 1; i < hours.length; i++) {
        minGap = Math.min(minGap, hours[i] - hours[i - 1]);
      }
      minGap = Math.min(minGap, 24 - hours[hours.length - 1] + hours[0]);
      return minGap * 60;
    }
    return 24 * 60;
  }

  if (freq === "MINUTELY") return interval;
  if (freq === "HOURLY") return interval * 60;
  if (freq === "DAILY") return interval * 24 * 60;
  if (freq === "WEEKLY") return interval * 7 * 24 * 60;

  return null;
}

/**
 * Parse RRule schedule string and format as human-readable time in user's timezone
 */
export function formatScheduleForUser(
  schedule: string,
  timezone: string,
): string {
  const hourMatch = schedule.match(/BYHOUR=(\d+)/);
  const minuteMatch = schedule.match(/BYMINUTE=(\d+)/);
  const dayMatch = schedule.match(/BYDAY=([A-Z,]+)/);
  const freqMatch = schedule.match(/FREQ=(\w+)/);
  const intervalMatch = schedule.match(/INTERVAL=(\d+)/);

  const hour = hourMatch ? parseInt(hourMatch[1]) : null;
  const minute = minuteMatch ? parseInt(minuteMatch[1]) : 0;
  const days = dayMatch ? dayMatch[1] : null;
  const freq = freqMatch ? freqMatch[1] : "DAILY";
  const interval = intervalMatch ? parseInt(intervalMatch[1]) : 1;

  // Format time
  let timeStr = "";
  if (hour !== null) {
    const dt = DateTime.now().setZone(timezone).set({ hour, minute });
    timeStr = dt.toFormat("h:mm a").toLowerCase();
  }

  // Format frequency
  let freqStr = "";
  const dayNames: Record<string, string> = {
    MO: "mon",
    TU: "tue",
    WE: "wed",
    TH: "thu",
    FR: "fri",
    SA: "sat",
    SU: "sun",
  };

  if (freq === "DAILY" && days) {
    const dayList = days
      .split(",")
      .map((d) => dayNames[d] || d)
      .join("/");
    freqStr = dayList;
  } else if (freq === "DAILY") {
    freqStr = interval > 1 ? `every ${interval} days` : "daily";
  } else if (freq === "WEEKLY") {
    freqStr = interval > 1 ? `every ${interval} weeks` : "weekly";
    if (days) {
      const dayList = days
        .split(",")
        .map((d) => dayNames[d] || d)
        .join("/");
      freqStr += ` on ${dayList}`;
    }
  } else if (freq === "MINUTELY") {
    freqStr = `every ${interval} min`;
  } else if (freq === "HOURLY") {
    freqStr = interval > 1 ? `every ${interval} hours` : "hourly";
  }

  if (timeStr && freqStr) {
    return `${freqStr} at ${timeStr}`;
  } else if (timeStr) {
    return `at ${timeStr}`;
  } else if (freqStr) {
    return freqStr;
  }
  return schedule;
}

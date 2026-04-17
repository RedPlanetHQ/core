import { describe, it, expect, vi } from "vitest";

// Mock the database layer so the pure date utility can be tested in isolation
// without requiring a live Prisma / @core/database setup.
vi.mock("~/db.server", () => ({ prisma: {} }));

import { todayUTCMidnightInTimezone } from "../page.server";

describe("todayUTCMidnightInTimezone", () => {
  // Asia/Kolkata is UTC+5:30.
  // At 00:03 IST on 2026-04-08 the UTC instant is 2026-04-07T18:33:00Z.
  // The function must return midnight UTC for April 8, not April 7.
  it("returns April 8 UTC midnight for Asia/Kolkata at 00:03 IST on April 8", () => {
    const nowUTC = new Date("2026-04-07T18:33:00.000Z");
    const result = todayUTCMidnightInTimezone("Asia/Kolkata", nowUTC);
    expect(result.toISOString()).toBe("2026-04-08T00:00:00.000Z");
  });

  // At 23:31 UTC on April 7 it is 05:01 IST on April 8 – still April 8 locally.
  it("returns April 8 UTC midnight for Asia/Kolkata at 05:01 IST on April 8", () => {
    const nowUTC = new Date("2026-04-07T23:31:00.000Z");
    const result = todayUTCMidnightInTimezone("Asia/Kolkata", nowUTC);
    expect(result.toISOString()).toBe("2026-04-08T00:00:00.000Z");
  });

  // Late in the UTC day (22:00 UTC on April 8) while still the same local date in UTC+5:30.
  it("returns April 8 UTC midnight for Asia/Kolkata at 22:00 UTC on April 8", () => {
    const nowUTC = new Date("2026-04-08T22:00:00.000Z");
    const result = todayUTCMidnightInTimezone("Asia/Kolkata", nowUTC);
    expect(result.toISOString()).toBe("2026-04-09T00:00:00.000Z");
  });

  it("handles UTC timezone correctly", () => {
    const nowUTC = new Date("2026-04-08T00:03:00.000Z");
    const result = todayUTCMidnightInTimezone("UTC", nowUTC);
    expect(result.toISOString()).toBe("2026-04-08T00:00:00.000Z");
  });

  // America/New_York is UTC-4 during DST.
  // At 22:00 UTC on April 8 the local time is 18:00 on April 8 — same calendar day.
  it("returns April 8 UTC midnight for America/New_York at 22:00 UTC on April 8", () => {
    const nowUTC = new Date("2026-04-08T22:00:00.000Z");
    const result = todayUTCMidnightInTimezone("America/New_York", nowUTC);
    expect(result.toISOString()).toBe("2026-04-08T00:00:00.000Z");
  });

  // America/New_York: at 02:00 UTC on April 8 the local time is 22:00 on April 7.
  it("returns April 7 UTC midnight for America/New_York at 02:00 UTC on April 8", () => {
    const nowUTC = new Date("2026-04-08T02:00:00.000Z");
    const result = todayUTCMidnightInTimezone("America/New_York", nowUTC);
    expect(result.toISOString()).toBe("2026-04-07T00:00:00.000Z");
  });

  it("falls back to UTC calendar date for an invalid timezone string", () => {
    const nowUTC = new Date("2026-04-08T10:00:00.000Z");
    const result = todayUTCMidnightInTimezone("Not/ATimezone", nowUTC);
    expect(result.toISOString()).toBe("2026-04-08T00:00:00.000Z");
  });

  // Verify the no-arg form uses the real clock (smoke test – just check the
  // result is a valid midnight-UTC date).
  it("returns a valid midnight-UTC Date when called without explicit 'now'", () => {
    const result = todayUTCMidnightInTimezone("UTC");
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });
});

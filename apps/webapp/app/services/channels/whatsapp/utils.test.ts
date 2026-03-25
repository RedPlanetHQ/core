import { describe, it, expect } from "vitest";
import { ordinalSuffix, formatDailyWhatsAppTitle } from "./utils";

describe("ordinalSuffix", () => {
  it("returns st for 1, 21, 31", () => {
    expect(ordinalSuffix(1)).toBe("st");
    expect(ordinalSuffix(21)).toBe("st");
    expect(ordinalSuffix(31)).toBe("st");
  });

  it("returns nd for 2, 22", () => {
    expect(ordinalSuffix(2)).toBe("nd");
    expect(ordinalSuffix(22)).toBe("nd");
  });

  it("returns rd for 3, 23", () => {
    expect(ordinalSuffix(3)).toBe("rd");
    expect(ordinalSuffix(23)).toBe("rd");
  });

  it("returns th for 4-20 (teens always th)", () => {
    [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].forEach(
      (d) => {
        expect(ordinalSuffix(d)).toBe("th");
      },
    );
  });

  it("11th, 12th, 13th are th (not st/nd/rd)", () => {
    expect(ordinalSuffix(11)).toBe("th");
    expect(ordinalSuffix(12)).toBe("th");
    expect(ordinalSuffix(13)).toBe("th");
  });

  it("returns th for 24-30", () => {
    [24, 25, 26, 27, 28, 29, 30].forEach((d) => {
      expect(ordinalSuffix(d)).toBe("th");
    });
  });
});

describe("formatDailyWhatsAppTitle", () => {
  it("formats 21 Mar 2026 correctly", () => {
    // 2026-03-21 00:00 UTC = 2026-03-21 05:30 IST → still the 21st
    const date = new Date("2026-03-21T00:00:00Z");
    expect(formatDailyWhatsAppTitle(date)).toBe("21st mar'26 whatsapp");
  });

  it("formats 1 Jan 2026 correctly", () => {
    const date = new Date("2026-01-01T06:00:00Z");
    expect(formatDailyWhatsAppTitle(date)).toBe("1st jan'26 whatsapp");
  });

  it("formats 2 Feb 2026 correctly", () => {
    const date = new Date("2026-02-02T06:00:00Z");
    expect(formatDailyWhatsAppTitle(date)).toBe("2nd feb'26 whatsapp");
  });

  it("formats 3 Apr 2027 correctly", () => {
    const date = new Date("2027-04-03T06:00:00Z");
    expect(formatDailyWhatsAppTitle(date)).toBe("3rd apr'27 whatsapp");
  });

  it("formats 11 Jun 2026 as th (teen override)", () => {
    const date = new Date("2026-06-11T06:00:00Z");
    expect(formatDailyWhatsAppTitle(date)).toBe("11th jun'26 whatsapp");
  });

  it("formats 12 Jul 2026 as th (teen override)", () => {
    const date = new Date("2026-07-12T06:00:00Z");
    expect(formatDailyWhatsAppTitle(date)).toBe("12th jul'26 whatsapp");
  });

  it("formats 13 Aug 2026 as th (teen override)", () => {
    const date = new Date("2026-08-13T06:00:00Z");
    expect(formatDailyWhatsAppTitle(date)).toBe("13th aug'26 whatsapp");
  });

  it("formats 31 Dec 2026 correctly", () => {
    const date = new Date("2026-12-31T06:00:00Z");
    expect(formatDailyWhatsAppTitle(date)).toBe("31st dec'26 whatsapp");
  });

  it("uses IST timezone boundary (UTC 18:30 = IST midnight next day)", () => {
    // 2026-03-24T18:30:00Z = 2026-03-25T00:00:00+05:30 (IST) → 25th
    const date = new Date("2026-03-24T18:30:00Z");
    expect(formatDailyWhatsAppTitle(date)).toBe("25th mar'26 whatsapp");
  });

  it("title is all lowercase", () => {
    const date = new Date("2026-05-15T06:00:00Z");
    const title = formatDailyWhatsAppTitle(date);
    expect(title).toBe(title.toLowerCase());
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { DailyPage } from "../daily-page.client";

vi.mock("../day-editor.client", () => ({
  DayEditor: ({ pageId, isToday }: { pageId: string; isToday: boolean }) => (
    <div data-page={pageId} data-today={isToday} />
  ),
}));
vi.mock("~/hooks/use-tauri", () => ({
  useTauri: () => ({ isDesktop: false }),
}));

it("labels the prefetched note with the account's calendar date", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-06T12:00:00.000Z"));
  try {
    const html = renderToStaticMarkup(
      <DailyPage
        butlerName="Test"
        workspaceId="workspace"
        userId="user"
        collabToken="test"
        todayPage={{ id: "jan-7", date: "2026-01-07T00:00:00.000Z" }}
      />,
    );
    expect(html).toContain("Wed, January 7th, 2026");
    expect(html).toContain('data-page="jan-7" data-today="true"');
    expect(html).not.toContain("Tue, January 6th, 2026");
  } finally {
    vi.useRealTimers();
  }
});

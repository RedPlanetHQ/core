// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPromptInput } from "../terminal-prompt-input";

let container: HTMLDivElement;
let root: Root;
let onSubmit: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onSubmit = vi.fn(() => true);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(disabled = false) {
  await act(async () => {
    root.render(
      <TerminalPromptInput disabled={disabled} onSubmit={onSubmit} />,
    );
  });
}

async function type(value: string) {
  const textarea = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return textarea;
}

async function key(
  textarea: HTMLTextAreaElement,
  init: KeyboardEventInit = {},
) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => textarea.dispatchEvent(event));
  return event;
}

describe("TerminalPromptInput", () => {
  it("leaves Enter and Shift+Enter to native newline handling", async () => {
    await render();
    const textarea = await type("first line");
    expect((await key(textarea)).defaultPrevented).toBe(false);
    expect((await key(textarea, { shiftKey: true })).defaultPrevented).toBe(
      false,
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(["ctrlKey", "metaKey"] as const)(
    "sends exact multiline text with %s+Enter",
    async (modifier) => {
      await render();
      const prompt = "  first line\n\nsecond line  ";
      const textarea = await type(prompt);
      const event = await key(textarea, { [modifier]: true });
      expect(event.defaultPrevented).toBe(true);
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith(prompt);
      expect(textarea.value).toBe("");
    },
  );

  it("sends through the button", async () => {
    await render();
    await type("first\nsecond");
    await act(async () => container.querySelector("button")!.click());
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("first\nsecond");
  });

  it("does not submit during IME composition", async () => {
    await render();
    const textarea = await type("こんにちは");
    expect(
      (await key(textarea, { ctrlKey: true, isComposing: true }))
        .defaultPrevented,
    ).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks empty and disconnected submissions", async () => {
    await render();
    await type(" \n ");
    expect(container.querySelector("button")!.disabled).toBe(true);
    await render(true);
    const textarea = await type("keep this");
    await key(textarea, { ctrlKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.disabled).toBe(true);
  });

  it("retains the draft when the terminal disconnects before sending", async () => {
    onSubmit.mockReturnValue(false);
    await render();
    const textarea = await type("first\nsecond");
    await key(textarea, { ctrlKey: true });
    expect(textarea.value).toBe("first\nsecond");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});

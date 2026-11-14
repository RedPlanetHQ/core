import { useId, useState, type FormEvent } from "react";
import { Button } from "~/components/ui/button";

interface Props {
  disabled: boolean;
  /** False means the terminal disconnected before the prompt could be sent. */
  onSubmit: (prompt: string) => boolean;
}

export function TerminalPromptInput({ disabled, onSubmit }: Props) {
  const [prompt, setPrompt] = useState("");
  const [sendError, setSendError] = useState(false);
  const hintId = useId();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (disabled || !prompt.trim()) return;
    if (!onSubmit(prompt)) {
      setSendError(true);
      return;
    }
    setPrompt("");
    setSendError(false);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border mt-3 shrink-0 border-t pt-3"
    >
      <textarea
        aria-label="Coding session prompt"
        aria-describedby={hintId}
        className="bg-input placeholder:text-muted-foreground focus-visible:ring-ring max-h-40 min-h-20 w-full resize-y rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50"
        rows={3}
        placeholder="Write a prompt…"
        disabled={disabled}
        value={prompt}
        onChange={(event) => {
          setPrompt(event.target.value);
          setSendError(false);
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p id={hintId} className="text-muted-foreground text-xs">
          Enter for a new line. Ctrl/Cmd+Enter to send.
        </p>
        <Button type="submit" size="sm" disabled={disabled || !prompt.trim()}>
          Send prompt
        </Button>
      </div>
      {sendError && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          Couldn’t send the prompt. Check the terminal connection and try again.
        </p>
      )}
    </form>
  );
}

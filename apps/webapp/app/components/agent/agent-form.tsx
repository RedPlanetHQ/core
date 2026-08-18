import { useEffect, useState } from "react";
import { Button, Input } from "~/components/ui";
import { Textarea } from "~/components/ui/textarea";
import { Card, CardContent } from "~/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  SamAvatar,
  SAM_EYE_OPTIONS,
  SAM_EYE_COLOR_OPTIONS,
  DEFAULT_SAM_EYE,
  DEFAULT_SAM_EYE_COLOR,
} from "~/components/ui/sam-avatar";
import { cn } from "~/lib/utils";

export type AgentKind = "system" | "gateway" | "user";

export interface AgentFormValue {
  displayName: string;
  handle: string;
  basePrompt: string;
  /** Voice/personality id — built-in ("tars", "alfred", …) or a workspace
   *  custom personality id. Passed straight through to the API. */
  personality: string;
  eye: string;
  eyeColor: string;
}

/** Shape the form needs to render the personality dropdown. The full
 *  built-in `PERSONALITY_OPTIONS` (services/agent/prompts/personality.ts)
 *  matches; workspace custom personalities get flattened to the same
 *  shape by the caller. */
export interface PersonalityChoice {
  id: string;
  name: string;
  description?: string;
}

export interface AgentFormProps {
  /** "create" hides handle-collision hints since the backend picks a unique one. */
  mode: "create" | "edit";
  /** system/gateway agents lock name + handle. */
  kind: AgentKind;
  initial: AgentFormValue;
  /** Choices for the personality dropdown. Built-ins first, custom
   *  personalities appended by the loader. Required — an empty list
   *  disables the picker (still valid: caller can rely on the DB default). */
  personalities: PersonalityChoice[];
  submitLabel: string;
  onSubmit: (value: AgentFormValue) => Promise<void> | void;
  error?: string | null;
  isSubmitting?: boolean;
}

export function defaultAgentFormValue(): AgentFormValue {
  return {
    displayName: "",
    handle: "",
    basePrompt: "",
    personality: "tars",
    eye: DEFAULT_SAM_EYE,
    eyeColor: DEFAULT_SAM_EYE_COLOR,
  };
}

function slugifyHandle(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function AgentForm({
  mode,
  kind,
  initial,
  personalities,
  submitLabel,
  onSubmit,
  error,
  isSubmitting = false,
}: AgentFormProps) {
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [handle, setHandle] = useState(initial.handle);
  const [handleManuallyEdited, setHandleManuallyEdited] = useState(
    mode === "edit",
  );
  const [basePrompt, setBasePrompt] = useState(initial.basePrompt);
  const [personality, setPersonality] = useState(initial.personality);
  const [eye, setEye] = useState(initial.eye);
  const [eyeColor, setEyeColor] = useState(initial.eyeColor);

  // Auto-derive handle from display name until user edits it.
  useEffect(() => {
    if (mode === "create" && !handleManuallyEdited) {
      setHandle(slugifyHandle(displayName));
    }
  }, [displayName, handleManuallyEdited, mode]);

  const identityLocked = kind !== "user";
  const isDirty =
    displayName !== initial.displayName ||
    handle !== initial.handle ||
    basePrompt !== initial.basePrompt ||
    personality !== initial.personality ||
    eye !== initial.eye ||
    eyeColor !== initial.eyeColor;

  const canSubmit =
    displayName.trim().length > 0 &&
    handle.trim().length >= 2 &&
    basePrompt.trim().length > 0 &&
    (mode === "create" || isDirty) &&
    !isSubmitting;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      displayName: displayName.trim(),
      handle: handle.trim(),
      basePrompt,
      personality,
      eye,
      eyeColor,
    });
  };

  const kindHint =
    kind === "system"
      ? "The generalist agent is the workspace's default assistant — its name and handle mirror the workspace and are edited on the workspace settings page."
      : kind === "gateway"
        ? "Gateway agents are managed by the gateway lifecycle. The name and handle can't be changed here."
        : null;

  const selectedPersonality = personalities.find((p) => p.id === personality);

  return (
    <div className="md:w-3xl mx-auto flex w-auto flex-col gap-4 px-4 py-6">
      <Card>
        <CardContent className="flex flex-col gap-5 p-4">
          {/* Live preview */}
          <div className="flex items-center gap-4">
            <SamAvatar size={72} eye={eye} eyeColor={eyeColor} />
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                {displayName || "Unnamed agent"}
              </span>
              <span className="text-muted-foreground text-xs">
                {SAM_EYE_OPTIONS.find((o) => o.id === eye)?.label ?? eye}
              </span>
            </div>
          </div>

          {kindHint && (
            <p className="text-muted-foreground text-xs">{kindHint}</p>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Cass"
              disabled={identityLocked}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Handle</label>
            <Input
              value={handle}
              onChange={(e) => {
                setHandleManuallyEdited(true);
                setHandle(slugifyHandle(e.target.value));
              }}
              placeholder="handle"
              disabled={identityLocked}
            />
            <p className="text-muted-foreground text-xs">
              Used to @mention the agent. Lowercase, letters, digits, and dashes.
            </p>
          </div>

          {/* Voice / personality */}
          {personalities.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Voice</label>
              <Select
                value={personality}
                onValueChange={setPersonality}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a voice" />
                </SelectTrigger>
                <SelectContent>
                  {personalities.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPersonality?.description && (
                <p className="text-muted-foreground text-xs">
                  {selectedPersonality.description}
                </p>
              )}
            </div>
          )}

          {/* Mood (eye pattern) */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Mood</label>
            <div className="grid grid-cols-6 gap-2">
              {SAM_EYE_OPTIONS.map((opt) => {
                const selected = eye === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    title={opt.desc}
                    onClick={() => setEye(opt.id)}
                    className={cn(
                      "bg-background flex flex-col items-center gap-1 rounded-md border-2 p-2 transition-all hover:scale-[1.03] focus:outline-none",
                      selected
                        ? "border-primary"
                        : "hover:border-border border-transparent",
                    )}
                  >
                    <SamAvatar size={40} eye={opt.id} eyeColor={eyeColor} />
                    <span className="text-muted-foreground text-[10px]">
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Color */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Color</label>
            <div className="flex flex-wrap gap-2">
              {SAM_EYE_COLOR_OPTIONS.map((opt) => {
                const selected = eyeColor === opt.hex;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    title={opt.label}
                    onClick={() => setEyeColor(opt.hex)}
                    className={cn(
                      "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none",
                      selected ? "border-border" : "border-transparent",
                    )}
                    style={{ backgroundColor: opt.hex }}
                  />
                );
              })}
            </div>
          </div>

          {/* Prompt */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Prompt</label>
            <Textarea
              value={basePrompt}
              onChange={(e) => setBasePrompt(e.target.value)}
              placeholder="Describe how this agent should behave..."
              rows={16}
              className="font-mono text-xs"
            />
            <p className="text-muted-foreground text-xs">
              Supports {"{{AGENT_NAME}}"}, {"{{USER_NAME}}"}, {"{{VOICE}}"},{" "}
              {"{{TOOLS}}"}, {"{{MEMORY_RULES}}"}, {"{{CAPABILITIES}}"},{" "}
              {"{{TIME}}"}, {"{{USER}}"}, {"{{PERSONA}}"} tokens.
            </p>
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}

          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="lg"
              onClick={submit}
              disabled={!canSubmit}
              isLoading={isSubmitting}
            >
              {submitLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * ElevenLabs voice picker for TTS — searchable, fetches the full
 * catalog the workspace's account has access to.
 *
 * Behaviour:
 *   - On mount, loads `/api/v1/voice/voices?provider=elevenlabs`.
 *     Falls back to a small built-in list if the key isn't configured
 *     yet, so the picker still shows something.
 *   - Popover + Command (cmdk) for in-place search.
 *   - Preview uses the voice's `preview_url` when ElevenLabs returns
 *     one (avoids spending TTS credits to audition a voice).
 *
 * Voice selection persists to user.metadata via the parent route's
 * action ("updateElevenLabsVoice" intent). The workspace API key
 * input lives in the parent VoiceSection so it isn't duplicated.
 */

import { useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";

import { Button } from "~/components/ui";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";

export const DEFAULT_ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

interface RemoteVoice {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  previewUrl: string | null;
  labels: Record<string, string> | null;
}

// Used as a placeholder catalog when the workspace key isn't configured
// yet — gives the user something to look at without making them set up
// auth just to see what the picker looks like.
const FALLBACK_VOICES: RemoteVoice[] = [
  {
    id: "JBFqnCBsd6RMkjVDRZzb",
    name: "George",
    description: "calm British male",
    category: "premade",
    previewUrl: null,
    labels: null,
  },
  {
    id: "21m00Tcm4TlvDq8ikWAM",
    name: "Rachel",
    description: "warm American female",
    category: "premade",
    previewUrl: null,
    labels: null,
  },
  {
    id: "EXAVITQu4vr4xnSDxMaL",
    name: "Sarah",
    description: "soft American female",
    category: "premade",
    previewUrl: null,
    labels: null,
  },
  {
    id: "IKne3meq5aSn9XLyUdCD",
    name: "Charlie",
    description: "casual Australian male",
    category: "premade",
    previewUrl: null,
    labels: null,
  },
  {
    id: "pNInz6obpgDQGcFmaJgB",
    name: "Adam",
    description: "deep American male",
    category: "premade",
    previewUrl: null,
    labels: null,
  },
  {
    id: "nPczCjzI2devNBz1zQrb",
    name: "Brian",
    description: "deep narrator male",
    category: "premade",
    previewUrl: null,
    labels: null,
  },
];

interface ElevenLabsPickerProps {
  voiceId: string;
}

type CatalogState =
  | { status: "loading"; voices: RemoteVoice[] }
  | { status: "ready"; voices: RemoteVoice[] }
  | { status: "needs-config"; voices: RemoteVoice[] }
  | { status: "error"; voices: RemoteVoice[]; message: string };

export function ElevenLabsPicker({ voiceId }: ElevenLabsPickerProps) {
  const voiceFetcher = useFetcher();
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogState>({
    status: "loading",
    voices: FALLBACK_VOICES,
  });
  // Single audio element reused across previews — cancels any previous
  // sample when the user clicks a new one.
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/voice/voices?provider=elevenlabs", {
          credentials: "include",
        });
        if (cancelled) return;
        if (res.status === 412) {
          setCatalog({ status: "needs-config", voices: FALLBACK_VOICES });
          return;
        }
        if (!res.ok) {
          setCatalog({
            status: "error",
            voices: FALLBACK_VOICES,
            message: `voices ${res.status}`,
          });
          return;
        }
        const data = (await res.json()) as { voices?: RemoteVoice[] };
        const voices = data.voices ?? [];
        setCatalog({
          status: "ready",
          voices: voices.length > 0 ? voices : FALLBACK_VOICES,
        });
      } catch (err) {
        if (cancelled) return;
        setCatalog({
          status: "error",
          voices: FALLBACK_VOICES,
          message: String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentVoiceId =
    (voiceFetcher.formData?.get("elevenLabsVoiceId")?.toString() ||
      voiceId ||
      DEFAULT_ELEVENLABS_VOICE_ID) as string;

  const selected = catalog.voices.find((v) => v.id === currentVoiceId) ?? null;

  function handleVoiceChange(nextVoiceId: string) {
    voiceFetcher.submit(
      { intent: "updateElevenLabsVoice", elevenLabsVoiceId: nextVoiceId },
      { method: "POST" },
    );
    setOpen(false);
  }

  function stopPreview() {
    const a = previewAudioRef.current;
    if (a) {
      try {
        a.pause();
      } catch {
        // ignore
      }
      previewAudioRef.current = null;
    }
    setPreviewingId(null);
  }

  async function previewVoice(voice: RemoteVoice) {
    // Toggle off if already playing this one.
    if (previewingId === voice.id) {
      stopPreview();
      return;
    }
    stopPreview();

    // Prefer the catalog's preview_url — instant + free. Fall back to
    // the synthesis route only when ElevenLabs didn't return a sample.
    if (voice.previewUrl) {
      try {
        const audio = new Audio(voice.previewUrl);
        previewAudioRef.current = audio;
        setPreviewingId(voice.id);
        audio.addEventListener("ended", () => {
          if (previewAudioRef.current === audio) {
            previewAudioRef.current = null;
            setPreviewingId(null);
          }
        });
        audio.addEventListener("error", () => {
          if (previewAudioRef.current === audio) {
            previewAudioRef.current = null;
            setPreviewingId(null);
          }
        });
        await audio.play();
      } catch {
        stopPreview();
      }
      return;
    }

    // No preview_url → synthesize a short sample. The selected voice on
    // the user is what /api/v1/voice/tts uses, so persist first.
    if (currentVoiceId !== voice.id) handleVoiceChange(voice.id);
    try {
      const res = await fetch("/api/v1/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text: "Hi, this is butler. How does this voice sound?",
        }),
      });
      if (!res.ok || res.status === 204) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      setPreviewingId(voice.id);
      audio.addEventListener("ended", () => {
        URL.revokeObjectURL(url);
        if (previewAudioRef.current === audio) {
          previewAudioRef.current = null;
          setPreviewingId(null);
        }
      });
      audio.addEventListener("error", () => {
        URL.revokeObjectURL(url);
        if (previewAudioRef.current === audio) {
          previewAudioRef.current = null;
          setPreviewingId(null);
        }
      });
      await audio.play();
    } catch {
      stopPreview();
    }
  }

  // Group voices by category for the popover list — keeps cloned /
  // professional voices visually separate from the premade catalog.
  const groups = groupByCategory(catalog.voices);

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between text-left font-normal"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {selected ? (
                <>
                  <span className="truncate font-medium">{selected.name}</span>
                  {voiceMetaLabel(selected) && (
                    <span className="text-muted-foreground truncate text-xs">
                      — {voiceMetaLabel(selected)}
                    </span>
                  )}
                </>
              ) : catalog.status === "loading" ? (
                <span className="text-muted-foreground flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" />
                  Loading voices…
                </span>
              ) : (
                <span className="text-muted-foreground">Pick a voice</span>
              )}
            </span>
            <ChevronsUpDown
              size={14}
              className="text-muted-foreground ml-2 shrink-0 opacity-60"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
        >
          <Command>
            <CommandInput placeholder="Search voices…" />
            <CommandList>
              <CommandEmpty>No matching voice.</CommandEmpty>
              {groups.map(({ category, voices }) => (
                <CommandGroup
                  key={category}
                  heading={prettyCategory(category)}
                >
                  {voices.map((v) => (
                    <CommandItem
                      key={v.id}
                      value={`${v.name} ${v.description ?? ""} ${labelString(v.labels)}`}
                      onSelect={() => handleVoiceChange(v.id)}
                      className="flex items-center gap-2"
                    >
                      <Check
                        size={14}
                        className={cn(
                          "shrink-0",
                          currentVoiceId === v.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-center gap-2 truncate">
                          <span className="truncate font-medium">{v.name}</span>
                          {voiceMetaLabel(v) && (
                            <span className="text-muted-foreground truncate text-xs">
                              — {voiceMetaLabel(v)}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void previewVoice(v);
                        }}
                        className={cn(
                          "text-muted-foreground hover:text-foreground shrink-0 rounded px-1.5 py-0.5 text-xs",
                          previewingId === v.id && "text-primary",
                        )}
                      >
                        {previewingId === v.id ? "Stop" : "Preview"}
                      </button>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {catalog.status === "needs-config" && (
        <p className="text-muted-foreground text-xs">
          Showing built-in voices. Add an ElevenLabs key below to see your
          full account catalog.
        </p>
      )}
      {catalog.status === "error" && (
        <p className="text-destructive text-xs">
          Couldn't load your voice catalog ({catalog.message}). Showing
          built-in voices.
        </p>
      )}
    </div>
  );
}

function groupByCategory(
  voices: RemoteVoice[],
): Array<{ category: string; voices: RemoteVoice[] }> {
  const order = ["cloned", "professional", "generated", "premade"];
  const map = new Map<string, RemoteVoice[]>();
  for (const v of voices) {
    const key = (v.category ?? "premade").toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(v);
  }
  const groups: Array<{ category: string; voices: RemoteVoice[] }> = [];
  for (const key of order) {
    if (map.has(key)) groups.push({ category: key, voices: map.get(key)! });
  }
  // Any unexpected category goes at the end so we don't drop voices.
  for (const [key, group] of map) {
    if (!order.includes(key)) groups.push({ category: key, voices: group });
  }
  return groups;
}

function prettyCategory(c: string): string {
  if (c === "premade") return "Built-in";
  if (c === "cloned") return "Your clones";
  if (c === "professional") return "Professional";
  if (c === "generated") return "Generated";
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function voiceMetaLabel(v: RemoteVoice): string {
  if (v.description) return v.description;
  if (v.labels) {
    const parts: string[] = [];
    if (v.labels.accent) parts.push(v.labels.accent);
    if (v.labels.gender) parts.push(v.labels.gender);
    if (v.labels.use_case) parts.push(v.labels.use_case);
    if (parts.length > 0) return parts.join(", ");
  }
  return "";
}

function labelString(labels: Record<string, string> | null): string {
  if (!labels) return "";
  return Object.values(labels).join(" ");
}

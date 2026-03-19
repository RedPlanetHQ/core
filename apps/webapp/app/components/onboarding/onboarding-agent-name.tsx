import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, Check, X } from "lucide-react";
import { Button } from "~/components/ui";
import { Input } from "~/components/ui/input";

interface OnboardingAgentNameProps {
  defaultName: string;
  defaultSlug: string;
  workspaceId: string;
  onComplete: (name: string, slug: string) => void;
  isSubmitting?: boolean;
}

type AvailabilityState = "idle" | "checking" | "available" | "taken";

export function OnboardingAgentName({
  defaultName,
  defaultSlug,
  workspaceId,
  onComplete,
  isSubmitting = false,
}: OnboardingAgentNameProps) {
  const [name, setName] = useState(defaultName);
  const [slug, setSlug] = useState(defaultSlug);
  const [availability, setAvailability] = useState<AvailabilityState>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkAvailability = useCallback(
    async (nameValue: string) => {
      setAvailability("checking");
      try {
        const res = await fetch("/api/v1/onboarding/check-name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: nameValue,
            currentWorkspaceId: workspaceId,
          }),
        });
        const data = await res.json();
        setSlug(data.slug || "");
        setAvailability(data.available ? "available" : "taken");
      } catch {
        setAvailability("idle");
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    if (!name.trim()) {
      setAvailability("idle");
      setSlug("");
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => checkAvailability(name), 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [name, checkAvailability]);

  const canContinue =
    name.trim() &&
    slug &&
    availability !== "taken" &&
    availability !== "checking";

  return (
    <div className="flex w-full max-w-lg flex-col gap-4 p-3">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">name your butler</h2>
        <p className="text-muted-foreground text-base">
          give your butler a name. this is how you'll know them.
        </p>
      </div>

      <div className="space-y-1">
        <div className="relative">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Steven"
            className="h-10 pr-8"
            disabled={isSubmitting}
            autoFocus
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            {availability === "checking" && (
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            )}
            {availability === "available" && (
              <Check className="text-success size-4" />
            )}
            {availability === "taken" && (
              <X className="text-destructive size-4" />
            )}
          </div>
        </div>
        {availability === "taken" && (
          <p className="text-destructive text-xs">
            "{slug}" is already taken. try a different name.
          </p>
        )}
      </div>

      {slug && availability !== "taken" && (
        <p className="text-muted-foreground text-md">
          you can email your butler at{" "}
          <span className="text-foreground font-medium">{slug}@getcore.me</span>
        </p>
      )}

      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="lg"
          onClick={() => canContinue && onComplete(name.trim(), slug)}
          disabled={!canContinue || isSubmitting}
          isLoading={isSubmitting}
        >
          continue
        </Button>
      </div>
    </div>
  );
}

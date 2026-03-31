import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, Check, X } from "lucide-react";
import { Button } from "~/components/ui";
import { Input } from "~/components/ui/input";
import Avatar from "boring-avatars";

interface OnboardingAgentNameProps {
  defaultName: string;
  defaultSlug: string;
  workspaceId: string;
  onComplete: (name: string, slug: string) => void;
  isSubmitting?: boolean;
}

type AvailabilityState = "idle" | "checking" | "available" | "taken";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function OnboardingAgentName({
  defaultName,
  defaultSlug,
  workspaceId,
  onComplete,
  isSubmitting = false,
}: OnboardingAgentNameProps) {
  const [name, setName] = useState(defaultName);
  const [slug, setSlug] = useState(defaultSlug);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityState>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkAvailability = useCallback(
    async (slugValue: string) => {
      setAvailability("checking");
      try {
        const res = await fetch("/api/v1/onboarding/check-name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug: slugValue,
            currentWorkspaceId: workspaceId,
          }),
        });
        const data = await res.json();
        setAvailability(data.available ? "available" : "taken");
      } catch {
        setAvailability("idle");
      }
    },
    [workspaceId],
  );

  // Auto-derive slug from name unless user has manually edited it
  useEffect(() => {
    if (!slugManuallyEdited) {
      setSlug(slugify(name));
    }
  }, [name, slugManuallyEdited]);

  // Debounced availability check on slug
  useEffect(() => {
    if (!slug.trim()) {
      setAvailability("idle");
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => checkAvailability(slug), 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [slug, checkAvailability]);

  const canContinue =
    name.trim() &&
    slug &&
    availability !== "taken" &&
    availability !== "checking";

  return (
    <div className="flex w-full max-w-lg flex-col gap-4 p-3">
      <div className="flex justify-center">
        <Avatar
          name={name || "butler"}
          variant="pixel"
          colors={["var(--background-3)", "#c87844"]}
          size={72}
        />
      </div>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">name your butler</h2>
        <p className="text-muted-foreground text-base">
          give your butler a name. this is how you'll know them.
        </p>
      </div>

      <div className="space-y-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Alfred"
          className="h-10"
          disabled={isSubmitting}
          autoFocus
        />

        <div className="space-y-1">
          <div className="relative">
            <Input
              value={slug}
              onChange={(e) => {
                setSlugManuallyEdited(true);
                setSlug(slugify(e.target.value));
              }}
              placeholder="email slug"
              className="h-10 pr-10"
              disabled={isSubmitting}
            />
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center">
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
          {availability === "taken" ? (
            <p className="text-destructive text-xs">
              "{slug}@getcore.me" is already taken.
            </p>
          ) : slug ? (
            <p className="text-muted-foreground text-xs">
              your butler's email:{" "}
              <span className="text-foreground font-medium">{slug}@getcore.me</span>
            </p>
          ) : null}
        </div>
      </div>

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

import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, Check, X, Plus, ArrowLeft } from "lucide-react";
import { Button } from "~/components/ui";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import {
  PERSONALITY_OPTIONS,
  type PersonalityType,
} from "~/services/agent/prompts/personality";
import { ALFRED_VOICE } from "~/services/agent/prompts/personality";
import {
  generateButlerEmailSlug,
  generateButlerEmail,
} from "~/utils/onboarding-email";

type Step = "personality" | "form";
type AvailabilityState = "idle" | "checking" | "available" | "taken";

export interface CustomPersonalityData {
  name: string;
  text: string;
  useHonorifics: boolean;
}

export interface OnboardingAgentNameProps {
  defaultName: string;
  defaultSlug: string;
  workspaceId: string;
  emailDomain: string;
  userName: string;
  onComplete: (
    name: string,
    slug: string,
    personalityId: string,
    customPersonality?: CustomPersonalityData,
  ) => void;
  isSubmitting?: boolean;
}

export function OnboardingAgentName({
  defaultName,
  defaultSlug,
  workspaceId,
  emailDomain,
  userName,
  onComplete,
  isSubmitting = false,
}: OnboardingAgentNameProps) {
  const [step, setStep] = useState<Step>("personality");
  const [selectedPersonalityId, setSelectedPersonalityId] = useState<
    PersonalityType | "custom" | null
  >(null);

  // Step 2 form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailManuallyEdited, setEmailManuallyEdited] = useState(false);
  const [customPrompt, setCustomPrompt] = useState(ALFRED_VOICE);
  const [availability, setAvailability] = useState<AvailabilityState>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isCustom = selectedPersonalityId === "custom";

  // Derive slug from email local part (before @)
  const slugFromEmail = email.split("@")[0] ?? "";

  const checkAvailability = useCallback(
    async (slugValue: string) => {
      if (!slugValue.trim()) {
        setAvailability("idle");
        return;
      }
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

  // Auto-generate email from name when not manually edited (default personalities only)
  useEffect(() => {
    if (emailManuallyEdited || isCustom) return;
    if (!name.trim()) {
      setEmail("");
      return;
    }
    setEmail(generateButlerEmail(name, userName, emailDomain));
  }, [name, userName, emailDomain, emailManuallyEdited, isCustom]);

  // Debounced availability check on slug
  useEffect(() => {
    if (isCustom || !slugFromEmail.trim()) {
      setAvailability("idle");
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => checkAvailability(slugFromEmail),
      500,
    );
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [slugFromEmail, checkAvailability, isCustom]);

  const handlePersonalitySelect = (id: PersonalityType | "custom") => {
    setSelectedPersonalityId(id);
    setEmailManuallyEdited(false);
    setAvailability("idle");

    if (id === "custom") {
      setName("");
      setEmail("");
      setCustomPrompt(ALFRED_VOICE);
    } else {
      const option = PERSONALITY_OPTIONS.find((p) => p.id === id);
      setName(option?.name ?? "");
      // email auto-generates via useEffect above
    }

    setStep("form");
  };

  const handleEmailChange = (value: string) => {
    setEmailManuallyEdited(true);
    setEmail(value);
  };

  const handleBack = () => {
    setStep("personality");
    setAvailability("idle");
  };

  const canContinue =
    !!name.trim() &&
    !isSubmitting &&
    (isCustom
      ? !!customPrompt.trim()
      : availability === "available" && !!slugFromEmail.trim());

  const handleContinue = () => {
    if (!canContinue || !selectedPersonalityId) return;
    const finalSlug =
      slugFromEmail || generateButlerEmailSlug(name, userName);

    if (isCustom) {
      const customId = name.toLowerCase().replace(/\s+/g, "-");
      onComplete(name.trim(), finalSlug, customId, {
        name: name.trim(),
        text: customPrompt,
        useHonorifics: false,
      });
    } else {
      onComplete(name.trim(), finalSlug, selectedPersonalityId);
    }
  };

  // --- Step 1: Personality selection ---
  if (step === "personality") {
    return (
      <div className="flex w-full max-w-2xl flex-col gap-4 p-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">choose a personality</h2>
          <p className="text-muted-foreground text-base">
            pick who shows up in your inbox.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PERSONALITY_OPTIONS.map((option) => (
            <Card
              key={option.id}
              className={cn(
                "hover:border-primary/50 relative cursor-pointer p-4 transition-all",
                selectedPersonalityId === option.id &&
                  "border-primary/50 border",
              )}
              onClick={() => handlePersonalitySelect(option.id)}
            >
              <h3 className="mb-1 font-medium">{option.name}</h3>
              <p className="text-muted-foreground mb-3 text-sm">
                {option.description}
              </p>
              {option.examples.slice(0, 1).map((example, idx) => (
                <div key={idx} className="bg-muted/50 rounded-md p-2 text-xs">
                  <p className="text-muted-foreground mb-1">
                    "{example.prompt}"
                  </p>
                  <p className="italic">"{example.response}"</p>
                </div>
              ))}
            </Card>
          ))}

          <Card
            className="hover:border-primary/50 flex cursor-pointer flex-col items-center justify-center gap-2 border-dashed p-4 transition-all"
            onClick={() => handlePersonalitySelect("custom")}
          >
            <Plus className="text-muted-foreground h-5 w-5" />
            <p className="text-muted-foreground text-sm">build your own</p>
          </Card>
        </div>
      </div>
    );
  }

  // --- Step 2: Name / Email form ---
  return (
    <div className="flex w-full max-w-lg flex-col gap-4 p-3">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          disabled={isSubmitting}
          className="gap-1.5 px-2"
        >
          <ArrowLeft className="h-4 w-4" />
          change personality
        </Button>
      </div>

      <div className="space-y-1">
        <h2 className="text-xl font-semibold">name your butler</h2>
        <p className="text-muted-foreground text-base">
          {isCustom
            ? "set up your custom butler."
            : "give your butler a name. this is how you'll know them."}
        </p>
      </div>

      <div className="space-y-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isCustom ? "e.g. Jarvis, Samantha, Max" : "e.g. Alfred"}
          className="h-10"
          disabled={isSubmitting}
          autoFocus
        />

        <div className="space-y-1">
          <div className="relative">
            <Input
              value={email}
              onChange={(e) => handleEmailChange(e.target.value)}
              placeholder={`butler_you@${emailDomain}`}
              className="h-10 pr-10"
              disabled={isSubmitting || isCustom}
            />
            {!isCustom && (
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
            )}
          </div>
          {!isCustom && (
            <>
              {availability === "taken" ? (
                <p className="text-destructive text-xs">
                  "{email}" is already taken.
                </p>
              ) : email ? (
                <p className="text-muted-foreground text-xs">
                  your butler's email:{" "}
                  <span className="text-foreground font-medium">{email}</span>
                </p>
              ) : null}
            </>
          )}
        </div>

        {isCustom && (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">personality prompt</p>
            <Textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Describe how the butler should talk — tone, style, what they never say..."
              className="min-h-[160px] text-sm"
              disabled={isSubmitting}
            />
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="lg"
          onClick={handleContinue}
          disabled={!canContinue || isSubmitting}
          isLoading={isSubmitting}
        >
          continue
        </Button>
      </div>
    </div>
  );
}

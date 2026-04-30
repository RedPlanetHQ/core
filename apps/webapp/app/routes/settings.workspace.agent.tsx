import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState } from "react";
import { requireUser } from "~/services/session.server";
import { prisma } from "~/db.server";
import { env } from "~/env.server";
import { hasWorkspaceElevenLabsKey } from "~/services/voice-tts.server";
import { SettingSection } from "~/components/setting-section";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui";
import { Check, Plus, Trash2, Pencil } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { CustomPersonalityDialog } from "~/components/personality/custom-personality-dialog.client";
import { ClientOnly } from "remix-utils/client-only";
import {
  PERSONALITY_OPTIONS,
  type PronounType,
} from "~/services/agent/prompts/personality";
import {
  getCustomPersonalities,
  saveCustomPersonality,
  deleteCustomPersonality,
  improvePersonality,
  type CustomPersonality,
} from "~/models/personality.server";
import { cn } from "~/lib/utils";
import { VoiceSection } from "~/components/voice";

const PRONOUN_OPTIONS: { id: PronounType; label: string; honorific: string }[] =
  [
    { id: "he/him", label: "He / Him", honorific: "sir" },
    { id: "she/her", label: "She / Her", honorific: "ma'am" },
    { id: "they/them", label: "They / Them", honorific: "name only" },
  ];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);

  if (!user.workspaceId) {
    throw new Error("Workspace not found");
  }

  const userMetadata = user.metadata as Record<string, unknown> | null;
  const personality = (userMetadata?.personality as string) || "tars";
  const pronoun = (userMetadata?.pronoun as PronounType) || "he/him";
  // Empty string / undefined = "same as default" (use personality for voice too)
  const voicePersonality =
    (userMetadata?.voicePersonality as string | undefined) ?? "";
  // ElevenLabs is "available" (i.e. will actually make sound) if either
  // the operator set ELEVENLABS_API_KEY on the server, or the workspace
  // stored its own BYOK key. The proxy prefers the workspace key.
  // We surface both flags to the UI; we DON'T overwrite the user's
  // saved preference if they're on ElevenLabs without a key — instead
  // the picker shows the BYOK input so they can configure it.
  const workspaceHasOwnKey = await hasWorkspaceElevenLabsKey(user.workspaceId);
  const hasElevenLabs = Boolean(env.ELEVENLABS_API_KEY) || workspaceHasOwnKey;
  const persistedProvider = userMetadata?.ttsProvider as string | undefined;
  const ttsProvider: "apple" | "elevenlabs" =
    persistedProvider === "elevenlabs" ? "elevenlabs" : "apple";

  const elevenLabsVoiceId =
    (userMetadata?.elevenLabsVoiceId as string | undefined) ?? "";
  const customPersonalities = await getCustomPersonalities(user.workspaceId);

  return json({
    personality,
    voicePersonality,
    pronoun,
    personalityOptions: PERSONALITY_OPTIONS,
    customPersonality: customPersonalities[0] ?? null,
    ttsProvider,
    elevenLabsVoiceId,
    hasElevenLabs,
    workspaceHasOwnKey,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const user = await requireUser(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (!user.workspaceId) {
    return json({ error: "Workspace not found" }, { status: 404 });
  }

  if (intent === "updatePronoun") {
    const pronoun = formData.get("pronoun") as string;
    const validPronouns: PronounType[] = ["he/him", "she/her", "they/them"];

    if (!pronoun || !validPronouns.includes(pronoun as PronounType)) {
      return json({ error: "Invalid pronoun" }, { status: 400 });
    }

    const currentMetadata = (user.metadata as Record<string, unknown>) || {};
    await prisma.user.update({
      where: { id: user.id },
      data: { metadata: { ...currentMetadata, pronoun } },
    });

    return json({ success: true });
  }

  if (intent === "updatePersonality") {
    const personality = formData.get("personality") as string;
    if (!personality) {
      return json({ error: "Invalid personality" }, { status: 400 });
    }

    const currentMetadata = (user.metadata as Record<string, unknown>) || {};
    await prisma.user.update({
      where: { id: user.id },
      data: { metadata: { ...currentMetadata, personality } },
    });

    return json({ success: true });
  }

  if (intent === "updateVoicePersonality") {
    // Empty string = "same as default" (clear the override).
    const voicePersonality = (formData.get("voicePersonality") as string) ?? "";
    const currentMetadata = (user.metadata as Record<string, unknown>) || {};
    await prisma.user.update({
      where: { id: user.id },
      data: { metadata: { ...currentMetadata, voicePersonality } },
    });
    return json({ success: true });
  }

  if (intent === "updateTtsProvider") {
    const raw = formData.get("ttsProvider") as string;
    const ttsProvider = raw === "elevenlabs" ? "elevenlabs" : "apple";
    const currentMetadata = (user.metadata as Record<string, unknown>) || {};
    await prisma.user.update({
      where: { id: user.id },
      data: { metadata: { ...currentMetadata, ttsProvider } },
    });
    return json({ success: true });
  }

  if (intent === "updateElevenLabsVoice") {
    const elevenLabsVoiceId =
      (formData.get("elevenLabsVoiceId") as string) ?? "";
    const currentMetadata = (user.metadata as Record<string, unknown>) || {};
    await prisma.user.update({
      where: { id: user.id },
      data: { metadata: { ...currentMetadata, elevenLabsVoiceId } },
    });
    return json({ success: true });
  }

  if (intent === "createPersonality") {
    const raw = formData.get("personality") as string;
    if (!raw) {
      return json({ error: "Missing personality data" }, { status: 400 });
    }

    const personality: CustomPersonality = JSON.parse(raw);
    await saveCustomPersonality(user.workspaceId, personality);
    return json({ success: true });
  }

  if (intent === "deletePersonality") {
    const personalityId = formData.get("personalityId") as string;
    if (!personalityId) {
      return json({ error: "Missing personalityId" }, { status: 400 });
    }

    await deleteCustomPersonality(user.workspaceId, personalityId);
    return json({ success: true });
  }

  if (intent === "improvePersonality") {
    const name = formData.get("name") as string;
    const text = formData.get("text") as string;
    if (!name || !text) {
      return json({ error: "Missing name or text" }, { status: 400 });
    }

    const improved = await improvePersonality(name, text);
    return json({ success: true, improved });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
};

export default function AgentSettings() {
  const {
    personality,
    voicePersonality,
    pronoun,
    personalityOptions,
    customPersonality,
    ttsProvider,
    elevenLabsVoiceId,
    hasElevenLabs,
    workspaceHasOwnKey,
  } = useLoaderData<typeof loader>();
  const personalityFetcher = useFetcher();
  const voicePersonalityFetcher = useFetcher();
  const pronounFetcher = useFetcher();
  const deleteFetcher = useFetcher();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustom, setEditingCustom] = useState(false);

  const currentPersonality =
    personalityFetcher.formData?.get("personality")?.toString() || personality;
  const currentVoicePersonality =
    voicePersonalityFetcher.formData?.get("voicePersonality")?.toString() ??
    voicePersonality;
  const currentPronoun =
    (pronounFetcher.formData?.get("pronoun")?.toString() as PronounType) ||
    pronoun;

  const handleSelect = (id: string) => {
    personalityFetcher.submit(
      { intent: "updatePersonality", personality: id },
      { method: "POST" },
    );
  };

  const handleDeleteCustom = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteFetcher.submit(
      { intent: "deletePersonality", personalityId: id },
      { method: "POST" },
    );
    if (currentPersonality === id) {
      personalityFetcher.submit(
        { intent: "updatePersonality", personality: "tars" },
        { method: "POST" },
      );
    }
  };

  return (
    <div className="md:w-3xl mx-auto flex w-auto flex-col gap-4 px-4 py-6">
      <SettingSection
        title="Agent Settings"
        description="Configure your agent's behaviour and automation"
      >
        <div className="mb-8">
          <h2 className="text-md">Pronouns</h2>
          <p className="text-muted-foreground mb-2 text-sm">
            How your butler addresses you
          </p>
          <Select
            value={currentPronoun}
            onValueChange={(value) => {
              pronounFetcher.submit(
                { intent: "updatePronoun", pronoun: value },
                { method: "POST" },
              );
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRONOUN_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                  <span className="text-muted-foreground ml-1 text-xs">
                    ({option.honorific})
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mb-8">
          <h2 className="text-md">Personalisation</h2>
          <p className="text-muted-foreground mb-2 text-sm">
            Choose how your agent communicates with you
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            {personalityOptions.map((option) => (
              <Card
                key={option.id}
                className={cn(
                  "hover:border-primary/50 relative cursor-pointer p-4 transition-all",
                  currentPersonality === option.id &&
                    "border-primary/50 border-1",
                )}
                onClick={() => handleSelect(option.id)}
              >
                {currentPersonality === option.id && (
                  <div className="absolute right-3 top-3">
                    <Check className="text-primary h-4 w-4" />
                  </div>
                )}
                <h3 className="mb-1 font-medium">{option.name}</h3>
                <p className="text-muted-foreground mb-3 text-sm">
                  {option.description}
                </p>
                <div className="space-y-2">
                  {option.examples.map((example, idx) => (
                    <div
                      key={idx}
                      className="bg-muted/50 rounded-md p-2 text-xs"
                    >
                      <p className="text-muted-foreground mb-1">
                        "{example.prompt}"
                      </p>
                      <p className="italic">"{example.response}"</p>
                    </div>
                  ))}
                </div>
              </Card>
            ))}

            {/* Custom personality card */}
            {customPersonality ? (
              <Card
                className={cn(
                  "hover:border-primary/50 group relative cursor-pointer p-4 transition-all",
                  currentPersonality === customPersonality.id &&
                    "border-primary/50 border-1",
                )}
                onClick={() => handleSelect(customPersonality.id)}
              >
                {currentPersonality === customPersonality.id && (
                  <div className="absolute right-3 top-3">
                    <Check className="text-primary h-4 w-4" />
                  </div>
                )}
                <div className="absolute right-3 top-3 hidden gap-1 group-hover:flex">
                  <button
                    className="text-muted-foreground hover:text-foreground rounded p-0.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingCustom(true);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="text-muted-foreground hover:text-destructive rounded p-0.5"
                    onClick={(e) => handleDeleteCustom(e, customPersonality.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <h3 className="mb-1 font-medium">{customPersonality.name}</h3>
                <p className="text-muted-foreground line-clamp-4 text-sm">
                  {customPersonality.text}
                </p>
              </Card>
            ) : (
              <Card
                className="hover:border-primary/50 flex cursor-pointer flex-col items-center justify-center gap-2 border-dashed p-4 transition-all"
                onClick={() => {
                  setEditingCustom(false);
                  setDialogOpen(true);
                }}
              >
                <Plus className="text-muted-foreground h-5 w-5" />
                <p className="text-muted-foreground text-sm">Create your own</p>
              </Card>
            )}
          </div>
        </div>

        <ClientOnly>
          {() => (
            <VoiceSection
              ttsProvider={ttsProvider}
              elevenLabsVoiceId={elevenLabsVoiceId}
              hasElevenLabs={hasElevenLabs}
              workspaceHasOwnKey={workspaceHasOwnKey}
            />
          )}
        </ClientOnly>
      </SettingSection>

      <ClientOnly>
        {() => (
          <CustomPersonalityDialog
            key={editingCustom ? "edit" : "create"}
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            existing={editingCustom ? customPersonality : null}
          />
        )}
      </ClientOnly>
    </div>
  );
}


import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { requireUser } from "~/services/session.server";
import { prisma } from "~/db.server";
import { hasWorkspaceElevenLabsKey } from "~/services/voice-tts.server";
import { SettingSection } from "~/components/setting-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ClientOnly } from "remix-utils/client-only";
import { type PronounType } from "~/services/agent/prompts/personality";
import { VoiceSection } from "~/components/voice";
import type { STTProviderId } from "~/components/voice";

// Personality (voice) picker moved to the per-agent form at
// /home/agents/:agentId — each agent (generalist, Cass, …) picks its
// own voice now. This page keeps the workspace-level knobs that don't
// belong on any individual agent: pronoun (governs honorific rendering
// across all agents) and voice-mode audio infrastructure (TTS/STT
// provider, ElevenLabs voice, STT language). Custom-personality
// authoring will land inside the agent form in a follow-up.

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
  const pronoun = (userMetadata?.pronoun as PronounType) || "he/him";
  // ElevenLabs "available" flag drives the BYOK-key input inside
  // VoiceSection. Only the per-workspace key check matters for the UI —
  // the operator-set env key is a runtime detail the proxy handles.
  const workspaceHasOwnKey = await hasWorkspaceElevenLabsKey(user.workspaceId);
  const persistedProvider = userMetadata?.ttsProvider as string | undefined;
  const ttsProvider: "apple" | "elevenlabs" =
    persistedProvider === "elevenlabs" ? "elevenlabs" : "apple";

  const persistedSttProvider = userMetadata?.sttProvider as string | undefined;
  const sttProvider: STTProviderId =
    persistedSttProvider === "apple" ? "apple" : "elevenlabs";
  const sttLanguage = (userMetadata?.sttLanguage as string | undefined) ?? "";

  const elevenLabsVoiceId =
    (userMetadata?.elevenLabsVoiceId as string | undefined) ?? "";

  return json({
    pronoun,
    ttsProvider,
    sttProvider,
    sttLanguage,
    elevenLabsVoiceId,
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

  if (intent === "updateSttProvider") {
    const raw = formData.get("sttProvider") as string;
    const sttProvider = raw === "apple" ? "apple" : "elevenlabs";
    const currentMetadata = (user.metadata as Record<string, unknown>) || {};
    await prisma.user.update({
      where: { id: user.id },
      data: { metadata: { ...currentMetadata, sttProvider } },
    });
    return json({ success: true });
  }

  if (intent === "updateSttLanguage") {
    const { isValidSTTLanguage } = await import(
      "~/components/voice/stt-languages"
    );
    const sttLanguage = (formData.get("sttLanguage") as string) ?? "";
    if (sttLanguage !== "" && !isValidSTTLanguage(sttLanguage)) {
      return json({ error: "Invalid language" }, { status: 400 });
    }
    const currentMetadata = (user.metadata as Record<string, unknown>) || {};
    await prisma.user.update({
      where: { id: user.id },
      data: { metadata: { ...currentMetadata, sttLanguage } },
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

  return json({ error: "Invalid intent" }, { status: 400 });
};

export default function AgentSettings() {
  const {
    pronoun,
    ttsProvider,
    sttProvider,
    sttLanguage,
    elevenLabsVoiceId,
    workspaceHasOwnKey,
  } = useLoaderData<typeof loader>();
  const pronounFetcher = useFetcher();

  const currentPronoun =
    (pronounFetcher.formData?.get("pronoun")?.toString() as PronounType) ||
    pronoun;

  return (
    <div className="md:w-3xl mx-auto flex w-auto flex-col gap-4 px-4 py-6">
      <SettingSection
        title="Agent Settings"
        description="Workspace-level agent knobs. Each agent's voice, prompt, and appearance live on the agent itself — edit them from /home/agents."
      >
        <div className="mb-8">
          <h2 className="text-md">Pronouns</h2>
          <p className="text-muted-foreground mb-2 text-sm">
            How your agents address you
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

        <ClientOnly>
          {() => (
            <VoiceSection
              sttProvider={sttProvider}
              sttLanguage={sttLanguage}
              ttsProvider={ttsProvider}
              elevenLabsVoiceId={elevenLabsVoiceId}
              workspaceHasOwnKey={workspaceHasOwnKey}
            />
          )}
        </ClientOnly>
      </SettingSection>
    </div>
  );
}

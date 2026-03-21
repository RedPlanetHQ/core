import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { requireUser } from "~/services/session.server";
import { prisma } from "~/db.server";
import { SettingSection } from "~/components/setting-section";
import { Card } from "~/components/ui/card";
import { Check } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  PERSONALITY_OPTIONS,
  type PersonalityType,
  type PronounType,
} from "~/services/agent/prompts/personality";

const PRONOUN_OPTIONS: { id: PronounType; label: string; honorific: string }[] =
  [
    { id: "he/him", label: "He / Him", honorific: "sir" },
    { id: "she/her", label: "She / Her", honorific: "ma'am" },
    { id: "they/them", label: "They / Them", honorific: "name only" },
  ];
import { cn } from "~/lib/utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);

  if (!user.workspaceId) {
    throw new Error("Workspace not found");
  }

  const userMetadata = user.metadata as Record<string, unknown> | null;
  const personality = (userMetadata?.personality as PersonalityType) || "tars";
  const pronoun = (userMetadata?.pronoun as PronounType) || "he/him";

  return json({
    personality,
    pronoun,
    personalityOptions: PERSONALITY_OPTIONS,
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
    const validPersonalities = PERSONALITY_OPTIONS.map((p) => p.id);

    if (
      !personality ||
      !validPersonalities.includes(personality as PersonalityType)
    ) {
      return json({ error: "Invalid personality" }, { status: 400 });
    }

    const currentMetadata = (user.metadata as Record<string, unknown>) || {};
    await prisma.user.update({
      where: { id: user.id },
      data: { metadata: { ...currentMetadata, personality } },
    });

    return json({ success: true });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
};

export default function AgentSettings() {
  const { personality, pronoun, personalityOptions } =
    useLoaderData<typeof loader>();
  const personalityFetcher = useFetcher();
  const pronounFetcher = useFetcher();

  const currentPersonality =
    personalityFetcher.formData?.get("personality")?.toString() || personality;
  const currentPronoun =
    (pronounFetcher.formData?.get("pronoun")?.toString() as PronounType) ||
    pronoun;

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
                onClick={() => {
                  personalityFetcher.submit(
                    { intent: "updatePersonality", personality: option.id },
                    { method: "POST" },
                  );
                }}
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
          </div>
        </div>
      </SettingSection>
    </div>
  );
}

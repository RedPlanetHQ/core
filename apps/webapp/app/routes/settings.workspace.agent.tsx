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
  PERSONALITY_OPTIONS,
  type PersonalityType,
} from "~/services/agent/prompts/personality";
import { cn } from "~/lib/utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);

  if (!user.workspaceId) {
    throw new Error("Workspace not found");
  }

  const userMetadata = user.metadata as Record<string, unknown> | null;
  const personality = (userMetadata?.personality as PersonalityType) || "tars";

  return json({
    personality,
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

  if (intent === "updatePersonality") {
    const personality = formData.get("personality") as string;
    const validPersonalities = PERSONALITY_OPTIONS.map((p) => p.id);

    if (!personality || !validPersonalities.includes(personality as PersonalityType)) {
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
  const { personality, personalityOptions } = useLoaderData<typeof loader>();
  const personalityFetcher = useFetcher();

  const currentPersonality =
    personalityFetcher.formData?.get("personality")?.toString() || personality;

  return (
    <div className="md:w-3xl mx-auto flex w-auto flex-col gap-4 px-4 py-6">
      <SettingSection
        title="Agent Settings"
        description="Configure your agent's behaviour and automation"
      >
        <div className="mb-8">
          <h2 className="text-md mb-4">Personalisation</h2>
          <p className="text-muted-foreground mb-4 text-sm">
            Choose how your agent communicates with you
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            {personalityOptions.map((option) => (
              <Card
                key={option.id}
                className={cn(
                  "hover:border-primary/50 relative cursor-pointer p-4 transition-all",
                  currentPersonality === option.id && "border-primary/50 border-1",
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

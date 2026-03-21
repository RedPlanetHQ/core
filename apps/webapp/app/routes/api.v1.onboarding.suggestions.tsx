import { json } from "@remix-run/node";
import { generateObject } from "ai";
import { z } from "zod";
import { type LanguageModel } from "ai";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { getLibrarySkills } from "~/lib/skills-library";
import { getIntegrationDefinitions } from "~/services/integrationDefinition.server";
import { getModel } from "~/lib/model.server";

const { action } = createHybridActionApiRoute(
  { allowJWT: false, corsStrategy: "none" },
  async ({ authentication, request }) => {
    const { summary } = await request.json();

    const [librarySkills, integrationDefs] = await Promise.all([
      getLibrarySkills(),
      getIntegrationDefinitions(authentication.workspaceId),
    ]);

    const skillsList = librarySkills.map((s) => ({
      slug: s.slug,
      title: s.title,
      description: s.shortDescription,
      integrations: s.integrations.map((i) => i.slug),
    }));

    const integrationsList = integrationDefs.map((i) => ({
      slug: i.slug,
      name: i.name,
    }));

    const { object } = await generateObject({
      model: getModel() as LanguageModel,
      schema: z.object({
        skills: z
          .array(z.string())
          .describe("slugs of skills relevant to this user, max 4"),
        integrations: z
          .array(z.string())
          .describe(
            "slugs of integrations relevant to this user, max 4",
          ),
      }),
      prompt: `You are helping onboard a new user. Based on their profile summary, pick the most relevant skills and integrations to suggest.

User profile:
${summary}

Available skills:
${JSON.stringify(skillsList, null, 2)}

Available integrations:
${JSON.stringify(integrationsList, null, 2)}

Pick up to 4 skills and up to 4 integrations that would be most useful for this specific user based on their work, tools, and patterns. Only suggest things that are clearly relevant. Return only the slugs.`,
      temperature: 0.3,
    });

    const suggestedSkills = librarySkills.filter((s) =>
      object.skills.includes(s.slug),
    );
    const suggestedIntegrations = integrationDefs.filter((i) =>
      object.integrations.includes(i.slug),
    );

    return json({ skills: suggestedSkills, integrations: suggestedIntegrations });
  },
);

export { action };

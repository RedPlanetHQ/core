export interface SkillIntegration {
  name: string;
  slug: string;
  optional?: boolean;
}

export interface LibrarySkill {
  slug: string;
  title: string;
  shortDescription: string;
  category: string;
  integrations: SkillIntegration[];
  content: string;
}

import matter from "gray-matter";

const GITHUB_API =
  "https://api.github.com/repos/RedPlanetHQ/core/contents/docs/skills?ref=main";

// Simple in-memory cache
let cachedSkills: LibrarySkill[] | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getLibrarySkills(): Promise<LibrarySkill[]> {
  if (cachedSkills && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedSkills;
  }

  try {
    const listRes = await fetch(GITHUB_API, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });

    if (!listRes.ok) {
      return cachedSkills ?? [];
    }

    const files: Array<{ name: string; download_url: string }> =
      await listRes.json();

    const skillFiles = files.filter(
      (f) => f.name.endsWith(".mdx") && f.name !== "overview.mdx",
    );

    const skills = await Promise.all(
      skillFiles.map(async (file) => {
        const slug = file.name.replace(".mdx", "");
        const rawRes = await fetch(file.download_url);
        const text = await rawRes.text();
        const { data, content } = matter(text);

        let integrations: SkillIntegration[] = [];
        try {
          if (data.integrations) {
            integrations =
              typeof data.integrations === "string"
                ? JSON.parse(data.integrations)
                : data.integrations;
          }
        } catch {
          integrations = [];
        }

        return {
          slug,
          title: data.title ?? slug,
          shortDescription: data.description ?? "",
          category: data.category ?? "General",
          integrations,
          content: content.trim(),
        } satisfies LibrarySkill;
      }),
    );

    cachedSkills = skills;
    cacheTime = Date.now();
    return skills;
  } catch {
    return cachedSkills ?? [];
  }
}

export function groupSkillsByCategory(
  skills: LibrarySkill[],
): Record<string, LibrarySkill[]> {
  return skills.reduce(
    (acc, skill) => {
      if (!acc[skill.category]) acc[skill.category] = [];
      acc[skill.category].push(skill);
      return acc;
    },
    {} as Record<string, LibrarySkill[]>,
  );
}

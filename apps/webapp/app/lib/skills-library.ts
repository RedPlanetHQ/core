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

const GITHUB_HEADERS = { Accept: "application/vnd.github.v3+json" };

interface GitHubContentItem {
  name: string;
  path: string;
  type: "file" | "dir";
  url: string;
  download_url: string | null;
}

let cachedSkills: LibrarySkill[] | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function parseFrontmatter(text: string) {
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
    title: (data.title as string) ?? "",
    shortDescription: (data.description as string) ?? "",
    category: (data.category as string) ?? "General",
    integrations,
    content: content.trim(),
  };
}

async function loadFlatSkill(
  item: GitHubContentItem,
): Promise<LibrarySkill | null> {
  if (!item.download_url) return null;
  const slug = item.name.replace(/\.mdx$/, "");
  const text = await (await fetch(item.download_url)).text();
  const parsed = parseFrontmatter(text);
  return {
    slug,
    title: parsed.title || slug,
    shortDescription: parsed.shortDescription,
    category: parsed.category,
    integrations: parsed.integrations,
    content: parsed.content,
  };
}

export async function getLibrarySkills(): Promise<LibrarySkill[]> {
  if (cachedSkills && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedSkills;
  }

  try {
    const listRes = await fetch(GITHUB_API, { headers: GITHUB_HEADERS });
    if (!listRes.ok) return cachedSkills ?? [];

    const entries = (await listRes.json()) as GitHubContentItem[];

    const relevant = entries.filter(
      (e) =>
        e.type === "file" &&
        e.name.endsWith(".mdx") &&
        e.name !== "overview.mdx",
    );

    const loaded = await Promise.all(relevant.map(loadFlatSkill));
    const skills = loaded.filter((s): s is LibrarySkill => s !== null);

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

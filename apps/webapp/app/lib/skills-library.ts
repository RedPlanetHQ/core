export interface SkillIntegration {
  name: string;
  slug: string;
  optional?: boolean;
}

export interface SkillBundleFile {
  path: string; // relative path inside the skill folder, e.g. "scripts/foo.sh"
  download_url: string;
}

export type SkillKind = "policy" | "gateway";

export interface LibrarySkill {
  slug: string;
  title: string;
  shortDescription: string;
  category: string;
  integrations: SkillIntegration[];
  content: string;
  kind: SkillKind;
  bundle?: SkillBundleFile[]; // populated only when kind === "gateway"
}

import matter from "gray-matter";

/**
 * Source of the skill library. Used both for browsing (via the GitHub
 * Contents API) and for installing gateway skills (which the gateway clones
 * directly with `git clone --sparse`).
 */
export const LIBRARY_REPO_URL = "https://github.com/RedPlanetHQ/core";
export const LIBRARY_SKILLS_PATH = "docs/skills";

const GITHUB_API = `https://api.github.com/repos/RedPlanetHQ/core/contents/${LIBRARY_SKILLS_PATH}?ref=main`;

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

async function fetchDir(url: string): Promise<GitHubContentItem[]> {
  const res = await fetch(url, { headers: GITHUB_HEADERS });
  if (!res.ok) return [];
  return (await res.json()) as GitHubContentItem[];
}

async function collectBundleFiles(
  dirUrl: string,
  basePath = "",
): Promise<SkillBundleFile[]> {
  const items = await fetchDir(dirUrl);
  const files: SkillBundleFile[] = [];
  for (const item of items) {
    if (item.name === "SKILL.md") continue; // entry point lives in CORE, not in the bundle
    const itemPath = basePath ? `${basePath}/${item.name}` : item.name;
    if (item.type === "file" && item.download_url) {
      files.push({ path: itemPath, download_url: item.download_url });
    } else if (item.type === "dir") {
      const nested = await collectBundleFiles(item.url, itemPath);
      files.push(...nested);
    }
  }
  return files;
}

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
    kind: "policy",
  };
}

async function loadFolderSkill(
  item: GitHubContentItem,
): Promise<LibrarySkill | null> {
  const slug = item.name;
  const contents = await fetchDir(item.url);
  const skillMd = contents.find(
    (c) => c.name === "SKILL.md" && c.type === "file",
  );
  if (!skillMd || !skillMd.download_url) return null;

  const text = await (await fetch(skillMd.download_url)).text();
  const parsed = parseFrontmatter(text);

  // Anything other than SKILL.md (file or dir) makes this a gateway skill.
  const hasOther = contents.some((c) => c.name !== "SKILL.md");
  const kind: SkillKind = hasOther ? "gateway" : "policy";

  const skill: LibrarySkill = {
    slug,
    title: parsed.title || slug,
    shortDescription: parsed.shortDescription,
    category: parsed.category,
    integrations: parsed.integrations,
    content: parsed.content,
    kind,
  };

  if (kind === "gateway") {
    skill.bundle = await collectBundleFiles(item.url);
  }

  return skill;
}

export async function getLibrarySkills(): Promise<LibrarySkill[]> {
  if (cachedSkills && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedSkills;
  }

  try {
    const listRes = await fetch(GITHUB_API, { headers: GITHUB_HEADERS });
    if (!listRes.ok) return cachedSkills ?? [];

    const entries = (await listRes.json()) as GitHubContentItem[];

    const relevant = entries.filter((e) => {
      if (e.type === "file") {
        return e.name.endsWith(".mdx") && e.name !== "overview.mdx";
      }
      return e.type === "dir";
    });

    const loaded = await Promise.all(
      relevant.map((entry) =>
        entry.type === "file" ? loadFlatSkill(entry) : loadFolderSkill(entry),
      ),
    );

    const skills = loaded.filter((s): s is LibrarySkill => s !== null);

    cachedSkills = skills;
    cacheTime = Date.now();
    return skills;
  } catch {
    return cachedSkills ?? [];
  }
}

// Variables that can appear as {{name}} placeholders in a gateway skill's
// SKILL.md and get replaced at install time. The map is open-ended — add new
// keys here as new variables become available in the install context.
export interface SkillInstallVariables {
  gatewayId?: string;
  gatewayName?: string;
  // The resolved absolute path of the skill's bundle on the chosen gateway,
  // e.g. /data/.corebrain/skills/my-skill
  gatewaySkillRoot?: string;
  [key: string]: string | undefined;
}

/**
 * Replace every `{{key}}` token in `content` with the matching value from
 * `vars`. Tokens whose key is not in `vars` (or whose value is undefined) are
 * left intact, so SKILL.md authors can leave optional placeholders in place
 * without breaking the install. Variable names are matched case-sensitively
 * and may contain letters, digits, underscores, or hyphens.
 */
export function substituteSkillVariables(
  content: string,
  vars: SkillInstallVariables,
): string {
  return content.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (match, key) => {
    const value = vars[key];
    return typeof value === "string" ? value : match;
  });
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

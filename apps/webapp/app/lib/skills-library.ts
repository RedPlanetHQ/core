export interface SkillIntegration {
  name: string;
  slug: string;
  optional?: boolean;
}

export type SkillTarget = 'cloud' | 'gateway';

export interface LibrarySkill {
  slug: string;
  title: string;
  shortDescription: string;
  category: string;
  integrations: SkillIntegration[];
  content: string;
  target: SkillTarget;
  /** Frontmatter `allowed-tools` (gateway skills only). UI display only. */
  allowedTools?: string[];
}

import matter from 'gray-matter';

const SOURCES: Array<{target: SkillTarget; api: string}> = [
  {
    target: 'cloud',
    api: 'https://api.github.com/repos/RedPlanetHQ/core/contents/docs/skills?ref=main',
  },
  {
    target: 'gateway',
    api: 'https://api.github.com/repos/RedPlanetHQ/core/contents/docs/gateway-skills?ref=main',
  },
];

let cachedSkills: LibrarySkill[] | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchOne(target: SkillTarget, api: string): Promise<LibrarySkill[]> {
  const listRes = await fetch(api, {
    headers: {Accept: 'application/vnd.github.v3+json'},
  });
  if (!listRes.ok) return [];

  const files: Array<{name: string; download_url: string}> =
    await listRes.json();

  const skillFiles = files.filter(
    (f) => f.name.endsWith('.mdx') && f.name !== 'overview.mdx',
  );

  return Promise.all(
    skillFiles.map(async (file) => {
      const slug = file.name.replace('.mdx', '');
      const rawRes = await fetch(file.download_url);
      const text = await rawRes.text();
      const {data, content} = matter(text);

      let integrations: SkillIntegration[] = [];
      try {
        if (data.integrations) {
          integrations =
            typeof data.integrations === 'string'
              ? JSON.parse(data.integrations)
              : data.integrations;
        }
      } catch {
        integrations = [];
      }

      const at = (data as Record<string, unknown>)['allowed-tools'];
      const allowedTools =
        Array.isArray(at) && at.every((s) => typeof s === 'string')
          ? (at as string[])
          : undefined;

      return {
        slug,
        title: (data.title as string) ?? slug,
        shortDescription: (data.description as string) ?? '',
        category: (data.category as string) ?? 'General',
        integrations,
        content: content.trim(),
        target,
        ...(allowedTools ? {allowedTools} : {}),
      } satisfies LibrarySkill;
    }),
  );
}

export async function getLibrarySkills(): Promise<LibrarySkill[]> {
  if (cachedSkills && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedSkills;
  }

  try {
    const buckets = await Promise.all(
      SOURCES.map(({target, api}) => fetchOne(target, api)),
    );
    cachedSkills = buckets.flat();
    cacheTime = Date.now();
    return cachedSkills;
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

import type {FastifyPluginAsync} from 'fastify';
import {installSkill, removeSkill, type InstallSource} from '@/server/skills/install';
import {skillsTools, executeSkillsTool} from '@/server/tools/skills-tools';
import {makeToolGroupRoutes} from '../tool-group';

/**
 * Skill management + tool routes (mounted at `/api/skills`).
 *
 *   POST   /api/skills/install       → body: InstallSource (url or files)
 *   DELETE /api/skills/:name         → uninstall
 *   POST   /api/skills/load_skill    → tool: read SKILL.md (or a file inside the skill dir)
 *   POST   /api/skills/create_skill  → tool: author a new SKILL.md from name/desc/body
 *   POST   /api/skills/update_skill  → tool: append body to an existing SKILL.md
 *
 * Auth is handled upstream (`makeAuthHook`); these handlers assume the caller
 * already passed the gateway's security key.
 */
export const skillsRoutes: FastifyPluginAsync = async (app) => {
	await app.register(makeToolGroupRoutes(skillsTools, executeSkillsTool));

  app.post<{Body: InstallSource}>('/install', async (req, reply) => {
    const body = req.body as InstallSource | undefined;
    if (!body || !body.source) {
      reply.code(400);
      return {ok: false, error: '`source` is required ("url" or "files")'};
    }
    try {
      const skill = await installSkill(body);
      return {ok: true, skill};
    } catch (err) {
      reply.code(400);
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'install failed',
      };
    }
  });

  app.delete<{Params: {name: string}}>('/:name', async (req, reply) => {
    const {name} = req.params;
    try {
      await removeSkill(name);
      return {ok: true};
    } catch (err) {
      reply.code(err instanceof Error && /not found/i.test(err.message) ? 404 : 400);
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'remove failed',
      };
    }
  });
};

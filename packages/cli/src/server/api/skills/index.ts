import type {FastifyPluginAsync} from 'fastify';
import {installSkill, removeSkill, type InstallSource} from '@/server/skills/install';

/**
 * Skill management routes (mounted at `/api/skills`).
 *
 *   POST   /api/skills/install   → body: InstallSource (url or files)
 *   DELETE /api/skills/:name     → uninstall
 *
 * Auth is handled upstream (`makeAuthHook`); these handlers assume the caller
 * already passed the gateway's security key.
 */
export const skillsRoutes: FastifyPluginAsync = async (app) => {
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

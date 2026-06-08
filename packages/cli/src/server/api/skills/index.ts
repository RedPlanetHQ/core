import type {FastifyPluginAsync} from 'fastify';
import {skillsTools, executeSkillsTool} from '@/server/tools/skills-tools';
import {makeToolGroupRoutes} from '../tool-group';

/**
 * Mounted at `/api/skills`. Registers one POST route per skill management
 * tool (`skill_install`, `skill_remove`). Auth is the standard gateway
 * security key; the install itself doesn't run user code — it only writes
 * the cloned repo subtree into `~/.corebrain/skills/<name>/`.
 */
export const skillsRoutes: FastifyPluginAsync = async app => {
	await app.register(makeToolGroupRoutes(skillsTools, executeSkillsTool));
};

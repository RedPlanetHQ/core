// Auto-generated from Google Docs Discovery Document
// DO NOT EDIT MANUALLY - Generated on 2025-11-20T13:37:00.000Z

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { docs_v1 } from 'googleapis';

// ========== SCHEMAS ==========
// No additional schemas needed - all core Docs API methods are implemented as custom tools

// ========== TOOL DEFINITIONS ==========
export const generatedTools: any[] = [];

// ========== HANDLER FUNCTION ==========
/**
 * Handles auto-generated tool calls
 * @param name - Tool name
 * @param args - Tool arguments
 * @param docs - Docs API client
 */
export async function handleGeneratedTool(
  name: string,
  args: any,
  docs: docs_v1.Docs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  throw new Error(`Unknown generated tool: ${name}`);
}

// ========== SUMMARY ==========
// Generated 0 new tools
// The Google Docs API only has 3 methods (create, get, batchUpdate)
// All of these are implemented as custom high-level tools with better UX

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PresetFile {
  name: string;             // e.g. "superpowers"
  appliesTo: string[];      // e.g. ["claude-code"]
  tracks: {
    bug: { phases: unknown[] };
    feature: { phases: unknown[] };
  };
}

/**
 * Locate the presets directory whether we're running from src (ts-node /
 * vitest) or dist (compiled CLI). Both layouts have `presets/` adjacent to
 * this file's compiled output.
 *
 * The package is ESM (`"type": "module"`), so we derive the current dir from
 * `import.meta.url` rather than `__dirname`. vitest's `__dirname` shim was
 * masking this in unit tests.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

function presetsDir(): string {
  return join(HERE, 'presets');
}

export function loadPresets(): PresetFile[] {
  const dir = presetsDir();
  if (!existsSync(dir)) return [];
  const result: PresetFile[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue;
    const raw = readFileSync(join(dir, entry), 'utf8');
    result.push(JSON.parse(raw) as PresetFile);
  }
  return result;
}

export function getPreset(name: string): PresetFile | undefined {
  return loadPresets().find((p) => p.name === name);
}

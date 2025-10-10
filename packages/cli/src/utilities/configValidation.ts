import fs from 'node:fs';
import path from 'path';

import { log } from '@clack/prompts';

import { readJSONFileSync } from './fileSystem';
import { ConfigMap } from '../api/client';

export const activeProcesses: any[] = []; // Store active processes for cleanup

// Validate and export the found config files
export async function validateAndExportConfigs(
  configPaths: string[],
  cwd: string,
): Promise<ConfigMap[]> {
  const validConfigs: ConfigMap[] = [];

  for (const configPath of configPaths) {
    const configMap = await validateAndExportConfig(cwd, configPath);

    if (configMap) {
      validConfigs.push(configMap);
    }
  }

  return validConfigs;
}

export async function validateAndExportConfig(
  cwd: string,
  configPath: string,
): Promise<ConfigMap | undefined> {
  const dir = path.dirname(configPath);
  const indexPath = path.join(dir, 'index.ts');

  if (!fs.existsSync(indexPath)) {
    log.error(`index.ts not found at ${indexPath}`);
    return undefined;
  }

  log.info(`Found index.ts at ${indexPath}`);

  const config = readJSONFileSync(configPath);
  const relativeDir = `./${path.relative(cwd, dir)}`;

  return { path: relativeDir, config };
}

// Utility function to check for all config.json files
export const checkConfigFiles = (dir: string): string[] => {
  const foundConfigs: string[] = [];

  // Check for config.json in the root directory
  const rootConfigPath = path.join(dir, 'config.json');
  if (fs.existsSync(rootConfigPath)) {
    foundConfigs.push(rootConfigPath);
  }

  // Check each subdirectory one level down for config.json
  const subDirs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => path.join(dir, dirent.name));

  for (const subDir of subDirs) {
    const subConfigPath = path.join(subDir, 'config.json');
    if (fs.existsSync(subConfigPath)) {
      foundConfigs.push(subConfigPath);
    }
  }

  return foundConfigs;
};

export const checkIfConfigExist = (dir: string) => {
  // Check for config.json in the root directory
  const rootConfigPath = path.join(dir, 'config.json');

  if (fs.existsSync(rootConfigPath)) {
    return true;
  }

  return false;
};

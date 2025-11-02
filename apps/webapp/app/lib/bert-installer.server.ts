import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

// Volume path for persistent package storage
export const BERT_PACKAGE_PATH = '/opt/bert-packages';
const INSTALL_LOCK_FILE = `${BERT_PACKAGE_PATH}/.installed`;
const INSTALL_IN_PROGRESS_FILE = `${BERT_PACKAGE_PATH}/.installing`;
const REQUIREMENTS_FILE = '/core/apps/webapp/python/requirements.txt';

/**
 * Checks if BertTopic packages are installed, and triggers async installation if not.
 * @returns true if installed, false if installation is needed/in-progress
 */
export async function ensureBertPackagesInstalled(): Promise<boolean> {
  try {
    // Check if already installed
    await fs.access(INSTALL_LOCK_FILE);
    return true;
  } catch {
    // Not installed, check if installation in progress
    try {
      await fs.access(INSTALL_IN_PROGRESS_FILE);
      console.log('BertTopic packages installation already in progress...');
      return false; // Installation in progress
    } catch {
      // Start installation in background
      console.log('BertTopic packages not found. Starting background installation...');
      installBertPackagesInBackground();
      return false;
    }
  }
}

/**
 * Installs BertTopic packages to persistent volume in background.
 * This runs async and doesn't block the caller.
 */
async function installBertPackagesInBackground() {
  try {
    // Create directory and installing flag
    await fs.mkdir(BERT_PACKAGE_PATH, { recursive: true });
    await fs.writeFile(INSTALL_IN_PROGRESS_FILE, new Date().toISOString());

    console.log('Installing BertTopic packages from requirements.txt to', BERT_PACKAGE_PATH);

    // Install packages from requirements.txt to the persistent volume
    const { stdout, stderr } = await execAsync(
      `pip3 install --target=${BERT_PACKAGE_PATH} --no-cache-dir -r ${REQUIREMENTS_FILE}`,
      { timeout: 600000 } // 10 min timeout
    );

    if (stderr) {
      console.log('Installation stderr:', stderr);
    }

    // Read requirements to store in lock file
    const requirementsContent = await fs.readFile(REQUIREMENTS_FILE, 'utf-8');

    // Mark as installed
    await fs.writeFile(INSTALL_LOCK_FILE, JSON.stringify({
      installedAt: new Date().toISOString(),
      requirementsFile: REQUIREMENTS_FILE,
      requirements: requirementsContent.trim()
    }, null, 2));

    // Remove in-progress flag
    await fs.unlink(INSTALL_IN_PROGRESS_FILE);

    console.log('BertTopic packages installed successfully from requirements.txt');
  } catch (error) {
    console.error('Failed to install BertTopic packages:', error);
    // Clean up in-progress flag on failure
    try {
      await fs.unlink(INSTALL_IN_PROGRESS_FILE);
    } catch {
      // Ignore errors during cleanup
    }
  }
}

/**
 * Gets the PYTHONPATH environment variable to use installed packages from volume
 */
export function getBertPythonPath(): string {
  return BERT_PACKAGE_PATH;
}

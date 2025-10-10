import { chalkGrey, chalkRun, chalkTask, chalkWorker, logo } from './cliOutput';
import { getVersion } from './getVersion';
import { logger } from './logger';

export async function printInitialBanner() {
  const cliVersion = getVersion();
  const text = `\n${logo()} ${chalkGrey(`(${cliVersion})`)}\n`;

  logger.info(text);
}

export async function printStandloneInitialBanner() {
  const cliVersion = getVersion();

  logger.log(`\n${logo()} ${chalkGrey(`(${cliVersion})`)}`);
  logger.log(`${chalkGrey('-'.repeat(54))}`);
}

export function printDevBanner(printTopBorder = true) {
  if (printTopBorder) {
    logger.log(chalkGrey('-'.repeat(54)));
  }

  logger.log(
    `${chalkGrey('Key:')} ${chalkWorker('Version')} ${chalkGrey('|')} ${chalkTask(
      'Task',
    )} ${chalkGrey('|')} ${chalkRun('Run')}`,
  );
  logger.log(chalkGrey('-'.repeat(54)));
}

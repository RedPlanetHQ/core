import fs from 'node:fs';
import path from 'path';

import { spinner, intro, outro } from '@clack/prompts';
import { Command } from 'commander';
import degit from 'degit';

import { commonOptions } from '../cli/common';
import { getVersion } from '../utilities/getVersion';
import { printInitialBanner } from '../utilities/initialBanner';

export function configureInitCommand(program: Command) {
  return commonOptions(
    program
      .command('init')
      .description('Init a tegon action')
      .option(
        '-a, --action <name>',
        'Name of the action folder to initialize',
        'base',
      ),
  )
    .version(getVersion(), '-v, --version', 'Display the version number')
    .action(async (options) => {
      await printInitialBanner();

      const { action } = options;
    });
}

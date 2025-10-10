import { Command } from 'commander';

import { configureInitCommand } from '../commands/init';
import { COMMAND_NAME } from '../consts';
import { getVersion } from '../utilities/getVersion';

export const program = new Command();

program
  .name(COMMAND_NAME)
  .description('Cli to run core')
  .version(getVersion(), '-v, --version', 'Display the version number');

configureInitCommand(program);

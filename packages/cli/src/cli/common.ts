import { outro } from '@clack/prompts';
import { Command } from 'commander';
import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';

import { chalkError } from '../utilities/cliOutput';
import { logger } from '../utilities/logger';

export const CommonCommandOptions = z.object({
  apiUrl: z.string().optional(),
  logLevel: z
    .enum(['debug', 'info', 'log', 'warn', 'error', 'none'])
    .default('log'),
  skipTelemetry: z.boolean().default(false),
});

export type CommonCommandOptions = z.infer<typeof CommonCommandOptions>;

export function commonOptions(command: Command) {
  return command.option(
    '-l, --log-level <level>',
    'The CLI log level to use (debug, info, log, warn, error, none). This does not effect the log level of your tegon actions',
    'log',
  );
}

export class SkipLoggingError extends Error {}
export class SkipCommandError extends Error {}
export class OutroCommandError extends SkipCommandError {}

export async function wrapCommandAction<T extends z.AnyZodObject, TResult>(
  name: string,
  schema: T,
  options: unknown,
  action: (opts: z.output<T>) => Promise<TResult>,
): Promise<TResult> {
  try {
    const parsedOptions = schema.safeParse(options);

    if (!parsedOptions.success) {
      throw new Error(fromZodError(parsedOptions.error).toString());
    }

    logger.loggerLevel = parsedOptions.data.logLevel;

    logger.debug(`Running "${name}" with the following options`, {
      options,
    });

    const result = await action(parsedOptions.data);

    return result;
  } catch (e) {
    if (e instanceof SkipLoggingError) {
      logger.log(
        `${chalkError('X Error:')} ${e instanceof Error ? e.message : String(e)}`,
      );
    } else if (e instanceof OutroCommandError) {
      outro('Operation cancelled');
    } else if (e instanceof SkipCommandError) {
      // do nothing
    } else {
      logger.log(
        `${chalkError('X Error:')} ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    throw e;
  }
}

import { Command } from 'commander';
import {
  IntegrationEventPayload,
  Spec,
  Message,
  IntegrationEventType,
} from '@core/types';

export abstract class IntegrationCLI {
  protected program: Command;
  protected integrationName: string;
  protected version: string;

  constructor(integrationName: string, version: string = '1.0.0') {
    this.integrationName = integrationName;
    this.version = version;
    this.program = new Command();
    this.setupProgram();
  }

  private setupProgram(): void {
    this.program
      .name(`${this.integrationName}-integration`)
      .description(`${this.integrationName} integration CLI`)
      .version(this.version);

    this.setupSpecCommand();
    this.setupAccountCommands();
    this.setupDataCommands();
    this.setupSyncCommand();
  }

  private setupAccountCommands(): void {
    this.program
      .command('setup')
      .description(`Set up a new ${this.integrationName} integration account`)
      .requiredOption(
        '--event-body <body>',
        'Event body JSON (e.g. OAuth response or setup data)',
      )
      .requiredOption(
        '--integration-definition <definition>',
        'Integration definition JSON',
      )
      .action(async (options) => {
        try {
          const eventBody = JSON.parse(options.eventBody);
          const integrationDefinition = JSON.parse(
            options.integrationDefinition,
          );

          const messages: Message[] = await this.handleEvent({
            event: IntegrationEventType.SETUP,
            eventBody,
            integrationDefinition,
          });

          for (const message of messages) {
            console.log(JSON.stringify(message, null, 2));
          }
        } catch (error) {
          console.error('Error during setup:', error);
          process.exit(1);
        }
      });
  }

  private setupDataCommands(): void {
    this.program
      .command('process')
      .description(`Process ${this.integrationName} integration data`)
      .requiredOption('--event-data <data>', 'Event data JSON')
      .requiredOption('--config <config>', 'Integration configuration JSON')
      .action(async (options) => {
        try {
          const eventData = JSON.parse(options.eventData);
          const config = JSON.parse(options.config);

          const messages: Message[] = await this.handleEvent({
            event: IntegrationEventType.PROCESS,
            eventBody: { eventData },
            config,
          });

          for (const message of messages) {
            console.log(JSON.stringify(message, null, 2));
          }
        } catch (error) {
          console.error('Error processing data:', error);
          process.exit(1);
        }
      });

    this.program
      .command('identify')
      .description('Identify webhook account')
      .requiredOption('--webhook-data <data>', 'Webhook data JSON')
      .action(async (options) => {
        try {
          const webhookData = JSON.parse(options.webhookData);

          const messages: Message[] = await this.handleEvent({
            event: IntegrationEventType.IDENTIFY,
            eventBody: webhookData,
          });

          for (const message of messages) {
            console.log(JSON.stringify(message, null, 2));
          }
        } catch (error) {
          console.error('Error identifying account:', error);
          process.exit(1);
        }
      });
  }

  private setupSpecCommand(): void {
    this.program
      .command('spec')
      .description('Get integration specification')
      .action(async () => {
        try {
          const spec = await this.getSpec();
          const message: Message = {
            type: 'spec',
            data: spec,
          };
          // For spec, we keep the single message output for compatibility
          console.log(JSON.stringify(message, null, 2));
        } catch (error) {
          console.error('Error getting spec:', error);
          process.exit(1);
        }
      });
  }

  private setupSyncCommand(): void {
    this.program
      .command('sync')
      .description('Perform scheduled sync')
      .requiredOption('--config <config>', 'Integration configuration JSON')
      .option('--state <state>', 'Integration state JSON', '{}')
      .action(async (options) => {
        try {
          const config = JSON.parse(options.config);
          const state = options.state ? JSON.parse(options.state) : {};

          const messages: Message[] = await this.handleEvent({
            event: IntegrationEventType.SYNC,
            eventBody: {},
            config,
            state,
          });

          for (const message of messages) {
            console.log(JSON.stringify(message, null, 2));
          }
        } catch (error) {
          console.error('Error during sync:', error);
          process.exit(1);
        }
      });
  }

  /**
   * Abstract method that must be implemented by each integration
   * This method should handle the integration-specific logic for each event type
   * and return an array of Message objects.
   */
  protected abstract handleEvent(
    eventPayload: IntegrationEventPayload,
  ): Promise<Message[]>;

  /**
   * Abstract method that must be implemented by each integration
   * This method should return the integration specification
   */
  protected abstract getSpec(): Promise<Spec>;

  /**
   * Parse and execute the CLI commands
   */
  public parse(): void {
    this.program.parse();
  }

  /**
   * Get the commander program instance for additional customization
   */
  public getProgram(): Command {
    return this.program;
  }
}

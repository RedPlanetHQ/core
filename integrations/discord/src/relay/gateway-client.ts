import { Client, Events, GatewayIntentBits, Message, GuildMember } from 'discord.js';

import type { RelayEvent } from './events';
import { serializeGuildMemberAdd, serializeMessageCreate } from './events';
import type { Forwarder } from './forwarder';

export interface GatewayClientOptions {
  botToken: string;
  forwarder: Forwarder;
  logger?: Pick<Console, 'info' | 'warn' | 'error' | 'debug'>;
}

export class GatewayClient {
  private client: Client;
  private logger: Pick<Console, 'info' | 'warn' | 'error' | 'debug'>;

  constructor(private options: GatewayClientOptions) {
    this.logger = options.logger ?? console;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
      ],
    });
  }

  async start(): Promise<void> {
    this.client.on(Events.ClientReady, (c) => {
      this.logger.info(`Gateway ready as ${c.user.tag} (id=${c.user.id})`);
    });

    this.client.on(Events.Error, (err) => {
      this.logger.error('Gateway error', err);
    });

    this.client.on(Events.ShardDisconnect, (event, shardId) => {
      this.logger.warn(`Shard ${shardId} disconnected`, event);
    });

    this.client.on(Events.ShardReconnecting, (shardId) => {
      this.logger.info(`Shard ${shardId} reconnecting`);
    });

    this.client.on(Events.MessageCreate, (message: Message) => {
      // Ignore bot's own messages to avoid loops.
      if (message.author.id === this.client.user?.id) return;
      void this.dispatch(serializeMessageCreate(message));
    });

    this.client.on(Events.GuildMemberAdd, (member: GuildMember) => {
      void this.dispatch(serializeGuildMemberAdd(member));
    });

    await this.client.login(this.options.botToken);
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }

  private async dispatch(event: RelayEvent): Promise<void> {
    try {
      await this.options.forwarder.forward(event);
    } catch (err) {
      this.logger.error(`Failed to forward ${event.event_type} ${event.event_id}`, err);
    }
  }
}

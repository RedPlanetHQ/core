import { APIKeyParams, OAuth2Params } from "./oauth";

export enum IntegrationEventType {
  /**
   * Processes authentication data and returns tokens/credentials to be saved
   */
  SETUP = "setup",

  /**
   * Processing incoming data from the integration
   */
  PROCESS = "process",

  /**
   * Identifying which account a webhook belongs to
   */
  IDENTIFY = "identify",

  /**
   * Scheduled synchronization of data
   */
  SYNC = "sync",

  /**
   * For returning integration metadata/config
   */
  SPEC = "spec",
  /**
   * For to start mcp
   */
  MCP = "mcp",
}

interface IntegrationDefinition {
  name: string;
  version: string;
  description: string;
  config: Record<string, string>;
  spec: any;
}

export interface IntegrationEventPayload {
  event: IntegrationEventType;

  // For setup command
  integrationDefinition?: IntegrationDefinition;
  // Has event body based on the event
  eventBody: any;

  // For everything other than setup
  config?: Config;

  // For sync command
  state?: Record<string, string>;
  [x: string]: any;
}

export class Spec {
  name: string;
  key: string;
  description: string;
  icon: string;
  category?: string;
  mcp?:
    | {
        type: "http";
        url: string;
        headers?: Record<string, string>;
        needsAuth?: boolean;
      }
    | {
        type: "cli";
      };
  auth?: Record<string, OAuth2Params | APIKeyParams>;
}

export interface Config {
  access_token: string;
  [key: string]: string;
}

export interface Identifier {
  id: string;
  type?: string;
}

export type MessageType = "spec" | "activity" | "state" | "identifier" | "account";

export interface Message {
  type: MessageType;
  data: any;
}

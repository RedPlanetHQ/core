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
}

export interface IntegrationEventPayload {
  event: IntegrationEventType;
  [x: string]: any;
}

export class Spec {
  name: string;
  key: string;
  description: string;
  icon: string;
  mcp?: {
    command: string;
    args: string[];
    env: Record<string, string>;
  };
  auth?: Record<string, OAuth2Params | APIKeyParams>;
}

export interface Config {
  access_token: string;
  [key: string]: any;
}

export interface Identifier {
  id: string;
  type?: string;
}

export type MessageType = "spec" | "activity" | "state" | "identifier";

export interface Message {
  type: MessageType;
  data: any;
}

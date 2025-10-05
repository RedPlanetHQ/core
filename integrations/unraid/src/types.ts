/* eslint-disable @typescript-eslint/no-explicit-any */

// Configuration interface
export interface UnraidConfig {
  serverUrl: string;
  apiKey: string;
}

// State interface for tracking changes between syncs
export interface UnraidState {
  lastSyncTime?: string;
  serverVersion?: string;
  containers: Record<string, ContainerState>;
  vms: Record<string, VMState>;
  arrayState?: string;
  lastMetricsCheck?: string;
}

export interface ContainerState {
  state: string;
  image: string;
  imageId: string;
}

export interface VMState {
  state: string;
}

// GraphQL Response Types
export interface SystemInfoResponse {
  info: {
    version: string;
    model?: string;
    motherboard?: string;
  };
  me?: {
    username: string;
  };
}

export interface DockerResponse {
  docker: {
    containers: DockerContainer[];
  };
}

export interface DockerContainer {
  id: string;
  names: string[];
  image: string;
  imageId: string;
  state: string;
  status: string;
  autoStart: boolean;
  isUpdateAvailable?: boolean;
}

export interface VMsResponse {
  vms: {
    domains: VMDomain[];
  };
}

export interface VMDomain {
  id: string;
  name: string;
  state: string;
}

export interface ArrayResponse {
  array: {
    state: string;
    capacity?: {
      total: string;
      used: string;
      free: string;
    };
    parityCheckStatus: {
      running: boolean;
      status: string;
      progress?: number;
      errors?: number;
    };
  };
}

export interface MetricsResponse {
  metrics: {
    cpu?: {
      usage: number;
    };
    memory?: {
      usage: number;
      total: number;
      free: number;
    };
  };
}

export interface NotificationsResponse {
  notifications: any[];
}

// Activity message interface
export interface ActivityMessage {
  type: 'activity';
  data: {
    text: string;
    sourceURL?: string;
  };
}

export interface StateMessage {
  type: 'state';
  data: UnraidState;
}

export type Message = ActivityMessage | StateMessage;

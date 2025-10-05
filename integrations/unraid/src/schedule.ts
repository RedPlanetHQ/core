/* eslint-disable @typescript-eslint/no-explicit-any */
import { executeGraphQLQuery, getDefaultSyncTime, createActivityMessage, getContainerName } from './utils';
import type {
  UnraidConfig,
  UnraidState,
  DockerResponse,
  VMsResponse,
  ArrayResponse,
  MetricsResponse,
  SystemInfoResponse,
  Message,
} from './types';

/**
 * Main sync handler - polls Unraid API and generates activities for changes
 */
export async function handleSchedule(config: any, state: any): Promise<Message[]> {
  try {
    const unraidConfig: UnraidConfig = config;

    if (!unraidConfig?.serverUrl || !unraidConfig?.apiKey) {
      return [];
    }

    // Get or initialize state
    let currentState: UnraidState = state || {
      lastSyncTime: getDefaultSyncTime(),
      containers: {},
      vms: {},
    };

    const messages: Message[] = [];

    // Fetch all data in parallel
    const [dockerData, vmsData, arrayData, metricsData, systemInfo] = await Promise.allSettled([
      fetchDockerContainers(unraidConfig),
      fetchVMs(unraidConfig),
      fetchArrayStatus(unraidConfig),
      fetchMetrics(unraidConfig),
      fetchSystemInfo(unraidConfig),
    ]);

    // Process Docker containers
    if (dockerData.status === 'fulfilled' && dockerData.value) {
      const containerActivities = processDockerContainers(
        dockerData.value,
        currentState.containers,
        unraidConfig.serverUrl,
      );
      messages.push(...containerActivities.activities);
      currentState.containers = containerActivities.newState;
    }

    // Process VMs
    if (vmsData.status === 'fulfilled' && vmsData.value) {
      const vmActivities = processVMs(vmsData.value, currentState.vms, unraidConfig.serverUrl);
      messages.push(...vmActivities.activities);
      currentState.vms = vmActivities.newState;
    }

    // Process Array status
    if (arrayData.status === 'fulfilled' && arrayData.value) {
      const arrayActivities = processArrayStatus(
        arrayData.value,
        currentState.arrayState,
        unraidConfig.serverUrl,
      );
      messages.push(...arrayActivities);
      currentState.arrayState = arrayData.value.array.state;
    }

    // Process Metrics (threshold alerts)
    if (metricsData.status === 'fulfilled' && metricsData.value) {
      const metricsActivities = processMetrics(metricsData.value, unraidConfig.serverUrl);
      messages.push(...metricsActivities);
      currentState.lastMetricsCheck = new Date().toISOString();
    }

    // Check for system version changes
    if (systemInfo.status === 'fulfilled' && systemInfo.value) {
      const versionActivity = processSystemInfo(
        systemInfo.value,
        currentState.serverVersion,
        unraidConfig.serverUrl,
      );
      if (versionActivity) {
        messages.push(versionActivity);
      }
      // Update version in state
      if (systemInfo.value?.info?.versions?.core?.unraid) {
        currentState.serverVersion = systemInfo.value.info.versions.core.unraid;
      }
    }

    // Update sync time
    currentState.lastSyncTime = new Date().toISOString();

    // Add state message
    messages.push({
      type: 'state',
      data: currentState,
    });

    return messages;
  } catch (error) {
    console.error('Unraid sync error:', error);
    return [];
  }
}

/**
 * Fetch Docker containers
 */
async function fetchDockerContainers(config: UnraidConfig): Promise<DockerResponse | null> {
  const query = `
    query {
      docker {
        containers {
          id
          names
          image
          imageId
          state
          status
          autoStart
        }
      }
    }
  `;

  try {
    return await executeGraphQLQuery<DockerResponse>(config, query);
  } catch (error) {
    console.error('Error fetching Docker containers:', error);
    return null;
  }
}

/**
 * Fetch VMs
 */
async function fetchVMs(config: UnraidConfig): Promise<VMsResponse | null> {
  const query = `
    query {
      vms {
        domains {
          id
          name
          state
        }
      }
    }
  `;

  try {
    return await executeGraphQLQuery<VMsResponse>(config, query);
  } catch (error) {
    console.error('Error fetching VMs:', error);
    return null;
  }
}

/**
 * Fetch Array status
 */
async function fetchArrayStatus(config: UnraidConfig): Promise<ArrayResponse | null> {
  const query = `
    query {
      array {
        state
        capacity {
          total
          used
          free
        }
        parityCheckStatus {
          running
          status
          progress
          errors
        }
      }
    }
  `;

  try {
    return await executeGraphQLQuery<ArrayResponse>(config, query);
  } catch (error) {
    console.error('Error fetching array status:', error);
    return null;
  }
}

/**
 * Fetch system metrics
 */
async function fetchMetrics(config: UnraidConfig): Promise<any | null> {
  const query = `
    query {
      metrics {
        cpu {
          percentTotal
        }
        memory {
          percentTotal
          total
          used
          free
        }
      }
    }
  `;

  try {
    return await executeGraphQLQuery<MetricsResponse>(config, query);
  } catch (error) {
    console.error('Error fetching metrics:', error);
    return null;
  }
}

/**
 * Fetch system info
 */
async function fetchSystemInfo(config: UnraidConfig): Promise<any | null> {
  const query = `
    query {
      info {
        id
        versions {
          core {
            unraid
          }
        }
      }
    }
  `;

  try {
    return await executeGraphQLQuery<any>(config, query);
  } catch (error) {
    console.error('Error fetching system info:', error);
    return null;
  }
}

/**
 * Process Docker container changes
 */
function processDockerContainers(
  data: DockerResponse,
  previousState: Record<string, any>,
  serverUrl: string,
): { activities: Message[]; newState: Record<string, any> } {
  const activities: Message[] = [];
  const newState: Record<string, any> = {};

  for (const container of data.docker.containers) {
    const containerName = getContainerName(container.names);
    const containerId = container.id;
    const previous = previousState[containerId];

    newState[containerId] = {
      state: container.state,
      image: container.image,
      imageId: container.imageId,
    };

    if (!previous) {
      // New container
      activities.push(
        createActivityMessage(
          `New Docker container deployed: ${containerName} (${container.image})`,
          `${serverUrl}/Docker`,
        ),
      );
    } else if (previous.state !== container.state) {
      // State change
      activities.push(
        createActivityMessage(
          `Docker container ${containerName} ${container.state}`,
          `${serverUrl}/Docker`,
        ),
      );
    } else if (previous.imageId !== container.imageId) {
      // Image update
      activities.push(
        createActivityMessage(
          `Docker container ${containerName} updated to ${container.image}`,
          `${serverUrl}/Docker`,
        ),
      );
    }
  }

  // Detect removed containers
  for (const [prevId, prevContainer] of Object.entries(previousState)) {
    if (!newState[prevId]) {
      const containerName = prevContainer.image || prevId;
      activities.push(
        createActivityMessage(`Docker container ${containerName} removed`, `${serverUrl}/Docker`),
      );
    }
  }

  return { activities, newState };
}

/**
 * Process VM changes
 */
function processVMs(
  data: VMsResponse,
  previousState: Record<string, any>,
  serverUrl: string,
): { activities: Message[]; newState: Record<string, any> } {
  const activities: Message[] = [];
  const newState: Record<string, any> = {};

  if (!data.vms.domains) {
    return { activities, newState };
  }

  for (const vm of data.vms.domains) {
    const previous = previousState[vm.id];

    newState[vm.id] = {
      state: vm.state,
    };

    if (!previous) {
      // New VM
      activities.push(createActivityMessage(`New VM created: ${vm.name}`, `${serverUrl}/VMs`));
    } else if (previous.state !== vm.state) {
      // State change
      activities.push(createActivityMessage(`VM ${vm.name} ${vm.state}`, `${serverUrl}/VMs`));
    }
  }

  // Detect removed VMs
  for (const [prevId] of Object.entries(previousState)) {
    if (!newState[prevId]) {
      activities.push(createActivityMessage(`VM removed (ID: ${prevId})`, `${serverUrl}/VMs`));
    }
  }

  return { activities, newState };
}

/**
 * Process Array status changes
 */
function processArrayStatus(
  data: ArrayResponse,
  previousState: string | undefined,
  serverUrl: string,
): Message[] {
  const activities: Message[] = [];
  const currentState = data.array.state;

  if (previousState && previousState !== currentState) {
    activities.push(createActivityMessage(`Unraid array ${currentState}`, `${serverUrl}/Main`));
  }

  // Check parity status
  const parity = data.array.parityCheckStatus;
  if (parity.running) {
    const progress = parity.progress ? ` (${parity.progress}% complete)` : '';
    activities.push(
      createActivityMessage(`Parity check running${progress}`, `${serverUrl}/Main`),
    );
  } else if (parity.status && parity.status !== 'OK') {
    const errors = parity.errors ? ` with ${parity.errors} errors` : '';
    activities.push(
      createActivityMessage(`Parity check completed: ${parity.status}${errors}`, `${serverUrl}/Main`),
    );
  }

  return activities;
}

/**
 * Process metrics for threshold alerts
 */
function processMetrics(data: any, serverUrl: string): Message[] {
  const activities: Message[] = [];

  if (data.metrics?.cpu?.percentTotal > 80) {
    activities.push(
      createActivityMessage(
        `High CPU usage detected: ${data.metrics.cpu.percentTotal.toFixed(1)}%`,
        `${serverUrl}/Dashboard`,
      ),
    );
  }

  if (data.metrics?.memory?.percentTotal > 90) {
    activities.push(
      createActivityMessage(
        `High memory usage detected: ${data.metrics.memory.percentTotal.toFixed(1)}%`,
        `${serverUrl}/Dashboard`,
      ),
    );
  }

  return activities;
}

/**
 * Process system info for version changes
 */
function processSystemInfo(
  data: any,
  previousVersion: string | undefined,
  serverUrl: string,
): Message | null {
  const currentVersion = data?.info?.versions?.core?.unraid;
  if (currentVersion && previousVersion && previousVersion !== currentVersion) {
    return createActivityMessage(
      `Unraid updated to version ${currentVersion}`,
      `${serverUrl}/Settings`,
    );
  }
  return null;
}

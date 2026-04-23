/**
 * Label Manager for Gmail MCP Server
 * Provides comprehensive label management functionality
 */

import { resolveLabelColor, LabelColorPair } from './label-colors';

// Type definitions for Gmail API labels
export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
  messageListVisibility?: string;
  labelListVisibility?: string;
  messagesTotal?: number;
  messagesUnread?: number;
  color?: {
    textColor?: string;
    backgroundColor?: string;
  };
}

/**
 * Creates a new Gmail label.
 * @param gmail - Gmail API instance
 * @param labelName - Name of the label to create
 * @param options - Optional settings (visibility, color)
 * @returns The newly created label
 */
export async function createLabel(
  gmail: any,
  labelName: string,
  options: {
    messageListVisibility?: string;
    labelListVisibility?: string;
    color?: string | LabelColorPair;
  } = {}
) {
  try {
    // Resolve color before any network call so invalid input fails fast.
    const resolvedColor =
      options.color !== undefined ? resolveLabelColor(options.color) : undefined;

    const messageListVisibility = options.messageListVisibility || 'show';
    const labelListVisibility = options.labelListVisibility || 'labelShow';

    const requestBody: {
      name: string;
      messageListVisibility: string;
      labelListVisibility: string;
      color?: LabelColorPair;
    } = {
      name: labelName,
      messageListVisibility,
      labelListVisibility,
    };

    if (resolvedColor) requestBody.color = resolvedColor;

    const response = await gmail.users.labels.create({
      userId: 'me',
      requestBody,
    });

    return response.data;
  } catch (error: any) {
    // Handle duplicate labels more gracefully
    if (error.message && error.message.includes('already exists')) {
      throw new Error(`Label "${labelName}" already exists. Please use a different name.`);
    }

    throw new Error(`Failed to create label: ${error.message}`);
  }
}

/**
 * Updates an existing Gmail label.
 *
 * Uses `labels.patch` (partial update) so fields omitted from `updates` are
 * preserved. Gmail renders the submitted color in both light and dark themes
 * automatically.
 *
 * @param gmail - Gmail API instance
 * @param labelId - ID of the label to update
 * @param updates - Properties to update (any subset)
 * @returns The updated label
 */
export async function updateLabel(
  gmail: any,
  labelId: string,
  updates: {
    name?: string;
    messageListVisibility?: string;
    labelListVisibility?: string;
    color?: string | LabelColorPair;
  }
) {
  try {
    // Resolve/validate color first so invalid input never hits the network.
    const resolvedColor =
      updates.color !== undefined ? resolveLabelColor(updates.color) : undefined;

    // Verify the label exists before updating
    await gmail.users.labels.get({
      userId: 'me',
      id: labelId,
    });

    const requestBody: Record<string, unknown> = {};
    if (updates.name !== undefined) requestBody.name = updates.name;
    if (updates.messageListVisibility !== undefined) {
      requestBody.messageListVisibility = updates.messageListVisibility;
    }
    if (updates.labelListVisibility !== undefined) {
      requestBody.labelListVisibility = updates.labelListVisibility;
    }
    if (resolvedColor) requestBody.color = resolvedColor;

    const response = await gmail.users.labels.patch({
      userId: 'me',
      id: labelId,
      requestBody,
    });

    return response.data;
  } catch (error: any) {
    if (error.code === 404) {
      throw new Error(`Label with ID "${labelId}" not found.`);
    }

    throw new Error(`Failed to update label: ${error.message}`);
  }
}

/**
 * Deletes a Gmail label
 * @param gmail - Gmail API instance
 * @param labelId - ID of the label to delete
 * @returns Success message
 */
export async function deleteLabel(gmail: any, labelId: string) {
  try {
    // Ensure we're not trying to delete system labels
    const label = await gmail.users.labels.get({
      userId: 'me',
      id: labelId,
    });

    if (label.data.type === 'system') {
      throw new Error(`Cannot delete system label with ID "${labelId}".`);
    }

    await gmail.users.labels.delete({
      userId: 'me',
      id: labelId,
    });

    return { success: true, message: `Label "${label.data.name}" deleted successfully.` };
  } catch (error: any) {
    if (error.code === 404) {
      throw new Error(`Label with ID "${labelId}" not found.`);
    }

    throw new Error(`Failed to delete label: ${error.message}`);
  }
}

/**
 * Gets a detailed list of all Gmail labels
 * @param gmail - Gmail API instance
 * @returns Object containing system and user labels
 */
export async function listLabels(gmail: any) {
  try {
    const response = await gmail.users.labels.list({
      userId: 'me',
    });

    const labels = response.data.labels || [];

    // Group labels by type for better organization
    const systemLabels = labels.filter((label: GmailLabel) => label.type === 'system');
    const userLabels = labels.filter((label: GmailLabel) => label.type === 'user');

    return {
      all: labels,
      system: systemLabels,
      user: userLabels,
      count: {
        total: labels.length,
        system: systemLabels.length,
        user: userLabels.length,
      },
    };
  } catch (error: any) {
    throw new Error(`Failed to list labels: ${error}`);
  }
}

/**
 * Finds a label by name
 * @param gmail - Gmail API instance
 * @param labelName - Name of the label to find
 * @returns The found label or null if not found
 */
export async function findLabelByName(gmail: any, labelName: string) {
  try {
    const labelsResponse = await listLabels(gmail);
    const allLabels = labelsResponse.all;

    // Case-insensitive match
    const foundLabel = allLabels.find(
      (label: GmailLabel) => label.name.toLowerCase() === labelName.toLowerCase()
    );

    return foundLabel || null;
  } catch (error: any) {
    throw new Error(`Failed to find label: ${error.message}`);
  }
}

/**
 * Creates label if it doesn't exist or returns existing label
 * @param gmail - Gmail API instance
 * @param labelName - Name of the label to create
 * @param options - Optional settings for the label
 * @returns The new or existing label
 */
export async function getOrCreateLabel(
  gmail: any,
  labelName: string,
  options: {
    messageListVisibility?: string;
    labelListVisibility?: string;
    color?: string | LabelColorPair;
  } = {}
) {
  try {
    // First try to find an existing label
    const existingLabel = await findLabelByName(gmail, labelName);

    if (existingLabel) {
      return existingLabel;
    }

    // If not found, create a new one
    return await createLabel(gmail, labelName, options);
  } catch (error: any) {
    throw new Error(`Failed to get or create label: ${error.message}`);
  }
}

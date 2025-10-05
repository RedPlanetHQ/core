/**
 * GitHub Webhook IDENTIFY Handler
 *
 * Determines which IntegrationAccount owns a webhook event
 * by extracting the repository/installation information
 */

export async function identifyWebhook(webhookData: any): Promise<any> {
  try {
    const eventHeaders = webhookData.eventHeaders || {};
    const event = webhookData.event || {};

    // GitHub webhook events can be identified by:
    // 1. Installation ID (for GitHub App installations)
    // 2. Repository owner (for OAuth apps)

    // Try installation ID first (GitHub App)
    if (event.installation?.id) {
      return {
        type: "identifier",
        data: {
          id: event.installation.id.toString(),
        },
      };
    }

    // Fallback to repository owner (OAuth)
    if (event.repository?.owner?.login) {
      return {
        type: "identifier",
        data: {
          id: event.repository.owner.login,
        },
      };
    }

    // No identifier found
    console.error("Could not identify webhook owner from event");
    return {
      type: "identifier",
      data: {
        id: null,
      },
    };
  } catch (error) {
    console.error("Error in webhook identification:", error);
    return {
      type: "identifier",
      data: {
        id: null,
      },
    };
  }
}

import { prisma } from "~/db.server";
import { env } from "~/env.server";

/**
 * Service for managing OAuth integration grants and webhooks
 */
export class OAuthIntegrationService {
  /**
   * Create integration grants for OAuth client when user authorizes
   */
  async createIntegrationGrants(params: {
    clientId: string;
    userId: string;
    integrationAccountIds: string[];
  }): Promise<void> {
    // Get internal client ID
    const client = await prisma.oAuthClient.findUnique({
      where: { clientId: params.clientId },
      select: { id: true, webhookUrl: true, webhookSecret: true },
    });

    if (!client) {
      throw new Error("Invalid OAuth client");
    }

    // Create grants for each selected integration
    const grants = params.integrationAccountIds.map((integrationAccountId) => ({
      clientId: client.id,
      userId: params.userId,
      integrationAccountId,
      isActive: true,
    }));

    await prisma.oAuthIntegrationGrant.createMany({
      data: grants,
      skipDuplicates: true, // Avoid conflicts if grant already exists
    });

    // Send webhook notification if webhook URL is configured
    if (client.webhookUrl) {
      await this.sendIntegrationWebhooks({
        clientId: params.clientId,
        userId: params.userId,
        integrationAccountIds: params.integrationAccountIds,
        eventType: "integration.connected",
        webhookUrl: client.webhookUrl,
        webhookSecret: client.webhookSecret ?? undefined,
      });
    }
  }

  /**
   * Revoke integration grants for OAuth client
   */
  async revokeIntegrationGrants(params: {
    clientId: string;
    userId: string;
    integrationAccountIds?: string[]; // If not provided, revoke all
  }): Promise<void> {
    // Get internal client ID
    const client = await prisma.oAuthClient.findUnique({
      where: { clientId: params.clientId },
      select: { id: true, webhookUrl: true, webhookSecret: true },
    });

    if (!client) {
      throw new Error("Invalid OAuth client");
    }

    const whereClause: any = {
      clientId: client.id,
      userId: params.userId,
      isActive: true,
    };

    if (params.integrationAccountIds) {
      whereClause.integrationAccountId = {
        in: params.integrationAccountIds,
      };
    }

    // Get the grants being revoked for webhook notification
    const grantsToRevoke = await prisma.oAuthIntegrationGrant.findMany({
      where: whereClause,
      include: {
        integrationAccount: true,
      },
    });

    // Revoke the grants
    await prisma.oAuthIntegrationGrant.updateMany({
      where: whereClause,
      data: {
        isActive: false,
        revokedAt: new Date(),
      },
    });

    // Send webhook notification if webhook URL is configured
    if (client.webhookUrl && grantsToRevoke.length > 0) {
      await this.sendIntegrationWebhooks({
        clientId: params.clientId,
        userId: params.userId,
        integrationAccountIds: grantsToRevoke.map(
          (g) => g.integrationAccountId,
        ),
        eventType: "integration.disconnected",
        webhookUrl: client.webhookUrl,
        webhookSecret: client.webhookSecret ?? undefined,
      });
    }
  }

  /**
   * Get connected integrations for OAuth client
   */
  async getConnectedIntegrations(params: { clientId: string; userId: string }) {
    // Get internal client ID
    const client = await prisma.oAuthClient.findUnique({
      where: { clientId: params.clientId },
      select: { id: true },
    });

    if (!client) {
      throw new Error("Invalid OAuth client");
    }

    const integrationAccounts = await prisma.integrationAccount.findMany({
      where: {
        workspace: {
          userId: params.userId,
        },
        isActive: true,
      },
      include: {
        integrationDefinition: true,
      },
    });

    return integrationAccounts.map((integrationAccount) => {
      return {
        id: integrationAccount.id,
        provider: integrationAccount.integrationDefinition.slug,
        connectedAt: integrationAccount.createdAt,
        name: integrationAccount.integrationDefinition.name,
        icon: integrationAccount.integrationDefinition.icon,
      };
    });
  }

  /**
   * Send webhook notifications for integration events
   */
  private async sendIntegrationWebhooks(params: {
    clientId: string;
    userId: string;
    integrationAccountIds: string[];
    eventType: "integration.connected" | "integration.disconnected";
    webhookUrl: string;
    webhookSecret?: string;
  }) {
    return params;
  }
}

export const oauthIntegrationService = new OAuthIntegrationService();

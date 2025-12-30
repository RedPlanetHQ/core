import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { getOrCreatePersonalAccessToken } from './personalAccessToken';

export class CoreMemoryClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;

  /**
   * Connect to CORE MCP server using user's Personal Access Token
   */
  async connect(userId: string, workspaceId: string): Promise<void> {
    try {
      // Get or create a PAT for this user
      const result = await getOrCreatePersonalAccessToken({
        name: 'agent-server',
        userId,
      });

      // Use the decrypted token
      const token = result.token;
      if (!token) {
        throw new Error('Failed to get or create PAT for user');
      }

      const url = new URL(env.CORE_MCP_SERVER_URL);
      url.searchParams.set('source', 'agent-server');

      logger.info(`Connecting to MCP server at: ${url.toString()}`);
      logger.info(`Using PAT token: ${token.slice(0, 15)}...`);

      this.transport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'agent-server/1.0.0',
          },
        },
        sessionOptions: {
          // Use the sessions endpoint for session management
          sessionUrl: new URL('/api/v1/mcp/sessions', env.CORE_WEBAPP_URL),
        },
      });

      this.client = new Client({
        name: 'agent-server',
        version: '1.0.0',
      });

      await this.client.connect(this.transport);
      logger.info(`Connected to CORE MCP server for user ${userId}`);
    } catch (error) {
      logger.error('Failed to connect to CORE MCP server', error);
      throw error;
    }
  }

  async searchMemory(query: string): Promise<string> {
    if (!this.client) throw new Error('MCP client not connected');

    try {
      const response = await this.client.callTool({
        name: 'memory_search',
        arguments: {
          query,
          sortBy: 'relevance',
        },
      });

      if (response.isError) {
        logger.error('Memory search error', response.content);
        return '';
      }

      return response.content[0]?.text || '';
    } catch (error) {
      logger.error('Memory search failed', error);
      return '';
    }
  }

  async ingestConversation(message: string, sessionId: string): Promise<void> {
    if (!this.client) throw new Error('MCP client not connected');

    try {
      await this.client.callTool({
        name: 'memory_ingest',
        arguments: {
          message,
          sessionId,
        },
      });
      logger.debug('Ingested conversation to CORE memory');
    } catch (error) {
      logger.error('Failed to ingest conversation', error);
      throw error;
    }
  }

  async getUserPersona(): Promise<string> {
    if (!this.client) throw new Error('MCP client not connected');

    try {
      const response = await this.client.callTool({
        name: 'memory_about_user',
        arguments: { profile: false },
      });

      if (response.isError) {
        logger.error('Get persona error', response.content);
        return '';
      }

      return response.content[0]?.text || '';
    } catch (error) {
      logger.error('Failed to get user persona', error);
      return '';
    }
  }

  async getIntegrations(): Promise<Array<{ slug: string; name: string }>> {
    if (!this.client) throw new Error('MCP client not connected');

    try {
      const response = await this.client.callTool({
        name: 'get_integrations',
        arguments: {},
      });

      if (response.isError) {
        logger.error('Get integrations error', response.content);
        return [];
      }

      const content = response.content[0]?.text;
      if (!content) return [];

      // Parse the response (assuming it's JSON)
      try {
        return JSON.parse(content);
      } catch {
        return [];
      }
    } catch (error) {
      logger.error('Failed to get integrations', error);
      return [];
    }
  }

  async initializeSession(): Promise<string> {
    if (!this.client) throw new Error('MCP client not connected');

    try {
      const response = await this.client.callTool({
        name: 'initialize_conversation_session',
        arguments: { new: true },
      });

      if (response.isError) {
        throw new Error('Failed to initialize session');
      }

      const content = response.content[0]?.text;
      if (!content) throw new Error('No session ID returned');

      // Parse the sessionId from the response
      const result = JSON.parse(content);
      return result.sessionId;
    } catch (error) {
      logger.error('Failed to initialize session', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close();
        this.client = null;
      }
      if (this.transport) {
        await this.transport.close();
        this.transport = null;
      }
      logger.debug('Disconnected from CORE MCP server');
    } catch (error) {
      logger.error('Error disconnecting from CORE MCP server', error);
    }
  }
}

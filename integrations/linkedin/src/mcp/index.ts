import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import axios, { AxiosInstance } from 'axios';

let linkedinClient: AxiosInstance;

async function initializeLinkedInClient(accessToken: string) {
  linkedinClient = axios.create({
    baseURL: 'https://api.linkedin.com',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    },
  });
}

const PostUpdateSchema = z.object({
  text: z.string().describe('The text of the post to share on LinkedIn'),
  visibility: z.enum(['PUBLIC', 'CONNECTIONS']).optional().default('PUBLIC').describe('Who can see the post'),
});

const GetProfileSchema = z.object({});

export async function getTools() {
  return [
    {
      name: 'get_profile',
      description: 'Get your LinkedIn profile information',
      inputSchema: zodToJsonSchema(GetProfileSchema),
    },
    {
      name: 'post_update',
      description: 'Share a post on LinkedIn',
      inputSchema: zodToJsonSchema(PostUpdateSchema),
    },
  ];
}

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, string>,
) {
  await initializeLinkedInClient(config.access_token);

  try {
    switch (name) {
      case 'get_profile': {
        const response = await linkedinClient.get('/v2/me');
        const r = response.data;
        const formatted = `Name: ${r.localizedFirstName} ${r.localizedLastName}\nID: ${r.id}`;
        return {
          content: [{ type: 'text', text: formatted }],
        };
      }

      case 'post_update': {
        const { text, visibility } = PostUpdateSchema.parse(args);
        
        // First get the user's URN
        const meResponse = await linkedinClient.get('/v2/me');
        const userUrn = `urn:li:person:${meResponse.data.id}`;

        const postData = {
          author: userUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: {
                text: text,
              },
              shareMediaCategory: 'NONE',
            },
          },
          visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': visibility === 'PUBLIC' ? 'PUBLIC' : 'CONNECTIONS',
          },
        };

        const response = await linkedinClient.post('/v2/ugcPosts', postData);
        return {
          content: [{ type: 'text', text: `Post created successfully. ID: ${response.data.id}` }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.response?.data?.message || error.message}` }],
      isError: true,
    };
  }
}

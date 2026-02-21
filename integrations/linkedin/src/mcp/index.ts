import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';

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

/**
 * Fetches user info from the modern OIDC endpoint.
 * Required for apps using the "Sign In with LinkedIn using OpenID Connect" product.
 */
async function getUserInfo(accessToken: string) {
  const response = await axios.get('https://api.linkedin.com/v2/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return response.data;
}

const GetProfileSchema = z.object({});
const GetEmailSchema = z.object({});

const PostUpdateSchema = z.object({
  text: z.string().describe('The text of the post to share on LinkedIn'),
  visibility: z.enum(['PUBLIC', 'CONNECTIONS']).optional().default('PUBLIC').describe('Who can see the post'),
});

const CreateCommentSchema = z.object({
  postUrn: z.string().describe('The URN of the post to comment on (e.g., urn:li:share:12345 or urn:li:ugcPost:12345)'),
  text: z.string().describe('The content of your comment'),
});

const LikePostSchema = z.object({
  postUrn: z.string().describe('The URN of the post to like (e.g., urn:li:share:12345)'),
});

const DeletePostSchema = z.object({
  postUrn: z.string().describe('The URN of the post to delete'),
});

const PostImageUpdateSchema = z.object({
  text: z.string().describe('The text of the post'),
  imagePath: z.string().describe('The absolute path to the image file on your local machine'),
  visibility: z.enum(['PUBLIC', 'CONNECTIONS']).optional().default('PUBLIC').describe('Who can see the post'),
});

export async function getTools() {
  return [
    {
      name: 'get_profile',
      description: 'Get your LinkedIn profile information',
      inputSchema: zodToJsonSchema(GetProfileSchema),
    },
    {
      name: 'get_email',
      description: "Get the primary email address associated with your LinkedIn account",
      inputSchema: zodToJsonSchema(GetEmailSchema),
    },
    {
      name: 'post_update',
      description: 'Share a text post on LinkedIn',
      inputSchema: zodToJsonSchema(PostUpdateSchema),
    },
    {
      name: 'post_image_update',
      description: 'Share a post with an image on LinkedIn',
      inputSchema: zodToJsonSchema(PostImageUpdateSchema),
    },
    {
      name: 'create_comment',
      description: 'Add a comment to a LinkedIn post',
      inputSchema: zodToJsonSchema(CreateCommentSchema),
    },
    {
      name: 'like_post',
      description: 'Like a LinkedIn post',
      inputSchema: zodToJsonSchema(LikePostSchema),
    },
    {
      name: 'delete_post',
      description: 'Delete one of your own LinkedIn posts',
      inputSchema: zodToJsonSchema(DeletePostSchema),
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
        const userInfo = await getUserInfo(config.access_token);
        const formatted = `Name: ${userInfo.given_name} ${userInfo.family_name}\nLinkedIn ID: ${userInfo.sub}\nEmail: ${userInfo.email}`;
        return {
          content: [{ type: 'text', text: formatted }],
        };
      }

      case 'get_email': {
        const userInfo = await getUserInfo(config.access_token);
        return {
          content: [{ type: 'text', text: userInfo.email || 'No email found' }],
        };
      }

      case 'post_update': {
        const { text, visibility } = PostUpdateSchema.parse(args);
        const userInfo = await getUserInfo(config.access_token);
        const userUrn = `urn:li:person:${userInfo.sub}`;

        const postData = {
          author: userUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: { text },
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

      case 'post_image_update': {
        const { text, imagePath, visibility } = PostImageUpdateSchema.parse(args);
        const userInfo = await getUserInfo(config.access_token);
        const userUrn = `urn:li:person:${userInfo.sub}`;

        // 1. Register Upload
        const registerResponse = await linkedinClient.post('/v2/assets?action=registerUpload', {
          registerUploadRequest: {
            recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
            owner: userUrn,
            serviceRelationships: [{
              relationshipType: 'OWNER',
              identifier: 'urn:li:userGeneratedContent',
            }],
          },
        });

        const uploadUrl = registerResponse.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
        const assetUrn = registerResponse.data.value.asset;

        // 2. Upload Binary
        const imageBuffer = fs.readFileSync(imagePath);
        await axios.put(uploadUrl, imageBuffer, {
          headers: {
            Authorization: `Bearer ${config.access_token}`,
            'Content-Type': 'application/octet-stream',
          },
        });

        // 3. Create Post
        const postData = {
          author: userUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: { text },
              shareMediaCategory: 'IMAGE',
              media: [{
                status: 'READY',
                description: { text: 'Post Image' },
                media: assetUrn,
                title: { text: 'Post Image' },
              }],
            },
          },
          visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': visibility === 'PUBLIC' ? 'PUBLIC' : 'CONNECTIONS',
          },
        };

        const response = await linkedinClient.post('/v2/ugcPosts', postData);
        return {
          content: [{ type: 'text', text: `Post with image created successfully. ID: ${response.data.id}` }],
        };
      }

      case 'create_comment': {
        const { postUrn, text } = CreateCommentSchema.parse(args);
        const userInfo = await getUserInfo(config.access_token);
        const userUrn = `urn:li:person:${userInfo.sub}`;

        const commentData = {
          actor: userUrn,
          object: postUrn,
          message: { text },
        };

        const response = await linkedinClient.post(`/v2/socialActions/${postUrn}/comments`, commentData);
        return {
          content: [{ type: 'text', text: `Comment created successfully. ID: ${response.data.id}` }],
        };
      }

      case 'like_post': {
        const { postUrn } = LikePostSchema.parse(args);
        const userInfo = await getUserInfo(config.access_token);
        const userUrn = `urn:li:person:${userInfo.sub}`;

        const reactionData = {
          actor: userUrn,
          reactionType: 'LIKE',
        };

        await linkedinClient.post(`/v2/socialActions/${postUrn}/reactions`, reactionData);
        return {
          content: [{ type: 'text', text: 'Post liked successfully.' }],
        };
      }

      case 'delete_post': {
        const { postUrn } = DeletePostSchema.parse(args);
        await linkedinClient.delete(`/v2/ugcPosts/${postUrn}`);
        return {
          content: [{ type: 'text', text: 'Post deleted successfully.' }],
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

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { google, docs_v1 } from 'googleapis';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { OAuth2Client } from 'google-auth-library';
import { generatedTools, handleGeneratedTool } from './generated-tools';

// OAuth2 configuration
let oauth2Client: OAuth2Client;
let docs: docs_v1.Docs;

async function loadCredentials(
  client_id: string,
  client_secret: string,
  callback: string,
  config: Record<string, string>
) {
  try {
    const credentials = {
      refresh_token: config.refresh_token,
      expiry_date:
        typeof config.expires_at === 'string' ? parseInt(config.expires_at) : config.expires_at,
      expires_in: config.expires_in,
      expires_at: config.expires_at,
      access_token: config.access_token,
      token_type: config.token_type,
      id_token: config.id_token,
      scope: config.scope,
    };

    oauth2Client = new OAuth2Client(client_id, client_secret, callback);
    oauth2Client.setCredentials(credentials);
    oauth2Client.refreshAccessToken();
  } catch (error) {
    console.error('Error loading credentials:', error);
    process.exit(1);
  }
}

// Custom tool schemas for common operations
const ListDocumentsSchema = z.object({});

const CreateDocumentSchema = z.object({
  title: z.string().describe('Title for the new document'),
});

const ReadDocumentSchema = z.object({
  documentId: z.string().describe('ID of the document to read'),
  suggestionsViewMode: z
    .enum([
      'DEFAULT_FOR_CURRENT_ACCESS',
      'SUGGESTIONS_INLINE',
      'PREVIEW_SUGGESTIONS_ACCEPTED',
      'PREVIEW_WITHOUT_SUGGESTIONS',
    ])
    .optional()
    .describe('How to view suggestions in the document'),
});

const InsertTextSchema = z.object({
  documentId: z.string().describe('ID of the document'),
  text: z.string().describe('Text to insert'),
  index: z
    .number()
    .optional()
    .default(1)
    .describe('Location to insert text (default: 1 = start of document)'),
});

const AppendTextSchema = z.object({
  documentId: z.string().describe('ID of the document'),
  text: z.string().describe('Text to append to the end of the document'),
});

const ReplaceTextSchema = z.object({
  documentId: z.string().describe('ID of the document'),
  searchText: z.string().describe('Text to search for'),
  replaceText: z.string().describe('Text to replace with'),
  matchCase: z.boolean().optional().default(false).describe('Whether to match case'),
});

const FormatTextSchema = z.object({
  documentId: z.string().describe('ID of the document'),
  startIndex: z.number().describe('Start index of text to format'),
  endIndex: z.number().describe('End index of text to format'),
  bold: z.boolean().optional().describe('Make text bold'),
  italic: z.boolean().optional().describe('Make text italic'),
  underline: z.boolean().optional().describe('Underline text'),
  fontSize: z.number().optional().describe('Font size in points'),
  foregroundColor: z
    .object({
      red: z.number().min(0).max(1),
      green: z.number().min(0).max(1),
      blue: z.number().min(0).max(1),
    })
    .optional()
    .describe('Text color (RGB values 0-1)'),
});

const InsertImageSchema = z.object({
  documentId: z.string().describe('ID of the document'),
  imageUri: z.string().describe('URI of the image to insert'),
  index: z
    .number()
    .optional()
    .default(1)
    .describe('Location to insert image (default: 1 = start of document)'),
  width: z.number().optional().describe('Width in points'),
  height: z.number().optional().describe('Height in points'),
});

// Main function
export async function mcp(
  client_id: string,
  client_secret: string,
  callback: string,
  credentials: Record<string, string>
) {
  await loadCredentials(client_id, client_secret, callback, credentials);

  // Initialize Docs API
  docs = google.docs({ version: 'v1', auth: oauth2Client });

  // Server implementation
  const server = new Server({
    name: 'google-docs',
    version: '1.0.0',
    capabilities: {
      tools: {},
    },
  });

  // Tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      // Custom high-level tools
      {
        name: 'list_documents',
        description: 'List all Google Docs documents in the user\'s Google Drive.',
        inputSchema: zodToJsonSchema(ListDocumentsSchema),
      },
      {
        name: 'create_document',
        description: 'Creates a new Google Doc with optional title',
        inputSchema: zodToJsonSchema(CreateDocumentSchema),
      },
      {
        name: 'read_document',
        description: 'Reads the full content of a Google Doc',
        inputSchema: zodToJsonSchema(ReadDocumentSchema),
      },
      {
        name: 'insert_text',
        description: 'Inserts text at a specific location in a document',
        inputSchema: zodToJsonSchema(InsertTextSchema),
      },
      {
        name: 'append_text',
        description: 'Appends text to the end of a document',
        inputSchema: zodToJsonSchema(AppendTextSchema),
      },
      {
        name: 'replace_text',
        description: 'Replaces all occurrences of text in a document',
        inputSchema: zodToJsonSchema(ReplaceTextSchema),
      },
      {
        name: 'format_text',
        description: 'Formats text in a document (bold, italic, color, size, etc.)',
        inputSchema: zodToJsonSchema(FormatTextSchema),
      },
      {
        name: 'insert_image',
        description: 'Inserts an image into a document',
        inputSchema: zodToJsonSchema(InsertImageSchema),
      },
      // Auto-generated tools from Discovery Document
      ...generatedTools,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'list_documents': {
          ListDocumentsSchema.parse(args);

          // Use Drive API to list all documents
          const drive = google.drive({ version: 'v3', auth: oauth2Client });
          const response = await drive.files.list({
            q: "mimeType='application/vnd.google-apps.document'",
            fields: 'files(id, name, createdTime, modifiedTime, webViewLink)',
            orderBy: 'modifiedTime desc',
          });

          const files = response.data.files || [];
          return {
            content: [
              {
                type: 'text',
                text: `Found ${files.length} document(s):\n\n${files
                  .map(
                    f =>
                      `- ${f.name}\n  ID: ${f.id}\n  Modified: ${f.modifiedTime}\n  URL: ${f.webViewLink}`
                  )
                  .join('\n\n')}`,
              },
            ],
          };
        }

        case 'create_document': {
          const validatedArgs = CreateDocumentSchema.parse(args);
          const response = await docs.documents.create({
            requestBody: {
              title: validatedArgs.title,
            },
          });

          return {
            content: [
              {
                type: 'text',
                text: `Document created successfully!\nID: ${response.data.documentId}\nTitle: ${response.data.title}\nURL: https://docs.google.com/document/d/${response.data.documentId}/edit`,
              },
            ],
          };
        }

        case 'read_document': {
          const validatedArgs = ReadDocumentSchema.parse(args);
          const response = await docs.documents.get({
            documentId: validatedArgs.documentId,
            suggestionsViewMode: validatedArgs.suggestionsViewMode,
          });

          // Extract text content from the document
          let textContent = '';
          if (response.data.body?.content) {
            for (const element of response.data.body.content) {
              if (element.paragraph?.elements) {
                for (const elem of element.paragraph.elements) {
                  if (elem.textRun?.content) {
                    textContent += elem.textRun.content;
                  }
                }
              }
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: `Document: ${response.data.title}\nID: ${response.data.documentId}\n\nContent:\n${textContent}`,
              },
            ],
          };
        }

        case 'insert_text': {
          const validatedArgs = InsertTextSchema.parse(args);
          await docs.documents.batchUpdate({
            documentId: validatedArgs.documentId,
            requestBody: {
              requests: [
                {
                  insertText: {
                    location: {
                      index: validatedArgs.index,
                    },
                    text: validatedArgs.text,
                  },
                },
              ],
            },
          });

          return {
            content: [
              {
                type: 'text',
                text: `Successfully inserted text at index ${validatedArgs.index}`,
              },
            ],
          };
        }

        case 'append_text': {
          const validatedArgs = AppendTextSchema.parse(args);

          // First, get the document to find the end index
          const doc = await docs.documents.get({
            documentId: validatedArgs.documentId,
          });

          const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

          await docs.documents.batchUpdate({
            documentId: validatedArgs.documentId,
            requestBody: {
              requests: [
                {
                  insertText: {
                    location: {
                      index: endIndex - 1,
                    },
                    text: validatedArgs.text,
                  },
                },
              ],
            },
          });

          return {
            content: [
              {
                type: 'text',
                text: `Successfully appended text to the end of the document`,
              },
            ],
          };
        }

        case 'replace_text': {
          const validatedArgs = ReplaceTextSchema.parse(args);
          await docs.documents.batchUpdate({
            documentId: validatedArgs.documentId,
            requestBody: {
              requests: [
                {
                  replaceAllText: {
                    containsText: {
                      text: validatedArgs.searchText,
                      matchCase: validatedArgs.matchCase,
                    },
                    replaceText: validatedArgs.replaceText,
                  },
                },
              ],
            },
          });

          return {
            content: [
              {
                type: 'text',
                text: `Successfully replaced all occurrences of "${validatedArgs.searchText}" with "${validatedArgs.replaceText}"`,
              },
            ],
          };
        }

        case 'format_text': {
          const validatedArgs = FormatTextSchema.parse(args);
          const fields: string[] = [];
          const textStyle: any = {};

          if (validatedArgs.bold !== undefined) {
            textStyle.bold = validatedArgs.bold;
            fields.push('bold');
          }
          if (validatedArgs.italic !== undefined) {
            textStyle.italic = validatedArgs.italic;
            fields.push('italic');
          }
          if (validatedArgs.underline !== undefined) {
            textStyle.underline = validatedArgs.underline;
            fields.push('underline');
          }
          if (validatedArgs.fontSize !== undefined) {
            textStyle.fontSize = { magnitude: validatedArgs.fontSize, unit: 'PT' };
            fields.push('fontSize');
          }
          if (validatedArgs.foregroundColor !== undefined) {
            textStyle.foregroundColor = {
              color: {
                rgbColor: validatedArgs.foregroundColor,
              },
            };
            fields.push('foregroundColor');
          }

          await docs.documents.batchUpdate({
            documentId: validatedArgs.documentId,
            requestBody: {
              requests: [
                {
                  updateTextStyle: {
                    range: {
                      startIndex: validatedArgs.startIndex,
                      endIndex: validatedArgs.endIndex,
                    },
                    textStyle,
                    fields: fields.join(','),
                  },
                },
              ],
            },
          });

          return {
            content: [
              {
                type: 'text',
                text: `Successfully formatted text from index ${validatedArgs.startIndex} to ${validatedArgs.endIndex}`,
              },
            ],
          };
        }

        case 'insert_image': {
          const validatedArgs = InsertImageSchema.parse(args);
          const objectSize: any = {};

          if (validatedArgs.width && validatedArgs.height) {
            objectSize.width = { magnitude: validatedArgs.width, unit: 'PT' };
            objectSize.height = { magnitude: validatedArgs.height, unit: 'PT' };
          }

          await docs.documents.batchUpdate({
            documentId: validatedArgs.documentId,
            requestBody: {
              requests: [
                {
                  insertInlineImage: {
                    location: {
                      index: validatedArgs.index,
                    },
                    uri: validatedArgs.imageUri,
                    ...(Object.keys(objectSize).length > 0 && { objectSize }),
                  },
                },
              ],
            },
          });

          return {
            content: [
              {
                type: 'text',
                text: `Successfully inserted image at index ${validatedArgs.index}`,
              },
            ],
          };
        }

        default:
          // Try to handle with auto-generated tools
          return await handleGeneratedTool(name, args, docs);
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`,
          },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  server.connect(transport);
}

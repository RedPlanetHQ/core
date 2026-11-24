import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { google, docs_v1 } from 'googleapis';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { OAuth2Client } from 'google-auth-library';
import { generatedTools, handleGeneratedTool } from './generated-tools';

async function loadCredentials(
  client_id: string,
  client_secret: string,
  callback: string,
  config: Record<string, string>
): Promise<{ authClient: OAuth2Client; docs: docs_v1.Docs }> {
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

  const oauth2Client = new OAuth2Client(client_id, client_secret, callback);
  oauth2Client.setCredentials(credentials);
  // The SDK refreshes tokens on demand for authenticated API requests.
  const docs = google.docs({ version: 'v1', auth: oauth2Client });
  return { authClient: oauth2Client, docs };
}

async function getOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  folderName: string
): Promise<string> {
  const escapedName = folderName.replace(/'/g, "\\'");
  const q = `mimeType='application/vnd.google-apps.folder' and name='${escapedName}' and 'root' in parents and trashed=false`;
  const list = await drive.files.list({ q, fields: 'files(id, name)' });
  const existing = list.data.files?.[0];
  if (existing?.id) return existing.id;

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });
  if (!created.data.id) throw new Error(`Failed to create folder "${folderName}"`);
  return created.data.id;
}

// Accepts a full docs URL or a raw file ID and returns the file ID.
function extractDocumentId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  // Fallback: assume the caller passed the raw ID.
  return trimmed;
}

async function shareFilePublicly(
  drive: ReturnType<typeof google.drive>,
  fileId: string
): Promise<void> {
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });
}

function readStructuralText(content: docs_v1.Schema$StructuralElement[] = []): string {
  let text = '';

  for (const element of content) {
    if (element.paragraph) {
      for (const part of element.paragraph.elements ?? []) {
        text += part.textRun?.content ?? '';
      }
    } else if (element.table) {
      for (const row of element.table.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) {
          text += readStructuralText(cell.content ?? []);
        }
      }
    } else if (element.tableOfContents) {
      text += readStructuralText(element.tableOfContents.content ?? []);
    }
  }

  return text;
}

// Custom tool schemas for common operations
const ListDocumentsSchema = z.object({
  pageToken: z.string().min(1).optional().describe('Token returned by the previous page'),
});

const CreateDocumentSchema = z.object({
  title: z.string().describe('Title for the new document'),
  folderName: z
    .string()
    .optional()
    .describe(
      'Optional folder name at the Drive root. The document will be placed inside this folder; if the folder does not exist it is created automatically.'
    ),
  makePublic: z
    .boolean()
    .optional()
    .describe(
      'If true, share the created document publicly (anyone with the link can view). Defaults to false.'
    ),
});

const CloneDocumentSchema = z.object({
  source: z
    .string()
    .describe(
      'Source document — either a Google Docs URL (e.g. https://docs.google.com/document/d/ABC.../edit) or a raw document ID.'
    ),
  title: z
    .string()
    .optional()
    .describe('Title for the cloned copy. Defaults to "Copy of <original title>".'),
  folderName: z
    .string()
    .optional()
    .describe(
      'Optional folder name at the Drive root. The cloned document is placed inside this folder; if the folder does not exist it is created automatically.'
    ),
  makePublic: z
    .boolean()
    .optional()
    .describe(
      'If true, share the cloned document publicly (anyone with the link can view). Defaults to false.'
    ),
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
  tabId: z.string().trim().min(1).optional().describe('Tab ID. Omit to use the first tab.'),
  text: z.string().describe('Text to insert'),
  index: z
    .number()
    .optional()
    .default(1)
    .describe('Location to insert text (default: 1 = start of document)'),
});

const AppendTextSchema = z.object({
  documentId: z.string().describe('ID of the document'),
  tabId: z.string().trim().min(1).optional().describe('Tab ID. Omit to use the first tab.'),
  text: z.string().describe('Text to append to the end of the document'),
});

const ReplaceTextSchema = z.object({
  documentId: z.string().describe('ID of the document'),
  tabId: z.string().trim().min(1).optional().describe('Target tab ID. Omit to replace in all tabs.'),
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

export async function getTools() {
  return [
    // Custom high-level tools
    {
      name: 'list_documents',
      description:
        "List a page of Google Docs documents in the user's Google Drive. Pass the returned page token to continue.",
      inputSchema: zodToJsonSchema(ListDocumentsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_document',
      description:
        'Creates a new Google Doc with a title. Optionally places it inside a named folder at the Drive root (folder auto-created if missing) and shares it publicly (anyone with the link can view).',
      inputSchema: zodToJsonSchema(CreateDocumentSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'clone_document',
      description:
        'Clones an existing Google Doc into a new document. Accepts either a docs.google.com URL or a raw document ID. Optionally places the copy inside a named folder at the Drive root (folder auto-created if missing). The source must be readable by the authenticated account (public link, shared with the account, or owned by it).',
      inputSchema: zodToJsonSchema(CloneDocumentSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'read_document',
      description: 'Reads the full content of a Google Doc',
      inputSchema: zodToJsonSchema(ReadDocumentSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'insert_text',
      description: 'Inserts text at a specific location in a document tab',
      inputSchema: zodToJsonSchema(InsertTextSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'append_text',
      description: 'Appends text to the end of a document tab',
      inputSchema: zodToJsonSchema(AppendTextSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'replace_text',
      description: 'Replaces all occurrences of text in the selected tab, or throughout the document if omitted',
      inputSchema: zodToJsonSchema(ReplaceTextSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'format_text',
      description: 'Formats text in a document (bold, italic, color, size, etc.)',
      inputSchema: zodToJsonSchema(FormatTextSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'insert_image',
      description: 'Inserts an image into a document',
      inputSchema: zodToJsonSchema(InsertImageSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    // Auto-generated tools from Discovery Document
    ...generatedTools,
  ];
}

/**
 * Call a specific tool without starting the MCP server
 */
export async function callTool(
  name: string,
  args: Record<string, any>,
  client_id: string,
  client_secret: string,
  callback: string,
  credentials: Record<string, string>
) {
  const { authClient, docs } = await loadCredentials(
    client_id,
    client_secret,
    callback,
    credentials
  );

  try {
    switch (name) {
      case 'list_documents': {
        const { pageToken } = ListDocumentsSchema.parse(args);

        // Use Drive API to list all documents
        const drive = google.drive({ version: 'v3', auth: authClient });
        const response = await drive.files.list({
          q: "mimeType='application/vnd.google-apps.document' and trashed=false",
          fields: 'nextPageToken, files(id, name, createdTime, modifiedTime, webViewLink)',
          pageToken,
          orderBy: 'modifiedTime desc',
        });

        const files = response.data.files || [];
        const nextPage = response.data.nextPageToken
          ? `\n\nNext page token: ${response.data.nextPageToken}`
          : '';
        return {
          content: [
            {
              type: 'text',
              text: `Found ${files.length} document(s):\n\n${files
                .map(
                  f =>
                    `- ${f.name}\n  ID: ${f.id}\n  Modified: ${f.modifiedTime}\n  URL: ${f.webViewLink}`
                )
                .join('\n\n')}${nextPage}`,
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

        const documentId = response.data.documentId!;
        const drive = google.drive({ version: 'v3', auth: authClient });

        if (validatedArgs.folderName) {
          const folderId = await getOrCreateFolder(drive, validatedArgs.folderName);
          await drive.files.update({
            fileId: documentId,
            addParents: folderId,
            removeParents: 'root',
            fields: 'id, parents',
          });
        }

        const shouldMakePublic = validatedArgs.makePublic ?? false;
        if (shouldMakePublic) {
          await shareFilePublicly(drive, documentId);
        }

        const url = `https://docs.google.com/document/d/${documentId}/edit`;
        return {
          content: [
            {
              type: 'text',
              text: `Document created successfully!\nID: ${documentId}\nTitle: ${response.data.title}\nURL: ${url}${validatedArgs.folderName ? `\nFolder: ${validatedArgs.folderName}` : ''}${shouldMakePublic ? '\nVisibility: public (anyone with the link can view)' : ''}`,
            },
          ],
        };
      }

      case 'clone_document': {
        const validatedArgs = CloneDocumentSchema.parse(args);
        const sourceId = extractDocumentId(validatedArgs.source);
        const drive = google.drive({ version: 'v3', auth: authClient });

        const requestBody: { name?: string; parents?: string[] } = {};
        if (validatedArgs.title) requestBody.name = validatedArgs.title;
        if (validatedArgs.folderName) {
          const folderId = await getOrCreateFolder(drive, validatedArgs.folderName);
          requestBody.parents = [folderId];
        }

        const copyResponse = await drive.files.copy({
          fileId: sourceId,
          requestBody,
          fields: 'id, name, webViewLink',
        });

        const newId = copyResponse.data.id!;
        const shouldMakePublic = validatedArgs.makePublic ?? false;

        if (shouldMakePublic) {
          await shareFilePublicly(drive, newId);
        }

        const url =
          copyResponse.data.webViewLink ??
          `https://docs.google.com/document/d/${newId}/edit`;

        return {
          content: [
            {
              type: 'text',
              text: `Document cloned successfully!\nSource ID: ${sourceId}\nNew ID: ${newId}\nTitle: ${copyResponse.data.name}\nURL: ${url}${validatedArgs.folderName ? `\nFolder: ${validatedArgs.folderName}` : ''}${shouldMakePublic ? '\nVisibility: public (anyone with the link can view)' : ''}`,
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

        const textContent = readStructuralText(response.data.body?.content ?? []);

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
                    ...(validatedArgs.tabId && { tabId: validatedArgs.tabId }),
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

        await docs.documents.batchUpdate({
          documentId: validatedArgs.documentId,
          requestBody: {
            requests: [
              {
                insertText: {
                  endOfSegmentLocation: validatedArgs.tabId ? { tabId: validatedArgs.tabId } : {},
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
                  ...(validatedArgs.tabId && {
                    tabsCriteria: { tabIds: [validatedArgs.tabId] },
                  }),
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
}

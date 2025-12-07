import { google, sheets_v4 } from 'googleapis';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { OAuth2Client } from 'google-auth-library';
import { generatedTools, handleGeneratedTool } from './generated-tools';

// OAuth2 configuration
let oauth2Client: OAuth2Client;
let sheets: sheets_v4.Sheets;

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
const CreateSpreadsheetSchema = z.object({
  title: z.string().describe('Title for the new spreadsheet'),
  sheetTitles: z
    .array(z.string())
    .optional()
    .describe('Titles for initial sheets (default: single sheet named "Sheet1")'),
});

const ReadRangeSchema = z.object({
  spreadsheetId: z.string().describe('ID of the spreadsheet'),
  range: z.string().describe('A1 notation range (e.g., "Sheet1!A1:B10")'),
  majorDimension: z
    .enum(['ROWS', 'COLUMNS'])
    .optional()
    .describe('Whether values should be organized by row or column'),
});

const WriteRangeSchema = z.object({
  spreadsheetId: z.string().describe('ID of the spreadsheet'),
  range: z.string().describe('A1 notation range (e.g., "Sheet1!A1:B10")'),
  values: z.array(z.array(z.any())).describe('2D array of values to write (rows then columns)'),
  valueInputOption: z
    .enum(['RAW', 'USER_ENTERED'])
    .optional()
    .default('USER_ENTERED')
    .describe('How values should be interpreted (RAW = as-is, USER_ENTERED = as if typed)'),
});

const AppendRangeSchema = z.object({
  spreadsheetId: z.string().describe('ID of the spreadsheet'),
  range: z.string().describe('A1 notation range where to append (e.g., "Sheet1!A1")'),
  values: z.array(z.array(z.any())).describe('2D array of values to append'),
  valueInputOption: z
    .enum(['RAW', 'USER_ENTERED'])
    .optional()
    .default('USER_ENTERED')
    .describe('How values should be interpreted'),
});

const BatchUpdateSchema = z.object({
  spreadsheetId: z.string().describe('ID of the spreadsheet'),
  requests: z
    .array(z.any())
    .describe('Array of update requests (formatting, sorting, filtering, etc.)'),
});

const ListSpreadsheetsSchema = z.object({});

const ListSheetsSchema = z.object({
  spreadsheetId: z.string().describe('The ID of the spreadsheet'),
});

const WriteToCellSchema = z.object({
  spreadsheetId: z.string().describe('ID of the spreadsheet'),
  sheetName: z.string().describe('Name of the sheet (e.g., "Sheet1")'),
  cell: z.string().describe('Cell reference in A1 notation (e.g., "A1", "B5")'),
  value: z.any().describe('Value to write to the cell'),
  valueInputOption: z
    .enum(['RAW', 'USER_ENTERED'])
    .optional()
    .default('USER_ENTERED')
    .describe('How the value should be interpreted (RAW = as-is, USER_ENTERED = as if typed)'),
});

export async function getTools() {
  return [
    // Custom high-level tools
    {
      name: 'list_spreadsheets',
      description: "List all Google Sheets spreadsheets in the user's Google Drive.",
      inputSchema: zodToJsonSchema(ListSpreadsheetsSchema),
    },
    {
      name: 'list_sheets',
      description:
        'List all sheets in a spreadsheet with metadata (sheetId, title, index, rowCount, columnCount). Does not include cell data. Use this to discover available sheets before fetching data.',
      inputSchema: zodToJsonSchema(ListSheetsSchema),
    },
    {
      name: 'write_to_cell',
      description: 'Writes a single value to a specific cell',
      inputSchema: zodToJsonSchema(WriteToCellSchema),
    },
    {
      name: 'create_spreadsheet',
      description: 'Creates a new spreadsheet with optional initial sheets',
      inputSchema: zodToJsonSchema(CreateSpreadsheetSchema),
    },
    {
      name: 'read_range',
      description: 'Reads values from a spreadsheet range',
      inputSchema: zodToJsonSchema(ReadRangeSchema),
    },
    {
      name: 'write_range',
      description: 'Writes values to a spreadsheet range',
      inputSchema: zodToJsonSchema(WriteRangeSchema),
    },
    {
      name: 'append_range',
      description: 'Appends values to a spreadsheet range',
      inputSchema: zodToJsonSchema(AppendRangeSchema),
    },
    {
      name: 'batch_update',
      description: 'Performs batch updates (formatting, sorting, filtering, adding sheets, etc.)',
      inputSchema: zodToJsonSchema(BatchUpdateSchema),
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
  await loadCredentials(client_id, client_secret, callback, credentials);

  // Initialize Sheets API
  sheets = google.sheets({ version: 'v4', auth: oauth2Client });

  try {
    switch (name) {
      case 'list_spreadsheets': {
        ListSpreadsheetsSchema.parse(args);

        // Use Drive API to list all spreadsheets
        const drive = google.docs({ version: 'v3', auth: oauth2Client });
        const response = await drive.files.list({
          q: "mimeType='application/vnd.google-apps.spreadsheet'",
          fields: 'files(id, name, createdTime, modifiedTime, webViewLink)',
          orderBy: 'modifiedTime desc',
        });

        const files = response.data.files || [];
        return {
          content: [
            {
              type: 'text',
              text: `Found ${files.length} spreadsheet(s):\n\n${files
                .map(
                  f =>
                    `- ${f.name}\n  ID: ${f.id}\n  Modified: ${f.modifiedTime}\n  URL: ${f.webViewLink}`
                )
                .join('\n\n')}`,
            },
          ],
        };
      }

      case 'list_sheets': {
        const validatedArgs = ListSheetsSchema.parse(args);

        const response = await sheets.spreadsheets.get({
          spreadsheetId: validatedArgs.spreadsheetId,
          fields: 'sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))',
        });

        const sheetsList = response.data.sheets || [];
        const sheetsInfo = sheetsList.map(sheet => ({
          sheetId: sheet.properties?.sheetId,
          title: sheet.properties?.title,
          index: sheet.properties?.index,
          rowCount: sheet.properties?.gridProperties?.rowCount,
          columnCount: sheet.properties?.gridProperties?.columnCount,
        }));

        return {
          content: [
            {
              type: 'text',
              text: `Found ${sheetsInfo.length} sheet(s) in spreadsheet:\n\n${JSON.stringify(
                sheetsInfo,
                null,
                2
              )}`,
            },
          ],
        };
      }

      case 'write_to_cell': {
        const validatedArgs = WriteToCellSchema.parse(args);
        const range = `${validatedArgs.sheetName}!${validatedArgs.cell}`;

        const response = await sheets.spreadsheets.values.update({
          spreadsheetId: validatedArgs.spreadsheetId,
          range,
          valueInputOption: validatedArgs.valueInputOption,
          requestBody: {
            values: [[validatedArgs.value]],
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: `Successfully wrote value to ${range}\nUpdated range: ${response.data.updatedRange}`,
            },
          ],
        };
      }

      case 'create_spreadsheet': {
        const validatedArgs = CreateSpreadsheetSchema.parse(args);
        const resource: sheets_v4.Schema$Spreadsheet = {
          properties: {
            title: validatedArgs.title,
          },
          sheets: validatedArgs.sheetTitles?.map(title => ({
            properties: { title },
          })) || [{ properties: { title: 'Sheet1' } }],
        };

        const response = await sheets.spreadsheets.create({
          requestBody: resource,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Spreadsheet created successfully!\nID: ${response.data.spreadsheetId}\nURL: ${response.data.spreadsheetUrl}\nTitle: ${response.data.properties?.title}`,
            },
          ],
        };
      }

      case 'read_range': {
        const validatedArgs = ReadRangeSchema.parse(args);
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: validatedArgs.spreadsheetId,
          range: validatedArgs.range,
          majorDimension: validatedArgs.majorDimension,
        });

        const values = response.data.values || [];
        return {
          content: [
            {
              type: 'text',
              text: `Range: ${response.data.range}\nRows: ${values.length}\n\nData:\n${JSON.stringify(values, null, 2)}`,
            },
          ],
        };
      }

      case 'write_range': {
        const validatedArgs = WriteRangeSchema.parse(args);
        const response = await sheets.spreadsheets.values.update({
          spreadsheetId: validatedArgs.spreadsheetId,
          range: validatedArgs.range,
          valueInputOption: validatedArgs.valueInputOption,
          requestBody: {
            values: validatedArgs.values,
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: `Successfully wrote ${response.data.updatedRows} rows and ${response.data.updatedColumns} columns to ${response.data.updatedRange}`,
            },
          ],
        };
      }

      case 'append_range': {
        const validatedArgs = AppendRangeSchema.parse(args);
        const response = await sheets.spreadsheets.values.append({
          spreadsheetId: validatedArgs.spreadsheetId,
          range: validatedArgs.range,
          valueInputOption: validatedArgs.valueInputOption,
          requestBody: {
            values: validatedArgs.values,
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: `Successfully appended ${response.data.updates?.updatedRows} rows to ${response.data.updates?.updatedRange}`,
            },
          ],
        };
      }

      case 'batch_update': {
        const validatedArgs = BatchUpdateSchema.parse(args);
        const response = await sheets.spreadsheets.batchUpdate({
          spreadsheetId: validatedArgs.spreadsheetId,
          requestBody: {
            requests: validatedArgs.requests,
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: `Batch update completed successfully with ${response.data.replies?.length || 0} replies`,
            },
          ],
        };
      }

      default:
        // Try to handle with auto-generated tools
        return await handleGeneratedTool(name, args, sheets);
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

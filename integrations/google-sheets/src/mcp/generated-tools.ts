// Auto-generated from Google Sheets Discovery Document
// DO NOT EDIT MANUALLY - Generated on 2025-11-20T13:29:34.127Z

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { sheets_v4 } from 'googleapis';

// ========== SCHEMAS ==========
const GetByDataFilterGetByDataFilterSchema = z.object({
  spreadsheetId: z.string().describe('The spreadsheet to request.'),
  dataFilters: z
    .array(z.any())
    .describe('The DataFilters used to select which ranges to retrieve from the spreadsheet.'),
  includeGridData: z
    .boolean()
    .describe(
      'True if grid data should be returned. This parameter is ignored if a field mask was set in the request.'
    ),
  excludeTablesInBandedRanges: z
    .boolean()
    .describe('True if tables should be excluded in the banded ranges. False if not set.'),
});

const BatchUpdateBatchUpdateSchema = z.object({
  spreadsheetId: z.string().describe('The spreadsheet to apply the updates to.'),
  requests: z
    .array(z.any())
    .describe(
      'A list of updates to apply to the spreadsheet. Requests will be applied in the order they are specified. If any request is not valid, no requests will be applied.'
    ),
  includeSpreadsheetInResponse: z
    .boolean()
    .describe('Determines if the update response should include the spreadsheet resource.'),
  responseRanges: z
    .array(z.string())
    .describe(
      "Limits the ranges included in the response spreadsheet. Meaningful only if include_spreadsheet_in_response is 'true'."
    ),
  responseIncludeGridData: z
    .boolean()
    .describe(
      "True if grid data should be returned. Meaningful only if include_spreadsheet_in_response is 'true'. This parameter is ignored if a field mask was set in the request."
    ),
});

const UpdateValuesSchema = z.object({
  spreadsheetId: z.string().describe('The ID of the spreadsheet to update.'),
  valueInputOption: z
    .enum(['INPUT_VALUE_OPTION_UNSPECIFIED', 'RAW', 'USER_ENTERED'])
    .optional()
    .describe('How the input data should be interpreted.'),
  includeValuesInResponse: z
    .boolean()
    .optional()
    .describe(
      'Determines if the update response should include the values of the cells that were updated. By default, responses do not include the updated values. If the range to write was larger than the range actually written, the response includes all values in the requested range (excluding trailing empty rows and columns).'
    ),
  responseValueRenderOption: z
    .enum(['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'])
    .optional()
    .describe(
      'Determines how values in the response should be rendered. The default render option is FORMATTED_VALUE.'
    ),
  responseDateTimeRenderOption: z
    .enum(['SERIAL_NUMBER', 'FORMATTED_STRING'])
    .optional()
    .describe(
      'Determines how dates, times, and durations in the response should be rendered. This is ignored if response_value_render_option is FORMATTED_VALUE. The default dateTime render option is SERIAL_NUMBER.'
    ),
  range: z
    .string()
    .describe(
      'The range the values cover, in [A1 notation](https://developers.google.com/workspace/sheets/api/guides/concepts#cell). For output, this range indicates the entire requested range, even though the values will exclude trailing rows and columns. When appending values, this field represents the range to search for a table, after which values will be appended.'
    ),
  majorDimension: z
    .enum(['DIMENSION_UNSPECIFIED', 'ROWS', 'COLUMNS'])
    .describe(
      'The major dimension of the values. For output, if the spreadsheet data is: `A1=1,B1=2,A2=3,B2=4`, then requesting `range=A1:B2,majorDimension=ROWS` will return `[[1,2],[3,4]]`, whereas requesting `range=A1:B2,majorDimension=COLUMNS` will return `[[1,3],[2,4]]`. For input, with `range=A1:B2,majorDimension=ROWS` then `[[1,2],[3,4]]` will set `A1=1,B1=2,A2=3,B2=4`. With `range=A1:B2,majorDimension=COLUMNS` then `[[1,2],[3,4]]` will set `A1=1,B1=3,A2=2,B2=4`. When writing, if this field is not set, it defaults to ROWS.'
    ),
  values: z
    .array(z.array(z.any()))
    .describe(
      'The data that was read or to be written. This is an array of arrays, the outer array representing all the data and each inner array representing a major dimension. Each item in the inner array corresponds with one cell. For output, empty trailing rows and columns will not be included. For input, supported value types are: bool, string, and double. Null values will be skipped. To set a cell to an empty value, set the string value to an empty string.'
    ),
});

const AppendValuesSchema = z.object({
  spreadsheetId: z.string().describe('The ID of the spreadsheet to update.'),
  valueInputOption: z
    .enum(['INPUT_VALUE_OPTION_UNSPECIFIED', 'RAW', 'USER_ENTERED'])
    .optional()
    .describe('How the input data should be interpreted.'),
  insertDataOption: z
    .enum(['OVERWRITE', 'INSERT_ROWS'])
    .optional()
    .describe('How the input data should be inserted.'),
  includeValuesInResponse: z
    .boolean()
    .optional()
    .describe(
      'Determines if the update response should include the values of the cells that were appended. By default, responses do not include the updated values.'
    ),
  responseValueRenderOption: z
    .enum(['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'])
    .optional()
    .describe(
      'Determines how values in the response should be rendered. The default render option is FORMATTED_VALUE.'
    ),
  responseDateTimeRenderOption: z
    .enum(['SERIAL_NUMBER', 'FORMATTED_STRING'])
    .optional()
    .describe(
      'Determines how dates, times, and durations in the response should be rendered. This is ignored if response_value_render_option is FORMATTED_VALUE. The default dateTime render option is SERIAL_NUMBER.'
    ),
  range: z
    .string()
    .describe(
      'The range the values cover, in [A1 notation](https://developers.google.com/workspace/sheets/api/guides/concepts#cell). For output, this range indicates the entire requested range, even though the values will exclude trailing rows and columns. When appending values, this field represents the range to search for a table, after which values will be appended.'
    ),
  majorDimension: z
    .enum(['DIMENSION_UNSPECIFIED', 'ROWS', 'COLUMNS'])
    .describe(
      'The major dimension of the values. For output, if the spreadsheet data is: `A1=1,B1=2,A2=3,B2=4`, then requesting `range=A1:B2,majorDimension=ROWS` will return `[[1,2],[3,4]]`, whereas requesting `range=A1:B2,majorDimension=COLUMNS` will return `[[1,3],[2,4]]`. For input, with `range=A1:B2,majorDimension=ROWS` then `[[1,2],[3,4]]` will set `A1=1,B1=2,A2=3,B2=4`. With `range=A1:B2,majorDimension=COLUMNS` then `[[1,2],[3,4]]` will set `A1=1,B1=3,A2=2,B2=4`. When writing, if this field is not set, it defaults to ROWS.'
    ),
  values: z
    .array(z.array(z.any()))
    .describe(
      'The data that was read or to be written. This is an array of arrays, the outer array representing all the data and each inner array representing a major dimension. Each item in the inner array corresponds with one cell. For output, empty trailing rows and columns will not be included. For input, supported value types are: bool, string, and double. Null values will be skipped. To set a cell to an empty value, set the string value to an empty string.'
    ),
});

const ClearValuesSchema = z.object({
  spreadsheetId: z.string().describe('The ID of the spreadsheet to update.'),
  range: z
    .string()
    .describe(
      'The [A1 notation or R1C1 notation](https://developers.google.com/workspace/sheets/api/guides/concepts#cell) of the values to clear.'
    ),
});

const BatchGetValuesSchema = z.object({
  spreadsheetId: z.string().describe('The ID of the spreadsheet to retrieve data from.'),
  ranges: z
    .array(z.string())
    .optional()
    .describe(
      'The [A1 notation or R1C1 notation](https://developers.google.com/workspace/sheets/api/guides/concepts#cell) of the range to retrieve values from.'
    ),
  majorDimension: z
    .enum(['DIMENSION_UNSPECIFIED', 'ROWS', 'COLUMNS'])
    .optional()
    .describe(
      'The major dimension that results should use. For example, if the spreadsheet data is: `A1=1,B1=2,A2=3,B2=4`, then requesting `ranges=["A1:B2"],majorDimension=ROWS` returns `[[1,2],[3,4]]`, whereas requesting `ranges=["A1:B2"],majorDimension=COLUMNS` returns `[[1,3],[2,4]]`.'
    ),
  valueRenderOption: z
    .enum(['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'])
    .optional()
    .describe(
      'How values should be represented in the output. The default render option is ValueRenderOption.FORMATTED_VALUE.'
    ),
  dateTimeRenderOption: z
    .enum(['SERIAL_NUMBER', 'FORMATTED_STRING'])
    .optional()
    .describe(
      'How dates, times, and durations should be represented in the output. This is ignored if value_render_option is FORMATTED_VALUE. The default dateTime render option is SERIAL_NUMBER.'
    ),
});

const BatchUpdateValuesSchema = z.object({
  spreadsheetId: z.string().describe('The ID of the spreadsheet to update.'),
  valueInputOption: z
    .enum(['INPUT_VALUE_OPTION_UNSPECIFIED', 'RAW', 'USER_ENTERED'])
    .describe('How the input data should be interpreted.'),
  data: z.array(z.any()).describe('The new values to apply to the spreadsheet.'),
  includeValuesInResponse: z
    .boolean()
    .describe(
      'Determines if the update response should include the values of the cells that were updated. By default, responses do not include the updated values. The `updatedData` field within each of the BatchUpdateValuesResponse.responses contains the updated values. If the range to write was larger than the range actually written, the response includes all values in the requested range (excluding trailing empty rows and columns).'
    ),
  responseValueRenderOption: z
    .enum(['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'])
    .describe(
      'Determines how values in the response should be rendered. The default render option is FORMATTED_VALUE.'
    ),
  responseDateTimeRenderOption: z
    .enum(['SERIAL_NUMBER', 'FORMATTED_STRING'])
    .describe(
      'Determines how dates, times, and durations in the response should be rendered. This is ignored if response_value_render_option is FORMATTED_VALUE. The default dateTime render option is SERIAL_NUMBER.'
    ),
});

const BatchClearValuesSchema = z.object({
  spreadsheetId: z.string().describe('The ID of the spreadsheet to update.'),
  ranges: z
    .array(z.string())
    .describe(
      'The ranges to clear, in [A1 notation or R1C1 notation](https://developers.google.com/workspace/sheets/api/guides/concepts#cell).'
    ),
});

const BatchGetByDataFilterValuesSchema = z.object({
  spreadsheetId: z.string().describe('The ID of the spreadsheet to retrieve data from.'),
  dataFilters: z
    .array(z.any())
    .describe(
      'The data filters used to match the ranges of values to retrieve. Ranges that match any of the specified data filters are included in the response.'
    ),
  majorDimension: z
    .enum(['DIMENSION_UNSPECIFIED', 'ROWS', 'COLUMNS'])
    .describe(
      'The major dimension that results should use. For example, if the spreadsheet data is: `A1=1,B1=2,A2=3,B2=4`, then a request that selects that range and sets `majorDimension=ROWS` returns `[[1,2],[3,4]]`, whereas a request that sets `majorDimension=COLUMNS` returns `[[1,3],[2,4]]`.'
    ),
  valueRenderOption: z
    .enum(['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'])
    .describe(
      'How values should be represented in the output. The default render option is FORMATTED_VALUE.'
    ),
  dateTimeRenderOption: z
    .enum(['SERIAL_NUMBER', 'FORMATTED_STRING'])
    .describe(
      'How dates, times, and durations should be represented in the output. This is ignored if value_render_option is FORMATTED_VALUE. The default dateTime render option is SERIAL_NUMBER.'
    ),
});

const BatchUpdateByDataFilterValuesSchema = z.object({
  spreadsheetId: z.string().describe('The ID of the spreadsheet to update.'),
  valueInputOption: z
    .enum(['INPUT_VALUE_OPTION_UNSPECIFIED', 'RAW', 'USER_ENTERED'])
    .describe('How the input data should be interpreted.'),
  data: z
    .array(z.any())
    .describe(
      'The new values to apply to the spreadsheet. If more than one range is matched by the specified DataFilter the specified values are applied to all of those ranges.'
    ),
  includeValuesInResponse: z
    .boolean()
    .describe(
      'Determines if the update response should include the values of the cells that were updated. By default, responses do not include the updated values. The `updatedData` field within each of the BatchUpdateValuesResponse.responses contains the updated values. If the range to write was larger than the range actually written, the response includes all values in the requested range (excluding trailing empty rows and columns).'
    ),
  responseValueRenderOption: z
    .enum(['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'])
    .describe(
      'Determines how values in the response should be rendered. The default render option is FORMATTED_VALUE.'
    ),
  responseDateTimeRenderOption: z
    .enum(['SERIAL_NUMBER', 'FORMATTED_STRING'])
    .describe(
      'Determines how dates, times, and durations in the response should be rendered. This is ignored if response_value_render_option is FORMATTED_VALUE. The default dateTime render option is SERIAL_NUMBER.'
    ),
});

const BatchClearByDataFilterValuesSchema = z.object({
  spreadsheetId: z.string().describe('The ID of the spreadsheet to update.'),
  dataFilters: z
    .array(z.any())
    .describe('The DataFilters used to determine which ranges to clear.'),
});

const SearchDeveloperMetadataSchema = z.object({
  spreadsheetId: z.string().describe('The ID of the spreadsheet to retrieve metadata from.'),
  dataFilters: z
    .array(z.any())
    .describe(
      'The data filters describing the criteria used to determine which DeveloperMetadata entries to return. DeveloperMetadata matching any of the specified filters are included in the response.'
    ),
});

const CopyToSheetsSchema = z.object({
  spreadsheetId: z.string().describe('The ID of the spreadsheet containing the sheet to copy.'),
  sheetId: z.number().describe('The ID of the sheet to copy.'),
  destinationSpreadsheetId: z.string().describe('The ID of the spreadsheet to copy the sheet to.'),
});

// ========== TOOL DEFINITIONS ==========
export const generatedTools = [
  {
    name: 'get_by_data_filter',
    description:
      'Returns the spreadsheet at the given ID. The caller must specify the spreadsheet ID. This method differs from GetSpreadsheet in that it allows selecting which subsets of spreadsheet data to return by specifying a dataFilters parameter. Multiple DataFilters can be specified. Specifying one or more data filters returns the portions of the spreadsheet that intersect ranges matched by any of the filters. By default, data within grids is not returned. You can include grid data one of 2 ways: * Specify a [field mask](https://developers.google.com/workspace/sheets/api/guides/field-masks) listing your desired fields using the `fields` URL parameter in HTTP * Set the includeGridData parameter to true. If a field mask is set, the `includeGridData` parameter is ignored For large spreadsheets, as a best practice, retrieve only the specific spreadsheet fields that you want.',
    inputSchema: zodToJsonSchema(GetByDataFilterGetByDataFilterSchema),
  },
  {
    name: 'batch_update',
    description:
      'Applies one or more updates to the spreadsheet. Each request is validated before being applied. If any request is not valid then the entire request will fail and nothing will be applied. Some requests have replies to give you some information about how they are applied. The replies will mirror the requests. For example, if you applied 4 updates and the 3rd one had a reply, then the response will have 2 empty replies, the actual reply, and another empty reply, in that order. Due to the collaborative nature of spreadsheets, it is not guaranteed that the spreadsheet will reflect exactly your changes after this completes, however it is guaranteed that the updates in the request will be applied together atomically. Your changes may be altered with respect to collaborator changes. If there are no collaborators, the spreadsheet should reflect your changes.',
    inputSchema: zodToJsonSchema(BatchUpdateBatchUpdateSchema),
  },
  {
    name: 'update_value',
    description:
      'Sets values in a range of a spreadsheet. The caller must specify the spreadsheet ID, range, and a valueInputOption.',
    inputSchema: zodToJsonSchema(UpdateValuesSchema),
  },
  {
    name: 'append_value',
    description:
      'Appends values to a spreadsheet. The input range is used to search for existing data and find a "table" within that range. Values will be appended to the next row of the table, starting with the first column of the table. See the [guide](https://developers.google.com/workspace/sheets/api/guides/values#appending_values) and [sample code](https://developers.google.com/workspace/sheets/api/samples/writing#append_values) for specific details of how tables are detected and data is appended. The caller must specify the spreadsheet ID, range, and a valueInputOption. The `valueInputOption` only controls how the input data will be added to the sheet (column-wise or row-wise), it does not influence what cell the data starts being written to.',
    inputSchema: zodToJsonSchema(AppendValuesSchema),
  },
  {
    name: 'clear_value',
    description:
      'Clears values from a spreadsheet. The caller must specify the spreadsheet ID and range. Only values are cleared -- all other properties of the cell (such as formatting, data validation, etc..) are kept.',
    inputSchema: zodToJsonSchema(ClearValuesSchema),
  },
  {
    name: 'batch_get_value',
    description:
      'Returns one or more ranges of values from a spreadsheet. The caller must specify the spreadsheet ID and one or more ranges.',
    inputSchema: zodToJsonSchema(BatchGetValuesSchema),
  },
  {
    name: 'batch_update_value',
    description:
      'Sets values in one or more ranges of a spreadsheet. The caller must specify the spreadsheet ID, a valueInputOption, and one or more ValueRanges.',
    inputSchema: zodToJsonSchema(BatchUpdateValuesSchema),
  },
  {
    name: 'batch_clear_value',
    description:
      'Clears one or more ranges of values from a spreadsheet. The caller must specify the spreadsheet ID and one or more ranges. Only values are cleared -- all other properties of the cell (such as formatting and data validation) are kept.',
    inputSchema: zodToJsonSchema(BatchClearValuesSchema),
  },
  {
    name: 'batch_get_by_data_filter_value',
    description:
      'Returns one or more ranges of values that match the specified data filters. The caller must specify the spreadsheet ID and one or more DataFilters. Ranges that match any of the data filters in the request will be returned.',
    inputSchema: zodToJsonSchema(BatchGetByDataFilterValuesSchema),
  },
  {
    name: 'batch_update_by_data_filter_value',
    description:
      'Sets values in one or more ranges of a spreadsheet. The caller must specify the spreadsheet ID, a valueInputOption, and one or more DataFilterValueRanges.',
    inputSchema: zodToJsonSchema(BatchUpdateByDataFilterValuesSchema),
  },
  {
    name: 'batch_clear_by_data_filter_value',
    description:
      'Clears one or more ranges of values from a spreadsheet. The caller must specify the spreadsheet ID and one or more DataFilters. Ranges matching any of the specified data filters will be cleared. Only values are cleared -- all other properties of the cell (such as formatting, data validation, etc..) are kept.',
    inputSchema: zodToJsonSchema(BatchClearByDataFilterValuesSchema),
  },
  {
    name: 'search_developer_metadata',
    description:
      'Returns all developer metadata matching the specified DataFilter. If the provided DataFilter represents a DeveloperMetadataLookup object, this will return all DeveloperMetadata entries selected by it. If the DataFilter represents a location in a spreadsheet, this will return all developer metadata associated with locations intersecting that region.',
    inputSchema: zodToJsonSchema(SearchDeveloperMetadataSchema),
  },
  {
    name: 'copy_to_sheet',
    description:
      'Copies a single sheet from a spreadsheet to another spreadsheet. Returns the properties of the newly created sheet.',
    inputSchema: zodToJsonSchema(CopyToSheetsSchema),
  },
];

// ========== HANDLER FUNCTION ==========
/**
 * Handles auto-generated tool calls
 * @param name - Tool name
 * @param args - Tool arguments
 * @param gmail - Gmail API client
 */
export async function handleGeneratedTool(
  name: string,
  args: any,
  sheets: sheets_v4.Sheets
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'get_by_data_filter': {
      const validatedArgs = GetByDataFilterGetByDataFilterSchema.parse(args);
      const response = await sheets.spreadsheets.getByDataFilter({
        spreadsheetId: validatedArgs.spreadsheetId,
        requestBody: validatedArgs,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'batch_update': {
      const validatedArgs = BatchUpdateBatchUpdateSchema.parse(args);
      const response = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: validatedArgs.spreadsheetId,
        requestBody: validatedArgs,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'update_value': {
      const validatedArgs = UpdateValuesSchema.parse(args);
      const response = await sheets.spreadsheets.values.update(
        {
          spreadsheetId: validatedArgs.spreadsheetId,
          range: validatedArgs.range,
          requestBody: validatedArgs,
        },
        {}
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'append_value': {
      const validatedArgs = AppendValuesSchema.parse(args);
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId: validatedArgs.spreadsheetId,
        range: validatedArgs.range,
        requestBody: validatedArgs,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'clear_value': {
      const validatedArgs = ClearValuesSchema.parse(args);
      const response = await sheets.spreadsheets.values.clear({
        spreadsheetId: validatedArgs.spreadsheetId,
        range: validatedArgs.range,
        requestBody: validatedArgs,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'batch_get_value': {
      const validatedArgs = BatchGetValuesSchema.parse(args);
      const response = await sheets.spreadsheets.values.batchGet(
        {
          spreadsheetId: validatedArgs.spreadsheetId,
          ranges: validatedArgs.ranges,
          majorDimension: validatedArgs.majorDimension,
          valueRenderOption: validatedArgs.valueRenderOption,
          dateTimeRenderOption: validatedArgs.dateTimeRenderOption,
        },
        {}
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'batch_update_value': {
      const validatedArgs = BatchUpdateValuesSchema.parse(args);
      const response = await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: validatedArgs.spreadsheetId,
        requestBody: validatedArgs,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'batch_clear_value': {
      const validatedArgs = BatchClearValuesSchema.parse(args);
      const response = await sheets.spreadsheets.values.batchClear({
        spreadsheetId: validatedArgs.spreadsheetId,
        requestBody: validatedArgs,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'batch_get_by_data_filter_value': {
      const validatedArgs = BatchGetByDataFilterValuesSchema.parse(args);
      const response = await sheets.spreadsheets.values.batchGetByDataFilter({
        spreadsheetId: validatedArgs.spreadsheetId,
        requestBody: validatedArgs,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'batch_update_by_data_filter_value': {
      const validatedArgs = BatchUpdateByDataFilterValuesSchema.parse(args);
      const response = await sheets.spreadsheets.values.batchUpdateByDataFilter({
        spreadsheetId: validatedArgs.spreadsheetId,
        requestBody: validatedArgs,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'batch_clear_by_data_filter_value': {
      const validatedArgs = BatchClearByDataFilterValuesSchema.parse(args);
      const response = await sheets.spreadsheets.values.batchClearByDataFilter({
        spreadsheetId: validatedArgs.spreadsheetId,
        requestBody: validatedArgs,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'search_developer_metadata': {
      const validatedArgs = SearchDeveloperMetadataSchema.parse(args);
      const response = await sheets.spreadsheets.developerMetadata.search({
        spreadsheetId: validatedArgs.spreadsheetId,
        requestBody: validatedArgs,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'copy_to_sheet': {
      const validatedArgs = CopyToSheetsSchema.parse(args);
      const response = await sheets.spreadsheets.sheets.copyTo({
        spreadsheetId: validatedArgs.spreadsheetId,
        sheetId: validatedArgs.sheetId,
        requestBody: validatedArgs,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }
    default:
      throw new Error(`Unknown generated tool: ${name}`);
  }
}

// ========== SUMMARY ==========
// Generated 13 new tools:
// - sheets.spreadsheets.getByDataFilter: Returns the spreadsheet at the given ID. The caller must specify the spreadsheet
// - sheets.spreadsheets.batchUpdate: Applies one or more updates to the spreadsheet. Each request is validated before
// - sheets.spreadsheets.values.update: Sets values in a range of a spreadsheet. The caller must specify the spreadsheet
// - sheets.spreadsheets.values.append: Appends values to a spreadsheet. The input range is used to search for existing
// - sheets.spreadsheets.values.clear: Clears values from a spreadsheet. The caller must specify the spreadsheet ID and
// - sheets.spreadsheets.values.batchGet: Returns one or more ranges of values from a spreadsheet. The caller must specify
// - sheets.spreadsheets.values.batchUpdate: Sets values in one or more ranges of a spreadsheet. The caller must specify the
// - sheets.spreadsheets.values.batchClear: Clears one or more ranges of values from a spreadsheet. The caller must specify
// - sheets.spreadsheets.values.batchGetByDataFilter: Returns one or more ranges of values that match the specified data filters. The
// - sheets.spreadsheets.values.batchUpdateByDataFilter: Sets values in one or more ranges of a spreadsheet. The caller must specify the
// - sheets.spreadsheets.values.batchClearByDataFilter: Clears one or more ranges of values from a spreadsheet. The caller must specify
// - sheets.spreadsheets.developerMetadata.search: Returns all developer metadata matching the specified DataFilter. If the provide
// - sheets.spreadsheets.sheets.copyTo: Copies a single sheet from a spreadsheet to another spreadsheet. Returns the pro

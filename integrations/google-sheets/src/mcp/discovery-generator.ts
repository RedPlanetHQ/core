import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import fs from 'fs';
import path from 'path';

interface DiscoveryDocument {
  schemas: Record<string, any>;
  resources: Record<string, any>;
}

interface DiscoveryMethod {
  id: string;
  path: string;
  httpMethod: string;
  description: string;
  parameters?: Record<string, any>;
  request?: { $ref: string };
  response?: { $ref: string };
  scopes?: string[];
}

interface GeneratedTool {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  handler: string; // Code string for the handler implementation
  category: 'spreadsheet' | 'values' | 'sheets' | 'developerMetadata' | 'other';
}

/**
 * Converts a JSON schema property to a Zod schema
 */
function jsonSchemaToZod(property: any, description?: string): string {
  const baseSchema = (() => {
    switch (property.type) {
      case 'string':
        if (property.enum) {
          return `z.enum([${property.enum.map((e: string) => `'${e}'`).join(', ')}])`;
        }
        return 'z.string()';
      case 'integer':
        return 'z.number()';
      case 'boolean':
        return 'z.boolean()';
      case 'array':
        if (property.items) {
          // For array items, don't pass description to avoid double descriptions
          const itemSchema = jsonSchemaToZod(property.items, undefined);
          return `z.array(${itemSchema})`;
        }
        return 'z.array(z.any())';
      case 'object':
        return 'z.object({})';
      default:
        return 'z.any()';
    }
  })();

  const withOptional = property.required === false ? `${baseSchema}.optional()` : baseSchema;
  const withDescription = description
    ? `${withOptional}.describe('${description.replace(/'/g, "\\'")}')`
    : withOptional;

  return withDescription;
}

/**
 * Generates a Zod schema from discovery document parameters
 */
function generateSchemaFromParameters(
  parameters: Record<string, any> = {},
  requestSchema?: any
): string {
  const schemaFields: string[] = [];

  // Add path/query parameters
  for (const [paramName, param] of Object.entries(parameters)) {
    if (param.location === 'path' || param.location === 'query') {
      // Query parameters and non-required path parameters should be optional
      const isRequired = param.required === true;
      const baseSchema = jsonSchemaToZod(param, param.description);
      const zodSchema = isRequired
        ? baseSchema
        : `${baseSchema.replace('.describe', '.optional().describe')}`;
      schemaFields.push(`  ${paramName}: ${zodSchema}`);
    }
  }

  // Add request body fields if present
  if (requestSchema?.properties) {
    for (const [propName, prop] of Object.entries(requestSchema.properties)) {
      const zodSchema = jsonSchemaToZod(prop as any, (prop as any).description);
      schemaFields.push(`  ${propName}: ${zodSchema}`);
    }
  }

  return `z.object({\n${schemaFields.join(',\n')}\n})`;
}

/**
 * Generates handler code for a method
 */
function generateHandler(
  method: DiscoveryMethod,
  resourcePath: string,
  toolName: string,
  schemaName: string
): string {
  const methodName = method.id.split('.').pop() || '';
  const pathParts = method.path.split('/');

  // Determine Sheets API method to call
  let apiCall = 'sheets';
  const parts = method.id.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    apiCall += `.${parts[i]}`;
  }
  apiCall += `.${methodName}`;

  // Build request parameters (no default userId for Sheets)
  const params: string[] = [];

  if (method.parameters) {
    for (const [paramName, param] of Object.entries(method.parameters)) {
      if (param.location === 'path') {
        params.push(`${paramName}: validatedArgs.${paramName}`);
      }
    }
  }

  // Add query parameters and request body
  if (method.request) {
    params.push('requestBody: validatedArgs');
  } else if (method.parameters) {
    for (const [paramName, param] of Object.entries(method.parameters)) {
      if (param.location === 'query') {
        params.push(`${paramName}: validatedArgs.${paramName}`);
      }
    }
  }

  return `
        case '${toolName}': {
          const validatedArgs = ${schemaName}.parse(args);
          const response = await ${apiCall}({
            ${params.join(',\n            ')}
          });

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(response.data, null, 2)
            }]
          };
        }`;
}

/**
 * Extracts methods from a resource recursively
 */
function extractMethods(
  resource: any,
  resourcePath: string,
  schemas: Record<string, any>
): DiscoveryMethod[] {
  const methods: DiscoveryMethod[] = [];

  if (resource.methods) {
    for (const [methodName, method] of Object.entries(resource.methods)) {
      methods.push({
        ...(method as any),
        resourcePath,
      });
    }
  }

  if (resource.resources) {
    for (const [subResourceName, subResource] of Object.entries(resource.resources)) {
      methods.push(...extractMethods(subResource, `${resourcePath}.${subResourceName}`, schemas));
    }
  }

  return methods;
}

/**
 * Categorizes a method based on its resource path
 */
function categorizeMethod(method: DiscoveryMethod): GeneratedTool['category'] {
  const id = method.id.toLowerCase();
  if (id.includes('.values.')) return 'values';
  if (id.includes('.sheets.')) return 'sheets';
  if (id.includes('.developermetadata')) return 'developerMetadata';
  if (id.includes('spreadsheets')) return 'spreadsheet';
  return 'other';
}

/**
 * Determines if a method is already implemented
 */
function isAlreadyImplemented(methodId: string, existingImplementation: string): boolean {
  const methodName = methodId.split('.').pop() || '';
  // Check if the method name appears as a case in the existing implementation
  return existingImplementation.includes(`case '${methodName.toLowerCase()}'`);
}

/**
 * Main generator function
 */
export async function generateToolsFromDiscovery(
  discoveryPath: string,
  existingImplementationPath: string
): Promise<{
  schemas: string[];
  tools: string[];
  handlers: string[];
  newMethods: DiscoveryMethod[];
}> {
  // Load discovery document
  const discovery: DiscoveryDocument = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8'));

  // Load existing implementation to avoid duplicates
  const existingImpl = fs.readFileSync(existingImplementationPath, 'utf-8');

  // Extract all methods from spreadsheets resource
  const spreadsheetsResource = (discovery as any).resources?.spreadsheets;
  if (!spreadsheetsResource) {
    throw new Error('Spreadsheets resource not found in discovery document');
  }

  const allMethods = extractMethods(spreadsheetsResource, 'spreadsheets', discovery.schemas);

  // Filter for new methods we want to add (exclude custom ones we already implemented)
  const excludeMethodNames = ['create', 'get']; // Already have custom implementations
  const targetCategories: GeneratedTool['category'][] = ['values', 'sheets', 'developerMetadata', 'spreadsheet'];
  const newMethods = allMethods.filter(method => {
    const category = categorizeMethod(method);
    const methodName = method.id.split('.').pop() || '';
    return (
      targetCategories.includes(category) &&
      !excludeMethodNames.includes(methodName) &&
      !isAlreadyImplemented(method.id, existingImpl)
    );
  });

  const schemas: string[] = [];
  const tools: string[] = [];
  const handlers: string[] = [];

  // Generate code for each new method
  for (const method of newMethods) {
    const methodName = method.id.split('.').pop() || '';
    const resourceName = method.id.split('.')[2] || ''; // e.g., 'drafts', 'threads'
    const toolName = `${methodName.toLowerCase()}_${resourceName.slice(0, -1)}`; // e.g., 'delete_draft', 'list_thread'
    const schemaName = `${methodName.charAt(0).toUpperCase() + methodName.slice(1)}${resourceName.charAt(0).toUpperCase() + resourceName.slice(1)}Schema`;

    // Get request schema if exists
    let requestSchema = null;
    if (method.request?.$ref) {
      requestSchema = discovery.schemas[method.request.$ref];
    }

    // Generate Zod schema
    const schemaCode = generateSchemaFromParameters(method.parameters, requestSchema);
    schemas.push(`const ${schemaName} = ${schemaCode};`);

    // Generate tool definition
    tools.push(`      {
        name: '${toolName}',
        description: '${method.description?.replace(/'/g, "\\'")}',
        inputSchema: zodToJsonSchema(${schemaName}),
      }`);

    // Generate handler
    handlers.push(generateHandler(method, (method as any).resourcePath, toolName, schemaName));
  }

  return {
    schemas,
    tools,
    handlers,
    newMethods,
  };
}

/**
 * CLI entry point
 */
async function main() {
  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const discoveryPath = path.join(__dirname, '../../sheets-discovery.json');
  const implPath = path.join(__dirname, 'index.ts');
  const outputPath = path.join(__dirname, 'generated-tools.ts');

  generateToolsFromDiscovery(discoveryPath, implPath)
    .then(result => {
      const output = `// Auto-generated from Google Sheets Discovery Document
// DO NOT EDIT MANUALLY - Generated on ${new Date().toISOString()}

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { sheets_v4 } from 'googleapis';

// ========== SCHEMAS ==========
${result.schemas.join('\n\n')}

// ========== TOOL DEFINITIONS ==========
export const generatedTools = [
${result.tools.join(',\n')}
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
  switch (name) {${result.handlers.join('\n')}
    default:
      throw new Error(\`Unknown generated tool: \${name}\`);
  }
}

// ========== SUMMARY ==========
// Generated ${result.newMethods.length} new tools:
${result.newMethods.map(m => `// - ${m.id}: ${m.description?.slice(0, 80)}`).join('\n')}
`;

      fs.writeFileSync(outputPath, output);
      console.log(`✅ Generated ${result.newMethods.length} new tools`);
      console.log(`📝 Output written to: ${outputPath}`);
      console.log('\nNew tools by category:');

      const byCategory = result.newMethods.reduce(
        (acc, m) => {
          const cat = categorizeMethod(m);
          acc[cat] = (acc[cat] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      Object.entries(byCategory).forEach(([cat, count]) => {
        console.log(`  - ${cat}: ${count} tools`);
      });
    })
    .catch(err => {
      console.error('❌ Generation failed:', err);
      process.exit(1);
    });
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

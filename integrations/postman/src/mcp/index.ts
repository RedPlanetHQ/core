import { zodToJsonSchema } from "zod-to-json-schema";

import * as user from "./user-tools";
import * as workspace from "./workspace-tools";
import * as collection from "./collection-tools";
import * as environment from "./environment-tools";
import * as apiTools from "./api-tools";
import * as monitor from "./monitor-tools";
import * as mock from "./mock-tools";

interface ToolDef {
  name: string;
  description: string;
  schema: any;
  handler: (args: any, apiKey: string) => Promise<any>;
}

const TOOLS: ToolDef[] = [
  {
    name: "get_me",
    description: "Return the authenticated Postman user (id, username, email, fullName, teamId).",
    schema: user.GetMeSchema,
    handler: user.getMe,
  },
  {
    name: "list_workspaces",
    description: "List every Postman workspace the authenticated user can access.",
    schema: workspace.ListWorkspacesSchema,
    handler: workspace.listWorkspaces,
  },
  {
    name: "get_workspace",
    description:
      "Get one Postman workspace by id, including its collections, environments, mocks, monitors, and apis.",
    schema: workspace.GetWorkspaceSchema,
    handler: workspace.getWorkspace,
  },
  {
    name: "list_collections",
    description: "List every Postman collection accessible to the user. Optional workspace filter.",
    schema: collection.ListCollectionsSchema,
    handler: collection.listCollections,
  },
  {
    name: "get_collection",
    description: "Get one Postman collection by uid, including requests and folder structure.",
    schema: collection.GetCollectionSchema,
    handler: collection.getCollection,
  },
  {
    name: "list_environments",
    description: "List Postman environments. Optional workspace filter.",
    schema: environment.ListEnvironmentsSchema,
    handler: environment.listEnvironments,
  },
  {
    name: "get_environment",
    description: "Get a Postman environment by uid, including its variables.",
    schema: environment.GetEnvironmentSchema,
    handler: environment.getEnvironment,
  },
  {
    name: "list_apis",
    description: "List Postman APIs visible to the user. Optional workspace filter.",
    schema: apiTools.ListApisSchema,
    handler: apiTools.listApis,
  },
  {
    name: "get_api",
    description: "Get one Postman API by id, including summary and description.",
    schema: apiTools.GetApiSchema,
    handler: apiTools.getApi,
  },
  {
    name: "list_api_versions",
    description: "List the version history of a Postman API by id.",
    schema: apiTools.ListApiVersionsSchema,
    handler: apiTools.listApiVersions,
  },
  {
    name: "list_monitors",
    description: "List Postman monitors. Optional workspace filter.",
    schema: monitor.ListMonitorsSchema,
    handler: monitor.listMonitors,
  },
  {
    name: "get_monitor",
    description: "Get one Postman monitor by uid, including schedule and last-run summary.",
    schema: monitor.GetMonitorSchema,
    handler: monitor.getMonitor,
  },
  {
    name: "list_mocks",
    description: "List Postman mock servers. Optional workspace filter.",
    schema: mock.ListMocksSchema,
    handler: mock.listMocks,
  },
  {
    name: "get_mock",
    description: "Get one Postman mock server by uid, including its public URL and config.",
    schema: mock.GetMockSchema,
    handler: mock.getMock,
  },
];

export async function getTools(_config: Record<string, string>) {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.schema),
  }));
}

export async function callTool(name: string, args: any, config: Record<string, any>) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown Postman tool: ${name}` }],
      isError: true,
    };
  }

  const apiKey = config?.api_key;
  if (!apiKey) {
    return {
      content: [{ type: "text", text: "Postman is not authenticated (no api_key in config)." }],
      isError: true,
    };
  }

  const parsed = tool.schema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid arguments for ${name}: ${parsed.error.message}` }],
      isError: true,
    };
  }

  try {
    return await tool.handler(parsed.data, apiKey);
  } catch (err: any) {
    return {
      content: [{ type: "text", text: `${name} failed: ${err.message}` }],
      isError: true,
    };
  }
}

"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  run: () => run
});
module.exports = __toCommonJS(index_exports);

// src/account-create.ts
var import_axios = __toESM(require("axios"), 1);
async function integrationCreate(data) {
  const { api_key } = data;
  const response = await import_axios.default.get("https://api.attio.com/v2/workspace_members/me", {
    headers: {
      Authorization: `Bearer ${api_key}`,
      "Content-Type": "application/json"
    }
  });
  const member = response.data?.data;
  const workspaceId = member?.id?.workspace_member_id || "attio";
  const email = member?.email_address || "";
  const name = [member?.first_name, member?.last_name].filter(Boolean).join(" ") || "Attio User";
  return [
    {
      type: "account",
      data: {
        settings: {
          name,
          email
        },
        accountId: `attio-${workspaceId}`,
        config: { api_key }
      }
    }
  ];
}

// src/schedule.ts
var import_axios2 = __toESM(require("axios"), 1);
function createActivityMessage(params) {
  return {
    type: "activity",
    data: {
      text: params.text,
      sourceURL: params.sourceURL
    }
  };
}
function getDefaultSyncTime() {
  return new Date(Date.now() - 24 * 60 * 60 * 1e3).toISOString();
}
async function fetchRecentRecords(apiKey, objectSlug, lastSyncTime) {
  try {
    const response = await import_axios2.default.post(
      `https://api.attio.com/v2/objects/${objectSlug}/records/query`,
      {
        filter: {
          updated_at: {
            $gte: lastSyncTime
          }
        },
        limit: 50,
        sorts: [{ attribute: "updated_at", direction: "desc" }]
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        }
      }
    );
    return response.data?.data || [];
  } catch (_error) {
    return [];
  }
}
async function fetchRecentNotes(apiKey, lastSyncTime) {
  try {
    const response = await import_axios2.default.get("https://api.attio.com/v2/notes", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      params: {
        limit: 50,
        sort: "created_at:desc"
      }
    });
    const notes = response.data?.data || [];
    return notes.filter(
      (note) => note.created_at && new Date(note.created_at) >= new Date(lastSyncTime)
    );
  } catch (_error) {
    return [];
  }
}
async function processPeopleActivities(apiKey, lastSyncTime) {
  const activities = [];
  const records = await fetchRecentRecords(apiKey, "people", lastSyncTime);
  for (const record of records) {
    try {
      const name = record.values?.name?.[0]?.full_name || record.values?.name?.[0]?.first_name || record.id?.record_id || "Unknown Person";
      const email = record.values?.email_addresses?.[0]?.email_address || "";
      const recordId = record.id?.record_id;
      const sourceURL = `https://app.attio.com/people/${recordId}`;
      const text = `Contact updated: ${name}${email ? ` (${email})` : ""}`;
      activities.push(createActivityMessage({ text, sourceURL }));
    } catch (_error) {
    }
  }
  return activities;
}
async function processCompanyActivities(apiKey, lastSyncTime) {
  const activities = [];
  const records = await fetchRecentRecords(apiKey, "companies", lastSyncTime);
  for (const record of records) {
    try {
      const name = record.values?.name?.[0]?.value || record.id?.record_id || "Unknown Company";
      const recordId = record.id?.record_id;
      const sourceURL = `https://app.attio.com/companies/${recordId}`;
      const text = `Company updated: ${name}`;
      activities.push(createActivityMessage({ text, sourceURL }));
    } catch (_error) {
    }
  }
  return activities;
}
async function processNoteActivities(apiKey, lastSyncTime) {
  const activities = [];
  const notes = await fetchRecentNotes(apiKey, lastSyncTime);
  for (const note of notes) {
    try {
      const title = note.title || "Untitled Note";
      const noteId = note.id?.note_id;
      const parentObjectSlug = note.parent_object;
      const parentRecordId = note.parent_record_id?.record_id;
      const sourceURL = parentObjectSlug && parentRecordId ? `https://app.attio.com/${parentObjectSlug}/${parentRecordId}` : `https://app.attio.com/notes/${noteId}`;
      const text = `Note created: ${title}`;
      activities.push(createActivityMessage({ text, sourceURL }));
    } catch (_error) {
    }
  }
  return activities;
}
async function handleSchedule(config, state) {
  try {
    if (!config?.api_key) {
      return [];
    }
    const settings = state || {};
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();
    const apiKey = config.api_key;
    const messages = [];
    try {
      const personActivities = await processPeopleActivities(apiKey, lastSyncTime);
      messages.push(...personActivities);
    } catch (_error) {
    }
    try {
      const companyActivities = await processCompanyActivities(apiKey, lastSyncTime);
      messages.push(...companyActivities);
    } catch (_error) {
    }
    try {
      const noteActivities = await processNoteActivities(apiKey, lastSyncTime);
      messages.push(...noteActivities);
    } catch (_error) {
    }
    const newSyncTime = (/* @__PURE__ */ new Date()).toISOString();
    messages.push({
      type: "state",
      data: {
        ...settings,
        lastSyncTime: newSyncTime
      }
    });
    return messages;
  } catch (_error) {
    return [];
  }
}

// src/mcp/index.ts
var import_axios3 = __toESM(require("axios"), 1);
var import_zod = require("zod");
var import_zod_to_json_schema = require("zod-to-json-schema");
var attioClient;
function initializeClient(apiKey) {
  attioClient = import_axios3.default.create({
    baseURL: "https://api.attio.com/v2",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  });
}
var CreatePersonSchema = import_zod.z.object({
  name: import_zod.z.string().describe("Full name of the person"),
  email_addresses: import_zod.z.array(import_zod.z.string().email()).optional().describe("List of email addresses"),
  phone_numbers: import_zod.z.array(import_zod.z.string()).optional().describe("List of phone numbers"),
  job_title: import_zod.z.string().optional().describe("Job title"),
  company_name: import_zod.z.string().optional().describe("Company name"),
  description: import_zod.z.string().optional().describe("Description or notes about the person")
});
var GetPersonSchema = import_zod.z.object({
  record_id: import_zod.z.string().describe("ID of the person record to retrieve")
});
var UpdatePersonSchema = import_zod.z.object({
  record_id: import_zod.z.string().describe("ID of the person record to update"),
  name: import_zod.z.string().optional().describe("Full name of the person"),
  email_addresses: import_zod.z.array(import_zod.z.string().email()).optional().describe("List of email addresses"),
  phone_numbers: import_zod.z.array(import_zod.z.string()).optional().describe("List of phone numbers"),
  job_title: import_zod.z.string().optional().describe("Job title"),
  description: import_zod.z.string().optional().describe("Description or notes about the person")
});
var SearchPeopleSchema = import_zod.z.object({
  query: import_zod.z.string().describe("Search query to find people by name, email, etc."),
  limit: import_zod.z.number().optional().default(20).describe("Maximum number of results to return")
});
var DeletePersonSchema = import_zod.z.object({
  record_id: import_zod.z.string().describe("ID of the person record to delete")
});
var CreateCompanySchema = import_zod.z.object({
  name: import_zod.z.string().describe("Company name"),
  domains: import_zod.z.array(import_zod.z.string()).optional().describe("List of company domains (e.g. example.com)"),
  description: import_zod.z.string().optional().describe("Description of the company"),
  industry: import_zod.z.string().optional().describe("Industry the company operates in"),
  employee_count: import_zod.z.number().optional().describe("Number of employees")
});
var GetCompanySchema = import_zod.z.object({
  record_id: import_zod.z.string().describe("ID of the company record to retrieve")
});
var UpdateCompanySchema = import_zod.z.object({
  record_id: import_zod.z.string().describe("ID of the company record to update"),
  name: import_zod.z.string().optional().describe("Company name"),
  domains: import_zod.z.array(import_zod.z.string()).optional().describe("List of company domains"),
  description: import_zod.z.string().optional().describe("Description of the company"),
  industry: import_zod.z.string().optional().describe("Industry"),
  employee_count: import_zod.z.number().optional().describe("Number of employees")
});
var SearchCompaniesSchema = import_zod.z.object({
  query: import_zod.z.string().describe("Search query to find companies by name, domain, etc."),
  limit: import_zod.z.number().optional().default(20).describe("Maximum number of results to return")
});
var DeleteCompanySchema = import_zod.z.object({
  record_id: import_zod.z.string().describe("ID of the company record to delete")
});
var CreateNoteSchema = import_zod.z.object({
  parent_object: import_zod.z.enum(["people", "companies"]).describe("Object type to attach the note to (people or companies)"),
  parent_record_id: import_zod.z.string().describe("ID of the record to attach the note to"),
  title: import_zod.z.string().describe("Title of the note"),
  content_plaintext: import_zod.z.string().describe("Plain text content of the note")
});
var GetNoteSchema = import_zod.z.object({
  note_id: import_zod.z.string().describe("ID of the note to retrieve")
});
var DeleteNoteSchema = import_zod.z.object({
  note_id: import_zod.z.string().describe("ID of the note to delete")
});
var ListNotesSchema = import_zod.z.object({
  parent_object: import_zod.z.enum(["people", "companies"]).optional().describe("Filter notes by parent object type"),
  parent_record_id: import_zod.z.string().optional().describe("Filter notes by parent record ID"),
  limit: import_zod.z.number().optional().default(20).describe("Maximum number of notes to return")
});
var CreateTaskSchema = import_zod.z.object({
  content: import_zod.z.string().describe("Content/description of the task"),
  deadline_at: import_zod.z.string().optional().describe("Deadline for the task in ISO 8601 format"),
  is_completed: import_zod.z.boolean().optional().default(false).describe("Whether the task is completed"),
  linked_record_ids: import_zod.z.array(
    import_zod.z.object({
      target_object: import_zod.z.enum(["people", "companies"]),
      target_record_id: import_zod.z.string()
    })
  ).optional().describe("Records to link this task to")
});
var GetTaskSchema = import_zod.z.object({
  task_id: import_zod.z.string().describe("ID of the task to retrieve")
});
var UpdateTaskSchema = import_zod.z.object({
  task_id: import_zod.z.string().describe("ID of the task to update"),
  content: import_zod.z.string().optional().describe("Content/description of the task"),
  deadline_at: import_zod.z.string().optional().describe("Deadline for the task in ISO 8601 format"),
  is_completed: import_zod.z.boolean().optional().describe("Whether the task is completed")
});
var DeleteTaskSchema = import_zod.z.object({
  task_id: import_zod.z.string().describe("ID of the task to delete")
});
var ListTasksSchema = import_zod.z.object({
  is_completed: import_zod.z.boolean().optional().describe("Filter by completion status"),
  limit: import_zod.z.number().optional().default(20).describe("Maximum number of tasks to return")
});
var ListListsSchema = import_zod.z.object({
  limit: import_zod.z.number().optional().default(20).describe("Maximum number of lists to return")
});
var GetListSchema = import_zod.z.object({
  list_id: import_zod.z.string().describe("ID of the list to retrieve")
});
var ListEntriesSchema = import_zod.z.object({
  list_id: import_zod.z.string().describe("ID of the list to get entries from"),
  limit: import_zod.z.number().optional().default(20).describe("Maximum number of entries to return")
});
async function getTools() {
  return [
    // People tools
    {
      name: "create_person",
      description: "Creates a new person (contact) record in Attio CRM",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(CreatePersonSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    {
      name: "get_person",
      description: "Retrieves a person (contact) record by ID from Attio CRM",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(GetPersonSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    {
      name: "update_person",
      description: "Updates an existing person (contact) record in Attio CRM",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(UpdatePersonSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    {
      name: "search_people",
      description: "Searches for people (contacts) in Attio CRM by name, email, or other attributes",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(SearchPeopleSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    {
      name: "delete_person",
      description: "Deletes a person (contact) record from Attio CRM",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(DeletePersonSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
    },
    // Company tools
    {
      name: "create_company",
      description: "Creates a new company record in Attio CRM",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(CreateCompanySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    {
      name: "get_company",
      description: "Retrieves a company record by ID from Attio CRM",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(GetCompanySchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    {
      name: "update_company",
      description: "Updates an existing company record in Attio CRM",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(UpdateCompanySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    {
      name: "search_companies",
      description: "Searches for companies in Attio CRM by name, domain, or other attributes",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(SearchCompaniesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    {
      name: "delete_company",
      description: "Deletes a company record from Attio CRM",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(DeleteCompanySchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
    },
    // Notes tools
    {
      name: "create_note",
      description: "Creates a note and attaches it to a person or company record in Attio",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(CreateNoteSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    {
      name: "get_note",
      description: "Retrieves a specific note by ID from Attio",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(GetNoteSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    {
      name: "list_notes",
      description: "Lists notes in Attio, optionally filtered by parent record",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(ListNotesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    {
      name: "delete_note",
      description: "Deletes a note from Attio",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(DeleteNoteSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
    },
    // Tasks tools
    {
      name: "create_task",
      description: "Creates a new task in Attio CRM",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(CreateTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    {
      name: "get_task",
      description: "Retrieves a specific task by ID from Attio",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(GetTaskSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    {
      name: "update_task",
      description: "Updates an existing task in Attio (e.g., mark as completed)",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(UpdateTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    {
      name: "delete_task",
      description: "Deletes a task from Attio",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(DeleteTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
    },
    {
      name: "list_tasks",
      description: "Lists tasks in Attio, optionally filtered by completion status",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(ListTasksSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    // Lists tools
    {
      name: "list_lists",
      description: "Lists all lists (pipelines/views) in Attio",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(ListListsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    {
      name: "get_list",
      description: "Retrieves a specific list by ID from Attio",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(GetListSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    {
      name: "list_entries",
      description: "Lists entries (records) within a specific Attio list",
      inputSchema: (0, import_zod_to_json_schema.zodToJsonSchema)(ListEntriesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    }
  ];
}
async function callTool(name, args, apiKey) {
  initializeClient(apiKey);
  try {
    switch (name) {
      // ---- People operations ----
      case "create_person": {
        const validated = CreatePersonSchema.parse(args);
        const values = {};
        if (validated.name) {
          const parts = validated.name.trim().split(/\s+/);
          values["name"] = [
            {
              first_name: parts[0] || "",
              last_name: parts.slice(1).join(" ") || ""
            }
          ];
        }
        if (validated.email_addresses?.length) {
          values["email_addresses"] = validated.email_addresses.map((e) => ({
            email_address: e
          }));
        }
        if (validated.phone_numbers?.length) {
          values["phone_numbers"] = validated.phone_numbers.map((p) => ({
            phone_number: p
          }));
        }
        if (validated.job_title) values["job_title"] = [{ value: validated.job_title }];
        if (validated.company_name) values["company_name"] = [{ value: validated.company_name }];
        if (validated.description) values["description"] = [{ value: validated.description }];
        const response = await attioClient.post("/objects/people/records", { data: { values } });
        const record = response.data?.data;
        return {
          content: [
            {
              type: "text",
              text: `Person created successfully:
ID: ${record?.id?.record_id}
Name: ${validated.name}`
            }
          ]
        };
      }
      case "get_person": {
        const validated = GetPersonSchema.parse(args);
        const response = await attioClient.get(
          `/objects/people/records/${validated.record_id}`
        );
        const record = response.data?.data;
        return {
          content: [
            {
              type: "text",
              text: `Person details:
ID: ${record?.id?.record_id}
${JSON.stringify(record?.values, null, 2)}`
            }
          ]
        };
      }
      case "update_person": {
        const validated = UpdatePersonSchema.parse(args);
        const { record_id, ...fields } = validated;
        const values = {};
        if (fields.name) {
          const parts = fields.name.trim().split(/\s+/);
          values["name"] = [
            { first_name: parts[0] || "", last_name: parts.slice(1).join(" ") || "" }
          ];
        }
        if (fields.email_addresses?.length) {
          values["email_addresses"] = fields.email_addresses.map((e) => ({
            email_address: e
          }));
        }
        if (fields.phone_numbers?.length) {
          values["phone_numbers"] = fields.phone_numbers.map((p) => ({ phone_number: p }));
        }
        if (fields.job_title) values["job_title"] = [{ value: fields.job_title }];
        if (fields.description) values["description"] = [{ value: fields.description }];
        const response = await attioClient.patch(
          `/objects/people/records/${record_id}`,
          { data: { values } }
        );
        const record = response.data?.data;
        return {
          content: [
            {
              type: "text",
              text: `Person updated successfully:
ID: ${record?.id?.record_id}`
            }
          ]
        };
      }
      case "search_people": {
        const validated = SearchPeopleSchema.parse(args);
        const response = await attioClient.post("/objects/people/records/query", {
          filter: {
            name: { $contains: validated.query }
          },
          limit: validated.limit
        });
        const records = response.data?.data || [];
        const results = records.map((r) => {
          const id = r.id?.record_id;
          const values = r.values;
          const firstName = values?.name?.[0]?.first_name || "";
          const lastName = values?.name?.[0]?.last_name || "";
          const email = values?.email_addresses?.[0]?.email_address || "N/A";
          return `ID: ${id}
Name: ${firstName} ${lastName}
Email: ${email}`;
        }).join("\n\n");
        return {
          content: [
            {
              type: "text",
              text: `Found ${records.length} people:

${results}`
            }
          ]
        };
      }
      case "delete_person": {
        const validated = DeletePersonSchema.parse(args);
        await attioClient.delete(`/objects/people/records/${validated.record_id}`);
        return {
          content: [
            {
              type: "text",
              text: `Person ${validated.record_id} deleted successfully`
            }
          ]
        };
      }
      // ---- Company operations ----
      case "create_company": {
        const validated = CreateCompanySchema.parse(args);
        const values = {};
        values["name"] = [{ value: validated.name }];
        if (validated.domains?.length) {
          values["domains"] = validated.domains.map((d) => ({ domain: d }));
        }
        if (validated.description) values["description"] = [{ value: validated.description }];
        if (validated.industry) values["industry"] = [{ value: validated.industry }];
        if (validated.employee_count !== void 0) {
          values["employee_count"] = [{ value: validated.employee_count }];
        }
        const response = await attioClient.post("/objects/companies/records", {
          data: { values }
        });
        const record = response.data?.data;
        return {
          content: [
            {
              type: "text",
              text: `Company created successfully:
ID: ${record?.id?.record_id}
Name: ${validated.name}`
            }
          ]
        };
      }
      case "get_company": {
        const validated = GetCompanySchema.parse(args);
        const response = await attioClient.get(
          `/objects/companies/records/${validated.record_id}`
        );
        const record = response.data?.data;
        return {
          content: [
            {
              type: "text",
              text: `Company details:
ID: ${record?.id?.record_id}
${JSON.stringify(record?.values, null, 2)}`
            }
          ]
        };
      }
      case "update_company": {
        const validated = UpdateCompanySchema.parse(args);
        const { record_id, ...fields } = validated;
        const values = {};
        if (fields.name) values["name"] = [{ value: fields.name }];
        if (fields.domains?.length) {
          values["domains"] = fields.domains.map((d) => ({ domain: d }));
        }
        if (fields.description) values["description"] = [{ value: fields.description }];
        if (fields.industry) values["industry"] = [{ value: fields.industry }];
        if (fields.employee_count !== void 0) {
          values["employee_count"] = [{ value: fields.employee_count }];
        }
        const response = await attioClient.patch(
          `/objects/companies/records/${record_id}`,
          { data: { values } }
        );
        const record = response.data?.data;
        return {
          content: [
            {
              type: "text",
              text: `Company updated successfully:
ID: ${record?.id?.record_id}`
            }
          ]
        };
      }
      case "search_companies": {
        const validated = SearchCompaniesSchema.parse(args);
        const response = await attioClient.post("/objects/companies/records/query", {
          filter: {
            name: { $contains: validated.query }
          },
          limit: validated.limit
        });
        const records = response.data?.data || [];
        const results = records.map((r) => {
          const id = r.id?.record_id;
          const values = r.values;
          const name2 = values?.name?.[0]?.value || "N/A";
          const domain = values?.domains?.[0]?.domain || "N/A";
          return `ID: ${id}
Name: ${name2}
Domain: ${domain}`;
        }).join("\n\n");
        return {
          content: [
            {
              type: "text",
              text: `Found ${records.length} companies:

${results}`
            }
          ]
        };
      }
      case "delete_company": {
        const validated = DeleteCompanySchema.parse(args);
        await attioClient.delete(`/objects/companies/records/${validated.record_id}`);
        return {
          content: [
            {
              type: "text",
              text: `Company ${validated.record_id} deleted successfully`
            }
          ]
        };
      }
      // ---- Notes operations ----
      case "create_note": {
        const validated = CreateNoteSchema.parse(args);
        const response = await attioClient.post("/notes", {
          data: {
            parent_object: validated.parent_object,
            parent_record_id: validated.parent_record_id,
            title: validated.title,
            content_plaintext: validated.content_plaintext
          }
        });
        const note = response.data?.data;
        return {
          content: [
            {
              type: "text",
              text: `Note created successfully:
ID: ${note?.id?.note_id}
Title: ${validated.title}`
            }
          ]
        };
      }
      case "get_note": {
        const validated = GetNoteSchema.parse(args);
        const response = await attioClient.get(`/notes/${validated.note_id}`);
        const note = response.data?.data;
        return {
          content: [
            {
              type: "text",
              text: `Note details:
ID: ${note?.id?.note_id}
Title: ${note?.title}
Content: ${note?.content_plaintext}`
            }
          ]
        };
      }
      case "list_notes": {
        const validated = ListNotesSchema.parse(args);
        const params = { limit: validated.limit };
        if (validated.parent_object) params["parent_object"] = validated.parent_object;
        if (validated.parent_record_id) params["parent_record_id"] = validated.parent_record_id;
        const response = await attioClient.get("/notes", { params });
        const notes = response.data?.data || [];
        const results = notes.map(
          (n) => `ID: ${n.id?.note_id}
Title: ${n.title || "Untitled"}`
        ).join("\n\n");
        return {
          content: [
            {
              type: "text",
              text: `Found ${notes.length} notes:

${results}`
            }
          ]
        };
      }
      case "delete_note": {
        const validated = DeleteNoteSchema.parse(args);
        await attioClient.delete(`/notes/${validated.note_id}`);
        return {
          content: [
            {
              type: "text",
              text: `Note ${validated.note_id} deleted successfully`
            }
          ]
        };
      }
      // ---- Tasks operations ----
      case "create_task": {
        const validated = CreateTaskSchema.parse(args);
        const taskData = {
          content: validated.content,
          is_completed: validated.is_completed ?? false
        };
        if (validated.deadline_at) taskData["deadline_at"] = validated.deadline_at;
        if (validated.linked_record_ids?.length) {
          taskData["linked_records"] = validated.linked_record_ids.map((lr) => ({
            target_object: lr.target_object,
            target_record_id: lr.target_record_id
          }));
        }
        const response = await attioClient.post("/tasks", { data: taskData });
        const task = response.data?.data;
        return {
          content: [
            {
              type: "text",
              text: `Task created successfully:
ID: ${task?.id?.task_id}
Content: ${validated.content}`
            }
          ]
        };
      }
      case "get_task": {
        const validated = GetTaskSchema.parse(args);
        const response = await attioClient.get(`/tasks/${validated.task_id}`);
        const task = response.data?.data;
        return {
          content: [
            {
              type: "text",
              text: `Task details:
ID: ${task?.id?.task_id}
Content: ${task?.content}
Completed: ${task?.is_completed}
Deadline: ${task?.deadline_at || "None"}`
            }
          ]
        };
      }
      case "update_task": {
        const validated = UpdateTaskSchema.parse(args);
        const { task_id, ...fields } = validated;
        const taskData = {};
        if (fields.content !== void 0) taskData["content"] = fields.content;
        if (fields.is_completed !== void 0) taskData["is_completed"] = fields.is_completed;
        if (fields.deadline_at !== void 0) taskData["deadline_at"] = fields.deadline_at;
        const response = await attioClient.patch(`/tasks/${task_id}`, { data: taskData });
        const task = response.data?.data;
        return {
          content: [
            {
              type: "text",
              text: `Task updated successfully:
ID: ${task?.id?.task_id}
Completed: ${task?.is_completed}`
            }
          ]
        };
      }
      case "delete_task": {
        const validated = DeleteTaskSchema.parse(args);
        await attioClient.delete(`/tasks/${validated.task_id}`);
        return {
          content: [
            {
              type: "text",
              text: `Task ${validated.task_id} deleted successfully`
            }
          ]
        };
      }
      case "list_tasks": {
        const validated = ListTasksSchema.parse(args);
        const params = { limit: validated.limit };
        if (validated.is_completed !== void 0) params["is_completed"] = validated.is_completed;
        const response = await attioClient.get("/tasks", { params });
        const tasks = response.data?.data || [];
        const results = tasks.map(
          (t) => `ID: ${t.id?.task_id}
Content: ${t.content}
Completed: ${t.is_completed}`
        ).join("\n\n");
        return {
          content: [
            {
              type: "text",
              text: `Found ${tasks.length} tasks:

${results}`
            }
          ]
        };
      }
      // ---- Lists operations ----
      case "list_lists": {
        const validated = ListListsSchema.parse(args);
        const response = await attioClient.get("/lists", { params: { limit: validated.limit } });
        const lists = response.data?.data || [];
        const results = lists.map(
          (l) => `ID: ${l.id?.list_id}
Name: ${l.name}
Object: ${l.parent_object}`
        ).join("\n\n");
        return {
          content: [
            {
              type: "text",
              text: `Found ${lists.length} lists:

${results}`
            }
          ]
        };
      }
      case "get_list": {
        const validated = GetListSchema.parse(args);
        const response = await attioClient.get(`/lists/${validated.list_id}`);
        const list = response.data?.data;
        return {
          content: [
            {
              type: "text",
              text: `List details:
ID: ${list?.id?.list_id}
Name: ${list?.name}
Object: ${list?.parent_object}`
            }
          ]
        };
      }
      case "list_entries": {
        const validated = ListEntriesSchema.parse(args);
        const response = await attioClient.post(`/lists/${validated.list_id}/entries/query`, {
          limit: validated.limit
        });
        const entries = response.data?.data || [];
        const results = entries.map(
          (e) => `Entry ID: ${e.id?.entry_id}
Record: ${JSON.stringify(e.record_id)}`
        ).join("\n\n");
        return {
          content: [
            {
              type: "text",
              text: `Found ${entries.length} entries in list:

${results}`
            }
          ]
        };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const axiosError = error;
    const errorMessage = axiosError.response?.data?.message || axiosError.response?.data?.error || (error instanceof Error ? error.message : String(error));
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`
        }
      ]
    };
  }
}

// src/index.ts
var import_sdk = require("@redplanethq/sdk");
async function run(eventPayload) {
  switch (eventPayload.event) {
    case import_sdk.IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);
    case import_sdk.IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);
    case import_sdk.IntegrationEventType.GET_TOOLS: {
      const tools = await getTools();
      return tools;
    }
    case import_sdk.IntegrationEventType.CALL_TOOL: {
      const config = eventPayload.config;
      const { name, arguments: args } = eventPayload.eventBody;
      const result = await callTool(name, args, config?.api_key);
      return result;
    }
    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}
var AttioCLI = class extends import_sdk.IntegrationCLI {
  constructor() {
    super("attio", "1.0.0");
  }
  async handleEvent(eventPayload) {
    return await run(eventPayload);
  }
  async getSpec() {
    return {
      name: "Attio",
      key: "attio",
      description: "Connect your workspace to Attio CRM. Manage contacts, companies, notes, tasks, and lists to streamline your customer relationship management.",
      icon: "attio",
      schedule: {
        frequency: "*/15 * * * *"
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auth: {
        api_key: {
          fields: [
            {
              name: "api_key",
              label: "Attio API Key",
              placeholder: "your-attio-access-token",
              description: "Your Attio access token. Generate one from Attio Settings \u2192 API Keys."
            }
          ]
        }
      },
      mcp: {
        type: "cli"
      }
    };
  }
};
function main() {
  const attioCLI = new AttioCLI();
  attioCLI.parse();
}
main();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  run
});

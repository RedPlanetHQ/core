import { z } from "zod";

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

export const IngestInputSchema = z.object({
  episodeBody: z.string(),
  referenceTime: z.string(),
  metadata: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
  source: z.string(),
  labelIds: z.array(z.string()).optional(),
  sessionId: z.string().optional(),
  type: z
    .enum(["CONVERSATION", "DOCUMENT"])
    .default("CONVERSATION"),
  title: z.string().optional(),
});

export type IngestInput = z.infer<typeof IngestInputSchema>;

export const IngestResponseSchema = z.object({
  success: z.boolean(),
  id: z.string(),
});

export type IngestResponse = z.infer<typeof IngestResponseSchema>;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const SearchInputSchema = z.object({
  query: z.string(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  limit: z.number().optional(),
  structured: z.boolean().optional(),
  sortBy: z.enum(["relevance", "recency"]).optional(),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

export const SearchResponseSchema = z.record(z.unknown());

export type SearchResponse = z.infer<typeof SearchResponseSchema>;

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

export const MeResponseSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  persona: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
  phoneNumber: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

export type MeResponse = z.infer<typeof MeResponseSchema>;

// ---------------------------------------------------------------------------
// Get Integrations Connected
// ---------------------------------------------------------------------------

export const IntegrationAccountSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    slug: z.string().optional(),
  })
  .passthrough();

export const GetIntegrationsConnectedResponseSchema = z.object({
  accounts: z.array(IntegrationAccountSchema),
});

export type GetIntegrationsConnectedResponse = z.infer<
  typeof GetIntegrationsConnectedResponseSchema
>;

// ---------------------------------------------------------------------------
// Get Integration Actions
// ---------------------------------------------------------------------------

export const GetIntegrationActionsInputSchema = z.object({
  accountId: z.string(),
  query: z.string().optional(),
});

export type GetIntegrationActionsInput = z.infer<
  typeof GetIntegrationActionsInputSchema
>;

export const GetIntegrationActionsResponseSchema = z.object({
  actions: z.array(z.unknown()),
});

export type GetIntegrationActionsResponse = z.infer<
  typeof GetIntegrationActionsResponseSchema
>;

// ---------------------------------------------------------------------------
// Execute Integration Action
// ---------------------------------------------------------------------------

export const ExecuteIntegrationActionInputSchema = z.object({
  accountId: z.string(),
  action: z.string(),
  parameters: z.record(z.unknown()).optional(),
});

export type ExecuteIntegrationActionInput = z.infer<
  typeof ExecuteIntegrationActionInputSchema
>;

export const ExecuteIntegrationActionResponseSchema = z.object({
  result: z.unknown(),
});

export type ExecuteIntegrationActionResponse = z.infer<
  typeof ExecuteIntegrationActionResponseSchema
>;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const GetDocumentsInputSchema = z.object({
  page: z.number().optional(),
  limit: z.number().optional(),
  source: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  sessionId: z.string().optional(),
  label: z.string().optional(),
  cursor: z.string().optional(),
});

export type GetDocumentsInput = z.infer<typeof GetDocumentsInputSchema>;

export const DocumentSchema = z
  .object({
    id: z.string(),
    title: z.string().nullable().optional(),
    createdAt: z.string().optional(),
    sessionId: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
  })
  .passthrough();

export const GetDocumentsResponseSchema = z.object({
  documents: z.array(DocumentSchema),
  page: z.number(),
  limit: z.number(),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
  availableSources: z.array(
    z.object({ name: z.string(), slug: z.string() }),
  ),
  totalCount: z.number(),
});

export type GetDocumentsResponse = z.infer<
  typeof GetDocumentsResponseSchema
>;

export const GetDocumentInputSchema = z.object({
  documentId: z.string(),
});

export type GetDocumentInput = z.infer<typeof GetDocumentInputSchema>;

export const GetDocumentResponseSchema = z.object({
  document: DocumentSchema.nullable(),
});

export type GetDocumentResponse = z.infer<
  typeof GetDocumentResponseSchema
>;


// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export const GetSkillInputSchema = z.object({
  skillId: z.string(),
});

export type GetSkillInput = z.infer<typeof GetSkillInputSchema>;

export const GetSkillResponseSchema = z.object({
  skill: DocumentSchema.nullable(),
});

export type GetSkillResponse = z.infer<typeof GetSkillResponseSchema>;


// ---------------------------------------------------------------------------
// Gateways
// ---------------------------------------------------------------------------

export const GatewayAgentInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  baseUrl: z.string(),
  tools: z.array(z.string()),
  platform: z.string().nullable(),
  hostname: z.string().nullable(),
  status: z.enum(["CONNECTED", "DISCONNECTED"]),
});

export const RegisterGatewayRequestSchema = z.object({
  intent: z.literal("register"),
  baseUrl: z.string().url(),
  securityKey: z.string().min(10),
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(500).optional(),
});

export type RegisterGatewayRequest = z.infer<typeof RegisterGatewayRequestSchema>;

export const RegisterGatewayResponseSchema = z.object({
  gatewayId: z.string(),
});

export type RegisterGatewayResponse = z.infer<typeof RegisterGatewayResponseSchema>;

export type GatewayAgentInfo = z.infer<typeof GatewayAgentInfoSchema>;

export const GetGatewaysResponseSchema = z.object({
  gateways: z.array(GatewayAgentInfoSchema),
});

export type GetGatewaysResponse = z.infer<typeof GetGatewaysResponseSchema>;

// ---------------------------------------------------------------------------
// Auth – Authorization Code
// ---------------------------------------------------------------------------

export const AuthorizationCodeResponseSchema = z.object({
  authorizationCode: z.string(),
  url: z.string(),
});

export type AuthorizationCodeResponse = z.infer<
  typeof AuthorizationCodeResponseSchema
>;

// ---------------------------------------------------------------------------
// Auth – Token Exchange
// ---------------------------------------------------------------------------

export const TokenExchangeInputSchema = z.object({
  authorizationCode: z.string(),
});

export type TokenExchangeInput = z.infer<
  typeof TokenExchangeInputSchema
>;

export const TokenExchangeResponseSchema = z.object({
  token: z
    .object({
      token: z.string(),
      obfuscatedToken: z.string(),
    })
    .nullable(),
});

export type TokenExchangeResponse = z.infer<
  typeof TokenExchangeResponseSchema
>;

/**
 * Widget IR — declarative widget schema (v1).
 *
 * A widget is a small, reactive, sandboxed UI:
 *   state     — per-user reactive values, optionally persisted
 *   requests  — data sources (integration actions, AI calls, static)
 *   derived   — named computed expressions (mustache + filter pipeline)
 *   blocks    — render tree built from a closed primitive set
 *   actions   — named handlers wired to block events
 *
 * The IR is the contract. YAML/JSON are authoring surfaces. The agent emits
 * IR via the `create_widget` tool; the renderer interprets it.
 *
 * Conventions:
 *  - Expressions are mustache-style strings: `"{{path.to.value | filter:arg}}"`.
 *  - Requests/state/derived are referenced by id from blocks via `{{id.field}}`
 *    or `{{$state.id}}`, `{{$request.id}}`, `{{$derived.id}}`, `{{$config.id}}`.
 *  - Block types are a closed enum here; renderer must implement each.
 */

import { z } from "zod";

// ─── Primitives ──────────────────────────────────────────────────────────────

/** Identifier — kebab/snake/camel allowed, must start with letter, no spaces. */
export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_-]*$/,
    "id must start with a letter; only letters, digits, _ and - allowed",
  );

/** Mustache-templated string. Empty string is allowed. */
export const exprStringSchema = z.string();

/**
 * Any IR value — either a literal (string/number/bool/null) or a templated
 * string. We keep this loose at v1; the renderer evaluates mustache.
 */
export const valueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(valueSchema),
    z.record(z.string(), valueSchema),
  ]),
);

// ─── Config (user-set fields surfaced as a config form) ─────────────────────

export const configFieldSchema = z.object({
  id: idSchema,
  type: z.enum(["string", "number", "boolean", "select", "date"]),
  label: z.string(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  default: valueSchema.optional(),
  options: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .optional(),
});

// ─── State ───────────────────────────────────────────────────────────────────

export const stateDeclSchema = z.object({
  id: idSchema,
  type: z.enum(["string", "number", "boolean", "array", "object"]),
  /** Persist per-user (workspace-scoped). Default false (in-memory only). */
  persist: z.boolean().optional(),
  default: valueSchema.optional(),
});

// ─── Refresh / cache policies ───────────────────────────────────────────────

export const refreshPolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({ kind: z.literal("onMount") }),
  z.object({ kind: z.literal("onVisible") }),
  z.object({
    kind: z.literal("interval"),
    intervalMs: z.number().int().positive().min(1000),
  }),
]);

export const cachePolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("ttl"),
    ttlSeconds: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("cron"),
    cron: z.string(),
  }),
]);

// ─── Requests (data sources) ────────────────────────────────────────────────

const requestBase = {
  id: idSchema,
  refresh: refreshPolicySchema.optional(),
  cache: cachePolicySchema.optional(),
};

/** Static value — useful for test fixtures or seeded UI. */
export const requestStaticSchema = z.object({
  ...requestBase,
  type: z.literal("static"),
  value: valueSchema,
});

/** Calls an existing integration action, scoped to a connected account. */
export const requestIntegrationActionSchema = z.object({
  ...requestBase,
  type: z.literal("integration_action"),
  /** Integration slug, e.g. "github". The runtime resolves to the user's account. */
  integration: z.string().min(1),
  /** Action name within the integration (the agent looks it up beforehand). */
  action: z.string().min(1),
  /** Templated parameters — values can reference state/config/other requests. */
  params: z.record(z.string(), valueSchema).optional(),
});

/**
 * Spawns the Butler (core agent) loop with the given prompt and returns the
 * assistant's final text. Equivalent to messaging the Butler in chat — it has
 * its full toolset and runs in always-approved mode (no user confirmations).
 *
 * Use for any read/synthesize/aggregate flow where the answer is shaped by
 * runtime state (e.g. "today's important tasks", "summarize my open PRs").
 */
export const requestAiTextSchema = z.object({
  ...requestBase,
  type: z.literal("ai.text"),
  prompt: exprStringSchema,
  /** Optional: structured prompt inputs (preferred over interpolating into prompt). */
  inputs: z.record(z.string(), valueSchema).optional(),
  /** Max tokens for the response (defaults to a reasonable value at runtime). */
  maxTokens: z.number().int().positive().optional(),
});

/**
 * Same as `ai.text` (spawns the Butler loop) but instructs it to return JSON
 * matching the given schema. The runtime parses the assistant's final text
 * tolerantly (strips fences, extracts the largest balanced JSON span).
 */
export const requestAiStructuredSchema = z.object({
  ...requestBase,
  type: z.literal("ai.structured"),
  prompt: exprStringSchema,
  inputs: z.record(z.string(), valueSchema).optional(),
  /** JSON Schema describing the expected response shape. */
  schema: z.record(z.string(), z.unknown()),
  maxTokens: z.number().int().positive().optional(),
});

/**
 * Calls a CORE-internal mutation directly (no LLM, no agent loop). Reserved
 * for fire-and-forget mutations the IR knows how to call by name. Reads and
 * aggregates should go through `ai.text` / `ai.structured` instead — the
 * Butler will pick the right list/search tool itself.
 *
 * Action surface is a closed allowlist (see enum). Adding an action here is
 * an explicit decision — anything not on the list goes through the agent.
 */
export const requestInternalSchema = z.object({
  ...requestBase,
  type: z.literal("internal"),
  action: z.enum(["create_task", "delete_task", "unblock_task"]),
  params: z.record(z.string(), valueSchema).optional(),
});

export const requestSchema = z.discriminatedUnion("type", [
  requestStaticSchema,
  requestIntegrationActionSchema,
  requestAiTextSchema,
  requestAiStructuredSchema,
  requestInternalSchema,
]);

// ─── Derived ─────────────────────────────────────────────────────────────────

export const derivedSchema = z.object({
  id: idSchema,
  /**
   * Mustache-templated expression. Renderer evaluates against the merged
   * context (state, requests, derived, config). Filters via pipe syntax.
   */
  expr: exprStringSchema,
});

// ─── Action operations ──────────────────────────────────────────────────────

const opSetState = z.object({
  op: z.literal("setState"),
  state: idSchema,
  value: valueSchema,
});

const opMutateState = z.object({
  op: z.literal("mutateState"),
  state: idSchema,
  mutation: z.enum(["append", "prepend", "remove_where", "patch_where", "set"]),
  /** Optional predicate for *_where mutations (templated). */
  where: exprStringSchema.optional(),
  /** Value to append/prepend/set, or patch object for patch_where. */
  value: valueSchema.optional(),
});

const opRunRequest = z.object({
  op: z.literal("runRequest"),
  request: idSchema,
});

const opOpenModal = z.object({
  op: z.literal("openModal"),
  block: idSchema,
});

const opCloseModal = z.object({
  op: z.literal("closeModal"),
  block: idSchema,
});

export const actionOpSchema = z.discriminatedUnion("op", [
  opSetState,
  opMutateState,
  opRunRequest,
  opOpenModal,
  opCloseModal,
]);

export const actionSchema = z.object({
  id: idSchema,
  /** Optional human-readable description (helps agents reason). */
  description: z.string().optional(),
  /** Sequence of operations to perform. */
  do: z.array(actionOpSchema).min(1),
  /** Optional confirm prompt — UI must show before executing. */
  confirm: z.string().optional(),
});

// ─── Blocks (closed primitive set, v1) ──────────────────────────────────────

export const BLOCK_TYPES = [
  "Container",
  "Text",
  "Heading",
  "Markdown",
  "Badge",
  "Card",
  "Button",
  "Tabs",
  "List",
  "Table",
  "Form",
  "Modal",
  "EmptyState",
] as const;

const blockBase = {
  id: idSchema,
};

/**
 * Visual placement (v0). A small, opt-in vocabulary applied at block level:
 *
 *   align     — horizontal text alignment for prose-shaped blocks
 *               (Text/Heading/Markdown). Ignored on layout containers.
 *
 * Card variants (`Card.variant`) govern the chrome around the card itself,
 * not its children — see the `cardBlock` schema below.
 */
const alignSchema = z.enum(["left", "center", "right"]);

const containerBlock = z.object({
  ...blockBase,
  type: z.literal("Container"),
  layout: z.enum(["row", "column"]).default("column"),
  gap: z.number().int().min(0).max(64).optional(),
  /** Cross-axis alignment of children. */
  align: alignSchema.optional(),
  children: z.array(z.unknown()).default([]),
});

const textBlock = z.object({
  ...blockBase,
  type: z.literal("Text"),
  text: exprStringSchema,
  variant: z.enum(["default", "muted", "danger"]).optional(),
  align: alignSchema.optional(),
  /** Italic — useful for quotes, captions. */
  italic: z.boolean().optional(),
});

const headingBlock = z.object({
  ...blockBase,
  type: z.literal("Heading"),
  text: exprStringSchema,
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(2),
  align: alignSchema.optional(),
});

const markdownBlock = z.object({
  ...blockBase,
  type: z.literal("Markdown"),
  source: exprStringSchema,
  align: alignSchema.optional(),
  /** Italic — useful for quotes, captions. */
  italic: z.boolean().optional(),
});

const badgeBlock = z.object({
  ...blockBase,
  type: z.literal("Badge"),
  text: exprStringSchema,
  /** Color or color-expression (e.g. "{{priority | match:P0=red,P1=orange}}") */
  color: exprStringSchema.optional(),
});

const cardBlock = z.object({
  ...blockBase,
  type: z.literal("Card"),
  title: exprStringSchema.optional(),
  /**
   * Chrome variant.
   *   default  — neutral border + background (current behavior)
   *   muted    — gray-tinted background, no border (subtle filler card)
   *   outline  — border only, no fill (emphasis without weight)
   *   ghost    — no border, no fill (visual grouping only — for centered
   *              prose like a daily quote where chrome would clutter)
   */
  variant: z.enum(["default", "muted", "outline", "ghost"]).optional(),
  children: z.array(z.unknown()).default([]),
});

const buttonBlock = z.object({
  ...blockBase,
  type: z.literal("Button"),
  label: exprStringSchema,
  variant: z.enum(["primary", "secondary", "ghost", "danger"]).optional(),
  /** Action id to invoke on click. */
  onClick: idSchema.optional(),
  /** Inline arguments passed to the action via {{args.*}}. */
  args: z.record(z.string(), valueSchema).optional(),
  disabled: exprStringSchema.optional(),
});

const tabsBlock = z.object({
  ...blockBase,
  type: z.literal("Tabs"),
  /** State id holding the active tab value. */
  bind: idSchema,
  options: z.array(
    z.object({ label: z.string(), value: z.string() }),
  ).min(1),
});

const listBlock = z.object({
  ...blockBase,
  type: z.literal("List"),
  /** Reference to a request id, derived id, or templated expression resolving to an array. */
  data: exprStringSchema,
  /** Per-item template — values can reference {{item.*}} and {{index}}. */
  item: z.object({
    title: exprStringSchema,
    subtitle: exprStringSchema.optional(),
    badge: exprStringSchema.optional(),
    badgeColor: exprStringSchema.optional(),
    href: exprStringSchema.optional(),
    onClick: idSchema.optional(),
    args: z.record(z.string(), valueSchema).optional(),
  }),
  emptyText: exprStringSchema.optional(),
});

const tableBlock = z.object({
  ...blockBase,
  type: z.literal("Table"),
  data: exprStringSchema,
  columns: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        format: z.enum(["text", "date", "number", "badge"]).optional(),
      }),
    )
    .min(1),
  emptyText: exprStringSchema.optional(),
});

const formBlock = z.object({
  ...blockBase,
  type: z.literal("Form"),
  /**
   * Optional state id (object-typed) where field values are written through
   * on every change. When omitted, the renderer keeps form values in local
   * React state and dispatches them to onSubmit via `args` and `event`.
   *
   * Bind is recommended when other parts of the widget need to read the
   * draft values (e.g. a "Save" button that's disabled until valid). Skip
   * when the form is submit-only and the action handler reads values from
   * `{{args.fieldId}}`.
   */
  bind: idSchema.optional(),
  fields: z
    .array(
      z.object({
        id: idSchema,
        type: z.enum([
          "text",
          "textarea",
          "number",
          "boolean",
          "select",
          "date",
        ]),
        label: z.string(),
        placeholder: z.string().optional(),
        required: z.boolean().optional(),
        options: z
          .array(z.object({ label: z.string(), value: z.string() }))
          .optional(),
        /**
         * Optional initial value for the input. Evaluated when the form
         * mounts (or a bind state is empty). Typically used to pre-populate
         * with current state: `"{{$state.focusMinutes}}"`. Falls back to
         * empty if the expression resolves to undefined.
         */
        defaultValue: valueSchema.optional(),
      }),
    )
    .min(1),
  submitLabel: z.string().optional(),
  onSubmit: idSchema.optional(),
  onCancel: idSchema.optional(),
});

const modalBlock = z.object({
  ...blockBase,
  type: z.literal("Modal"),
  /** State id (boolean) controlling open/closed. */
  open: idSchema,
  title: exprStringSchema.optional(),
  children: z.array(z.unknown()).default([]),
});

const emptyStateBlock = z.object({
  ...blockBase,
  type: z.literal("EmptyState"),
  title: exprStringSchema,
  description: exprStringSchema.optional(),
  icon: z.string().optional(),
});

/**
 * The block schema is recursive (Container/Card/Modal can hold blocks). We use
 * z.lazy to allow children: Block[]. Children are typed in TS via the inferred
 * type below, but at runtime we recursively validate via parseBlock.
 */
export const blockSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion("type", [
    containerBlock,
    textBlock,
    headingBlock,
    markdownBlock,
    badgeBlock,
    cardBlock,
    buttonBlock,
    tabsBlock,
    listBlock,
    tableBlock,
    formBlock,
    modalBlock,
    emptyStateBlock,
  ]),
);

// ─── Top-level widget IR ────────────────────────────────────────────────────

export const widgetIRSchema = z.object({
  version: z.literal(1),
  id: idSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  config: z.array(configFieldSchema).optional(),
  state: z.array(stateDeclSchema).optional(),
  requests: z.array(requestSchema).optional(),
  derived: z.array(derivedSchema).optional(),
  blocks: z.array(blockSchema).min(1),
  actions: z.array(actionSchema).optional(),
});

export type WidgetIR = z.infer<typeof widgetIRSchema>;
export type ConfigField = z.infer<typeof configFieldSchema>;
export type StateDecl = z.infer<typeof stateDeclSchema>;
export type WidgetRequest = z.infer<typeof requestSchema>;
export type Derived = z.infer<typeof derivedSchema>;
export type WidgetAction = z.infer<typeof actionSchema>;
export type ActionOp = z.infer<typeof actionOpSchema>;
export type RefreshPolicy = z.infer<typeof refreshPolicySchema>;
export type CachePolicy = z.infer<typeof cachePolicySchema>;

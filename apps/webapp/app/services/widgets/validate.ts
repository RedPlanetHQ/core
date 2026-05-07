/**
 * Widget IR validator.
 *
 * Two layers of validation:
 *  1. Zod parse (shape + types) via `widgetIRSchema` from @core/types
 *  2. Cross-reference checks: action ops reference declared state, blocks
 *     reference declared requests/derived/state, ids are unique within their
 *     namespace, modal `open` bindings point at boolean state, etc.
 *
 * The agent's `create_widget` tool runs this before persisting; the renderer
 * may also re-validate on load to fail fast on stale rows.
 */

import { widgetIRSchema, type WidgetIR } from "@core/types";

export interface ValidationIssue {
  /** Dotted path to the offending node (e.g. "actions[0].do[1].state"). */
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; widget: WidgetIR }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Validate a candidate widget IR.
 * Returns the parsed widget on success, or an array of human-readable issues
 * suitable for surfacing to the agent so it can self-correct.
 */
export function validateWidget(input: unknown): ValidationResult {
  const parsed = widgetIRSchema.safeParse(input);
  if (!parsed.success) {
    const issues: ValidationIssue[] = parsed.error.issues.map((iss) => ({
      path: iss.path.length > 0 ? iss.path.join(".") : "(root)",
      message: iss.message,
    }));
    return { ok: false, issues };
  }

  const widget = parsed.data;
  const xrefIssues = crossReferenceCheck(widget);
  if (xrefIssues.length > 0) {
    return { ok: false, issues: xrefIssues };
  }

  return { ok: true, widget };
}

// ─── Cross-reference checks ─────────────────────────────────────────────────

function crossReferenceCheck(widget: WidgetIR): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const stateIds = new Set((widget.state ?? []).map((s) => s.id));
  const requestIds = new Set((widget.requests ?? []).map((r) => r.id));
  const derivedIds = new Set((widget.derived ?? []).map((d) => d.id));
  const actionIds = new Set((widget.actions ?? []).map((a) => a.id));
  const configIds = new Set((widget.config ?? []).map((c) => c.id));

  // Unique-within-namespace checks
  reportDuplicates(widget.state ?? [], "state", issues);
  reportDuplicates(widget.requests ?? [], "requests", issues);
  reportDuplicates(widget.derived ?? [], "derived", issues);
  reportDuplicates(widget.actions ?? [], "actions", issues);
  reportDuplicates(widget.config ?? [], "config", issues);

  // No id collisions across namespaces (templates use {{id}} or {{$ns.id}};
  // collisions create ambiguity).
  const allIds = new Map<string, string>();
  const recordId = (id: string, ns: string, idx: number) => {
    const prior = allIds.get(id);
    if (prior) {
      issues.push({
        path: `${ns}[${idx}].id`,
        message: `id "${id}" conflicts with existing id in ${prior}`,
      });
    } else {
      allIds.set(id, ns);
    }
  };
  (widget.state ?? []).forEach((s, i) => recordId(s.id, "state", i));
  (widget.requests ?? []).forEach((r, i) => recordId(r.id, "requests", i));
  (widget.derived ?? []).forEach((d, i) => recordId(d.id, "derived", i));
  (widget.actions ?? []).forEach((a, i) => recordId(a.id, "actions", i));
  (widget.config ?? []).forEach((c, i) => recordId(c.id, "config", i));

  // Action operation references must resolve to declared state / requests /
  // modal blocks.
  const modalBlockIds = collectModalBlockIds(widget);
  (widget.actions ?? []).forEach((a, ai) => {
    a.do.forEach((op, oi) => {
      const path = `actions[${ai}].do[${oi}]`;
      switch (op.op) {
        case "setState":
        case "mutateState":
          if (!stateIds.has(op.state)) {
            issues.push({
              path: `${path}.state`,
              message: `references unknown state "${op.state}"`,
            });
          }
          break;
        case "runRequest":
          if (!requestIds.has(op.request)) {
            issues.push({
              path: `${path}.request`,
              message: `references unknown request "${op.request}"`,
            });
          }
          break;
        case "openModal":
        case "closeModal":
          if (!modalBlockIds.has(op.block)) {
            issues.push({
              path: `${path}.block`,
              message: `references unknown Modal block "${op.block}"`,
            });
          }
          break;
      }
    });
  });

  // Block-level event references (onClick, onSubmit, etc.) must resolve to
  // declared actions. Modal `open` and Tabs `bind` and Form `bind` must
  // resolve to declared state ids.
  const blockIssues: ValidationIssue[] = [];
  walkBlocks(widget.blocks as unknown[], "blocks", (block, path) => {
    checkBlockRefs(block, path, {
      stateIds,
      actionIds,
      requestIds,
      derivedIds,
      configIds,
    }, blockIssues);
  });
  issues.push(...blockIssues);

  // Block ids must also be unique across the tree (modals are referenced by
  // id, plus uniqueness aids debuggability).
  const seenBlockIds = new Set<string>();
  walkBlocks(widget.blocks as unknown[], "blocks", (block, path) => {
    const id = (block as { id?: string }).id;
    if (id) {
      if (seenBlockIds.has(id)) {
        issues.push({
          path: `${path}.id`,
          message: `duplicate block id "${id}"`,
        });
      } else {
        seenBlockIds.add(id);
      }
    }
  });

  return issues;
}

function reportDuplicates(
  items: Array<{ id: string }>,
  namespace: string,
  out: ValidationIssue[],
) {
  const seen = new Map<string, number>();
  items.forEach((item, idx) => {
    const prior = seen.get(item.id);
    if (prior !== undefined) {
      out.push({
        path: `${namespace}[${idx}].id`,
        message: `duplicate id "${item.id}" (also at ${namespace}[${prior}])`,
      });
    } else {
      seen.set(item.id, idx);
    }
  });
}

function collectModalBlockIds(widget: WidgetIR): Set<string> {
  const out = new Set<string>();
  walkBlocks(widget.blocks as unknown[], "blocks", (block) => {
    if ((block as { type?: string }).type === "Modal") {
      const id = (block as { id?: string }).id;
      if (id) out.add(id);
    }
  });
  return out;
}

interface XrefSets {
  stateIds: Set<string>;
  actionIds: Set<string>;
  requestIds: Set<string>;
  derivedIds: Set<string>;
  configIds: Set<string>;
}

function checkBlockRefs(
  block: unknown,
  path: string,
  refs: XrefSets,
  out: ValidationIssue[],
) {
  if (typeof block !== "object" || block === null) return;
  const b = block as Record<string, unknown>;
  const type = b.type;

  // Action references on common interactive blocks.
  if (typeof b.onClick === "string" && !refs.actionIds.has(b.onClick)) {
    out.push({
      path: `${path}.onClick`,
      message: `references unknown action "${b.onClick}"`,
    });
  }
  if (typeof b.onSubmit === "string" && !refs.actionIds.has(b.onSubmit)) {
    out.push({
      path: `${path}.onSubmit`,
      message: `references unknown action "${b.onSubmit}"`,
    });
  }
  if (typeof b.onCancel === "string" && !refs.actionIds.has(b.onCancel)) {
    out.push({
      path: `${path}.onCancel`,
      message: `references unknown action "${b.onCancel}"`,
    });
  }

  // Modal: `open` must be a declared boolean state id.
  if (type === "Modal" && typeof b.open === "string" && !refs.stateIds.has(b.open)) {
    out.push({
      path: `${path}.open`,
      message: `Modal.open references unknown state "${b.open}"`,
    });
  }

  // Tabs: `bind` must be a declared state id.
  if (type === "Tabs" && typeof b.bind === "string" && !refs.stateIds.has(b.bind)) {
    out.push({
      path: `${path}.bind`,
      message: `Tabs.bind references unknown state "${b.bind}"`,
    });
  }

  // Form: `bind` is optional. When provided, must reference a declared
  // state id. When omitted, the form uses local state and dispatches values
  // via the onSubmit action's args/event.
  if (
    type === "Form" &&
    typeof b.bind === "string" &&
    b.bind.length > 0 &&
    !refs.stateIds.has(b.bind)
  ) {
    out.push({
      path: `${path}.bind`,
      message: `Form.bind references unknown state "${b.bind}"`,
    });
  }

  // List item onClick.
  if (type === "List" && typeof b.item === "object" && b.item) {
    const item = b.item as Record<string, unknown>;
    if (
      typeof item.onClick === "string" &&
      !refs.actionIds.has(item.onClick)
    ) {
      out.push({
        path: `${path}.item.onClick`,
        message: `List.item.onClick references unknown action "${item.onClick}"`,
      });
    }
  }
}

/**
 * Recursively walk the block tree, calling `visit` on every block.
 * Children live on Container/Card/Modal `children` arrays. Other blocks may
 * have nested config (List.item) but no nested *blocks*, so we don't recurse
 * into them.
 */
function walkBlocks(
  blocks: unknown[],
  parentPath: string,
  visit: (block: unknown, path: string) => void,
): void {
  blocks.forEach((block, idx) => {
    const path = `${parentPath}[${idx}]`;
    visit(block, path);
    if (typeof block !== "object" || block === null) return;
    const b = block as Record<string, unknown>;
    if (Array.isArray(b.children)) {
      walkBlocks(b.children, `${path}.children`, visit);
    }
  });
}

/**
 * Format a list of validation issues as a single human-readable string.
 * Used by the agent tool when surfacing failures back to the model.
 */
export function formatIssues(issues: ValidationIssue[]): string {
  if (issues.length === 0) return "";
  return issues
    .map((iss, i) => `  ${i + 1}. ${iss.path}: ${iss.message}`)
    .join("\n");
}

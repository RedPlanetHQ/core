/**
 * Block renderers — v0.
 *
 * One React component per block type in the closed primitive set:
 *   Container, Text, Heading, Markdown, Badge, Card, Button, Tabs,
 *   List, Table, Form, Modal, EmptyState
 *
 * Each component reads the runtime via `useEvaluate` for expression-bearing
 * fields, dispatches actions through `dispatchAction`, and pushes per-item
 * scope (item, index, args, event) via `<ScopeProvider>`.
 *
 * Styling follows the codebase's existing chat/widget conventions (border,
 * grayAlpha, muted-foreground tokens). Lucide icons for chrome.
 */

import { useCallback, useState } from "react";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";

import {
  ScopeProvider,
  useDispatch,
  useEvaluate,
  useRuntime,
  useSnapshot,
} from "../context";
import { cn } from "~/lib/utils";

// ─── Top-level block dispatch ───────────────────────────────────────────────

export function BlockRenderer({ block }: { block: unknown }) {
  if (!block || typeof block !== "object") return null;
  const b = block as { type: string };
  switch (b.type) {
    case "Container":
      return <ContainerBlock block={block as ContainerSpec} />;
    case "Text":
      return <TextBlock block={block as TextSpec} />;
    case "Heading":
      return <HeadingBlock block={block as HeadingSpec} />;
    case "Markdown":
      return <MarkdownBlock block={block as MarkdownSpec} />;
    case "Badge":
      return <BadgeBlock block={block as BadgeSpec} />;
    case "Card":
      return <CardBlock block={block as CardSpec} />;
    case "Button":
      return <ButtonBlock block={block as ButtonSpec} />;
    case "Tabs":
      return <TabsBlock block={block as TabsSpec} />;
    case "List":
      return <ListBlock block={block as ListSpec} />;
    case "Table":
      return <TableBlock block={block as TableSpec} />;
    case "Form":
      return <FormBlock block={block as FormSpec} />;
    case "Modal":
      return <ModalBlock block={block as ModalSpec} />;
    case "EmptyState":
      return <EmptyStateBlock block={block as EmptyStateSpec} />;
    default:
      return (
        <div className="rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          unknown block: {b.type}
        </div>
      );
  }
}

// ─── Container ──────────────────────────────────────────────────────────────

interface ContainerSpec {
  id: string;
  type: "Container";
  layout?: "row" | "column";
  gap?: number;
  children?: unknown[];
}

function ContainerBlock({ block }: { block: ContainerSpec }) {
  const layout = block.layout ?? "column";
  const gap = block.gap ?? 8;
  return (
    <div
      className={cn(
        "flex",
        layout === "row" ? "flex-row items-center" : "flex-col",
      )}
      style={{ gap }}
    >
      {(block.children ?? []).map((child, i) => (
        <BlockRenderer key={i} block={child} />
      ))}
    </div>
  );
}

// ─── Text / Heading / Markdown ──────────────────────────────────────────────

interface TextSpec {
  id: string;
  type: "Text";
  text: string;
  variant?: "default" | "muted" | "danger";
}

function TextBlock({ block }: { block: TextSpec }) {
  const text = useEvaluate(block.text) as string;
  const cls =
    block.variant === "muted"
      ? "text-muted-foreground"
      : block.variant === "danger"
        ? "text-destructive"
        : "text-foreground";
  return <p className={cn("text-sm", cls)}>{String(text ?? "")}</p>;
}

interface HeadingSpec {
  id: string;
  type: "Heading";
  text: string;
  level?: 1 | 2 | 3 | 4;
}

function HeadingBlock({ block }: { block: HeadingSpec }) {
  const text = useEvaluate(block.text) as string;
  const level = block.level ?? 2;
  const sizes = {
    1: "text-2xl",
    2: "text-xl",
    3: "text-lg",
    4: "text-base",
  };
  const Tag = (`h${level}`) as "h1" | "h2" | "h3" | "h4";
  return <Tag className={cn("font-medium", sizes[level])}>{String(text ?? "")}</Tag>;
}

interface MarkdownSpec {
  id: string;
  type: "Markdown";
  source: string;
}

function MarkdownBlock({ block }: { block: MarkdownSpec }) {
  const source = useEvaluate(block.source) as string;
  return (
    <div className="prose prose-sm max-w-none text-sm dark:prose-invert">
      <ReactMarkdown>{String(source ?? "")}</ReactMarkdown>
    </div>
  );
}

// ─── Badge ──────────────────────────────────────────────────────────────────

interface BadgeSpec {
  id: string;
  type: "Badge";
  text: string;
  color?: string;
}

const COLOR_CLASSES: Record<string, string> = {
  red: "bg-red-500/10 text-red-600 border-red-500/20",
  orange: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  yellow: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  green: "bg-green-500/10 text-green-600 border-green-500/20",
  blue: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  gray: "bg-grayAlpha-100 text-muted-foreground border-border",
};

function BadgeBlock({ block }: { block: BadgeSpec }) {
  const text = useEvaluate(block.text) as string;
  const color = (useEvaluate(block.color ?? "gray") as string) || "gray";
  const cls = COLOR_CLASSES[color] ?? COLOR_CLASSES.gray;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        cls,
      )}
    >
      {String(text ?? "")}
    </span>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

interface CardSpec {
  id: string;
  type: "Card";
  title?: string;
  children?: unknown[];
}

function CardBlock({ block }: { block: CardSpec }) {
  const title = useEvaluate(block.title) as string | undefined;
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      {title && (
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          {String(title ?? "")}
        </div>
      )}
      <div className="space-y-2">
        {(block.children ?? []).map((child, i) => (
          <BlockRenderer key={i} block={child} />
        ))}
      </div>
    </div>
  );
}

// ─── Button ─────────────────────────────────────────────────────────────────

interface ButtonSpec {
  id: string;
  type: "Button";
  label: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  onClick?: string;
  args?: Record<string, unknown>;
  disabled?: string;
}

const BUTTON_VARIANTS: Record<string, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "border border-border hover:bg-accent",
  ghost: "hover:bg-accent",
  danger:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90",
};

function ButtonBlock({ block }: { block: ButtonSpec }) {
  useSnapshot();
  const dispatch = useDispatch();

  const label = useEvaluate(block.label) as string;
  const disabled = block.disabled
    ? Boolean(useEvaluate(block.disabled))
    : false;
  const variant = block.variant ?? "secondary";

  return (
    <button
      type="button"
      onClick={() => dispatch(block.onClick, { args: block.args })}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center rounded px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_VARIANTS[variant] ?? BUTTON_VARIANTS.secondary,
      )}
    >
      {String(label ?? "")}
    </button>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

interface TabsSpec {
  id: string;
  type: "Tabs";
  bind: string;
  options: Array<{ label: string; value: string }>;
}

function TabsBlock({ block }: { block: TabsSpec }) {
  const { store } = useRuntime();
  const snap = useSnapshot();
  const current = String(snap.state[block.bind] ?? "");
  return (
    <div className="inline-flex rounded border border-border bg-grayAlpha-50 p-0.5">
      {block.options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => store.setState(block.bind, opt.value)}
          className={cn(
            "rounded px-2.5 py-1 text-xs transition-colors",
            current === opt.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── List ───────────────────────────────────────────────────────────────────

interface ListSpec {
  id: string;
  type: "List";
  data: string;
  item: {
    title: string;
    subtitle?: string;
    badge?: string;
    badgeColor?: string;
    href?: string;
    onClick?: string;
    args?: Record<string, unknown>;
  };
  emptyText?: string;
}

function ListBlock({ block }: { block: ListSpec }) {
  const data = useEvaluate(block.data);
  const empty = useEvaluate(block.emptyText) as string | undefined;
  const items = Array.isArray(data) ? data : [];

  if (items.length === 0) {
    return (
      <p className="py-2 text-xs text-muted-foreground">
        {empty || "Nothing here yet."}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border rounded border border-border">
      {items.map((item, idx) => (
        <ScopeProvider key={idx} extra={{ item, index: idx }}>
          <ListRow itemSpec={block.item} />
        </ScopeProvider>
      ))}
    </ul>
  );
}

function ListRow({ itemSpec }: { itemSpec: ListSpec["item"] }) {
  const dispatch = useDispatch();
  const title = useEvaluate(itemSpec.title) as string;
  const subtitle = useEvaluate(itemSpec.subtitle) as string | undefined;
  const badge = useEvaluate(itemSpec.badge) as string | undefined;
  const badgeColor = useEvaluate(itemSpec.badgeColor ?? "gray") as string;
  const href = useEvaluate(itemSpec.href) as string | undefined;

  const handleClick = () => dispatch(itemSpec.onClick, { args: itemSpec.args });

  const interactive = Boolean(itemSpec.onClick || href);
  const Wrap = href ? "a" : "div";
  const wrapProps: Record<string, unknown> = href
    ? { href, target: "_blank", rel: "noreferrer" }
    : {};

  return (
    <li
      onClick={!href && itemSpec.onClick ? handleClick : undefined}
      className={cn(
        "px-3 py-2",
        interactive && "cursor-pointer hover:bg-accent/40",
      )}
    >
      <Wrap
        {...(wrapProps as Record<string, never>)}
        className="flex items-center justify-between gap-2"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{String(title ?? "")}</div>
          {subtitle && (
            <div className="truncate text-xs text-muted-foreground">
              {String(subtitle)}
            </div>
          )}
        </div>
        {badge && (
          <span
            className={cn(
              "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase",
              COLOR_CLASSES[badgeColor] ?? COLOR_CLASSES.gray,
            )}
          >
            {String(badge)}
          </span>
        )}
      </Wrap>
    </li>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────────

interface TableSpec {
  id: string;
  type: "Table";
  data: string;
  columns: Array<{
    key: string;
    label: string;
    format?: "text" | "date" | "number" | "badge";
  }>;
  emptyText?: string;
}

function TableBlock({ block }: { block: TableSpec }) {
  const data = useEvaluate(block.data);
  const empty = useEvaluate(block.emptyText) as string | undefined;
  const rows = Array.isArray(data) ? data : [];

  if (rows.length === 0) {
    return (
      <p className="py-2 text-xs text-muted-foreground">
        {empty || "No rows."}
      </p>
    );
  }

  return (
    <div className="overflow-auto rounded border border-border">
      <table className="w-full text-xs">
        <thead className="bg-grayAlpha-50">
          <tr>
            {block.columns.map((col) => (
              <th
                key={col.key}
                className="px-2 py-1.5 text-left font-medium text-muted-foreground"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="border-t border-border">
              {block.columns.map((col) => {
                const value = (row as Record<string, unknown>)?.[col.key];
                return (
                  <td key={col.key} className="px-2 py-1.5">
                    {formatCell(value, col.format)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(
  value: unknown,
  format?: "text" | "date" | "number" | "badge",
): React.ReactNode {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  if (format === "date") {
    const d = value instanceof Date ? value : new Date(String(value));
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString();
  }
  if (format === "number") return Number(value).toLocaleString();
  if (format === "badge") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase",
          COLOR_CLASSES.gray,
        )}
      >
        {String(value)}
      </span>
    );
  }
  return String(value);
}

// ─── Form ───────────────────────────────────────────────────────────────────

interface FormSpec {
  id: string;
  type: "Form";
  bind: string;
  fields: Array<{
    id: string;
    type: "text" | "textarea" | "number" | "boolean" | "select" | "date";
    label: string;
    placeholder?: string;
    required?: boolean;
    options?: Array<{ label: string; value: string }>;
  }>;
  submitLabel?: string;
  onSubmit?: string;
  onCancel?: string;
}

function FormBlock({ block }: { block: FormSpec }) {
  const { store } = useRuntime();
  const snap = useSnapshot();
  const dispatch = useDispatch();
  const bound = (snap.state[block.bind] as Record<string, unknown>) ?? {};

  const updateField = (fieldId: string, value: unknown) => {
    const next = { ...bound, [fieldId]: value };
    store.setState(block.bind, next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    dispatch(block.onSubmit, { event: { values: bound, ...bound } });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {block.fields.map((field) => (
        <div key={field.id} className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            {field.label}
            {field.required && (
              <span className="ml-0.5 text-destructive">*</span>
            )}
          </label>
          {renderField(field, bound[field.id], (v) => updateField(field.id, v))}
        </div>
      ))}
      <div className="flex justify-end gap-2 pt-1">
        {block.onCancel && (
          <CancelButton actionId={block.onCancel} />
        )}
        <button
          type="submit"
          className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
        >
          {block.submitLabel ?? "Save"}
        </button>
      </div>
    </form>
  );
}

function CancelButton({ actionId }: { actionId: string }) {
  const dispatch = useDispatch();
  return (
    <button
      type="button"
      onClick={() => dispatch(actionId)}
      className="rounded border border-border px-3 py-1.5 text-xs hover:bg-accent"
    >
      Cancel
    </button>
  );
}

function renderField(
  field: FormSpec["fields"][number],
  value: unknown,
  onChange: (v: unknown) => void,
): React.ReactNode {
  switch (field.type) {
    case "textarea":
      return (
        <textarea
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          required={field.required}
          rows={3}
          className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      );
    case "number":
      return (
        <input
          type="number"
          value={value == null ? "" : Number(value)}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
          placeholder={field.placeholder}
          required={field.required}
          className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      );
    case "boolean":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4"
        />
      );
    case "select":
      return (
        <select
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Select…</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "date":
      return (
        <input
          type="date"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      );
    case "text":
    default:
      return (
        <input
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          required={field.required}
          className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      );
  }
}

// ─── Modal ──────────────────────────────────────────────────────────────────

interface ModalSpec {
  id: string;
  type: "Modal";
  open: string;
  title?: string;
  children?: unknown[];
}

function ModalBlock({ block }: { block: ModalSpec }) {
  const { store } = useRuntime();
  const snap = useSnapshot();

  // Truthy state value OR explicit modal open flag opens the modal.
  const stateVal = snap.state[block.open];
  const stateOpen =
    stateVal != null &&
    stateVal !== "" &&
    stateVal !== false &&
    !(Array.isArray(stateVal) && stateVal.length === 0);
  const flagOpen = snap.modals[block.id] === true;
  const explicitlyClosed = snap.modals[block.id] === false;
  const open = !explicitlyClosed && (stateOpen || flagOpen);

  // setModalOpen(_, false) handles clearing the bound state — see
  // WidgetStore.setModalOpen for the symmetry. No explicit clear needed.
  const close = useCallback(() => {
    store.setModalOpen(block.id, false);
  }, [store, block.id]);

  const title = useEvaluate(block.title) as string | undefined;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[80vh] w-full max-w-md overflow-auto rounded-lg border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium">{String(title ?? "")}</span>
          <button
            type="button"
            onClick={close}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2 p-3">
          {(block.children ?? []).map((child, i) => (
            <BlockRenderer key={i} block={child} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── EmptyState ─────────────────────────────────────────────────────────────

interface EmptyStateSpec {
  id: string;
  type: "EmptyState";
  title: string;
  description?: string;
  icon?: string;
}

function EmptyStateBlock({ block }: { block: EmptyStateSpec }) {
  const title = useEvaluate(block.title) as string;
  const description = useEvaluate(block.description) as string | undefined;
  return (
    <div className="rounded-lg border border-dashed border-border bg-grayAlpha-50 p-4 text-center">
      <p className="text-sm font-medium">{String(title ?? "")}</p>
      {description && (
        <p className="mt-1 text-xs text-muted-foreground">
          {String(description)}
        </p>
      )}
    </div>
  );
}

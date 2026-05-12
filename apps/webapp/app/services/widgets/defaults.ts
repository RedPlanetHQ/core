/**
 * Default widget IRs — the in-memory template catalog.
 *
 * Templates are NOT persisted as DB rows. They live here as literal IR
 * objects. The settings page reads `DEFAULT_WIDGETS` to render the
 * "Available templates" list; clicking [Install] runs `installTemplate`
 * (in widget.server.ts) which validates the IR and writes a USER row.
 *
 * Bumping `seedVersion` no longer auto-updates anyone's installed copy —
 * once installed, a widget is the user's. (If we want template updates to
 * propagate, that's a separate "upgrade" UX.)
 */

import type { WidgetIR } from "@core/types";

// ─── Default 1: Daily quote (AI text) ───────────────────────────────────────

const dailyQuote: WidgetIR = {
  version: 1,
  id: "daily-quote",
  title: "Daily quote",
  description: "A short daily quote refreshed each morning.",
  icon: "quote",
  config: [
    {
      id: "theme",
      type: "string",
      label: "Theme",
      placeholder: "engineering, stoicism, focus, …",
      default: "engineering",
    },
  ],
  requests: [
    {
      id: "quote",
      type: "ai.text",
      prompt:
        "Give me one short quote (max 30 words) about {{$config.theme}}. No author attribution. Just the quote text — no quotation marks, no preamble.",
      maxTokens: 80,
      cache: { kind: "cron", cron: "0 6 * * *" },
      refresh: { kind: "onMount" },
    },
  ],
  blocks: [
    {
      id: "card",
      type: "Card",
      // Ghost variant — no border, no fill. The quote is the focal point;
      // chrome here just clutters and competes with the dashboard's outer
      // widget frame.
      variant: "ghost",
      children: [
        {
          id: "text",
          type: "Markdown",
          source: "{{$request.quote}}",
          align: "center",
          italic: true,
        },
      ],
    },
  ],
};

// ─── Default 2: Important things (Butler-driven) ────────────────────────────
//
// `ai.structured` spawns the Butler loop — it has list_tasks/search_tasks/etc.
// and picks the right tool. The prompt directs it to read the user's actual
// task list and return the top items as JSON. No client-side filtering needed.
//
// Each item's `id` is a real task id, so the "Mark done" action wires straight
// through to `internal: delete_task` for a deterministic mutation. After the
// mutation, we force-refresh the list request so the row disappears.

const importantThings: WidgetIR = {
  version: 1,
  id: "important-things",
  title: "Today's important things",
  description:
    "Butler-curated list of the most important tasks for today, ranked by priority.",
  icon: "alert-triangle",
  requests: [
    {
      id: "items",
      type: "ai.structured",
      prompt:
        "Use list_tasks to read the user's current tasks (focus on Todo and Working). Return the top 5 most important ones for today, ranked by priority. Use real task ids — they will be used to mutate the tasks. Skip tasks that are already Done or Review.",
      schema: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "title", "priority", "why"],
          properties: {
            id: { type: "string", description: "Real task id from list_tasks" },
            title: { type: "string" },
            priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
            why: { type: "string", maxLength: 80 },
          },
        },
      },
      // 2-hour TTL aligned with the interval — a navigation back to the
      // dashboard within the window serves the cached list; the interval
      // ticks in-place and force-refreshes when the window expires. Butler
      // calls are LLM-priced, so we keep the floor generous.
      cache: { kind: "ttl", ttlSeconds: 7200 },
      refresh: { kind: "interval", intervalMs: 7_200_000 },
    },
    {
      id: "deleteTaskReq",
      type: "internal",
      action: "delete_task",
      params: { taskId: "{{args.id}}" },
      cache: { kind: "none" },
    },
  ],
  actions: [
    {
      id: "markDone",
      confirm: "Delete this task?",
      do: [
        { op: "runRequest", request: "deleteTaskReq" },
        // Force-refresh the items list so the deleted row disappears.
        { op: "runRequest", request: "items" },
      ],
    },
  ],
  blocks: [
    {
      id: "list",
      type: "List",
      data: "{{$request.items}}",
      item: {
        title: "{{title}}",
        subtitle: "{{why}}",
        badge: "{{priority}}",
        badgeColor:
          "{{priority | match:P0=red,P1=orange,P2=yellow,P3=gray}}",
        onClick: "markDone",
        args: { id: "{{id}}" },
      },
      emptyText: "Nothing important right now — caught up!",
    },
  ],
};

// ─── Default 3: Pomodoro (countdown timer) ──────────────────────────────────
//
// Showcases the new expression features:
//   - reactive `{{now}}` (auto 1Hz tick because mmss/gt filters need second
//     precision)
//   - math filters: mul, add, sub, max
//   - format filter: mmss (ms → "MM:SS")
//   - comparison filter: gt (boolean for "is running?")
//
// State is minimal: `endsAt` (ms epoch when current session ends, 0 = idle)
// plus `mode` for the focus/break label. Persisted so a refresh mid-session
// continues counting against the original target instead of resetting.

const pomodoro: WidgetIR = {
  version: 1,
  id: "pomodoro",
  title: "Pomodoro",
  description:
    "Focus timer with configurable focus/break lengths. Countdown updates every second.",
  icon: "timer",
  config: [
    {
      id: "focusMinutes",
      type: "number",
      label: "Focus minutes",
      default: 25,
    },
    {
      id: "breakMinutes",
      type: "number",
      label: "Break minutes",
      default: 5,
    },
  ],
  state: [
    // 0 = idle. Otherwise: ms epoch the current session ends at.
    { id: "endsAt", type: "number", default: 0, persist: true },
    { id: "mode", type: "string", default: "focus", persist: true },
  ],
  derived: [
    // Clamp at 0 so display shows "00:00" instead of negative time during
    // the gap between session-end and the user clicking Stop.
    { id: "remainingMs", expr: "{{ $state.endsAt | sub:now | max:0 }}" },
    { id: "display", expr: "{{ $derived.remainingMs | mmss }}" },
    // Running iff the session hasn't ended yet.
    { id: "running", expr: "{{ $state.endsAt | gt:now }}" },
    { id: "modeLabel", expr: "{{ $state.mode | match:focus=Focus,break=Break }}" },
  ],
  actions: [
    {
      id: "startFocus",
      do: [
        { op: "setState", state: "mode", value: "focus" },
        {
          op: "setState",
          state: "endsAt",
          value: "{{ $config.focusMinutes | mul:60000 | add:now }}",
        },
      ],
    },
    {
      id: "startBreak",
      do: [
        { op: "setState", state: "mode", value: "break" },
        {
          op: "setState",
          state: "endsAt",
          value: "{{ $config.breakMinutes | mul:60000 | add:now }}",
        },
      ],
    },
    {
      id: "stop",
      do: [{ op: "setState", state: "endsAt", value: 0 }],
    },
  ],
  blocks: [
    {
      id: "card",
      type: "Card",
      children: [
        {
          id: "modeBadge",
          type: "Badge",
          text: "{{$derived.modeLabel}}",
          color: "{{$state.mode | match:focus=blue,break=green}}",
        },
        {
          id: "display",
          type: "Heading",
          text: "{{$derived.display}}",
          level: 1,
        },
        {
          id: "controls",
          type: "Container",
          layout: "row",
          gap: 8,
          children: [
            {
              id: "focusBtn",
              type: "Button",
              label: "Start focus",
              variant: "primary",
              onClick: "startFocus",
              disabled: "{{$derived.running}}",
            },
            {
              id: "breakBtn",
              type: "Button",
              label: "Start break",
              variant: "secondary",
              onClick: "startBreak",
              disabled: "{{$derived.running}}",
            },
            {
              id: "stopBtn",
              type: "Button",
              label: "Stop",
              variant: "ghost",
              onClick: "stop",
              disabled: "{{$derived.running | not}}",
            },
          ],
        },
      ],
    },
  ],
};

// ─── Default 3: Task manager (declarative CRUD with modal) ──────────────────
//
// v0-compatible: avoids `OR`/`AND`/ternary/`filter:` predicate grammar that
// the runtime doesn't yet implement. Filter tabs are deliberately omitted —
// they'll land when the expression evaluator grows compound predicates.
// Uses the runtime's built-in `{{uuid}}` getter for new task ids.

const taskManager: WidgetIR = {
  version: 1,
  id: "tasks",
  title: "Tasks",
  description: "Lightweight per-user task list with add, edit, complete, delete.",
  icon: "check-square",
  state: [
    { id: "tasks", type: "array", persist: true, default: [] },
    { id: "editingId", type: "string", default: "" },
    { id: "draft", type: "object", default: {} },
  ],
  actions: [
    {
      id: "addTask",
      do: [
        {
          op: "mutateState",
          state: "tasks",
          mutation: "append",
          value: { id: "{{uuid}}", title: "New task", done: false },
        },
      ],
    },
    {
      id: "openEdit",
      do: [
        { op: "setState", state: "editingId", value: "{{args.id}}" },
        { op: "openModal", block: "editModal" },
      ],
    },
    {
      id: "toggleDone",
      do: [
        {
          op: "mutateState",
          state: "tasks",
          mutation: "patch_where",
          where: "{{item.id == args.id}}",
          value: { done: "{{!item.done}}" },
        },
      ],
    },
    {
      id: "saveTask",
      do: [
        {
          op: "mutateState",
          state: "tasks",
          mutation: "patch_where",
          where: "{{item.id == $state.editingId}}",
          value: "{{$state.draft}}",
        },
        { op: "closeModal", block: "editModal" },
        { op: "setState", state: "editingId", value: "" },
      ],
    },
    {
      id: "deleteTask",
      confirm: "Delete this task?",
      do: [
        {
          op: "mutateState",
          state: "tasks",
          mutation: "remove_where",
          where: "{{item.id == $state.editingId}}",
        },
        { op: "closeModal", block: "editModal" },
        { op: "setState", state: "editingId", value: "" },
      ],
    },
  ],
  blocks: [
    {
      id: "header",
      type: "Container",
      layout: "row",
      gap: 8,
      children: [
        {
          id: "addBtn",
          type: "Button",
          label: "Add task",
          variant: "primary",
          onClick: "addTask",
        },
      ],
    },
    {
      id: "list",
      type: "List",
      data: "{{$state.tasks}}",
      item: {
        title: "{{title}}",
        badge: "{{done | match:true=done,_=open}}",
        badgeColor: "{{done | match:true=green,_=gray}}",
        onClick: "openEdit",
        args: { id: "{{id}}" },
      },
      emptyText: "No tasks. Click Add task to start.",
    },
    {
      id: "editModal",
      type: "Modal",
      open: "editingId",
      title: "Edit task",
      children: [
        {
          id: "form",
          type: "Form",
          bind: "draft",
          fields: [
            { id: "title", type: "text", label: "Title", required: true },
            { id: "done", type: "boolean", label: "Done" },
          ],
          submitLabel: "Save",
          onSubmit: "saveTask",
        },
        {
          id: "deleteBtn",
          type: "Button",
          label: "Delete",
          variant: "danger",
          onClick: "deleteTask",
        },
      ],
    },
  ],
};

/**
 * In-memory template catalog. Each entry's IR is offered as an installable
 * template on the settings page; clicking [Install] writes a USER row.
 *
 * Adding a template = appending an entry. Editing a template = changing the
 * IR object; existing installs stay on whatever they had at install time
 * (templates don't auto-upgrade — that would clobber user customizations).
 */
export interface DefaultWidgetSpec {
  ir: WidgetIR;
}

export const DEFAULT_WIDGETS: DefaultWidgetSpec[] = [
  { ir: dailyQuote },
  { ir: importantThings },
  { ir: pomodoro },
  { ir: taskManager },
];

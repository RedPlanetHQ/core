/// <reference types="@remix-run/dev" />

// ── @redplanethq/types: external package not vendored locally ──────────────
declare module "@redplanethq/types" {
  export interface WidgetConfigField {
    key: string;
    label: string;
    type: "text" | "select" | string;
    required?: boolean;
    default?: string;
    placeholder?: string;
    options?: Array<{ value: string; label: string }>;
  }

  export interface WidgetMeta {
    slug: string;
    name: string;
    description: string;
    support: string[];
    configSchema?: WidgetConfigField[];
    [key: string]: unknown;
  }
}

// ── Build-time virtual module emitted by Remix/Vite ───────────────────────
declare module "./build/server/index.js" {
  const build: unknown;
  export = build;
}

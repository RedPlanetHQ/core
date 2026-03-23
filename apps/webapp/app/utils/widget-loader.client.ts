import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as RedplanethqUiWeb from "@redplanethq/ui/web";

// All packages the webapp can provide to remotely loaded widget bundles.
const HOST_DEPS: Record<string, Record<string, unknown>> = {
  react: React as unknown as Record<string, unknown>,
  "react/jsx-runtime": ReactJsxRuntime as unknown as Record<string, unknown>,
  "@redplanethq/ui/web": RedplanethqUiWeb as unknown as Record<string, unknown>,
  "@redplanethq/ui/tui": {} as unknown as Record<string, unknown>,
};

// Cache blob URLs so we only create them once per session.
const depBlobCache = new Map<string, string>();

/**
 * Creates a blob URL for a host dependency module.
 * The blob re-exports everything from the host's already-loaded module
 * by stashing it on globalThis under a stable key.
 */
function getDepBlobUrl(name: string, mod: Record<string, unknown>): string {
  if (depBlobCache.has(name)) return depBlobCache.get(name)!;

  // Stash the module reference on globalThis so the blob script can access it.
  const globalKey = `__widgetDep_${name.replace(/[^a-zA-Z0-9]/g, "_")}`;
  (globalThis as Record<string, unknown>)[globalKey] = mod;

  const namedExports = Object.keys(mod)
    .filter((k) => k !== "__esModule" && k !== "default")
    .map(
      (k) =>
        `export const ${JSON.stringify(k).slice(1, -1)} = __mod[${JSON.stringify(k)}];`,
    )
    .join("\n");

  const code = [
    `const __mod = globalThis[${JSON.stringify(globalKey)}];`,
    namedExports,
    `export default __mod.default ?? __mod;`,
  ].join("\n");

  const url = URL.createObjectURL(
    new Blob([code], { type: "application/javascript" }),
  );
  depBlobCache.set(name, url);
  return url;
}

/**
 * Loads a remote widget bundle by:
 * 1. Building blob URLs for each host dependency.
 * 2. Fetching the widget source and rewriting bare specifier imports
 *    to the corresponding blob URLs.
 * 3. Importing the patched source as a blob module.
 *
 * This ensures the widget shares the same React (and any other dep)
 * instance as the host app — no dual-React / invalid hook call issues.
 */
export async function loadWidgetBundle(
  widgetUrl: string,
): Promise<{ widgets: unknown[] }> {
  // Build dep blob URLs.
  const depBlobs: Record<string, string> = {};
  for (const [name, mod] of Object.entries(HOST_DEPS)) {
    depBlobs[name] = getDepBlobUrl(name, mod);
  }

  // Fetch the widget bundle source.
  const src = await fetch(widgetUrl).then((r) => {
    if (!r.ok) throw new Error(`Failed to fetch widget bundle: ${r.status}`);
    return r.text();
  });

  // Strip sourceMappingURL — relative paths don't resolve from a blob URL.
  // Rewrite every `from 'pkg'` / `from "pkg"` for known deps.
  let patched = src.replace(/\/\/# sourceMappingURL=\S+/g, "");
  for (const [name, blobUrl] of Object.entries(depBlobs)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    patched = patched.replace(
      new RegExp(`from ['"]${escaped}['"]`, "g"),
      `from '${blobUrl}'`,
    );
  }

  // Import the patched source via a temporary blob URL.
  const patchedBlobUrl = URL.createObjectURL(
    new Blob([patched], { type: "application/javascript" }),
  );

  try {
    // @vite-ignore needed to suppress Vite's static import analysis warning.
    const mod = await import(/* @vite-ignore */ patchedBlobUrl);
    return mod as { widgets: unknown[] };
  } finally {
    URL.revokeObjectURL(patchedBlobUrl);
  }
}

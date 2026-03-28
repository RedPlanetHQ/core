import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as RedplanethqUiWeb from "@redplanethq/ui/web";

// All packages the webapp can provide to remotely loaded bundles.
const HOST_DEPS: Record<string, Record<string, unknown>> = {
  react: React as unknown as Record<string, unknown>,
  "react/jsx-runtime": ReactJsxRuntime as unknown as Record<string, unknown>,
  "@redplanethq/ui/web": RedplanethqUiWeb as unknown as Record<string, unknown>,
  "@redplanethq/ui/tui": {} as unknown as Record<string, unknown>,
};

// Cache blob URLs so we only create them once per session.
const depBlobCache = new Map<string, string>();

function getDepBlobUrl(name: string, mod: Record<string, unknown>): string {
  if (depBlobCache.has(name)) return depBlobCache.get(name)!;

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
 * Fetches a remote bundle, rewrites bare-specifier imports to host dep blob
 * URLs, and dynamically imports it. Returns the raw module exports.
 */
export async function loadBundle(
  frontendUrl: string,
): Promise<Record<string, unknown>> {
  const depBlobs: Record<string, string> = {};
  for (const [name, mod] of Object.entries(HOST_DEPS)) {
    depBlobs[name] = getDepBlobUrl(name, mod);
  }

  const src = await fetch(frontendUrl).then((r) => {
    if (!r.ok) throw new Error(`Failed to fetch bundle: ${r.status}`);
    return r.text();
  });

  let patched = src.replace(/\/\/# sourceMappingURL=\S+/g, "");
  for (const [name, blobUrl] of Object.entries(depBlobs)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    patched = patched.replace(
      new RegExp(`from ['"]${escaped}['"]`, "g"),
      `from '${blobUrl}'`,
    );
  }

  const patchedBlobUrl = URL.createObjectURL(
    new Blob([patched], { type: "application/javascript" }),
  );

  try {
    const mod = await import(/* @vite-ignore */ patchedBlobUrl);
    return mod as Record<string, unknown>;
  } finally {
    URL.revokeObjectURL(patchedBlobUrl);
  }
}

import { sentryVitePlugin } from "@sentry/vite-plugin";
import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

declare module "@remix-run/node" {
  interface Future {
    v3_singleFetch: true;
  }
}

export default defineConfig({
  plugins: [tailwindcss(), remix({
    future: {
      v3_fetcherPersist: true,
      v3_relativeSplatPath: true,
      v3_throwAbortReason: true,
      v3_singleFetch: true,
      v3_lazyRouteDiscovery: true,
    },
  }), tsconfigPaths(), sentryVitePlugin({
    org: "tegon",
    project: "core-app"
  }), sentryVitePlugin({
    org: "tegon",
    project: "core-app"
  })],

  server: {
    middlewareMode: true,
    allowedHosts: true,
  },

  ssr: {
    target: "node",
    noExternal: [
      "@core/database",
      "@core/providers",
      "@core/types",
      "@core/mcp-proxy",
      "tailwindcss",
      "@tiptap/react",
      "react-tweet",
      "posthog-js",
      "posthog-js/react",
      "rrule",
    ],
    external: ["@prisma/client", "@redplanethq/sdk"],
  },

  build: {
    sourcemap: true,
    // Use terser instead of esbuild for production minification. @xterm/xterm
    // @6.0.0's `requestMode` function relies on `var`-hoisting — it declares
    // `var f, p;` AFTER the return statement and assigns to f/p inside the
    // return expression. Esbuild's minifier mistakenly treats that `var` as
    // unreachable dead code and strips it, leaving f/p as assignments to
    // undeclared variables that crash in strict mode (xterm has
    // "use strict"), surfacing as "ReferenceError: Can't find variable: i"
    // (or r, or whatever letter the mangler picks that build). Terser
    // preserves var-hoisting correctly per ES spec.
    minify: "terser",
  },
});

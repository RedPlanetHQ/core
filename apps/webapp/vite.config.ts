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
  },

  esbuild: {
    // Disable local-identifier mangling only. Keeps syntax + whitespace
    // minification (small bundle) but preserves variable names so the
    // minifier can't clobber a reference the code depends on. Fixes a
    // production-only "ReferenceError: Can't find variable: i" crash in
    // @xterm/xterm@6.0.0's `requestMode` parser that appeared after a
    // fresh install of esbuild/vite picked up a regression in identifier
    // mangling. Dev mode was unaffected because Vite doesn't minify in dev.
    minifyIdentifiers: false,
  },
});

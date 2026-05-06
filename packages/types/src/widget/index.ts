/**
 * Widget types — two flavors:
 *
 *   ./bundled  — widgets shipped as compiled TS bundles by integrations
 *                (github, spotify, metabase). The integration owns the React
 *                code; the runtime injects auth + config via closure.
 *
 *   ./ir       — declarative widget IR (Zod-validated JSON). Authored by the
 *                agent or the user. The runtime interprets the IR — no bundle,
 *                no per-widget code.
 *
 * Both share the same dashboard host. Bundled widgets are for integration
 * vendors; IR widgets are for user/agent-generated panels.
 */

export * from "./bundled";
export * from "./ir";

/**
 * Barrel re-export for the gateway service layer. Existing callers can keep
 * importing `~/services/gateway.server`; new code can import the specific
 * submodule (`~/services/gateway/transport.server`, `.../secrets.server`,
 * etc.) for tighter dependency boundaries.
 */

export * from "./gateway/crud.server";
export * from "./gateway/secrets.server";
export * from "./gateway/transport.server";
export * from "./gateway/register.server";
export * from "./gateway/health.server";

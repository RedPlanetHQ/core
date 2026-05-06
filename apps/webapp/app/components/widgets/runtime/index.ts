/**
 * Public API for the widget runtime.
 *
 * Consumers should import from this barrel — the internals (store, context,
 * expression eval) are subject to change as v1.x lands.
 */

export { WidgetRuntime } from "./WidgetRuntime";
export { WidgetStore, type Snapshot } from "./store";
export { evaluate, evaluateTemplate, evaluateValue, type Scope } from "./expression";
export { dispatchAction } from "./actions";

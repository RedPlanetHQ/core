/**
 * @core/providers - Provider abstraction layer for CORE
 *
 * Supports multiple graph, vector, and model providers with a unified interface.
 */

// Types
export * from "./types";

// Interfaces
export type { IGraphProvider } from "./graph/interface";
export type { IVectorProvider } from "./vector/interface";
export type { IModelProvider } from "./model/interface";

// Constants
export { VECTOR_NAMESPACES, type VectorNamespace } from "./vector/constants";

// Implementations
export { Neo4jGraphProvider } from "./graph";
export { PgVectorProvider } from "./vector";

// Factory
export { ProviderFactory } from "./factory";

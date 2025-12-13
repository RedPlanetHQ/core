/**
 * Vector Provider Constants
 *
 * Defines namespaces for different embedding types
 */

export const VECTOR_NAMESPACES = {
  /**
   * Entity name embeddings (for entity deduplication and similarity search)
   * ID format: entity UUID
   */
  ENTITY: 'entity',

  /**
   * Statement fact embeddings (for statement deduplication and similarity search)
   * ID format: statement UUID
   */
  STATEMENT: 'statement',

  /**
   * Episode content embeddings (for episode similarity search)
   * ID format: episode UUID
   */
  EPISODE: 'episode',

  /**
   * Compacted session summary embeddings (for compacted session similarity search)
   * ID format: compacted session UUID
   */
  COMPACTED_SESSION: 'compacted_session',
} as const;

export type VectorNamespace = typeof VECTOR_NAMESPACES[keyof typeof VECTOR_NAMESPACES];

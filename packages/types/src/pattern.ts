export type UserConfirmationStatus = "pending" | "accepted" | "rejected" | "edited";

export interface SpacePattern {
  id: string;
  name: string; // Human-readable name for the pattern
  source: "explicit" | "implicit";
  type: string; // "preference", "habit", "theme", "topic", "workflow", "communication_style", "decision_pattern"
  summary: string; // Description of what the pattern reveals
  editedSummary?: string; // User-edited version of the summary
  evidence: string[]; // Array of statement IDs that support this pattern
  confidence: number; // 0.0 to 1.0 confidence score
  userConfirmed: UserConfirmationStatus; // User confirmation status
  spaceId: string; // Which space this pattern belongs to
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePatternParams {
  name: string;
  source: "explicit" | "implicit";
  type: string;
  summary: string;
  editedSummary?: string;
  evidence: string[];
  confidence: number;
  userConfirmed?: UserConfirmationStatus;
  spaceId: string;
}

export interface PatternDetectionResult {
  explicitPatterns: Omit<SpacePattern, "id" | "createdAt" | "updatedAt" | "spaceId">[];
  implicitPatterns: Omit<SpacePattern, "id" | "createdAt" | "updatedAt" | "spaceId">[];
  totalPatternsFound: number;
  processingStats: {
    statementsAnalyzed: number;
    themesProcessed: number;
    implicitPatternsExtracted: number;
  };
}

export interface PatternConfirmationParams {
  patternId: string;
  confirmed: boolean;
}

// Pattern types for categorization (guidelines, not restrictions)
// LLM can suggest new pattern types beyond these categories

export const EXPLICIT_PATTERN_TYPES = {
  // Derived from space themes and explicit content
  THEME: "theme", // High-level thematic content
  TOPIC: "topic", // Specific subject matter
  DOMAIN: "domain", // Knowledge or work domains
  INTEREST_AREA: "interest_area", // Areas of personal interest
} as const;

export const IMPLICIT_PATTERN_TYPES = {
  // Discovered from behavioral analysis and content patterns
  PREFERENCE: "preference", // Personal preferences and choices
  HABIT: "habit", // Recurring behaviors and routines
  WORKFLOW: "workflow", // Work and process patterns
  COMMUNICATION_STYLE: "communication_style", // How user communicates
  DECISION_PATTERN: "decision_pattern", // Decision-making approaches
  TEMPORAL_PATTERN: "temporal_pattern", // Time-based behavioral patterns
  BEHAVIORAL_PATTERN: "behavioral_pattern", // General behavioral tendencies
  LEARNING_STYLE: "learning_style", // How user learns and processes info
  COLLABORATION_STYLE: "collaboration_style", // How user works with others
} as const;

// Combined pattern types for reference
export const PATTERN_TYPES = {
  ...EXPLICIT_PATTERN_TYPES,
  ...IMPLICIT_PATTERN_TYPES,
} as const;

export type ExplicitPatternType =
  (typeof EXPLICIT_PATTERN_TYPES)[keyof typeof EXPLICIT_PATTERN_TYPES];
export type ImplicitPatternType =
  (typeof IMPLICIT_PATTERN_TYPES)[keyof typeof IMPLICIT_PATTERN_TYPES];
export type PatternType = (typeof PATTERN_TYPES)[keyof typeof PATTERN_TYPES];

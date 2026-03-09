/**
 * Tokenize a string into normalized words for comparison.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/**
 * Calculate drift between current and previous persona.
 * Returns a drift score (0-1) indicating how much the persona has changed.
 *
 * Uses a combination of:
 * - Jaccard distance on word sets (measures vocabulary change)
 * - Bigram overlap (measures structural/phrase-level change)
 * - Length ratio difference (measures volume change)
 *
 * A score of 0 means identical; 1 means completely different.
 */
export async function calculatePersonaDrift(
  currentSummary: string,
  previousSummary: string,
): Promise<number> {
  if (!previousSummary && !currentSummary) return 0;
  if (!previousSummary || !currentSummary) return 1;

  const currentTokens = tokenize(currentSummary);
  const previousTokens = tokenize(previousSummary);

  if (currentTokens.length === 0 && previousTokens.length === 0) return 0;
  if (currentTokens.length === 0 || previousTokens.length === 0) return 1;

  // Jaccard distance on word sets
  const currentSet = new Set(currentTokens);
  const previousSet = new Set(previousTokens);
  const intersection = new Set([...currentSet].filter((w) => previousSet.has(w)));
  const union = new Set([...currentSet, ...previousSet]);
  const jaccardSimilarity = intersection.size / union.size;

  // Bigram overlap
  const toBigrams = (tokens: string[]): Set<string> => {
    const bigrams = new Set<string>();
    for (let i = 0; i < tokens.length - 1; i++) {
      bigrams.add(`${tokens[i]} ${tokens[i + 1]}`);
    }
    return bigrams;
  };
  const currentBigrams = toBigrams(currentTokens);
  const previousBigrams = toBigrams(previousTokens);
  let bigramSimilarity = 0;
  if (currentBigrams.size > 0 || previousBigrams.size > 0) {
    const bigramIntersection = new Set(
      [...currentBigrams].filter((b) => previousBigrams.has(b)),
    );
    const bigramUnion = new Set([...currentBigrams, ...previousBigrams]);
    bigramSimilarity = bigramIntersection.size / bigramUnion.size;
  }

  // Length ratio similarity (closer to 1 when lengths are similar)
  const lengthRatio =
    Math.min(currentTokens.length, previousTokens.length) /
    Math.max(currentTokens.length, previousTokens.length);

  // Weighted combination: word overlap matters most, then bigrams, then length
  const similarity =
    0.5 * jaccardSimilarity + 0.35 * bigramSimilarity + 0.15 * lengthRatio;

  // Drift is the inverse of similarity, clamped to [0, 1]
  return Math.min(1, Math.max(0, 1 - similarity));
}

/**
 * Calculate drift between current and previous persona
 * Returns a drift score (0-1) indicating how much the persona has changed
 */
export async function calculatePersonaDrift(
  currentSummary: string,
  previousSummary: string,
): Promise<number> {
  // TODO: Implement drift calculation
  // Could use:
  // - Lexical similarity (jaccard, cosine)
  // - Semantic similarity (embedding comparison)
  // - Structural similarity (section-by-section comparison)
  // For now, return 0 (no drift)
  // return 0;

  // If either summary is empty, return maximum drift
  if (!currentSummary.trim() || !previousSummary.trim()) {
    return 1;
  }

  // Calculate lexical similarity using Jaccard similarity
  const currentWords = new Set(currentSummary.toLowerCase().split(/\s+/).filter(word => word.length > 2));
  const previousWords = new Set(previousSummary.toLowerCase().split(/\s+/).filter(word => word.length > 2));

  const intersection = new Set([...currentWords].filter(word => previousWords.has(word)));
  const union = new Set([...currentWords, ...previousWords]);

  const jaccardSimilarity = union.size > 0 ? intersection.size / union.size : 0;

  // Calculate character-level similarity for more granular comparison
  const currentChars = currentSummary.toLowerCase();
  const previousChars = previousSummary.toLowerCase();

  // Simple Levenshtein distance approximation
  const levenshteinDistance = calculateLevenshteinDistance(currentChars, previousChars);
  const maxLength = Math.max(currentChars.length, previousChars.length);
  const charSimilarity = maxLength > 0 ? 1 - (levenshteinDistance / maxLength) : 1;

  // Combine similarities (weighted average)
  const lexicalWeight = 0.6;
  const charWeight = 0.4;
  const combinedSimilarity = (jaccardSimilarity * lexicalWeight) + (charSimilarity * charWeight);

  // Convert similarity to drift (1 - similarity)
  const drift = 1 - combinedSimilarity;

  // Ensure drift is between 0 and 1
  return Math.max(0, Math.min(1, drift));
}

/**
 * Calculate Levenshtein distance between two strings
 */
function calculateLevenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i++) {
    matrix[0][i] = i;
  }

  for (let j = 0; j <= str2.length; j++) {
    matrix[j][0] = j;
  }

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // deletion
        matrix[j - 1][i] + 1, // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }

  return matrix[str2.length][str1.length];
}

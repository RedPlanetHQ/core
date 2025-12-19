import DiffMatchPatch from 'diff-match-patch';

export interface DiffStats {
  additions: number;
  deletions: number;
  unchanged: number;
  changePercentage: number;
}

/**
 * Service for generating text diffs between document versions
 * Uses diff-match-patch for semantic diffing and comparison
 */
export class EpisodeDiffer {
  private dmp: DiffMatchPatch;

  constructor() {
    this.dmp = new DiffMatchPatch();
  }
  /**
   * Extract only changed content from two versions
   * Returns text containing additions and modifications (deletions omitted)
   *
   * @param oldContent - Previous version content
   * @param newContent - Current version content
   * @returns Changed content only (additions and modified parts)
   */
  extractChangedContent(oldContent: string, newContent: string): string {
    const diffs = this.dmp.diff_main(oldContent, newContent);
    this.dmp.diff_cleanupSemantic(diffs);

    // Extract only additions with minimal surrounding context
    const changedParts: string[] = [];
    const CONTEXT_CHARS = 50; // Characters of context before/after changes

    for (let i = 0; i < diffs.length; i++) {
      const [op, text] = diffs[i];
      const prevOp = i > 0 ? diffs[i - 1] : null;
      const nextOp = i < diffs.length - 1 ? diffs[i + 1] : null;

      if (op === 1) { // INSERT
        // Always include additions
        changedParts.push(text);
      } else if (op === 0) { // EQUAL
        // Only include context if adjacent to a change
        const isNearChange =
          (prevOp && prevOp[0] !== 0) ||
          (nextOp && nextOp[0] !== 0);

        if (isNearChange) {
          // Include minimal context (50 chars before/after changes)
          if (text.length > CONTEXT_CHARS * 2) {
            if (prevOp && prevOp[0] !== 0) {
              // After a change: include start only
              changedParts.push(text.slice(0, CONTEXT_CHARS));
            } else if (nextOp && nextOp[0] !== 0) {
              // Before a change: include end only
              changedParts.push(text.slice(-CONTEXT_CHARS));
            }
          } else {
            // Short unchanged section between changes: include all
            changedParts.push(text);
          }
        }
        // Skip unchanged sections not near changes
      }
      // Skip DELETE operations (op === -1) - LLM can infer from comparing with previous version
    }

    return changedParts.join('');
  }

  /**
   * Extract only changed content without any unchanged context
   * Most aggressive token savings - only additions
   *
   * Uses semantic diffing for structured documents
   *
   * @param oldContent - Previous version content
   * @param newContent - Current version content
   * @returns Only the added/modified content
   */
  extractChangedContentOnly(oldContent: string, newContent: string): string {
    const diffs = this.dmp.diff_main(oldContent, newContent);
    this.dmp.diff_cleanupSemantic(diffs);

    // Extract only additions (no context)
    const changedParts: string[] = [];

    for (const [op, text] of diffs) {
      if (op === 1) { // INSERT
        changedParts.push(text);
      }
    }

    return changedParts.join('');
  }

  /**
   * Get statistics about the changes between versions
   *
   * @param oldContent - Previous version content
   * @param newContent - Current version content
   * @returns Statistics about additions, deletions, and unchanged content
   */
  getChangeStats(oldContent: string, newContent: string): DiffStats {
    const diffs = this.dmp.diff_main(oldContent, newContent);
    this.dmp.diff_cleanupSemantic(diffs);

    let additions = 0;
    let deletions = 0;
    let unchanged = 0;

    for (const [op, text] of diffs) {
      const length = text.length;
      if (op === 1) { // INSERT
        additions += length;
      } else if (op === -1) { // DELETE
        deletions += length;
      } else { // EQUAL (op === 0)
        unchanged += length;
      }
    }

    const total = additions + deletions + unchanged;
    const changePercentage = total > 0
      ? ((additions + deletions) / total) * 100
      : 0;

    return {
      additions,
      deletions,
      unchanged,
      changePercentage,
    };
  }

  /**
   * Check if content has meaningful changes (not just whitespace/formatting)
   *
   * @param oldContent - Previous version content
   * @param newContent - Current version content
   * @returns True if there are semantic changes
   */
  hasMeaningfulChanges(oldContent: string, newContent: string): boolean {
    // Normalize whitespace for comparison
    const normalizeWhitespace = (text: string) =>
      text.replace(/\s+/g, ' ').trim();

    return normalizeWhitespace(oldContent) !== normalizeWhitespace(newContent);
  }

  /**
   * Generate git-style diff with + and - markers
   * Shows additions with + prefix and deletions with - prefix
   * Uses diff-match-patch for semantic line-based comparison
   *
   * @param oldContent - Previous version content
   * @param newContent - Current version content
   * @returns Git-style diff format
   */
  getGitStyleDiff(oldContent: string, newContent: string): string {
    // Use diff-match-patch for semantic diff
    const diffs = this.dmp.diff_main(oldContent, newContent);

    // Clean up semantics for better readability
    this.dmp.diff_cleanupSemantic(diffs);

    const diffLines: string[] = [];

    for (const [op, text] of diffs) {
      // DiffMatchPatch operations: -1 = DELETE, 0 = EQUAL, 1 = INSERT
      if (op === 1) {
        // INSERT - additions
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.trim() || lines.length === 1) { // Include line if it has content or is the only line
            diffLines.push(`+ ${line}`);
          }
        }
      } else if (op === -1) {
        // DELETE - deletions
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.trim() || lines.length === 1) { // Include line if it has content or is the only line
            diffLines.push(`- ${line}`);
          }
        }
      }
      // Skip op === 0 (EQUAL - unchanged content)
    }

    // If diff is empty, it means only whitespace changed
    if (diffLines.length === 0) {
      return '(No significant changes detected)';
    }

    return diffLines.join('\n');
  }
}

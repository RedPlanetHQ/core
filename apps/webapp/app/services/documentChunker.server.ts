import { encode } from "gpt-tokenizer";
import crypto from "crypto";

export interface DocumentChunk {
  content: string;
  chunkIndex: number;
  title?: string;
  context?: string;
  startPosition: number;
  endPosition: number;
  contentHash: string; // Hash for change detection
}

export interface ChunkedDocument {
  documentId: string;
  title: string;
  originalContent: string;
  chunks: DocumentChunk[];
  totalChunks: number;
  contentHash: string; // Hash of the entire document
  chunkHashes: string[]; // Array of chunk hashes for change detection
}

/**
 * Document chunking service that splits large documents into semantic chunks
 * Targets 1-3k tokens per chunk for better entity extraction with natural paragraph boundaries
 */
export class DocumentChunker {
  private TARGET_CHUNK_SIZE = 1000; // Much smaller for better entity extraction
  private MIN_CHUNK_SIZE = 500;
  private MAX_CHUNK_SIZE = 1500;
  private MIN_PARAGRAPH_SIZE = 100; // Minimum tokens for a paragraph to be considered

  constructor(
    targetChunkSize: number = 1000,
    minChunkSize: number = 500,
    maxChunkSize: number = 1500,
    minParagraphSize: number = 100,
  ) {
    this.TARGET_CHUNK_SIZE = targetChunkSize;
    this.MIN_CHUNK_SIZE = minChunkSize;
    this.MAX_CHUNK_SIZE = maxChunkSize;
    this.MIN_PARAGRAPH_SIZE = minParagraphSize;
  }

  /**
   * Chunk a document into semantic sections with natural boundaries
   */
  async chunkDocument(
    originalContent: string,
    title: string,
  ): Promise<ChunkedDocument> {
    const documentId = crypto.randomUUID();
    const contentHash = this.generateContentHash(originalContent);

    // First, split by major section headers (markdown style)
    const majorSections = this.splitByMajorSections(originalContent);

    const chunks: DocumentChunk[] = [];
    let currentChunk = "";
    let currentChunkStart = 0;
    let chunkIndex = 0;

    for (const section of majorSections) {
      const sectionTokens = encode(section.content).length;
      const currentChunkTokens = encode(currentChunk).length;

      // If adding this section would exceed max size, finalize current chunk
      if (
        currentChunkTokens > 0 &&
        currentChunkTokens + sectionTokens > this.MAX_CHUNK_SIZE
      ) {
        if (currentChunkTokens >= this.MIN_CHUNK_SIZE) {
          chunks.push(
            this.createChunk(
              currentChunk,
              chunkIndex,
              currentChunkStart,
              currentChunkStart + currentChunk.length,
              section.title,
            ),
          );
          chunkIndex++;
          currentChunk = "";
          currentChunkStart = section.startPosition;
        }
      }

      // Add section to current chunk
      if (currentChunk) {
        currentChunk += "\n\n" + section.content;
      } else {
        currentChunk = section.content;
        currentChunkStart = section.startPosition;
      }

      // If current chunk is large enough and we have a natural break, consider chunking
      const updatedChunkTokens = encode(currentChunk).length;
      if (updatedChunkTokens >= this.TARGET_CHUNK_SIZE) {
        // Try to find a good breaking point within the section
        const paragraphs = this.splitIntoParagraphs(section.content);
        if (paragraphs.length > 1) {
          // Split at paragraph boundary if beneficial
          const optimalSplit = this.findOptimalParagraphSplit(currentChunk);
          if (optimalSplit) {
            chunks.push(
              this.createChunk(
                optimalSplit.beforeSplit,
                chunkIndex,
                currentChunkStart,
                currentChunkStart + optimalSplit.beforeSplit.length,
                section.title,
              ),
            );
            chunkIndex++;
            currentChunk = optimalSplit.afterSplit;
            currentChunkStart =
              currentChunkStart + optimalSplit.beforeSplit.length;
          }
        }
      }
    }

    // Add remaining content as final chunk
    if (
      currentChunk.trim() &&
      encode(currentChunk).length >= this.MIN_PARAGRAPH_SIZE
    ) {
      chunks.push(
        this.createChunk(
          currentChunk,
          chunkIndex,
          currentChunkStart,
          originalContent.length,
        ),
      );
    }

    // Generate chunk hashes array
    const chunkHashes = chunks.map((chunk) => chunk.contentHash);

    return {
      documentId,
      title,
      originalContent,
      chunks,
      totalChunks: chunks.length,
      contentHash,
      chunkHashes,
    };
  }

  private splitByMajorSections(content: string): Array<{
    content: string;
    title?: string;
    startPosition: number;
    endPosition: number;
  }> {
    const sections: Array<{
      content: string;
      title?: string;
      startPosition: number;
      endPosition: number;
    }> = [];

    // Detect headers from multiple formats
    const headerMatches = this.findAllHeaders(content);

    if (headerMatches.length === 0) {
      // No headers found, try to split by natural boundaries
      return this.splitByNaturalBoundaries(content);
    }

    let lastIndex = 0;

    for (let i = 0; i < headerMatches.length; i++) {
      const match = headerMatches[i];
      const nextMatch = headerMatches[i + 1];

      const sectionStart = lastIndex;
      const sectionEnd = nextMatch ? nextMatch.startIndex : content.length;

      const sectionContent = content.slice(sectionStart, sectionEnd).trim();

      if (sectionContent) {
        sections.push({
          content: sectionContent,
          title: match.title,
          startPosition: sectionStart,
          endPosition: sectionEnd,
        });
      }

      lastIndex = match.endIndex;
    }

    return sections;
  }

  private findAllHeaders(content: string): Array<{
    title: string;
    startIndex: number;
    endIndex: number;
    level: number;
  }> {
    const headers: Array<{
      title: string;
      startIndex: number;
      endIndex: number;
      level: number;
    }> = [];

    // Markdown headers (# ## ### etc.)
    const markdownRegex = /^(#{1,6})\s+(.+)$/gm;
    let match;
    while ((match = markdownRegex.exec(content)) !== null) {
      headers.push({
        title: match[2].trim(),
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        level: match[1].length,
      });
    }

    // HTML headers (<h1>, <h2>, etc.)
    const htmlRegex = /<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi;
    while ((match = htmlRegex.exec(content)) !== null) {
      const textContent = match[2].replace(/<[^>]*>/g, "").trim();
      if (textContent) {
        headers.push({
          title: textContent,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          level: parseInt(match[1]),
        });
      }
    }

    // Underlined headers (Setext-style)
    const setextRegex = /^(.+)\n(={3,}|-{3,})$/gm;
    while ((match = setextRegex.exec(content)) !== null) {
      const level = match[2].startsWith("=") ? 1 : 2;
      headers.push({
        title: match[1].trim(),
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        level,
      });
    }

    // Sort by position in document
    return headers.sort((a, b) => a.startIndex - b.startIndex);
  }

  private splitByNaturalBoundaries(content: string): Array<{
    content: string;
    title?: string;
    startPosition: number;
    endPosition: number;
  }> {
    const sections: Array<{
      content: string;
      title?: string;
      startPosition: number;
      endPosition: number;
    }> = [];

    // Look for natural boundaries: double line breaks, HTML block elements, etc.
    const boundaryPatterns = [
      /\n\s*\n\s*\n/g, // Triple line breaks (strong boundary)
      /<\/(?:div|section|article|main|p)>\s*<(?:div|section|article|main|p)/gi, // HTML block boundaries
      /\n\s*[-=*]{4,}\s*\n/g, // Horizontal rules
    ];

    let boundaries: number[] = [0];

    for (const pattern of boundaryPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        boundaries.push(match.index);
      }
    }

    boundaries.push(content.length);
    boundaries = [...new Set(boundaries)].sort((a, b) => a - b);

    // If no natural boundaries found, split by token count
    if (boundaries.length <= 2) {
      return this.splitByTokenCount(content);
    }

    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      const sectionContent = content.slice(start, end).trim();

      if (
        sectionContent &&
        encode(sectionContent).length >= this.MIN_PARAGRAPH_SIZE
      ) {
        sections.push({
          content: sectionContent,
          startPosition: start,
          endPosition: end,
        });
      }
    }

    return sections.length > 0 ? sections : this.splitByTokenCount(content);
  }

  private splitByTokenCount(content: string): Array<{
    content: string;
    title?: string;
    startPosition: number;
    endPosition: number;
  }> {
    const sections: Array<{
      content: string;
      title?: string;
      startPosition: number;
      endPosition: number;
    }> = [];

    const totalTokens = encode(content).length;
    const numSections = Math.ceil(totalTokens / this.TARGET_CHUNK_SIZE);
    const charsPerSection = Math.ceil(content.length / numSections);

    for (let i = 0; i < numSections; i++) {
      const start = i * charsPerSection;
      const end = Math.min((i + 1) * charsPerSection, content.length);

      // Try to break at word boundaries
      let actualEnd = end;
      if (end < content.length) {
        const nextSpace = content.indexOf(" ", end);
        const nextNewline = content.indexOf("\n", end);
        const nextBoundary = Math.min(
          nextSpace === -1 ? Infinity : nextSpace,
          nextNewline === -1 ? Infinity : nextNewline,
        );
        if (nextBoundary !== Infinity && nextBoundary - end < 100) {
          actualEnd = nextBoundary;
        }
      }

      const sectionContent = content.slice(start, actualEnd).trim();
      if (sectionContent) {
        sections.push({
          content: sectionContent,
          startPosition: start,
          endPosition: actualEnd,
        });
      }
    }

    return sections;
  }

  private splitIntoParagraphs(content: string): string[] {
    // Handle HTML paragraphs first
    if (
      content.includes("<p") ||
      content.includes("<div") ||
      content.includes("<section")
    ) {
      return this.splitHtmlParagraphs(content);
    }

    // Split by double newlines (paragraph breaks) for text/markdown
    return content
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  private splitHtmlParagraphs(content: string): string[] {
    const paragraphs: string[] = [];

    // Split by HTML block elements
    const blockElements = [
      "p",
      "div",
      "section",
      "article",
      "li",
      "blockquote",
      "pre",
    ];
    const blockRegex = new RegExp(
      `<(${blockElements.join("|")})[^>]*>.*?</\\1>`,
      "gis",
    );

    let lastIndex = 0;
    let match;

    while ((match = blockRegex.exec(content)) !== null) {
      // Add content before this block element
      if (match.index > lastIndex) {
        const beforeContent = content.slice(lastIndex, match.index).trim();
        if (beforeContent) {
          paragraphs.push(beforeContent);
        }
      }

      // Add the block element content (strip tags for text content)
      const blockContent = match[0].replace(/<[^>]*>/g, " ").trim();
      if (blockContent) {
        paragraphs.push(blockContent);
      }

      lastIndex = match.index + match[0].length;
    }

    // Add remaining content
    if (lastIndex < content.length) {
      const remainingContent = content.slice(lastIndex).trim();
      if (remainingContent) {
        // Clean up remaining HTML and split by newlines
        const cleaned = remainingContent.replace(/<[^>]*>/g, " ").trim();
        if (cleaned) {
          paragraphs.push(
            ...cleaned.split(/\n\s*\n/).filter((p) => p.trim().length > 0),
          );
        }
      }
    }

    return paragraphs.length > 0
      ? paragraphs
      : this.splitTextParagraphs(content);
  }

  private splitTextParagraphs(content: string): string[] {
    return content
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  private findOptimalParagraphSplit(content: string): {
    beforeSplit: string;
    afterSplit: string;
  } | null {
    const paragraphs = this.splitIntoParagraphs(content);
    if (paragraphs.length < 2) return null;

    let bestSplitIndex = -1;
    let bestScore = 0;

    // Find the split that gets us closest to target size
    for (let i = 1; i < paragraphs.length; i++) {
      const beforeSplit = paragraphs.slice(0, i).join("\n\n");
      const afterSplit = paragraphs.slice(i).join("\n\n");

      const beforeTokens = encode(beforeSplit).length;
      const afterTokens = encode(afterSplit).length;

      // Score based on how close we get to target, avoiding too small chunks
      if (
        beforeTokens >= this.MIN_CHUNK_SIZE &&
        afterTokens >= this.MIN_PARAGRAPH_SIZE
      ) {
        const beforeDistance = Math.abs(beforeTokens - this.TARGET_CHUNK_SIZE);
        const score = 1 / (1 + beforeDistance); // Higher score for closer to target

        if (score > bestScore) {
          bestScore = score;
          bestSplitIndex = i;
        }
      }
    }

    if (bestSplitIndex > 0) {
      return {
        beforeSplit: paragraphs.slice(0, bestSplitIndex).join("\n\n"),
        afterSplit: paragraphs.slice(bestSplitIndex).join("\n\n"),
      };
    }

    return null;
  }

  private createChunk(
    content: string,
    chunkIndex: number,
    startPosition: number,
    endPosition: number,
    title?: string,
  ): DocumentChunk {
    // Generate a concise context/title if not provided
    const context = title || this.generateChunkContext(content);
    const contentHash = this.generateContentHash(content.trim());

    return {
      content: content.trim(),
      chunkIndex,
      title: context,
      context: `Chunk ${chunkIndex + 1}${context ? `: ${context}` : ""}`,
      startPosition,
      endPosition,
      contentHash,
    };
  }

  private generateChunkContext(content: string): string {
    // Clean content from HTML tags and markup
    const cleanContent = content
      .replace(/<[^>]*>/g, " ") // Remove HTML tags
      .replace(/#{1,6}\s+/g, "") // Remove markdown headers
      .replace(/[=-]{3,}/g, "") // Remove underline headers
      .replace(/\s+/g, " ") // Normalize whitespace
      .trim();

    if (!cleanContent) {
      return "Document content";
    }

    // Find first substantial sentence or line
    const sentences = cleanContent
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const sentence of sentences.slice(0, 2)) {
      if (sentence.length > 20) {
        return (
          sentence.substring(0, 100) + (sentence.length > 100 ? "..." : "")
        );
      }
    }

    // Fallback to first meaningful chunk
    const words = cleanContent.split(/\s+/).slice(0, 15).join(" ");
    return words.substring(0, 100) + (words.length > 100 ? "..." : "");
  }

  /**
   * Generate content hash for change detection
   */
  private generateContentHash(content: string): string {
    return crypto
      .createHash("sha256")
      .update(content, "utf8")
      .digest("hex")
      .substring(0, 16);
  }

  /**
   * Compare chunk hashes to detect changes
   */
  static compareChunkHashes(
    oldHashes: string[],
    newHashes: string[],
  ): {
    changedIndices: number[];
    changePercentage: number;
  } {
    const maxLength = Math.max(oldHashes.length, newHashes.length);
    const changedIndices: number[] = [];

    for (let i = 0; i < maxLength; i++) {
      const oldHash = oldHashes[i];
      const newHash = newHashes[i];

      // Mark as changed if hash is different or chunk added/removed
      if (oldHash !== newHash) {
        changedIndices.push(i);
      }
    }

    const changePercentage =
      maxLength > 0 ? (changedIndices.length / maxLength) * 100 : 0;

    return {
      changedIndices,
      changePercentage,
    };
  }

  /**
   * Calculate document size in tokens for threshold decisions
   */
  static getDocumentSizeInTokens(content: string): number {
    return encode(content).length;
  }
}

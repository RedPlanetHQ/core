import type { EpisodicNode } from "@core/types";
import { logger } from "~/services/logger.service";

export interface PersonaAnalytics {
  totalEpisodes: number;
  lexicon: Record<string, number>; // term -> frequency
  style: StyleMetrics;
  sources: Record<string, number>; // source -> percentage
  temporal: TemporalMetrics;
  receipts: string[]; // Explicit metrics/numbers found
}

export interface StyleMetrics {
  avgSentenceLength: number;
  avgParagraphLength: number;
  bulletUsage: number; // percentage of episodes with bullet lists
  codeBlockFrequency: number; // percentage with code blocks
  emphasisPatterns: {
    bold: number;
    italic: number;
    caps: number;
  };
}

export interface TemporalMetrics {
  oldestEpisode: Date;
  newestEpisode: Date;
  timeSpanDays: number;
  episodesPerMonth: number;
}

/**
 * Analyze episodes algorithmically (no LLM) to extract quantitative patterns
 * This runs on ALL episodes - no sampling
 */
export async function analyzeEpisodesAlgorithmically(
  episodes: EpisodicNode[]
): Promise<PersonaAnalytics> {
  logger.info("Starting algorithmic episode analysis", {
    episodeCount: episodes.length,
  });

  if (episodes.length === 0) {
    return getEmptyAnalytics();
  }

  return {
    totalEpisodes: episodes.length,
    lexicon: extractLexicon(episodes),
    style: calculateStyleMetrics(episodes),
    sources: analyzeSourceDistribution(episodes),
    temporal: trackTemporalPatterns(episodes),
    receipts: extractReceipts(episodes),
  };
}

/**
 * Extract term frequencies using TF-IDF approach
 * Returns top terms with their frequencies
 */
function extractLexicon(episodes: EpisodicNode[]): Record<string, number> {
  const termCounts: Record<string, number> = {};
  const documentCounts: Record<string, number> = {}; // How many episodes contain term

  // Common stop words to exclude
  const stopWords = new Set([
    "the",
    "be",
    "to",
    "of",
    "and",
    "a",
    "in",
    "that",
    "have",
    "i",
    "it",
    "for",
    "not",
    "on",
    "with",
    "he",
    "as",
    "you",
    "do",
    "at",
    "this",
    "but",
    "his",
    "by",
    "from",
    "they",
    "we",
    "say",
    "her",
    "she",
    "or",
    "an",
    "will",
    "my",
    "one",
    "all",
    "would",
    "there",
    "their",
    "what",
    "so",
    "up",
    "out",
    "if",
    "about",
    "who",
    "get",
    "which",
    "go",
    "me",
    "when",
    "make",
    "can",
    "like",
    "time",
    "no",
    "just",
    "him",
    "know",
    "take",
    "people",
    "into",
    "year",
    "your",
    "good",
    "some",
    "could",
    "them",
    "see",
    "other",
    "than",
    "then",
    "now",
    "look",
    "only",
    "come",
    "its",
    "over",
    "think",
    "also",
    "back",
    "after",
    "use",
    "two",
    "how",
    "our",
    "work",
    "first",
    "well",
    "way",
    "even",
    "new",
    "want",
    "because",
    "any",
    "these",
    "give",
    "day",
    "most",
    "us",
  ]);

  // First pass: count terms per document
  for (const episode of episodes) {
    const content = episode.content.toLowerCase();
    // Extract words (alphanumeric + underscore + hyphen, 3+ chars)
    const words = content.match(/\b[a-z0-9_-]{3,}\b/g) || [];

    const uniqueWords = new Set(words);
    for (const word of uniqueWords) {
      if (!stopWords.has(word)) {
        documentCounts[word] = (documentCounts[word] || 0) + 1;
      }
    }

    // Count all occurrences
    for (const word of words) {
      if (!stopWords.has(word)) {
        termCounts[word] = (termCounts[word] || 0) + 1;
      }
    }
  }

  // Calculate TF-IDF scores
  const totalDocs = episodes.length;
  const tfidfScores: Record<string, number> = {};

  for (const [term, count] of Object.entries(termCounts)) {
    const tf = count; // Term frequency (raw count)
    const df = documentCounts[term] || 1; // Document frequency
    const idf = Math.log(totalDocs / df); // Inverse document frequency

    // Filter out terms that appear in too many documents (likely not distinctive)
    if (df < totalDocs * 0.8) {
      // Less than 80% of documents
      tfidfScores[term] = tf * idf;
    }
  }

  // Return top 50 terms by TF-IDF score
  const sortedTerms = Object.entries(tfidfScores)
    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
    .slice(0, 50);

  const lexicon: Record<string, number> = {};
  for (const [term] of sortedTerms) {
    lexicon[term] = termCounts[term];
  }

  logger.info("Extracted lexicon", {
    uniqueTerms: Object.keys(termCounts).length,
    topTerms: Object.keys(lexicon).length,
  });

  return lexicon;
}

/**
 * Calculate writing style metrics
 */
function calculateStyleMetrics(episodes: EpisodicNode[]): StyleMetrics {
  let totalSentences = 0;
  let totalWords = 0;
  let totalParagraphs = 0;
  let episodesWithBullets = 0;
  let episodesWithCode = 0;
  let boldCount = 0;
  let italicCount = 0;
  let capsCount = 0;

  for (const episode of episodes) {
    const content = episode.content;

    // Count sentences (. ! ?)
    const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    totalSentences += sentences.length;

    // Count words
    const words = content.split(/\s+/).filter((w) => w.length > 0);
    totalWords += words.length;

    // Count paragraphs (double newline)
    const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);
    totalParagraphs += paragraphs.length || 1; // At least 1 paragraph

    // Check for bullet lists (- or * at start of line)
    if (/^\s*[-*]\s+/m.test(content)) {
      episodesWithBullets++;
    }

    // Check for code blocks (``` or indented code)
    if (/```|^\s{4,}/m.test(content)) {
      episodesWithCode++;
    }

    // Count emphasis patterns
    boldCount += (content.match(/\*\*[^*]+\*\*|__[^_]+__/g) || []).length;
    italicCount += (content.match(/\*[^*]+\*|_[^_]+_/g) || []).length;
    capsCount += (content.match(/\b[A-Z]{3,}\b/g) || []).length; // 3+ consecutive caps
  }

  const avgSentenceLength = totalSentences > 0 ? Math.round(totalWords / totalSentences) : 0;
  const avgParagraphLength =
    totalParagraphs > 0 ? Math.round(totalSentences / totalParagraphs) : 0;
  const bulletUsage = Math.round((episodesWithBullets / episodes.length) * 100);
  const codeBlockFrequency = Math.round((episodesWithCode / episodes.length) * 100);

  logger.info("Calculated style metrics", {
    avgSentenceLength,
    avgParagraphLength,
    bulletUsage: `${bulletUsage}%`,
    codeBlockFrequency: `${codeBlockFrequency}%`,
  });

  return {
    avgSentenceLength,
    avgParagraphLength,
    bulletUsage,
    codeBlockFrequency,
    emphasisPatterns: {
      bold: boldCount,
      italic: italicCount,
      caps: capsCount,
    },
  };
}

/**
 * Analyze source distribution (where episodes come from)
 */
function analyzeSourceDistribution(episodes: EpisodicNode[]): Record<string, number> {
  const sourceCounts: Record<string, number> = {};

  for (const episode of episodes) {
    const source = episode.source || "unknown";
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  }

  // Convert to percentages
  const sourcePercentages: Record<string, number> = {};
  for (const [source, count] of Object.entries(sourceCounts)) {
    sourcePercentages[source] = Math.round((count / episodes.length) * 100);
  }

  logger.info("Analyzed source distribution", {
    sources: Object.keys(sourceCounts).length,
    distribution: sourcePercentages,
  });

  return sourcePercentages;
}

/**
 * Track temporal patterns (time-based metrics)
 */
function trackTemporalPatterns(episodes: EpisodicNode[]): TemporalMetrics {
  const dates = episodes.map((e) => e.createdAt).sort((a, b) => a.getTime() - b.getTime());

  const oldestEpisode = dates[0];
  const newestEpisode = dates[dates.length - 1];

  const timeSpanMs = newestEpisode.getTime() - oldestEpisode.getTime();
  const timeSpanDays = Math.ceil(timeSpanMs / (1000 * 60 * 60 * 24));
  const episodesPerMonth =
    timeSpanDays > 0 ? Math.round((episodes.length / timeSpanDays) * 30) : episodes.length;

  logger.info("Tracked temporal patterns", {
    timeSpanDays,
    episodesPerMonth,
  });

  return {
    oldestEpisode,
    newestEpisode,
    timeSpanDays,
    episodesPerMonth,
  };
}

/**
 * Extract explicit metrics/receipts from episodes
 * Looks for numbers like "38%", "20k users", "$5M", etc.
 */
function extractReceipts(episodes: EpisodicNode[]): string[] {
  const receipts = new Set<string>();

  // Patterns to match metrics
  const patterns = [
    /\b\d+%\b/g, // Percentages: 38%
    /\b\d+[kKmMbB]\s*(?:users|customers|downloads|visits|views)\b/gi, // Scaled numbers: 20k users
    /\$\d+[kKmMbB]?\b/g, // Money: $5M, $150k
    /\b\d+x\b/gi, // Multipliers: 10x
    /\b\d+\.\d+\s*(?:seconds|minutes|hours|days)\b/gi, // Time metrics: 2.5 seconds
  ];

  for (const episode of episodes) {
    for (const pattern of patterns) {
      const matches = episode.content.match(pattern);
      if (matches) {
        matches.forEach((match) => receipts.add(match));
      }
    }
  }

  logger.info("Extracted receipts", {
    count: receipts.size,
  });

  return Array.from(receipts).slice(0, 20); // Top 20 receipts
}

function getEmptyAnalytics(): PersonaAnalytics {
  return {
    totalEpisodes: 0,
    lexicon: {},
    style: {
      avgSentenceLength: 0,
      avgParagraphLength: 0,
      bulletUsage: 0,
      codeBlockFrequency: 0,
      emphasisPatterns: {
        bold: 0,
        italic: 0,
        caps: 0,
      },
    },
    sources: {},
    temporal: {
      oldestEpisode: new Date(),
      newestEpisode: new Date(),
      timeSpanDays: 0,
      episodesPerMonth: 0,
    },
    receipts: [],
  };
}

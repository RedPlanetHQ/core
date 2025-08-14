#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const axios = require("axios");
/**
 * LOCOMO Q&A Evaluation Script
 * Evaluates question answering against ingested LOCOMO conversations
 * Assumes conversations are already ingested via ingest_conversations.js
 */

class LocomoEvaluator {
  constructor(baseUrl = "http://localhost:3033") {
    this.baseUrl = baseUrl;
    this.headers = {
      Authorization: "Bearer rc_pat_92bdumc45dwwmfxrr4xy2bk96pstt1j7opj6t412",
    };
    this.results = [];

    // Create axios instance with default config
    this.axios = axios.create({
      baseURL: this.baseUrl,
      headers: this.headers,
      timeout: 10000,
    });
  }

  async makeRequest(endpoint, data) {
    try {
      const response = await this.axios.post(endpoint, data, {
        headers: {
          "Content-Type": "application/json",
        },
      });
      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(`HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        throw new Error(`No response received: ${error.message}`);
      } else {
        throw new Error(`Request error: ${error.message}`);
      }
    }
  }
  async searchMemory(question, conversationId = null) {
    try {
      const response = await this.makeRequest("/api/v1/search", {
        query: question,
        limit: 10,
      });

      return response;
    } catch (error) {
      console.error("Search error:", error.message);
      return { results: [] };
    }
  }

  async evaluateQuestion(question, expectedAnswer, evidence, conversationId, category) {
    // Search for relevant context
    const searchResults = await this.searchMemory(question, conversationId);

    // Handle different API response formats
    const episodes = searchResults.episodes || searchResults.results || [];
    
    // Extract relevant context
    const context = episodes.map((episode) => {
      if (typeof episode === 'string') {
        return episode;
      }
      return episode.content || episode.text || episode;
    }).join("\n");

    // Basic relevance scoring
    const hasContext = episodes.length > 0;
    const contextLength = context.length;

    // Check if expected answer appears in context (simple matching)
    const answerInContext = context.toLowerCase().includes(expectedAnswer.toString().toLowerCase());

    return {
      question,
      expectedAnswer,
      evidence,
      category,
      searchContext: context,
      searchResultsCount: episodes.length,
      hasContext,
      contextLength,
      answerInContext,
      conversationId,
      facts: searchResults.facts || [],
    };
  }

  async evaluateConversation(conversation, conversationId) {
    console.log(`Evaluating conversation ${conversationId}...`);

    const qaResults = [];
    const totalQuestions = conversation.qa.length;

    for (const [index, qa] of conversation.qa.entries()) {
      if (index === 0) {
        try {
          const result = await this.evaluateQuestion(
            qa.question,
            qa.answer,
            qa.evidence,
            conversationId,
            qa.category
          );

          qaResults.push(result);

          // Progress indicator
          if ((index + 1) % 25 === 0) {
            console.log(`  Evaluated ${index + 1}/${totalQuestions} questions`);
          }

          // Small delay to avoid overwhelming the system
          await new Promise((resolve) => setTimeout(resolve, 25));
        } catch (error) {
          console.error(`Error evaluating question ${index}:`, error.message);
        }
      }
    }

    return qaResults;
  }

  async runEvaluation() {
    console.log("Starting LOCOMO Q&A evaluation...");

    // Load LOCOMO dataset
    const dataPath = path.join(__dirname, "data", "locomo10.json");
    const conversations = JSON.parse(fs.readFileSync(dataPath, "utf8"));

    console.log(`Loaded ${conversations.length} conversations for evaluation`);

    // Evaluate each conversation
    for (let i = 0; i < conversations.length; i++) {
      const conversation = conversations[i];
      const conversationId = `locomo_${i + 1}`;

      if (i === 0) {
        try {
          const results = await this.evaluateConversation(conversation, conversationId);
          this.results.push({
            conversationId,
            results,
            totalQuestions: conversation.qa.length,
          });
        } catch (error) {
          console.error(`Error evaluating conversation ${conversationId}:`, error.message);
        }
      }
    }

    // Save and summarize results
    this.saveResults();
    this.printDetailedSummary();
  }

  saveResults() {
    const resultsPath = path.join(__dirname, "evaluation_results.json");
    const timestamp = new Date().toISOString();

    const output = {
      timestamp,
      summary: this.calculateSummaryStats(),
      conversations: this.results,
    };

    fs.writeFileSync(resultsPath, JSON.stringify(output, null, 2));
    console.log(`\nResults saved to ${resultsPath}`);
  }

  calculateSummaryStats() {
    const totalQuestions = this.results.reduce((sum, conv) => sum + conv.totalQuestions, 0);
    const questionsWithContext = this.results.reduce(
      (sum, conv) => sum + conv.results.filter((r) => r.hasContext).length,
      0
    );
    const questionsWithAnswerInContext = this.results.reduce(
      (sum, conv) => sum + conv.results.filter((r) => r.answerInContext).length,
      0
    );

    // Category breakdown
    const categoryStats = {};
    this.results.forEach((conv) => {
      conv.results.forEach((result) => {
        const cat = result.category || "unknown";
        if (!categoryStats[cat]) {
          categoryStats[cat] = { total: 0, withContext: 0, withAnswer: 0 };
        }
        categoryStats[cat].total++;
        if (result.hasContext) categoryStats[cat].withContext++;
        if (result.answerInContext) categoryStats[cat].withAnswer++;
      });
    });

    return {
      totalQuestions,
      questionsWithContext,
      questionsWithAnswerInContext,
      contextRetrievalRate: ((questionsWithContext / totalQuestions) * 100).toFixed(1),
      answerFoundRate: ((questionsWithAnswerInContext / totalQuestions) * 100).toFixed(1),
      categoryBreakdown: categoryStats,
    };
  }

  printDetailedSummary() {
    const stats = this.calculateSummaryStats();

    console.log("\n=== LOCOMO EVALUATION RESULTS ===");
    console.log(`Total conversations: ${this.results.length}`);
    console.log(`Total questions: ${stats.totalQuestions}`);
    console.log(
      `Questions with retrieved context: ${stats.questionsWithContext}/${stats.totalQuestions} (${stats.contextRetrievalRate}%)`
    );
    console.log(
      `Questions with answer in context: ${stats.questionsWithAnswerInContext}/${stats.totalQuestions} (${stats.answerFoundRate}%)`
    );

    console.log("\n=== CATEGORY BREAKDOWN ===");
    Object.entries(stats.categoryBreakdown).forEach(([category, stats]) => {
      console.log(
        `Category ${category}: ${stats.withAnswer}/${stats.total} (${((stats.withAnswer / stats.total) * 100).toFixed(1)}%) answers found`
      );
    });

    console.log("\n=== PERFORMANCE INSIGHTS ===");
    const avgContextLength =
      this.results.reduce(
        (sum, conv) => sum + conv.results.reduce((s, r) => s + r.contextLength, 0),
        0
      ) / stats.totalQuestions;
    console.log(`Average context length: ${avgContextLength.toFixed(0)} characters`);

    console.log("\nNote: This evaluation measures retrieval performance. For accuracy scoring,");
    console.log("consider implementing LLM-based answer generation and comparison.");
  }
}

// Command line interface
if (require.main === module) {
  const evaluator = new LocomoEvaluator();
  evaluator.runEvaluation().catch(console.error);
}

module.exports = LocomoEvaluator;

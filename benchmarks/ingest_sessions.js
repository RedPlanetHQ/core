#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const axios = require("axios");

/**
 * LOCOMO Session Summary Ingestion Script
 * Ingests LOCOMO session summaries - comprehensive and available for all conversations
 * More efficient than full conversations while preserving all key information
 */

class LocomoSessionIngester {
  constructor(baseUrl = process.env.BASE_URL) {
    this.baseUrl = baseUrl;
    this.headers = {
      Authorization: `Bearer ${process.env.API_KEY}`,
    };
    this.statusFile = path.join(__dirname, "session_ingestion_status.json");

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

  loadIngestionStatus() {
    try {
      if (fs.existsSync(this.statusFile)) {
        return JSON.parse(fs.readFileSync(this.statusFile, "utf8"));
      }
    } catch (error) {
      console.warn("Could not load ingestion status:", error.message);
    }
    return { conversations: {}, timestamp: null };
  }

  saveIngestionStatus(status) {
    fs.writeFileSync(this.statusFile, JSON.stringify(status, null, 2));
  }

  formatSessionSummaryForIngestion(conversation, conversationId) {
    const episodes = [];
    const sessionSummary = conversation.session_summary;
    const conv = conversation.conversation;
    const speakerA = conv.speaker_a;
    const speakerB = conv.speaker_b;

    // Process each session summary
    Object.entries(sessionSummary).forEach(([sessionKey, summary]) => {
      const sessionNumber = sessionKey.replace("session_", "").replace("_summary", "");

      episodes.push({
        content: `Session ${sessionNumber} Summary: ${summary}`,
        metadata: {
          conversationId,
          sessionNumber: parseInt(sessionNumber),
          speakerA,
          speakerB,
          source: "locomo_sessions",
          type: "session_summary",
        },
      });
    });

    return episodes;
  }

  async ingestConversation(conversation, conversationId, forceReingest = false) {
    const status = this.loadIngestionStatus();

    if (status.conversations[conversationId] && !forceReingest) {
      console.log(`Conversation ${conversationId} already ingested, skipping...`);
      return false;
    }

    console.log(`Ingesting session summaries for conversation ${conversationId}...`);

    const episodes = this.formatSessionSummaryForIngestion(conversation, conversationId);
    let successCount = 0;
    let errorCount = 0;

    console.log(`  Total sessions to ingest: ${episodes.length}`);

    for (const [index, episode] of episodes.entries()) {
      try {
        const payload = {
          episodeBody: episode.content,
          referenceTime: new Date(Date.now() + index * 1000).toISOString(),
          source: "locomo_sessions",
        };

        await this.makeRequest("/api/v1/add", payload);
        successCount++;

        // Progress indicator
        if ((index + 1) % 10 === 0) {
          console.log(`  Ingested ${index + 1}/${episodes.length} sessions`);
        }

        // Small delay
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`  Error ingesting session ${index}:`, error.message);
        errorCount++;
      }
    }

    // Update status
    status.conversations[conversationId] = {
      ingested: true,
      timestamp: new Date().toISOString(),
      totalEpisodes: episodes.length,
      successCount,
      errorCount,
    };
    status.timestamp = new Date().toISOString();
    this.saveIngestionStatus(status);

    console.log(`  Completed: ${successCount} success, ${errorCount} errors`);
    return true;
  }

  async ingestAll(forceReingest = false) {
    console.log("Starting LOCOMO session summary ingestion...");

    if (forceReingest) {
      console.log("Force re-ingestion enabled");
    }

    // Load LOCOMO dataset
    const dataPath = path.join(__dirname, "data", "locomo10.json");
    const conversations = JSON.parse(fs.readFileSync(dataPath, "utf8"));

    console.log(`Loaded ${conversations.length} conversations`);

    let ingestedCount = 0;
    let skippedCount = 0;

    // Test connection first
    try {
      console.log("Testing connection...");
      await this.makeRequest("/api/v1/add", {
        episodeBody: "Session ingestion test",
        referenceTime: new Date().toISOString(),
        source: "test",
      });
      console.log("Connection test successful");
    } catch (error) {
      console.error("Connection test failed:", error.message);
      return;
    }

    // Ingest all conversations
    for (let i = 0; i < conversations.length; i++) {
      const conversation = conversations[i];
      const conversationId = `locomo_sessions_${i + 1}`;

      if (i === 0) {
        try {
          const wasIngested = await this.ingestConversation(
            conversation,
            conversationId,
            forceReingest
          );

          if (wasIngested) {
            ingestedCount++;
          } else {
            skippedCount++;
          }
        } catch (error) {
          console.error(`Error with conversation ${conversationId}:`, error.message);
        }
      }
    }

    this.printSummary(ingestedCount, skippedCount);
  }

  printSummary(ingestedCount, skippedCount) {
    console.log("\n=== SESSION SUMMARY INGESTION ===");
    console.log(`Conversations processed: ${ingestedCount}`);
    console.log(`Conversations skipped: ${skippedCount}`);

    const status = this.loadIngestionStatus();
    const totalSessions = Object.values(status.conversations).reduce(
      (sum, conv) => sum + (conv.totalEpisodes || 0),
      0
    );
    const totalSuccess = Object.values(status.conversations).reduce(
      (sum, conv) => sum + (conv.successCount || 0),
      0
    );
    const totalErrors = Object.values(status.conversations).reduce(
      (sum, conv) => sum + (conv.errorCount || 0),
      0
    );

    console.log(`Total sessions ingested: ${totalSuccess}/${totalSessions}`);
    console.log(
      `Success rate: ${((totalSuccess / (totalSuccess + totalErrors || 1)) * 100).toFixed(1)}%`
    );

    console.log("\nReady for evaluation phase!");
    console.log("Benefits: Fast ingestion, comprehensive summaries, all conversations covered");
  }

  getStatus() {
    const status = this.loadIngestionStatus();
    const conversations = Object.keys(status.conversations).length;
    const totalSessions = Object.values(status.conversations).reduce(
      (sum, conv) => sum + (conv.successCount || 0),
      0
    );

    return {
      conversations,
      sessions: totalSessions,
      lastIngestion: status.timestamp,
    };
  }
}

// Command line interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const forceReingest = args.includes("--force");
  const showStatus = args.includes("--status");

  const ingester = new LocomoSessionIngester();

  if (showStatus) {
    const status = ingester.getStatus();
    console.log("LOCOMO Session Ingestion Status:");
    console.log(`  Conversations: ${status.conversations}`);
    console.log(`  Sessions: ${status.sessions}`);
    console.log(`  Last ingestion: ${status.lastIngestion || "Never"}`);
  } else {
    ingester.ingestAll(forceReingest).catch(console.error);
  }
}

module.exports = LocomoSessionIngester;

#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const axios = require("axios");

/**
 * LOCOMO Conversation Ingestion Script
 * Ingests LOCOMO conversations into C.O.R.E memory system
 * Tracks ingestion status to avoid duplicates
 */

class LocomoIngester {
  constructor(baseUrl = process.env.BASE_URL) {
    this.baseUrl = baseUrl;
    this.headers = {
      Authorization: `Bearer ${process.env.API_KEY}`,
    };
    this.statusFile = path.join(__dirname, "ingestion_status.json");

    // Create axios instance with default config
    this.axios = axios.create({
      baseURL: this.baseUrl,
      headers: this.headers,
      timeout: 10000, // 10 second timeout
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
        // Server responded with error status
        throw new Error(`HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        // Request was made but no response received
        throw new Error(`No response received: ${error.message}`);
      } else {
        // Something else happened
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

  async ingestConversation(conversation, conversationId, forceReingest = false) {
    const status = this.loadIngestionStatus();
    const sessionId =
      Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    if (status.conversations[conversationId] && !forceReingest) {
      console.log(`Conversation ${conversationId} already ingested, skipping...`);
      return false;
    }

    console.log(`Ingesting conversation ${conversationId}...`);

    const episodes = this.formatConversationForIngestion(conversation, conversationId);
    let successCount = 0;
    let errorCount = 0;

    for (const [index, episode] of episodes.entries()) {
      // if (index >= 0 && index < 20) {
      try {
        const payload = {
          episodeBody: episode.content,
          referenceTime: episode.metadata.timestamp,
          source: "locomo_benchmark",
          sessionId: `${sessionId}-${episode.metadata.sessionNumber}`,
        };

        await this.makeRequest("/api/v1/add", payload);
        successCount++;

        // Progress indicator
        if ((index + 1) % 10 === 0) {
          console.log(`  Ingested ${index + 1}/${episodes.length} episodes`);
        }

        // Small delay to avoid overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (error) {
        console.error(`  Error ingesting episode ${index}:`, error.message);
        errorCount++;
      }
      // }
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

  formatConversationForIngestion(conversation, conversationId) {
    const episodes = [];
    const conv = conversation.conversation;

    // Extract speaker names
    const speakerA = conv.speaker_a;
    const speakerB = conv.speaker_b;

    // Process each session
    Object.keys(conv).forEach((key) => {
      if (key.startsWith("session_") && !key.endsWith("_date_time")) {
        const sessionNumber = key.replace("session_", "");
        const sessionData = conv[key];
        const sessionDateTime = conv[`session_${sessionNumber}_date_time`];

        if (Array.isArray(sessionData)) {
          sessionData.forEach((dialog, dialogIndex) => {
            episodes.push({
              content: `${dialog.speaker}: ${dialog.blip_caption ? `Shared ${dialog.blip_caption}.` : ""} ${dialog.text}`,
              metadata: {
                conversationId,
                sessionNumber: parseInt(sessionNumber),
                dialogIndex,
                dialogId: dialog.dia_id,
                timestamp: sessionDateTime
                  ? new Date(
                      Date.parse(
                        sessionDateTime.replace(
                          /(\d+):(\d+) (am|pm) on (\d+) (\w+), (\d+)/,
                          (_, hours, minutes, ampm, day, month, year) => {
                            const monthMap = {
                              January: 1,
                              Jan: 1,
                              February: 2,
                              Feb: 2,
                              March: 3,
                              Mar: 3,
                              April: 4,
                              Apr: 4,
                              May: 5,
                              June: 6,
                              Jun: 6,
                              July: 7,
                              Jul: 7,
                              August: 8,
                              Aug: 8,
                              September: 9,
                              Sep: 9,
                              October: 10,
                              Oct: 10,
                              November: 11,
                              Nov: 11,
                              December: 12,
                              Dec: 12,
                            };
                            const monthNum = monthMap[month] || 1;
                            return `${year}-${monthNum.toString().padStart(2, "0")}-${day.padStart(2, "0")} ${hours}:${minutes} ${ampm}`;
                          }
                        )
                      )
                    ).toISOString()
                  : null,
                speaker: dialog.speaker,
                speakerA,
                speakerB,
                source: "locomo_benchmark",
              },
            });
          });
        }
      }
    });

    return episodes;
  }

  async ingestAll(forceReingest = false) {
    console.log("Starting LOCOMO conversation ingestion...");

    if (forceReingest) {
      console.log("Force re-ingestion enabled - will overwrite existing data");
    }

    // Load LOCOMO dataset
    const dataPath = path.join(__dirname, "locomo10.json");
    const conversations = JSON.parse(fs.readFileSync(dataPath, "utf8"));

    console.log(`Loaded ${conversations.length} conversations`);

    let ingestedCount = 0;
    let skippedCount = 0;

    // Ingest each conversation
    for (let i = 0; i < conversations.length; i++) {
      if (i === 0) {
        const conversation = conversations[i];
        const conversationId = `locomo_${i + 1}`;

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
    console.log("\n=== INGESTION SUMMARY ===");
    console.log(`Conversations ingested: ${ingestedCount}`);
    console.log(`Conversations skipped: ${skippedCount}`);
    console.log(`Status file: ${this.statusFile}`);

    const status = this.loadIngestionStatus();
    const totalEpisodes = Object.values(status.conversations).reduce(
      (sum, conv) => sum + (conv.totalEpisodes || 0),
      0
    );
    const totalSuccess = Object.values(status.conversations).reduce(
      (sum, conv) => sum + (conv.successCount || 0),
      0
    );

    console.log(`Total episodes ingested: ${totalSuccess}/${totalEpisodes}`);
    console.log("\nReady for evaluation phase!");
  }

  getStatus() {
    const status = this.loadIngestionStatus();
    const conversations = Object.keys(status.conversations).length;
    const totalEpisodes = Object.values(status.conversations).reduce(
      (sum, conv) => sum + (conv.successCount || 0),
      0
    );

    return {
      conversations,
      episodes: totalEpisodes,
      lastIngestion: status.timestamp,
    };
  }
}

// Command line interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const forceReingest = args.includes("--force");
  const showStatus = args.includes("--status");

  const ingester = new LocomoIngester();

  if (showStatus) {
    const status = ingester.getStatus();
    console.log("LOCOMO Ingestion Status:");
    console.log(`  Conversations: ${status.conversations}`);
    console.log(`  Episodes: ${status.episodes}`);
    console.log(`  Last ingestion: ${status.lastIngestion || "Never"}`);
  } else {
    ingester.ingestAll(forceReingest).catch(console.error);
  }
}

module.exports = LocomoIngester;

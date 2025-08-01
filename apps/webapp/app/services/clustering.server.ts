import { type CoreMessage } from "ai";
import { logger } from "./logger.service";
import { runQuery } from "~/lib/neo4j.server";
import { makeModelCall } from "~/lib/model.server";
import crypto from "crypto";

export interface ClusterNode {
  uuid: string;
  name: string;
  aspectType: "thematic" | "social" | "activity";
  description?: string;
  size: number;
  createdAt: Date;
  userId: string;
  cohesionScore?: number;
}

export interface StatementSimilarityEdge {
  sourceStatementId: string;
  targetStatementId: string;
  weight: number;
  sharedEntities: string[];
}

export interface DriftMetrics {
  intraCohesion: number;
  sizeImbalance: number;
  newEntityConcentration: number;
  shouldRecluster: boolean;
}

export class ClusteringService {
  private readonly MIN_CLUSTER_SIZE = 10;
  private readonly LEIDEN_GAMMA = 0.7;
  private readonly LEIDEN_MAX_LEVELS = 5;
  private readonly LEIDEN_TOLERANCE = 0.001;
  private readonly COHESION_THRESHOLD = 0.6;

  /**
   * Create weighted edges between Statement nodes based on shared entities
   * Can be run incrementally for new statements or as complete rebuild
   */
  async createStatementSimilarityGraph(
    userId: string,
    incremental: boolean = false,
  ): Promise<void> {
    logger.info(
      `Creating statement similarity graph for clustering (${incremental ? "incremental" : "complete"})`,
    );

    const query = `
        MATCH (s1:Statement)-[:HAS_SUBJECT|HAS_PREDICATE|HAS_OBJECT]->(e:Entity)<-[:HAS_SUBJECT|HAS_PREDICATE|HAS_OBJECT]-(s2:Statement)
        WHERE s1.userId = $userId 
          AND s2.userId = $userId
          AND s1.invalidAt IS NULL 
          AND s2.invalidAt IS NULL
          AND id(s1) < id(s2)
        WITH s1, s2, collect(DISTINCT e.uuid) as sharedEntities
        WHERE size(sharedEntities) > 0
        MERGE (s1)-[r:SIMILAR_TO]-(s2)
        SET r.weight = size(sharedEntities) * 2,
            r.sharedEntities = sharedEntities,
            r.createdAt = datetime()
        RETURN count(r) as edgesCreated
      `;
    const result = await runQuery(query, { userId });
    const edgesCreated = result[0]?.get("edgesCreated") || 0;

    logger.info(
      `${incremental ? "Updated" : "Created"} ${edgesCreated} similarity edges between statements`,
    );
  }

  /**
   * Execute Leiden algorithm for community detection on statement similarity graph
   */
  async executeLeidenClustering(
    userId: string,
    incremental: boolean = false,
  ): Promise<void> {
    logger.info(
      `Executing Leiden clustering algorithm (${incremental ? "incremental" : "complete"})`,
    );

    // Create/update the similarity graph
    await this.createStatementSimilarityGraph(userId, incremental);

    const clusteringQuery = `
      MATCH (source:Statement) WHERE source.userId = $userId
      OPTIONAL MATCH (source)-[r:SIMILAR_TO]->(target:Statement) 
      WHERE target.userId = $userId
      WITH gds.graph.project(
        'statementSimilarity_' + $userId,
        source,
        target,
        {
          relationshipProperties: r { .weight }
        },
        { undirectedRelationshipTypes: ['*'] }
      ) AS g

      CALL gds.leiden.write(
        g.graphName,
        {
          writeProperty: 'tempClusterId',
          relationshipWeightProperty: 'weight',
          gamma: 0.7,
          maxLevels: 10,
          tolerance: 0.001
        }
      )
      YIELD communityCount

      CALL gds.graph.drop(g.graphName)
      YIELD graphName as droppedGraphName

      RETURN communityCount, g.nodeCount, g.relationshipCount
    `;

    const result = await runQuery(clusteringQuery, {
      userId,
      gamma: this.LEIDEN_GAMMA,
      maxLevels: this.LEIDEN_MAX_LEVELS,
      tolerance: this.LEIDEN_TOLERANCE,
    });

    const communityCount = result[0]?.get("communityCount") || 0;
    logger.info(`Leiden clustering found ${communityCount} communities`);

    // Filter clusters by minimum size and assign final cluster IDs
    await this.filterAndAssignClusters(userId, incremental);

    const removeRelationsQuery = `
            MATCH (s1:Statement)-[r:SIMILAR_TO]-(s2:Statement)
        WHERE s1.userId = $userId AND s2.userId = $userId
        DELETE r`;

    await runQuery(removeRelationsQuery, { userId });
  }

  /**
   * Perform incremental clustering for new statements
   */
  async performIncrementalClustering(userId: string): Promise<{
    newStatementsProcessed: number;
    newClustersCreated: number;
  }> {
    logger.info(`Starting incremental clustering for user ${userId}`);

    try {
      // Check if there are unclustered statements
      const unclusteredQuery = `
        MATCH (s:Statement)
        WHERE s.userId = $userId AND s.clusterId IS NULL AND s.invalidAt IS NULL
        RETURN count(s) as unclusteredCount
      `;

      const unclusteredResult = await runQuery(unclusteredQuery, { userId });
      const unclusteredCount =
        unclusteredResult[0]?.get("unclusteredCount") || 0;

      if (unclusteredCount === 0) {
        logger.info(
          "No unclustered statements found, skipping incremental clustering",
        );
        return {
          newStatementsProcessed: 0,
          newClustersCreated: 0,
        };
      }

      logger.info(`Found ${unclusteredCount} unclustered statements`);

      let newClustersCreated = 0;
      // Run incremental clustering on remaining statements
      await this.executeLeidenClustering(userId, true);
      await this.createClusterNodes(userId);

      // Count new clusters created
      const newClustersQuery = `
          MATCH (c:Cluster)
          WHERE c.userId = $userId AND c.createdAt > datetime() - duration('PT5M')
          RETURN count(c) as newClusters
        `;
      const newClustersResult = await runQuery(newClustersQuery, { userId });
      newClustersCreated = newClustersResult[0]?.get("newClusters") || 0;

      const drift = await this.detectClusterDrift(userId);
      const newClustersCreatedDrift = 0;
      if (drift.driftDetected) {
        logger.info("Cluster drift detected, evolving clusters");
        const { newClustersCreated: newClustersCreatedDrift, splitClusters } =
          await this.handleClusterDrift(userId);

        if (splitClusters.length > 0) {
          logger.info("Split clusters detected, evolving clusters");
        }
      }

      return {
        newStatementsProcessed: unclusteredCount,
        newClustersCreated: newClustersCreated + newClustersCreatedDrift,
      };
    } catch (error) {
      logger.error("Error in incremental clustering:", { error });
      throw error;
    }
  }

  /**
   * Perform complete clustering (for new users or full rebuilds)
   */
  async performCompleteClustering(userId: string): Promise<{
    clustersCreated: number;
    statementsProcessed: number;
  }> {
    logger.info(`Starting complete clustering for user ${userId}`);

    try {
      // Clear any existing cluster assignments
      await runQuery(
        `
        MATCH (s:Statement)
        WHERE s.userId = $userId
        REMOVE s.clusterId, s.tempClusterId
      `,
        { userId },
      );

      // Clear statement-to-statement similarity relationships
      await runQuery(
        `
        MATCH (s1:Statement)-[r:SIMILAR_TO]-(s2:Statement)
        WHERE s1.userId = $userId AND s2.userId = $userId
        DELETE r
      `,
        { userId },
      );

      // Clear existing cluster nodes
      await runQuery(
        `
        MATCH (c:Cluster)
        WHERE c.userId = $userId
        DETACH DELETE c
      `,
        { userId },
      );

      // Execute complete clustering pipeline
      await this.executeLeidenClustering(userId, false);
      await this.createClusterNodes(userId);

      // Get results
      const resultsQuery = `
        MATCH (c:Cluster) WHERE c.userId = $userId
        WITH count(c) as clusters
        MATCH (s:Statement) WHERE s.userId = $userId AND s.clusterId IS NOT NULL
        RETURN clusters, count(s) as statementsProcessed
      `;

      const results = await runQuery(resultsQuery, { userId });
      const clustersCreated = results[0]?.get("clusters") || 0;
      const statementsProcessed = results[0]?.get("statementsProcessed") || 0;

      logger.info(
        `Complete clustering finished: ${clustersCreated} clusters, ${statementsProcessed} statements processed`,
      );

      return { clustersCreated, statementsProcessed };
    } catch (error) {
      logger.error("Error in complete clustering:", { error });
      throw error;
    }
  }

  /**
   * Filter clusters by minimum size and assign final cluster IDs
   */
  private async filterAndAssignClusters(
    userId: string,
    incremental: boolean = false,
  ): Promise<void> {
    const filterQuery = `
      // Step 1: Get all temp cluster groups and their total sizes
      MATCH (s:Statement)
      WHERE s.userId = $userId AND s.tempClusterId IS NOT NULL
      WITH s.tempClusterId as tempId, collect(s) as allStatements
      
      // Step 2: Filter by minimum size
      WHERE size(allStatements) >= $minSize
      
      // Step 3: Check if any statements already have a permanent clusterId
      WITH tempId, allStatements,
          [stmt IN allStatements WHERE stmt.clusterId IS NOT NULL] as existingClustered,
          [stmt IN allStatements WHERE stmt.clusterId IS NULL] as newStatements
      
      // Step 4: Determine the final cluster ID
      WITH tempId, allStatements, existingClustered, newStatements,
          CASE 
            WHEN size(existingClustered) > 0 THEN existingClustered[0].clusterId
            ELSE toString(randomUUID())
          END as finalClusterId
      
      // Step 5: Assign cluster ID to new statements (handles empty arrays gracefully)
      FOREACH (stmt IN newStatements | 
        SET stmt.clusterId = finalClusterId
        REMOVE stmt.tempClusterId
      )
      
      // Step 6: Clean up temp IDs from existing statements
      FOREACH (existingStmt IN existingClustered |
        REMOVE existingStmt.tempClusterId
      )
      
      RETURN count(DISTINCT finalClusterId) as validClusters
    `;

    const result = await runQuery(filterQuery, {
      userId,
      minSize: this.MIN_CLUSTER_SIZE,
    });

    // Remove temp cluster IDs from statements that didn't meet minimum size
    await runQuery(
      `
      MATCH (s:Statement)
      WHERE s.userId = $userId AND s.tempClusterId IS NOT NULL
      REMOVE s.tempClusterId
    `,
      { userId },
    );

    const validClusters = result[0]?.get("validClusters") || 0;

    if (incremental) {
      await this.updateClusterEmbeddings(userId);
    }
    logger.info(
      `${incremental ? "Updated" : "Created"} ${validClusters} valid clusters after size filtering`,
    );
  }

  /**
   * Create Cluster nodes with metadata (hybrid storage approach)
   * Only creates cluster nodes for cluster IDs that don't already exist
   */
  async createClusterNodes(userId: string): Promise<void> {
    logger.info("Creating cluster metadata nodes for new clusters only");

    const query = `
      MATCH (s:Statement)
      WHERE s.userId = $userId AND s.clusterId IS NOT NULL
      WITH s.clusterId as clusterId, collect(s) as statements
      
      // Only process cluster IDs that don't already have a Cluster node
      WHERE NOT EXISTS {
        MATCH (existing:Cluster {uuid: clusterId, userId: $userId})
      }
      
      // Get representative entities for naming
      UNWIND statements as stmt
      MATCH (stmt)-[:HAS_SUBJECT]->(subj:Entity)
      MATCH (stmt)-[:HAS_PREDICATE]->(pred:Entity)  
      MATCH (stmt)-[:HAS_OBJECT]->(obj:Entity)
      
      WITH clusterId, statements,
           collect(DISTINCT subj.name) as subjects,
           collect(DISTINCT pred.name) as predicates,
           collect(DISTINCT obj.name) as objects
      
      // Get top 10 most frequent entities of each type
      WITH clusterId, statements,
           apoc.coll.frequencies(subjects)[0..10] as topSubjects,
           apoc.coll.frequencies(predicates)[0..10] as topPredicates,
           apoc.coll.frequencies(objects)[0..10] as topObjects
      
      // Calculate cluster embedding as average of statement embeddings
      WITH clusterId, statements, topSubjects, topPredicates, topObjects,
           [stmt IN statements WHERE stmt.factEmbedding IS NOT NULL | stmt.factEmbedding] as validEmbeddings
      
      // Calculate average embedding (centroid)
      WITH clusterId, statements, topSubjects, topPredicates, topObjects, validEmbeddings,
           CASE 
             WHEN size(validEmbeddings) > 0 THEN
               reduce(avg = [i IN range(0, size(validEmbeddings[0])-1) | 0.0], 
                      embedding IN validEmbeddings | 
                      [i IN range(0, size(embedding)-1) | avg[i] + embedding[i] / size(validEmbeddings)])
             ELSE null
           END as clusterEmbedding

      CREATE (c:Cluster {
        uuid: clusterId,
        size: size(statements),
        createdAt: datetime(),
        userId: $userId,
        topSubjects: [item in topSubjects | item.item],
        topPredicates: [item in topPredicates | item.item],
        topObjects: [item in topObjects | item.item],
        clusterEmbedding: clusterEmbedding,
        embeddingCount: size(validEmbeddings),
        needsNaming: true
      })
      
      RETURN count(c) as clustersCreated
    `;

    const result = await runQuery(query, { userId });
    const clustersCreated = result[0]?.get("clustersCreated") || 0;

    logger.info(`Created ${clustersCreated} new cluster metadata nodes`);

    // Only generate names for new clusters (those with needsNaming = true)
    if (clustersCreated > 0) {
      await this.generateClusterNames(userId);
    }
  }

  /**
   * Calculate TF-IDF scores for a specific cluster
   *
   * Uses cluster-based document frequency (not statement-based) for optimal cluster naming:
   * - TF: How often a term appears within this specific cluster
   * - DF: How many clusters (not statements) contain this term
   * - IDF: log(total_clusters / clusters_containing_term)
   *
   * This approach identifies terms that are frequent in THIS cluster but rare across OTHER clusters,
   * making them highly distinctive for cluster naming and differentiation.
   *
   * Example: "SOL" appears in 100/100 statements in Cluster A, but only 1/10 total clusters
   * - Cluster-based IDF: log(10/1) = high distinctiveness ✓ (good for naming)
   * - Statement-based IDF: log(1000/100) = lower distinctiveness (less useful for naming)
   */
  private async calculateClusterTFIDFForCluster(
    userId: string,
    targetClusterId: string,
  ): Promise<{
    subjects: Array<{ term: string; score: number }>;
    predicates: Array<{ term: string; score: number }>;
    objects: Array<{ term: string; score: number }>;
  } | null> {
    // Get all clusters and their entity frequencies (needed for cluster-based IDF calculation)
    // We need ALL clusters to calculate how rare each term is across the cluster space
    const allClustersQuery = `
    MATCH (s:Statement)
    WHERE s.userId = $userId AND s.clusterId IS NOT NULL
    MATCH (s)-[:HAS_SUBJECT]->(subj:Entity)
    MATCH (s)-[:HAS_PREDICATE]->(pred:Entity)  
    MATCH (s)-[:HAS_OBJECT]->(obj:Entity)
    WITH s.clusterId as clusterId, 
         collect(DISTINCT subj.name) as subjects,
         collect(DISTINCT pred.name) as predicates,
         collect(DISTINCT obj.name) as objects
    RETURN clusterId, subjects, predicates, objects
  `;

    const allClusters = await runQuery(allClustersQuery, {
      userId,
    });

    // Build document frequency maps from all clusters
    // DF = number of clusters that contain each term (not number of statements)
    const subjectDF = new Map<string, number>();
    const predicateDF = new Map<string, number>();
    const objectDF = new Map<string, number>();
    const totalClusters = allClusters.length;

    // Calculate cluster-based document frequencies
    // For each term, count how many different clusters it appears in
    for (const record of allClusters) {
      const subjects = (record.get("subjects") as string[]) || [];
      const predicates = (record.get("predicates") as string[]) || [];
      const objects = (record.get("objects") as string[]) || [];

      // Count unique terms per cluster (each cluster contributes max 1 to DF for each term)
      new Set(subjects).forEach((term) => {
        subjectDF.set(term, (subjectDF.get(term) || 0) + 1);
      });
      new Set(predicates).forEach((term) => {
        predicateDF.set(term, (predicateDF.get(term) || 0) + 1);
      });
      new Set(objects).forEach((term) => {
        objectDF.set(term, (objectDF.get(term) || 0) + 1);
      });
    }

    // Find the target cluster data for TF calculation
    const targetCluster = allClusters.find(
      (record) => record.get("clusterId") === targetClusterId,
    );

    if (!targetCluster) {
      return null;
    }

    const subjects = (targetCluster.get("subjects") as string[]) || [];
    const predicates = (targetCluster.get("predicates") as string[]) || [];
    const objects = (targetCluster.get("objects") as string[]) || [];

    // Calculate term frequencies within this specific cluster
    // TF = how often each term appears in this cluster's statements
    const subjectTF = new Map<string, number>();
    const predicateTF = new Map<string, number>();
    const objectTF = new Map<string, number>();

    subjects.forEach((term) => {
      subjectTF.set(term, (subjectTF.get(term) || 0) + 1);
    });
    predicates.forEach((term) => {
      predicateTF.set(term, (predicateTF.get(term) || 0) + 1);
    });
    objects.forEach((term) => {
      objectTF.set(term, (objectTF.get(term) || 0) + 1);
    });

    // Calculate TF-IDF scores using cluster-based document frequency
    // Higher scores = terms frequent in THIS cluster but rare across OTHER clusters
    const calculateTFIDF = (
      tf: Map<string, number>,
      df: Map<string, number>,
      totalTerms: number,
    ) => {
      return Array.from(tf.entries())
        .map(([term, freq]) => {
          // TF: Normalized frequency within this cluster
          const termFreq = freq / totalTerms;

          // DF: Number of clusters containing this term
          const docFreq = df.get(term) || 1;

          // IDF: Inverse document frequency (cluster-based)
          // Higher when term appears in fewer clusters
          const idf = Math.log(totalClusters / docFreq);

          // TF-IDF: Final distinctiveness score
          const tfidf = termFreq * idf;

          return { term, score: tfidf };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 10); // Top 10 most distinctive terms
    };

    return {
      subjects: calculateTFIDF(subjectTF, subjectDF, subjects.length),
      predicates: calculateTFIDF(predicateTF, predicateDF, predicates.length),
      objects: calculateTFIDF(objectTF, objectDF, objects.length),
    };
  }

  /**
   * Generate cluster names using LLM based on TF-IDF analysis
   */
  private async generateClusterNames(userId: string): Promise<void> {
    logger.info("Generating cluster names using TF-IDF analysis");

    const getClustersQuery = `
    MATCH (c:Cluster)
    WHERE c.userId = $userId AND c.needsNaming = true
    RETURN c.uuid as clusterId, c.size as size
  `;

    const clusters = await runQuery(getClustersQuery, { userId });

    for (const record of clusters) {
      const clusterId = record.get("clusterId");
      const size = record.get("size");

      // Calculate TF-IDF only for this specific cluster
      const tfidfData = await this.calculateClusterTFIDFForCluster(
        userId,
        clusterId,
      );
      if (!tfidfData) {
        logger.warn(`No TF-IDF data found for cluster ${clusterId}`);
        continue;
      }

      const namingPrompt = this.createTFIDFClusterNamingPrompt({
        ...tfidfData,
        size,
      });

      let responseText = "";
      await makeModelCall(false, namingPrompt, (text) => {
        responseText = text;
      });

      try {
        const outputMatch = responseText.match(/<output>([\s\S]*?)<\/output>/);
        if (outputMatch && outputMatch[1]) {
          const response = JSON.parse(outputMatch[1].trim());

          const updateQuery = `
          MATCH (c:Cluster {uuid: $clusterId})
          SET c.name = $name,
              c.description = $description,
              c.needsNaming = false
        `;

          await runQuery(updateQuery, {
            clusterId,
            name: response.name || `Cluster ${clusterId}`,
            description: response.description || null,
          });
        }
      } catch (error) {
        logger.error(`Error naming cluster ${clusterId}:`, { error });

        // Fallback naming
        await runQuery(
          `
        MATCH (c:Cluster {uuid: $clusterId})
        SET c.name = 'Cluster ' + substring($clusterId, 0, 8),
            c.needsNaming = false
      `,
          { clusterId },
        );
      }
    }
  }

  /**
   * Create prompt for unsupervised cluster naming using TF-IDF scores
   */
  private createTFIDFClusterNamingPrompt(data: {
    subjects: Array<{ term: string; score: number }>;
    predicates: Array<{ term: string; score: number }>;
    objects: Array<{ term: string; score: number }>;
    size: number;
  }): CoreMessage[] {
    const formatTerms = (terms: Array<{ term: string; score: number }>) =>
      terms.map((t) => `"${t.term}" (${t.score.toFixed(3)})`).join(", ");

    return [
      {
        role: "system",
        content: `You are an expert at analyzing semantic patterns and creating descriptive cluster names. You will receive TF-IDF scores showing the most distinctive terms for a cluster of knowledge graph statements.

        TF-IDF Analysis:
        - Higher scores = terms that are frequent in THIS cluster but rare in OTHER clusters
        - These scores reveal what makes this cluster semantically unique
        - Focus on the highest-scoring terms as they are the most distinctive

        Knowledge Graph Context:
        - Subjects: Who or what is performing actions
        - Predicates: The relationships, actions, or connections
        - Objects: Who or what is being acted upon or referenced

        Naming Guidelines:
        1. Create a 2-4 word descriptive name that captures the core semantic theme
        2. Focus on the highest TF-IDF scoring terms - they reveal the cluster's uniqueness
        3. Look for patterns across subjects, predicates, and objects together
        4. Use natural language that a user would understand
        5. Avoid generic terms - be specific based on the distinctive patterns

        Return only a JSON object:
        <output>
        {
        "name": "Descriptive cluster name",
        "description": "Brief explanation of the semantic pattern based on TF-IDF analysis"
        }
        </output>`,
      },
      {
        role: "user",
        content: `Analyze this cluster of ${data.size} statements. The TF-IDF scores show what makes this cluster distinctive:

**Distinctive Subjects (TF-IDF):**
${formatTerms(data.subjects)}

**Distinctive Predicates (TF-IDF):**
${formatTerms(data.predicates)}

**Distinctive Objects (TF-IDF):**
${formatTerms(data.objects)}

Based on these distinctive patterns, what is the most accurate name for this semantic cluster?`,
      },
    ];
  }

  /**
   * Update cluster embeddings incrementally when new statements are added
   */
  private async updateClusterEmbeddings(userId: string): Promise<void> {
    logger.info("Updating cluster embeddings after new statements");

    const updateQuery = `
      MATCH (c:Cluster)
      WHERE c.userId = $userId
      
      MATCH (s:Statement {clusterId: c.uuid, userId: $userId})
      WHERE s.factEmbedding IS NOT NULL
      
      WITH c, collect(s.factEmbedding) as allEmbeddings
      WHERE size(allEmbeddings) > 0
      
      // Recalculate average embedding
      WITH c, allEmbeddings,
           reduce(avg = [i IN range(0, size(allEmbeddings[0])-1) | 0.0], 
                  embedding IN allEmbeddings | 
                  [i IN range(0, size(embedding)-1) | avg[i] + embedding[i] / size(allEmbeddings)]) as newEmbedding
      
      SET c.clusterEmbedding = newEmbedding,
          c.embeddingCount = size(allEmbeddings),
          c.lastEmbeddingUpdate = datetime()
      
      RETURN count(c) as updatedClusters
    `;

    const result = await runQuery(updateQuery, { userId });
    const updatedClusters = result[0]?.get("updatedClusters") || 0;

    logger.info(`Updated embeddings for ${updatedClusters} clusters`);
  }

  /**
   * Detect cluster drift using embedding-based cohesion analysis
   */
  async detectClusterDrift(userId: string): Promise<{
    driftDetected: boolean;
    lowCohesionClusters: string[];
    avgCohesion: number;
    reason: string;
  }> {
    logger.info("Detecting cluster drift using embedding cohesion analysis");

    // First update cluster embeddings to ensure they're current
    await this.updateClusterEmbeddings(userId);

    // Calculate cohesion for all clusters
    const cohesionQuery = `
      MATCH (c:Cluster)
      WHERE c.userId = $userId AND c.clusterEmbedding IS NOT NULL
      
      MATCH (s:Statement {clusterId: c.uuid, userId: $userId})
      WHERE s.factEmbedding IS NOT NULL
      
      WITH c, collect(s.factEmbedding) as statementEmbeddings, c.clusterEmbedding as clusterEmbedding
      WHERE size(statementEmbeddings) >= $minClusterSize
      
      // Calculate average cosine similarity for this cluster
      UNWIND statementEmbeddings as stmtEmb
      WITH c, stmtEmb, clusterEmbedding,
           reduce(dot = 0.0, i IN range(0, size(stmtEmb)-1) | dot + stmtEmb[i] * clusterEmbedding[i]) as dotProduct,
           sqrt(reduce(mag1 = 0.0, i IN range(0, size(stmtEmb)-1) | mag1 + stmtEmb[i] * stmtEmb[i])) as stmtMagnitude,
           sqrt(reduce(mag2 = 0.0, i IN range(0, size(clusterEmbedding)-1) | mag2 + clusterEmbedding[i] * clusterEmbedding[i])) as clusterMagnitude
      
      WITH c, 
           CASE 
             WHEN stmtMagnitude > 0 AND clusterMagnitude > 0 
             THEN dotProduct / (stmtMagnitude * clusterMagnitude)
             ELSE 0.0
           END as cosineSimilarity
      
      WITH c, avg(cosineSimilarity) as clusterCohesion
      
      // Update cluster with cohesion score
      SET c.cohesionScore = clusterCohesion
      
      RETURN c.uuid as clusterId, c.size as clusterSize, clusterCohesion
      ORDER BY clusterCohesion ASC
    `;

    const cohesionResults = await runQuery(cohesionQuery, {
      userId,
      minClusterSize: this.MIN_CLUSTER_SIZE,
    });

    const clusterCohesions = cohesionResults.map((record) => ({
      clusterId: record.get("clusterId"),
      size: record.get("clusterSize"),
      cohesion: record.get("clusterCohesion") || 0.0,
    }));

    const avgCohesion =
      clusterCohesions.length > 0
        ? clusterCohesions.reduce((sum, c) => sum + c.cohesion, 0) /
          clusterCohesions.length
        : 0.0;

    const lowCohesionClusters = clusterCohesions
      .filter((c) => c.cohesion < this.COHESION_THRESHOLD)
      .map((c) => c.clusterId);

    const driftDetected =
      lowCohesionClusters.length > 0 || avgCohesion < this.COHESION_THRESHOLD;

    let reason = "";
    if (lowCohesionClusters.length > 0) {
      reason = `${lowCohesionClusters.length} clusters have low cohesion (< ${this.COHESION_THRESHOLD})`;
    } else if (avgCohesion < this.COHESION_THRESHOLD) {
      reason = `Overall average cohesion (${avgCohesion.toFixed(3)}) below threshold (${this.COHESION_THRESHOLD})`;
    }

    logger.info(
      `Drift detection completed: ${driftDetected ? "DRIFT DETECTED" : "NO DRIFT"} - ${reason || "Clusters are cohesive"}`,
    );

    return {
      driftDetected,
      lowCohesionClusters,
      avgCohesion,
      reason: reason || "Clusters are cohesive",
    };
  }

  /**
   * Handle cluster evolution when drift is detected by splitting low-cohesion clusters
   */
  async evolveCluster(oldClusterId: string, userId: string): Promise<string[]> {
    logger.info(`Splitting cluster ${oldClusterId} due to low cohesion`);

    try {
      // Step 1: Get all statements from the low-cohesion cluster
      const statementsQuery = `
        MATCH (s:Statement)
        WHERE s.clusterId = $oldClusterId AND s.userId = $userId
        RETURN collect(s.uuid) as statementIds, count(s) as statementCount
      `;
      const statementsResult = await runQuery(statementsQuery, {
        oldClusterId,
        userId,
      });
      const statementIds = statementsResult[0]?.get("statementIds") || [];
      const statementCount = statementsResult[0]?.get("statementCount") || 0;

      if (statementCount < this.MIN_CLUSTER_SIZE * 2) {
        logger.info(
          `Cluster ${oldClusterId} too small to split (${statementCount} statements)`,
        );
        return [oldClusterId]; // Return original cluster if too small to split
      }

      // Step 2: Create similarity edges within this cluster's statements
      const similarityQuery = `
        MATCH (s1:Statement)-[:HAS_SUBJECT|HAS_PREDICATE|HAS_OBJECT]->(e:Entity)<-[:HAS_SUBJECT|HAS_PREDICATE|HAS_OBJECT]-(s2:Statement)
        WHERE s1.clusterId = $oldClusterId AND s2.clusterId = $oldClusterId
          AND s1.userId = $userId AND s2.userId = $userId
          AND s1.invalidAt IS NULL AND s2.invalidAt IS NULL
          AND id(s1) < id(s2)
        WITH s1, s2, collect(DISTINCT e.uuid) as sharedEntities
        WHERE size(sharedEntities) > 0
        MERGE (s1)-[r:TEMP_SIMILAR_TO]-(s2)
        SET r.weight = size(sharedEntities) * 2,
            r.sharedEntities = sharedEntities
        RETURN count(r) as edgesCreated
      `;
      await runQuery(similarityQuery, { oldClusterId, userId });

      // Step 3: Run Leiden clustering on the cluster's statements
      const leidenQuery = `
        MATCH (source:Statement) WHERE source.userId = $userId
        OPTIONAL MATCH (source)-[r:TEMP_SIMILAR_TO]->(target:Statement) 
        WHERE target.userId = $userId and target.clusterId = $oldClusterId
        WITH gds.graph.project(
          'cluster_split_' + $userId + '_' + $oldClusterId,
          source,
          target,
          {
            relationshipProperties: r { .weight }
          },
          { undirectedRelationshipTypes: ['*'] }
        ) AS g

        CALL gds.leiden.write(
          g.graphName,
          {
            writeProperty: 'tempClusterId',
            relationshipWeightProperty: 'weight',
            gamma: $gamma,
            maxLevels: $maxLevels,
            tolerance: $tolerance,
          }
        )
        YIELD communityCount

        CALL gds.graph.drop(g.graphName)
        YIELD graphName as droppedGraphName

        RETURN communityCount, g.nodeCount, g.relationshipCount
      `;

      const leidenResult = await runQuery(leidenQuery, {
        oldClusterId,
        userId,
        gamma: this.LEIDEN_GAMMA,
        maxLevels: this.LEIDEN_MAX_LEVELS,
        tolerance: this.LEIDEN_TOLERANCE,
      });
      const subClusterCount = leidenResult[0]?.get("communityCount") || 1;

      // Step 4: Create new cluster IDs for sub-clusters that meet minimum size
      const newClusterIds: string[] = [];
      const assignClustersQuery = `
        MATCH (s:Statement)
        WHERE s.clusterId = $oldClusterId AND s.userId = $userId AND s.tempClusterId IS NOT NULL
        WITH s.tempClusterId as tempId, collect(s) as statements
        WHERE size(statements) >= $minSize
        
        WITH tempId, statements, randomUUID() as newClusterId
        
        FOREACH (stmt IN statements |
          SET stmt.clusterId = newClusterId
          REMOVE stmt.tempClusterId
        )
        
        RETURN collect(newClusterId) as newClusterIds, count(DISTINCT newClusterId) as validSubClusters
      `;

      const assignResult = await runQuery(assignClustersQuery, {
        oldClusterId,
        userId,
        minSize: this.MIN_CLUSTER_SIZE,
      });
      const validNewClusterIds = assignResult[0]?.get("newClusterIds") || [];
      newClusterIds.push(...validNewClusterIds);

      // Step 5: Handle statements that didn't make it into valid sub-clusters
      const orphanQuery = `
        MATCH (s:Statement)
        WHERE s.clusterId = $oldClusterId AND s.userId = $userId
        REMOVE s.tempClusterId
        
        // If we have valid sub-clusters, assign orphans to the largest one
        WITH count(s) as orphanCount
        MATCH (s2:Statement)
        WHERE s2.clusterId IN $newClusterIds AND s2.userId = $userId
        WITH s2.clusterId as clusterId, count(s2) as clusterSize, orphanCount
        ORDER BY clusterSize DESC
        LIMIT 1
        
        MATCH (orphan:Statement)
        WHERE orphan.clusterId = $oldClusterId AND orphan.userId = $userId
        SET orphan.clusterId = clusterId
        
        RETURN count(orphan) as orphansReassigned
      `;

      if (newClusterIds.length > 0) {
        await runQuery(orphanQuery, { oldClusterId, userId, newClusterIds });
      }

      // Step 6: Create new Cluster nodes and evolution relationships
      if (newClusterIds.length > 1) {
        const createClustersQuery = `
          MATCH (oldCluster:Cluster {uuid: $oldClusterId})
          
          UNWIND $newClusterIds as newClusterId
          
          MATCH (s:Statement {clusterId: newClusterId, userId: $userId})
          WITH oldCluster, newClusterId, count(s) as statementCount
          
          CREATE (newCluster:Cluster {
            uuid: newClusterId,
            createdAt: datetime(),
            userId: $userId,
            size: statementCount,
            needsNaming: true,
            aspectType: oldCluster.aspectType
          })
          
          CREATE (oldCluster)-[:SPLIT_INTO {
            createdAt: datetime(),
            reason: 'low_cohesion',
            originalSize: $originalSize,
            newSize: statementCount
          }]->(newCluster)
          
          RETURN count(newCluster) as clustersCreated
        `;

        await runQuery(createClustersQuery, {
          oldClusterId,
          newClusterIds,
          originalSize: statementCount,
          userId,
        });

        // Mark old cluster as evolved
        await runQuery(
          `
          MATCH (c:Cluster {uuid: $oldClusterId})
          SET c.evolved = true, c.evolvedAt = datetime()
        `,
          { oldClusterId },
        );

        logger.info(
          `Successfully split cluster ${oldClusterId} into ${newClusterIds.length} sub-clusters`,
        );
      } else {
        logger.info(`Cluster ${oldClusterId} could not be meaningfully split`);
        newClusterIds.push(oldClusterId); // Keep original if splitting didn't work
      }

      // Step 7: Clean up temporary relationships
      await runQuery(
        `
        MATCH ()-[r:TEMP_SIMILAR_TO]-()
        DELETE r
      `,
        {},
      );

      return newClusterIds;
    } catch (error) {
      logger.error(`Error splitting cluster ${oldClusterId}:`, { error });
      // Clean up on error
      await runQuery(
        `
        MATCH ()-[r:TEMP_SIMILAR_TO]-()
        DELETE r
        
        MATCH (s:Statement)
        WHERE s.clusterId = $oldClusterId AND s.userId = $userId
        REMOVE s.tempClusterId
      `,
        { oldClusterId, userId },
      );
      throw error;
    }
  }

  /**
   * Handle drift by splitting low-cohesion clusters
   */
  async handleClusterDrift(userId: string): Promise<{
    clustersProcessed: number;
    newClustersCreated: number;
    splitClusters: string[];
  }> {
    logger.info(`Handling cluster drift for user ${userId}`);

    try {
      // Detect drift and get low-cohesion clusters
      const driftMetrics = await this.detectClusterDrift(userId);

      if (
        !driftMetrics.driftDetected ||
        driftMetrics.lowCohesionClusters.length === 0
      ) {
        logger.info("No drift detected or no clusters need splitting");
        return {
          clustersProcessed: 0,
          newClustersCreated: 0,
          splitClusters: [],
        };
      }

      logger.info(
        `Found ${driftMetrics.lowCohesionClusters.length} clusters with low cohesion`,
      );

      let totalNewClusters = 0;
      const splitClusters: string[] = [];

      // Process each low-cohesion cluster
      for (const clusterId of driftMetrics.lowCohesionClusters) {
        try {
          const newClusterIds = await this.evolveCluster(clusterId, userId);

          if (newClusterIds.length > 1) {
            // Cluster was successfully split
            totalNewClusters += newClusterIds.length;
            splitClusters.push(clusterId);
            logger.info(
              `Split cluster ${clusterId} into ${newClusterIds.length} sub-clusters`,
            );
          } else {
            logger.info(`Cluster ${clusterId} could not be split meaningfully`);
          }
        } catch (error) {
          logger.error(`Failed to split cluster ${clusterId}:`, { error });
          // Continue with other clusters even if one fails
        }
      }

      // Update cluster embeddings for new clusters
      if (totalNewClusters > 0) {
        await this.updateClusterEmbeddings(userId);
        await this.generateClusterNames(userId);
      }

      logger.info(
        `Drift handling completed: ${splitClusters.length} clusters split, ${totalNewClusters} new clusters created`,
      );

      return {
        clustersProcessed: splitClusters.length,
        newClustersCreated: totalNewClusters,
        splitClusters,
      };
    } catch (error) {
      logger.error("Error handling cluster drift:", { error });
      throw error;
    }
  }

  /**
   * Main clustering orchestration method - intelligently chooses between incremental and complete clustering
   */
  async performClustering(
    userId: string,
    forceComplete: boolean = false,
  ): Promise<{
    clustersCreated: number;
    statementsProcessed: number;
    driftMetrics?: DriftMetrics;
    approach: "incremental" | "complete";
  }> {
    logger.info(`Starting clustering process for user ${userId}`);

    try {
      // Check if user has any existing clusters
      const existingClustersQuery = `
        MATCH (c:Cluster)
        WHERE c.userId = $userId
        RETURN count(c) as existingClusters
      `;
      const existingResult = await runQuery(existingClustersQuery, { userId });
      const existingClusters = existingResult[0]?.get("existingClusters") || 0;

      // Check total statement count
      // const totalStatementsQuery = `
      //   MATCH (s:Statement)
      //   WHERE s.userId = $userId AND s.invalidAt IS NULL
      //   RETURN count(s) as totalStatements
      // `;
      // const totalResult = await runQuery(totalStatementsQuery, { userId });
      // const totalStatements = totalResult[0]?.get("totalStatements") || 0;

      // Determine clustering approach
      let useIncremental =
        existingClusters > 0 && !forceComplete ? true : false;
      let driftMetrics: DriftMetrics | undefined;

      // if (
      //   !forceComplete &&
      //   existingClusters > 0 &&
      //   totalStatements >= this.MIN_CLUSTER_SIZE
      // ) {
      //   // Check for drift to decide approach
      //   driftMetrics = await this.detectClusterDrift(userId);

      //   if (!driftMetrics.shouldRecluster) {
      //     useIncremental = true;
      //     logger.info("Using incremental clustering approach");
      //   } else {
      //     logger.info("Drift detected, using complete clustering approach");
      //   }
      // } else if (totalStatements < this.MIN_CLUSTER_SIZE) {
      //   logger.info(
      //     `Insufficient statements (${totalStatements}) for clustering, minimum required: ${this.MIN_CLUSTER_SIZE}`,
      //   );
      //   return {
      //     clustersCreated: 0,
      //     statementsProcessed: 0,
      //     driftMetrics,
      //     approach: "incremental",
      //   };
      // } else {
      //   logger.info("Using complete clustering approach (new user or forced)");
      // }

      // Execute appropriate clustering strategy
      if (useIncremental) {
        const incrementalResult =
          await this.performIncrementalClustering(userId);
        return {
          clustersCreated: incrementalResult.newClustersCreated,
          statementsProcessed: incrementalResult.newStatementsProcessed,
          driftMetrics,
          approach: "incremental",
        };
      } else {
        const completeResult = await this.performCompleteClustering(userId);
        return {
          clustersCreated: completeResult.clustersCreated,
          statementsProcessed: completeResult.statementsProcessed,
          driftMetrics,
          approach: "complete",
        };
      }
    } catch (error) {
      logger.error("Error in clustering process:", { error });
      throw error;
    }
  }

  /**
   * Force complete reclustering (useful for maintenance or when drift is too high)
   */
  async forceCompleteClustering(userId: string): Promise<{
    clustersCreated: number;
    statementsProcessed: number;
  }> {
    return await this.performCompleteClustering(userId);
  }

  /**
   * Get cluster information for a user
   */
  async getClusters(userId: string): Promise<ClusterNode[]> {
    const query = `
      MATCH (c:Cluster)
      WHERE c.userId = $userId
      RETURN c
      ORDER BY c.size DESC
    `;

    const result = await runQuery(query, { userId });

    return result.map((record) => {
      const cluster = record.get("c").properties;
      return {
        uuid: cluster.uuid,
        name: cluster.name || `Cluster ${cluster.uuid.substring(0, 8)}`,
        aspectType: cluster.aspectType || "thematic",
        description: cluster.description,
        size: cluster.size || 0,
        createdAt: new Date(cluster.createdAt),
        userId: cluster.userId,
        cohesionScore: cluster.cohesionScore,
      };
    });
  }

  /**
   * Get statements in a specific cluster
   */
  async getClusterStatements(
    clusterId: string,
    userId: string,
  ): Promise<any[]> {
    const query = `
      MATCH (s:Statement)
      WHERE s.clusterId = $clusterId AND s.userId = $userId
      MATCH (s)-[:HAS_SUBJECT]->(subj:Entity)
      MATCH (s)-[:HAS_PREDICATE]->(pred:Entity)
      MATCH (s)-[:HAS_OBJECT]->(obj:Entity)
      RETURN s, subj.name as subject, pred.name as predicate, obj.name as object
      ORDER BY s.createdAt DESC
    `;

    const result = await runQuery(query, { clusterId, userId });

    return result.map((record) => {
      const statement = record.get("s").properties;
      return {
        uuid: statement.uuid,
        fact: statement.fact,
        subject: record.get("subject"),
        predicate: record.get("predicate"),
        object: record.get("object"),
        createdAt: new Date(statement.createdAt),
        validAt: new Date(statement.validAt),
      };
    });
  }
}

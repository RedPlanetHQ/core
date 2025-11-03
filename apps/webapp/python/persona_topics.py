#!/usr/bin/env python3
"""
BERTopic Clustering for Persona Generation

Clusters user episodes using BERTopic and returns topic keywords + episode IDs.
This script does ONLY clustering - all filtering logic is handled in TypeScript.
"""

import sys
import json
from typing import List, Tuple, Dict, Any
import click
import numpy as np
from neo4j import GraphDatabase
from bertopic import BERTopic
from bertopic.vectorizers import ClassTfidfTransformer
from sklearn.feature_extraction.text import CountVectorizer
from umap import UMAP
from hdbscan import HDBSCAN


class Neo4jConnection:
    """Manages Neo4j database connection."""

    def __init__(self, uri: str, username: str, password: str, quiet: bool = False):
        """Initialize Neo4j connection."""
        self.quiet = quiet
        try:
            self.driver = GraphDatabase.driver(uri, auth=(username, password))
            self.driver.verify_connectivity()
            if not quiet:
                click.echo(f"✓ Connected to Neo4j at {uri}")
        except Exception as e:
            if not quiet:
                click.echo(f"✗ Failed to connect to Neo4j: {e}", err=True)
            sys.exit(1)

    def close(self):
        """Close the Neo4j connection."""
        if self.driver:
            self.driver.close()
            if not self.quiet:
                click.echo("✓ Neo4j connection closed")

    def get_episodes_with_embeddings(
        self, user_id: str
    ) -> Tuple[List[str], List[str], np.ndarray]:
        """Fetch all episodes with their embeddings for a given user.

        Args:
            user_id: The user ID to fetch episodes for

        Returns:
            Tuple of (episode_uuids, episode_contents, embeddings_array)
        """
        query = """
        MATCH (e:Episode {userId: $userId})
        WHERE e.contentEmbedding IS NOT NULL
          AND size(e.contentEmbedding) > 0
          AND e.content IS NOT NULL
          AND e.content <> ''
        RETURN e.uuid as uuid,
               e.content as content,
               e.contentEmbedding as embedding,
               e.createdAt as createdAt
        ORDER BY e.createdAt DESC
        """

        with self.driver.session() as session:
            result = session.run(query, userId=user_id)
            records = list(result)

            if not records:
                if not self.quiet:
                    click.echo(f"✗ No episodes found for userId: {user_id}", err=True)
                sys.exit(1)

            uuids = []
            contents = []
            embeddings = []

            for record in records:
                uuids.append(record["uuid"])
                contents.append(record["content"])
                embeddings.append(record["embedding"])

            embeddings_array = np.array(embeddings, dtype=np.float32)

            if not self.quiet:
                click.echo(f"✓ Fetched {len(contents)} episodes with embeddings")
            return uuids, contents, embeddings_array


def run_bertopic_clustering(
    contents: List[str],
    embeddings: np.ndarray,
    min_topic_size: int = 10,
    quiet: bool = False,
) -> Tuple[BERTopic, List[int]]:
    """Run BERTopic clustering on episode contents.

    Args:
        contents: List of episode content strings
        embeddings: Pre-computed embeddings for the episodes
        min_topic_size: Minimum number of documents per topic
        quiet: If True, suppress output messages

    Returns:
        Tuple of (bertopic_model, topic_assignments)
    """
    if not quiet:
        click.echo(f"\n🔍 Running BERTopic clustering (min_topic_size={min_topic_size})...")

    # Configure UMAP for dimensionality reduction
    umap_model = UMAP(
        n_neighbors=15, n_components=5, min_dist=0.0, metric="cosine", random_state=42
    )

    # Configure HDBSCAN for clustering
    hdbscan_model = HDBSCAN(
        min_cluster_size=min_topic_size,
        min_samples=5,
        metric="euclidean",
        cluster_selection_method="eom",
        prediction_data=True,
    )

    # Configure vectorizer with stopword removal
    vectorizer_model = CountVectorizer(
        stop_words="english", min_df=2, max_df=0.95, ngram_range=(1, 2)
    )

    # Configure c-TF-IDF
    ctfidf_model = ClassTfidfTransformer(reduce_frequent_words=True, bm25_weighting=True)

    # Initialize BERTopic
    model = BERTopic(
        embedding_model=None,  # Use pre-computed embeddings
        umap_model=umap_model,
        hdbscan_model=hdbscan_model,
        vectorizer_model=vectorizer_model,
        ctfidf_model=ctfidf_model,
        top_n_words=15,
        calculate_probabilities=False,  # Faster without probabilities
        verbose=(not quiet),
    )

    # Fit the model
    topics, _ = model.fit_transform(contents, embeddings=embeddings)

    # Get topic count
    unique_topics = len(set(topics)) - (1 if -1 in topics else 0)
    if not quiet:
        click.echo(f"✓ Clustering complete - Found {unique_topics} topics")

    return model, topics


def build_json_output(
    model: BERTopic, topics: List[int], uuids: List[str]
) -> Dict[str, Any]:
    """Build JSON output structure.

    Args:
        model: Fitted BERTopic model
        topics: Topic assignments for each episode
        uuids: Episode UUIDs

    Returns:
        Dictionary with topics data: {topics: {topicId: {keywords: [], episodeIds: []}}}
    """
    topics_dict = {}
    topic_info = model.get_topic_info()

    for idx, row in topic_info.iterrows():
        topic_id = row["Topic"]

        # Skip outlier topic (-1)
        if topic_id == -1:
            continue

        # Get keywords for this topic
        topic_words = model.get_topic(topic_id)
        keywords = [word for word, score in topic_words[:10]] if topic_words else []

        # Get episode IDs for this topic
        episode_ids = [uuid for uuid, topic in zip(uuids, topics) if topic == topic_id]

        topics_dict[str(topic_id)] = {"keywords": keywords, "episodeIds": episode_ids}

    return {"topics": topics_dict}


@click.command()
@click.argument("user_id", type=str)
@click.option(
    "--min-topic-size",
    default=10,
    type=int,
    help="Minimum number of episodes per topic (default: 10)",
)
@click.option(
    "--neo4j-uri",
    envvar="NEO4J_URI",
    required=True,
    help="Neo4j connection URI",
)
@click.option(
    "--neo4j-user",
    envvar="NEO4J_USERNAME",
    required=True,
    help="Neo4j username",
)
@click.option(
    "--neo4j-password",
    envvar="NEO4J_PASSWORD",
    required=True,
    help="Neo4j password",
)
@click.option(
    "--quiet",
    is_flag=True,
    default=False,
    help="Suppress all non-JSON output",
)
def main(
    user_id: str,
    min_topic_size: int,
    neo4j_uri: str,
    neo4j_user: str,
    neo4j_password: str,
    quiet: bool,
):
    """
    Run BERTopic clustering on episodes for USER_ID.

    Returns JSON with topic keywords and episode IDs for each cluster.

    Example:
        python persona_topics.py user-123 --min-topic-size 10
    """
    # Connect to Neo4j
    neo4j_conn = Neo4jConnection(neo4j_uri, neo4j_user, neo4j_password, quiet=quiet)

    try:
        # Fetch episodes with embeddings
        uuids, contents, embeddings = neo4j_conn.get_episodes_with_embeddings(user_id)

        # Run BERTopic clustering
        model, topics = run_bertopic_clustering(contents, embeddings, min_topic_size, quiet=quiet)

        # Output JSON results
        output = build_json_output(model, topics, uuids)
        click.echo(json.dumps(output, indent=2))

    finally:
        neo4j_conn.close()


if __name__ == "__main__":
    main()

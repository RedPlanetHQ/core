#!/usr/bin/env python3
"""
BERT Topic Modeling CLI for Echo Episodes

This CLI tool connects to Neo4j, retrieves episodes with their embeddings for a given userId,
and performs topic modeling using BERTopic to discover thematic clusters.
"""

import os
import sys
import json
from typing import List, Tuple, Dict, Any
import click
import numpy as np
from neo4j import GraphDatabase
from bertopic import BERTopic
from bertopic.vectorizers import ClassTfidfTransformer
from dotenv import load_dotenv
from sklearn.feature_extraction.text import CountVectorizer
from umap import UMAP
from hdbscan import HDBSCAN


class Neo4jConnection:
    """Manages Neo4j database connection."""

    def __init__(self, uri: str, username: str, password: str, quiet: bool = False):
        """Initialize Neo4j connection.

        Args:
            uri: Neo4j connection URI (e.g., bolt://localhost:7687)
            username: Neo4j username
            password: Neo4j password
            quiet: If True, suppress output messages
        """
        self.quiet = quiet
        try:
            self.driver = GraphDatabase.driver(uri, auth=(username, password))
            # Verify connection
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

    def get_episodes_with_embeddings(self, user_id: str) -> Tuple[List[str], List[str], np.ndarray]:
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


def run_bertopic_analysis(
    contents: List[str],
    embeddings: np.ndarray,
    min_topic_size: int = 20,
    nr_topics: int = None,
    quiet: bool = False
) -> Tuple[BERTopic, List[int], List[float]]:
    """Run BERTopic clustering on episode contents with improved configuration.

    Args:
        contents: List of episode content strings
        embeddings: Pre-computed embeddings for the episodes
        min_topic_size: Minimum number of documents per topic
        nr_topics: Target number of topics (optional, for topic reduction)
        quiet: If True, suppress output messages

    Returns:
        Tuple of (bertopic_model, topic_assignments, probabilities)
    """
    if not quiet:
        click.echo(f"\n🔍 Running BERTopic analysis (min_topic_size={min_topic_size})...")

    # Step 1: Configure UMAP for dimensionality reduction
    # More aggressive reduction helps find distinct clusters
    umap_model = UMAP(
        n_neighbors=15,           # Balance between local/global structure
        n_components=5,           # Reduce to 5 dimensions
        min_dist=0.0,             # Allow tight clusters
        metric='cosine',          # Use cosine similarity
        random_state=42
    )

    # Step 2: Configure HDBSCAN for clustering
    # Tuned to find more granular topics
    hdbscan_model = HDBSCAN(
        min_cluster_size=min_topic_size,   # Minimum episodes per topic
        min_samples=5,                      # More sensitive to local density
        metric='euclidean',
        cluster_selection_method='eom',    # Excess of mass method
        prediction_data=True
    )

    # Step 3: Configure vectorizer with stopword removal
    # Remove common English stopwords that pollute topic keywords
    vectorizer_model = CountVectorizer(
        stop_words='english',              # Remove common English words
        min_df=2,                          # Word must appear in at least 2 docs
        max_df=0.95,                       # Ignore words in >95% of docs
        ngram_range=(1, 2)                 # Include unigrams and bigrams
    )

    # Step 4: Configure c-TF-IDF with better parameters
    ctfidf_model = ClassTfidfTransformer(
        reduce_frequent_words=True,        # Further reduce common words
        bm25_weighting=True               # Use BM25 for better keyword extraction
    )

    # Step 5: Initialize BERTopic with all custom components
    model = BERTopic(
        embedding_model=None,              # Use pre-computed embeddings
        umap_model=umap_model,
        hdbscan_model=hdbscan_model,
        vectorizer_model=vectorizer_model,
        ctfidf_model=ctfidf_model,
        top_n_words=15,                    # More keywords per topic
        nr_topics=nr_topics,               # Optional topic reduction
        calculate_probabilities=True,
        verbose=(not quiet)
    )

    # Fit the model with pre-computed embeddings
    topics, probs = model.fit_transform(contents, embeddings=embeddings)

    # Get topic count
    unique_topics = len(set(topics)) - (1 if -1 in topics else 0)
    if not quiet:
        click.echo(f"✓ Topic modeling complete - Found {unique_topics} topics")

    return model, topics, probs


def print_topic_results(
    model: BERTopic,
    topics: List[int],
    uuids: List[str],
    contents: List[str]
):
    """Print formatted topic results.

    Args:
        model: Fitted BERTopic model
        topics: Topic assignments for each episode
        uuids: Episode UUIDs
        contents: Episode contents
    """
    # Get topic info
    topic_info = model.get_topic_info()
    num_topics = len(topic_info) - 1  # Exclude outlier topic (-1)

    click.echo(f"\n{'='*80}")
    click.echo(f"TOPIC MODELING RESULTS")
    click.echo(f"{'='*80}")
    click.echo(f"Total Topics Found: {num_topics}")
    click.echo(f"Total Episodes: {len(contents)}")
    click.echo(f"{'='*80}\n")

    # Print each topic
    for idx, row in topic_info.iterrows():
        topic_id = row['Topic']
        count = row['Count']

        # Skip outlier topic
        if topic_id == -1:
            click.echo(f"Topic -1 (Outliers): {count} episodes\n")
            continue

        # Get top words for this topic
        topic_words = model.get_topic(topic_id)

        click.echo(f"{'─'*80}")
        click.echo(f"Topic {topic_id}: {count} episodes")
        click.echo(f"{'─'*80}")

        # Print top keywords
        if topic_words:
            keywords = [word for word, score in topic_words[:10]]
            click.echo(f"Keywords: {', '.join(keywords)}")

        # Print sample episodes
        topic_episodes = [(uuid, content) for uuid, content, topic
                         in zip(uuids, contents, topics) if topic == topic_id]

        click.echo(f"\nSample Episodes (showing up to 3):")
        for i, (uuid, content) in enumerate(topic_episodes[:3]):
            # Truncate content for display
            truncated = content[:200] + "..." if len(content) > 200 else content
            click.echo(f"  {i+1}. [{uuid}]")
            click.echo(f"     {truncated}\n")

        click.echo()


def build_json_output(
    model: BERTopic,
    topics: List[int],
    uuids: List[str]
) -> Dict[str, Any]:
    """Build JSON output structure.

    Args:
        model: Fitted BERTopic model
        topics: Topic assignments for each episode
        uuids: Episode UUIDs

    Returns:
        Dictionary with topics data
    """
    # Build topics dictionary
    topics_dict = {}
    topic_info = model.get_topic_info()

    for idx, row in topic_info.iterrows():
        topic_id = row['Topic']

        # Skip outlier topic
        if topic_id == -1:
            continue

        # Get keywords
        topic_words = model.get_topic(topic_id)
        keywords = [word for word, score in topic_words[:10]] if topic_words else []

        # Get episode IDs for this topic
        episode_ids = [uuid for uuid, topic in zip(uuids, topics) if topic == topic_id]

        topics_dict[topic_id] = {
            "keywords": keywords,
            "episodeIds": episode_ids
        }

    return {"topics": topics_dict}


@click.command()
@click.argument('user_id', type=str)
@click.option(
    '--min-topic-size',
    default=10,
    type=int,
    help='Minimum number of episodes per topic (default: 10, lower = more granular topics)'
)
@click.option(
    '--nr-topics',
    default=None,
    type=int,
    help='Target number of topics for reduction (optional, e.g., 20 for ~20 topics)'
)
@click.option(
    '--neo4j-uri',
    envvar='NEO4J_URI',
    default='bolt://localhost:7687',
    help='Neo4j connection URI (default: bolt://localhost:7687)'
)
@click.option(
    '--neo4j-username',
    envvar='NEO4J_USERNAME',
    default='neo4j',
    help='Neo4j username (default: neo4j)'
)
@click.option(
    '--neo4j-password',
    envvar='NEO4J_PASSWORD',
    required=True,
    help='Neo4j password (required, can use NEO4J_PASSWORD env var)'
)
@click.option(
    '--json',
    'json_output',
    is_flag=True,
    default=False,
    help='Output only final results in JSON format (suppresses all other output)'
)
def main(user_id: str, min_topic_size: int, nr_topics: int, neo4j_uri: str, neo4j_username: str, neo4j_password: str, json_output: bool):
    """
    Run BERTopic analysis on episodes for a given USER_ID.

    This tool connects to Neo4j, retrieves all episodes with embeddings for the specified user,
    and performs topic modeling to discover thematic clusters.

    Examples:

        # Using environment variables from .env file
        python main.py user-123

        # With custom min topic size
        python main.py user-123 --min-topic-size 10

        # With explicit Neo4j credentials
        python main.py user-123 --neo4j-uri bolt://localhost:7687 --neo4j-password mypassword
    """
    # Print header only if not in JSON mode
    if not json_output:
        click.echo(f"\n{'='*80}")
        click.echo("BERT TOPIC MODELING FOR ECHO EPISODES")
        click.echo(f"{'='*80}")
        click.echo(f"User ID: {user_id}")
        click.echo(f"Min Topic Size: {min_topic_size}")
        if nr_topics:
            click.echo(f"Target Topics: ~{nr_topics}")
        click.echo(f"{'='*80}\n")

    # Connect to Neo4j (quiet mode if JSON output)
    neo4j_conn = Neo4jConnection(neo4j_uri, neo4j_username, neo4j_password, quiet=json_output)

    try:
        # Fetch episodes with embeddings
        uuids, contents, embeddings = neo4j_conn.get_episodes_with_embeddings(user_id)

        # Run BERTopic analysis
        model, topics, probs = run_bertopic_analysis(contents, embeddings, min_topic_size, nr_topics, quiet=json_output)

        # Output results
        if json_output:
            # JSON output mode - only print JSON
            output = build_json_output(model, topics, uuids)
            click.echo(json.dumps(output, indent=2))
        else:
            # Normal output mode - print formatted results
            print_topic_results(model, topics, uuids, contents)

            click.echo(f"{'='*80}")
            click.echo("✓ Analysis complete!")
            click.echo(f"{'='*80}\n")

    finally:
        # Always close connection
        neo4j_conn.close()


if __name__ == '__main__':
    # Load environment variables from .env file if present
    load_dotenv()
    main()

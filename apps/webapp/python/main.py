#!/usr/bin/env python3
"""
Lightweight Episode Clustering CLI using HDBSCAN

This CLI tool connects to Neo4j, retrieves episodes with their embeddings for a given userId,
and performs clustering using UMAP + HDBSCAN (same pipeline BERTopic uses, but without the bloat).

Container size: ~500MB (vs 9GB with BERTopic)
"""

import os
import sys
import json
from typing import List, Tuple, Dict, Any
import click
import numpy as np
from neo4j import GraphDatabase
from dotenv import load_dotenv
from sklearn.feature_extraction.text import TfidfVectorizer,  
from sklearn.preprocessing import normalize
from hdbscan import HDBSCAN
from umap import UMAP


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


def run_hdbscan_clustering(
    contents: List[str],
    embeddings: np.ndarray,
    min_cluster_size: int = 8,
    min_samples: int = 3,
    quiet: bool = False
) -> Tuple[np.ndarray, np.ndarray, Dict[int, List[str]]]:
    """Run HDBSCAN clustering on episode embeddings and extract keywords.

    Args:
        contents: List of episode content strings
        embeddings: Pre-computed embeddings for the episodes
        min_cluster_size: Minimum number of episodes per cluster
        min_samples: Minimum samples for core points
        quiet: If True, suppress output messages

    Returns:
        Tuple of (cluster_labels, probabilities, keyword_dict)
    """
    if not quiet:
        click.echo(f"\n🔍 Running HDBSCAN clustering (min_cluster_size={min_cluster_size})...")

    # Step 1: Reduce dimensionality with UMAP (same as BERTopic does)
    # This helps HDBSCAN find more granular clusters
    if not quiet:
        click.echo(f"  Reducing dimensionality with UMAP...")

    umap_model = UMAP(
        n_components=5,              # Reduce to 5 dimensions
        n_neighbors=15,              # Local neighborhood size
        min_dist=0.0,                # Tight clusters
        metric='cosine',             # Cosine similarity for embeddings
        random_state=42
    )
    reduced_embeddings = umap_model.fit_transform(embeddings)

    # Step 2: Run HDBSCAN clustering on reduced embeddings
    if not quiet:
        click.echo(f"  Running HDBSCAN clustering...")

    clusterer = HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric='euclidean',             # Euclidean after UMAP reduction
        cluster_selection_method='eom', # Excess of mass method
        prediction_data=True
    )

    labels = clusterer.fit_predict(reduced_embeddings)
    probabilities = clusterer.probabilities_

    # Count clusters (excluding noise cluster -1)
    unique_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    noise_count = (labels == -1).sum()

    if not quiet:
        click.echo(f"✓ Clustering complete - Found {unique_clusters} clusters")
        click.echo(f"  Outliers (noise): {noise_count} episodes")

    # Step 3: Extract keywords for each cluster using   + TF-IDF
    if not quiet:
        click.echo(f"\n🔍 Extracting keywords for each cluster...")

    # Use CountVectorizer to get word counts
    count_vectorizer = CountVectorizer(
        stop_words='english',
        max_features=1000,
        ngram_range=(1, 2),                 # Unigrams and bigrams
        min_df=1,
        max_df=0.95
    )
    count_matrix = count_vectorizer.fit_transform(contents)
    count_feature_names = count_vectorizer.get_feature_names_out()

    # Also use TF-IDF for comparison
    tfidf_vectorizer = TfidfVectorizer(
        stop_words='english',
        max_features=1000,
        ngram_range=(1, 2),
        min_df=1,
        max_df=0.95
    )
    tfidf_matrix = tfidf_vectorizer.fit_transform(contents)
    tfidf_feature_names = tfidf_vectorizer.get_feature_names_out()

    # Extract top keywords per cluster (using both count and TF-IDF)
    keywords_dict = {}
    for cluster_id in set(labels):
        if cluster_id == -1:  # Skip noise cluster
            continue

        # Get documents in this cluster
        cluster_mask = labels == cluster_id

        # Count-based keywords
        cluster_counts = count_matrix[cluster_mask]
        avg_counts = np.asarray(cluster_counts.mean(axis=0)).flatten()
        top_count_indices = avg_counts.argsort()[-15:][::-1]

        # TF-IDF-based keywords
        cluster_tfidf = tfidf_matrix[cluster_mask]
        avg_tfidf = np.asarray(cluster_tfidf.mean(axis=0)).flatten()
        top_tfidf_indices = avg_tfidf.argsort()[-15:][::-1]

        # Combine keywords from both methods (prefer TF-IDF but include high-count terms)
        combined_keywords = []
        seen = set()

        # First add top TF-IDF keywords
        for idx in top_tfidf_indices[:7]:
            kw = tfidf_feature_names[idx]
            if kw not in seen:
                combined_keywords.append(kw)
                seen.add(kw)

        # Then add high-count keywords that weren't already included
        for idx in top_count_indices:
            if len(combined_keywords) >= 10:
                break
            kw = count_feature_names[idx]
            if kw not in seen:
                combined_keywords.append(kw)
                seen.add(kw)

        keywords_dict[cluster_id] = combined_keywords[:10]

    if not quiet:
        click.echo(f"✓ Keyword extraction complete")

    return labels, probabilities, keywords_dict


def print_cluster_results(
    labels: np.ndarray,
    probabilities: np.ndarray,
    keywords_dict: Dict[int, List[str]],
    uuids: List[str],
    contents: List[str]
):
    """Print formatted cluster results.

    Args:
        labels: Cluster assignments for each episode
        probabilities: Membership probabilities for each episode
        keywords_dict: Keywords for each cluster
        uuids: Episode UUIDs
        contents: Episode contents
    """
    # Count episodes per cluster
    unique_clusters = set(labels)
    num_clusters = len(unique_clusters) - (1 if -1 in unique_clusters else 0)
    noise_count = (labels == -1).sum()

    click.echo(f"\n{'='*80}")
    click.echo(f"CLUSTERING RESULTS")
    click.echo(f"{'='*80}")
    click.echo(f"Total Clusters Found: {num_clusters}")
    click.echo(f"Total Episodes: {len(contents)}")
    click.echo(f"Outliers (noise): {noise_count}")
    click.echo(f"{'='*80}\n")

    # Print each cluster (sorted by size)
    cluster_sizes = [(cluster_id, (labels == cluster_id).sum())
                     for cluster_id in unique_clusters if cluster_id != -1]
    cluster_sizes.sort(key=lambda x: x[1], reverse=True)

    for cluster_id, count in cluster_sizes:
        click.echo(f"{'─'*80}")
        click.echo(f"Cluster {cluster_id}: {count} episodes")
        click.echo(f"{'─'*80}")

        # Print keywords
        if cluster_id in keywords_dict:
            keywords = keywords_dict[cluster_id]
            click.echo(f"Keywords: {', '.join(keywords)}")

        # Print sample episodes with confidence
        cluster_episodes = [
            (uuid, content, prob)
            for uuid, content, label, prob in zip(uuids, contents, labels, probabilities)
            if label == cluster_id
        ]

        # Sort by probability (most confident first)
        cluster_episodes.sort(key=lambda x: x[2], reverse=True)

        click.echo(f"\nSample Episodes (showing top 3 by confidence):")
        for i, (uuid, content, prob) in enumerate(cluster_episodes[:3]):
            truncated = content[:200] + "..." if len(content) > 200 else content
            click.echo(f"  {i+1}. [{uuid}] (confidence: {prob:.2%})")
            click.echo(f"     {truncated}\n")

        click.echo()

    # Print outliers summary
    if noise_count > 0:
        click.echo(f"{'─'*80}")
        click.echo(f"Outliers (Cluster -1): {noise_count} episodes")
        click.echo(f"{'─'*80}")
        click.echo("These episodes don't fit well into any cluster\n")


def build_json_output(
    labels: np.ndarray,
    keywords_dict: Dict[int, List[str]],
    uuids: List[str]
) -> Dict[str, Any]:
    """Build JSON output structure.

    Args:
        labels: Cluster assignments for each episode
        keywords_dict: Keywords for each cluster
        uuids: Episode UUIDs

    Returns:
        Dictionary with cluster data (same format as BERTopic for compatibility)
    """
    # Build clusters dictionary
    clusters_dict = {}

    for cluster_id in set(labels):
        # Skip outlier cluster
        if cluster_id == -1:
            continue

        # Get keywords
        keywords = keywords_dict.get(cluster_id, [])

        # Get episode IDs for this cluster
        episode_ids = [uuid for uuid, label in zip(uuids, labels) if label == cluster_id]

        clusters_dict[str(cluster_id)] = {
            "keywords": keywords,
            "episodeIds": episode_ids
        }

    return clusters_dict


@click.command()
@click.argument('user_id', type=str)
@click.option(
    '--min-cluster-size',
    default=8,
    type=int,
    help='Minimum number of episodes per cluster (default: 8, lower = more granular)'
)
@click.option(
    '--min-samples',
    default=3,
    type=int,
    help='Minimum samples for core points (default: 3, lower = more sensitive)'
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
def main(user_id: str, min_cluster_size: int, min_samples: int, neo4j_uri: str,
         neo4j_username: str, neo4j_password: str, json_output: bool):
    """
    Run HDBSCAN clustering on episodes for a given USER_ID.

    This tool connects to Neo4j, retrieves all episodes with embeddings for the specified user,
    and performs density-based clustering to discover thematic groups.

    Lightweight alternative to BERTopic (~500MB vs 9GB) with same quality clustering.

    Examples:

        # Using environment variables from .env file
        python sample.py user-123

        # With custom cluster size
        python sample.py user-123 --min-cluster-size 8

        # JSON output for programmatic use
        python sample.py user-123 --json

        # With explicit Neo4j credentials
        python sample.py user-123 --neo4j-uri bolt://localhost:7687 --neo4j-password mypassword
    """
    # Print header only if not in JSON mode
    if not json_output:
        click.echo(f"\n{'='*80}")
        click.echo("LIGHTWEIGHT EPISODE CLUSTERING (HDBSCAN)")
        click.echo(f"{'='*80}")
        click.echo(f"User ID: {user_id}")
        click.echo(f"Min Cluster Size: {min_cluster_size}")
        click.echo(f"Min Samples: {min_samples}")
        click.echo(f"{'='*80}\n")

    # Connect to Neo4j (quiet mode if JSON output)
    neo4j_conn = Neo4jConnection(neo4j_uri, neo4j_username, neo4j_password, quiet=json_output)

    try:
        # Fetch episodes with embeddings
        uuids, contents, embeddings = neo4j_conn.get_episodes_with_embeddings(user_id)

        # Run HDBSCAN clustering
        labels, probs, keywords = run_hdbscan_clustering(
            contents, embeddings, min_cluster_size, min_samples, quiet=json_output
        )

        # Output results
        if json_output:
            # JSON output mode - only print JSON
            output = build_json_output(labels, keywords, uuids)
            click.echo(json.dumps(output, indent=2))
        else:
            # Normal output mode - print formatted results
            print_cluster_results(labels, probs, keywords, uuids, contents)

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

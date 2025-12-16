#!/usr/bin/env python3
"""
Persona Analytics Extraction using TF-IDF and Pattern Analysis

This script extracts quantitative patterns from episodes for persona generation:
- Lexicon: TF-IDF-based term frequencies (no hardcoded stop words)
- Style Metrics: Sentence patterns, formatting preferences
- Temporal Metrics: Time-based patterns
- Receipts: Explicit metrics extraction

Similar to BERTopic's approach but WITHOUT clustering - pure analytics on all episodes.
"""

import os
import sys
import json
import re
from typing import List, Tuple, Dict, Any
from datetime import datetime
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
import click
import numpy as np
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from sklearn.feature_extraction.text import TfidfVectorizer, CountVectorizer


class PostgresConnection:
    """Manages Postgres database connection for episode data.

    Note: Currently supports pgvector only. When other vector providers
    (turbopuffer, qdrant) are implemented, this can be refactored into
    a provider abstraction pattern.
    """

    def __init__(self, database_url: str, quiet: bool = False):
        """Initialize Postgres connection.

        Args:
            database_url: Postgres connection string (e.g., postgresql://user:pass@host:port/db?schema=core)
            quiet: If True, suppress output messages
        """
        self.quiet = quiet

        # Parse URL to extract and handle schema parameter (Prisma-specific)
        parsed = urlparse(database_url)
        query_params = parse_qs(parsed.query)

        # Extract schema if present (psycopg2 doesn't support ?schema= in URL)
        schema = query_params.pop('schema', ['public'])[0]

        # Rebuild URL without schema parameter
        clean_query = urlencode(query_params, doseq=True)
        clean_url = urlunparse((
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            parsed.params,
            clean_query,
            parsed.fragment
        ))

        try:
            self.conn = psycopg2.connect(clean_url)

            # Set search_path to the specified schema (for pgvector extension)
            with self.conn.cursor() as cursor:
                cursor.execute(f"SET search_path TO {schema}, public")
            self.conn.commit()

            if not quiet:
                click.echo(f"✓ Connected to Postgres (schema: {schema})")
        except Exception as e:
            if not quiet:
                click.echo(f"✗ Failed to connect to Postgres: {e}", err=True)
            sys.exit(1)

    def close(self):
        """Close the Postgres connection."""
        if self.conn:
            self.conn.close()
            if not self.quiet:
                click.echo("✓ Postgres connection closed")

    def get_episodes(
        self,
        user_id: str,
        start_time: str = None,
    ) -> Tuple[List[Dict[str, Any]], List[str]]:
        """Fetch episodes with metadata from episode_embeddings table.

        Args:
            user_id: The user ID to fetch episodes for
            start_time: Optional ISO format datetime string - filter episodes created after this time

        Returns:
            Tuple of (episodes_with_metadata, episode_contents)
        """
        # Build WHERE clause with time filters
        where_conditions = ['"userId" = %s']
        params = [user_id]

        if start_time:
            where_conditions.append('"createdAt" >= %s')
            params.append(start_time)

        where_clause = " AND ".join(where_conditions)

        query = f"""
        SELECT id, content, metadata, "createdAt"
        FROM episode_embeddings
        WHERE {where_clause}
        ORDER BY "createdAt" DESC
        """

        with self.conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(query, params)
            records = cursor.fetchall()

            if not records:
                if not self.quiet:
                    click.echo(f"✗ No episodes found for userId: {user_id}", err=True)
                sys.exit(1)

            episodes = []
            contents = []

            for record in records:
                # Extract source from metadata JSON if available
                metadata = record.get('metadata') or {}
                source = metadata.get('source', 'unknown') if isinstance(metadata, dict) else 'unknown'

                episodes.append({
                    "uuid": record['id'],
                    "content": record['content'],
                    "source": source,
                    "createdAt": record['createdAt'].isoformat() if hasattr(record['createdAt'], 'isoformat') else str(record['createdAt']),
                })
                contents.append(record['content'])

            if not self.quiet:
                click.echo(f"✓ Fetched {len(contents)} episodes")
            return episodes, contents


def extract_lexicon(contents: List[str], top_n: int = 50, quiet: bool = False) -> Dict[str, int]:
    """Extract top lexicon terms using TF-IDF (no hardcoded stop words).

    Uses sklearn's built-in 'english' stop words instead of manual hardcoding.

    Args:
        contents: List of episode content strings
        top_n: Number of top terms to return
        quiet: If True, suppress output messages

    Returns:
        Dictionary of {term: frequency}
    """
    if not quiet:
        click.echo(f"\n🔍 Extracting lexicon using TF-IDF...")

    # Adaptive constraints based on dataset size
    num_docs = len(contents)
    min_df = 1 if num_docs < 5 else 2  # Need at least 5 docs for min_df=2
    max_df = 1.0 if num_docs < 10 else 0.8  # Only filter common terms for larger datasets

    # Use CountVectorizer for raw frequencies
    count_vectorizer = CountVectorizer(
        stop_words='english',           # Built-in stop words (no hardcoding)
        max_features=1000,
        ngram_range=(1, 2),              # Unigrams and bigrams
        min_df=min_df,                   # Adaptive: 1 for small datasets, 2 for larger
        max_df=max_df,                   # Adaptive: 1.0 for small, 0.8 for larger
        token_pattern=r'\b[a-z][a-z0-9_-]{2,}\b'  # 3+ chars, alphanumeric + underscore/hyphen
    )
    count_matrix = count_vectorizer.fit_transform(contents)
    count_feature_names = count_vectorizer.get_feature_names_out()

    # Use TF-IDF for scoring
    tfidf_vectorizer = TfidfVectorizer(
        stop_words='english',
        max_features=1000,
        ngram_range=(1, 2),
        min_df=min_df,                   # Same adaptive constraints
        max_df=max_df,
        token_pattern=r'\b[a-z][a-z0-9_-]{2,}\b'
    )
    tfidf_matrix = tfidf_vectorizer.fit_transform(contents)
    tfidf_feature_names = tfidf_vectorizer.get_feature_names_out()

    # Calculate average TF-IDF scores
    avg_tfidf = np.asarray(tfidf_matrix.mean(axis=0)).flatten()
    top_tfidf_indices = avg_tfidf.argsort()[-top_n:][::-1]

    # Get raw counts for top TF-IDF terms
    lexicon = {}
    for idx in top_tfidf_indices:
        term = tfidf_feature_names[idx]
        # Find term in count matrix to get raw frequency
        count_idx = np.where(count_feature_names == term)[0]
        if len(count_idx) > 0:
            raw_count = int(count_matrix[:, count_idx[0]].sum())
            lexicon[term] = raw_count

    if not quiet:
        click.echo(f"✓ Extracted {len(lexicon)} lexicon terms")

    return lexicon


def extract_style_metrics(contents: List[str], quiet: bool = False) -> Dict[str, Any]:
    """Extract objective structural metrics (no interpretation).

    Args:
        contents: List of episode content strings
        quiet: If True, suppress output messages

    Returns:
        Dictionary with basic structural metrics
    """
    if not quiet:
        click.echo(f"\n🔍 Extracting structural metrics...")

    total_sentences = 0
    total_words = 0
    total_paragraphs = 0
    episodes_with_bullets = 0
    episodes_with_code = 0

    for content in contents:
        # Sentence count (. ! ?)
        sentences = re.split(r'[.!?]+', content)
        sentences = [s for s in sentences if s.strip()]
        total_sentences += len(sentences)

        # Word count
        words = content.split()
        total_words += len(words)

        # Paragraph count (double newline)
        paragraphs = re.split(r'\n\n+', content)
        paragraphs = [p for p in paragraphs if p.strip()]
        total_paragraphs += max(len(paragraphs), 1)

        # Count episodes with bullets (not interpretation)
        if re.search(r'^\s*[-*]\s+', content, re.MULTILINE):
            episodes_with_bullets += 1

        # Count episodes with code blocks (not interpretation)
        if re.search(r'```|^\s{4,}', content, re.MULTILINE):
            episodes_with_code += 1

    avg_sentence_length = round(total_words / total_sentences) if total_sentences > 0 else 0
    avg_paragraph_length = round(total_sentences / total_paragraphs) if total_paragraphs > 0 else 0

    style_metrics = {
        "avgSentenceLength": avg_sentence_length,
        "avgParagraphLength": avg_paragraph_length,
        "episodesWithBullets": episodes_with_bullets,
        "episodesWithCode": episodes_with_code,
    }

    if not quiet:
        click.echo(f"✓ Structural metrics extracted")
        click.echo(f"  Avg sentence length: {avg_sentence_length} words")
        click.echo(f"  Episodes with bullets: {episodes_with_bullets}")
        click.echo(f"  Episodes with code: {episodes_with_code}")

    return style_metrics


def extract_source_distribution(episodes: List[Dict[str, Any]], quiet: bool = False) -> Dict[str, int]:
    """Analyze source distribution (where episodes come from).

    Args:
        episodes: List of episode dictionaries with 'source' field
        quiet: If True, suppress output messages

    Returns:
        Dictionary of {source: percentage}
    """
    if not quiet:
        click.echo(f"\n🔍 Analyzing source distribution...")

    source_counts = {}
    for episode in episodes:
        source = episode.get('source') or 'unknown'
        source_counts[source] = source_counts.get(source, 0) + 1

    # Convert to percentages
    source_percentages = {}
    for source, count in source_counts.items():
        source_percentages[source] = round((count / len(episodes)) * 100)

    if not quiet:
        click.echo(f"✓ Found {len(source_counts)} sources")

    return source_percentages


def extract_temporal_metrics(episodes: List[Dict[str, Any]], quiet: bool = False) -> Dict[str, Any]:
    """Track temporal patterns (time-based metrics).

    Args:
        episodes: List of episode dictionaries with 'createdAt' field
        quiet: If True, suppress output messages

    Returns:
        Dictionary with temporal metrics
    """
    if not quiet:
        click.echo(f"\n🔍 Tracking temporal patterns...")

    # Sort by date
    dates = sorted([episode['createdAt'] for episode in episodes])

    # Handle Z timezone suffix (Python 3.9 fromisoformat doesn't support 'Z')
    oldest_date_str = dates[0].replace('Z', '+00:00') if dates[0].endswith('Z') else dates[0]
    newest_date_str = dates[-1].replace('Z', '+00:00') if dates[-1].endswith('Z') else dates[-1]

    oldest_episode = datetime.fromisoformat(oldest_date_str)
    newest_episode = datetime.fromisoformat(newest_date_str)

    # Calculate time span
    time_span_days = (newest_episode - oldest_episode).days + 1
    episodes_per_month = round((len(episodes) / time_span_days) * 30) if time_span_days > 0 else len(episodes)

    temporal_metrics = {
        "oldestEpisode": oldest_episode.isoformat(),
        "newestEpisode": newest_episode.isoformat(),
        "timeSpanDays": time_span_days,
        "episodesPerMonth": episodes_per_month
    }

    if not quiet:
        click.echo(f"✓ Time span: {time_span_days} days")
        click.echo(f"  Episodes per month: {episodes_per_month}")

    return temporal_metrics


# Removed: Receipt extraction - LLM handles this better with context
# Regex can find "38%" but doesn't know it means "cycle time reduction"
# LLM extracts "Reduced ops cycle time by 38%" with full context


@click.command()
@click.argument('user_id', type=str)
@click.option(
    '--start-time',
    type=str,
    default=None,
    help='Filter episodes created after this time (ISO format: 2024-01-01T00:00:00Z)'
)
@click.option(
    '--database-url',
    envvar='DATABASE_URL',
    required=True,
    help='Postgres connection URL (required, can use DATABASE_URL env var)'
)
@click.option(
    '--json',
    'json_output',
    is_flag=True,
    default=False,
    help='Output only final results in JSON format (suppresses all other output)'
)
def main(user_id: str, start_time: str, database_url: str, json_output: bool):
    """
    Extract persona analytics from episodes for a given USER_ID.

    This tool connects to Postgres (pgvector), retrieves all episodes for the specified user,
    and performs algorithmic analytics extraction (lexicon, style, temporal, receipts).

    Uses TF-IDF and pattern analysis (similar to BERTopic's approach) without clustering.

    Examples:

        # Using environment variables from .env file
        python persona_analytics.py user-123

        # Filter by time range
        python persona_analytics.py user-123 --start-time 2024-01-01T00:00:00Z

        # JSON output for programmatic use
        python persona_analytics.py user-123 --json

        # With explicit database URL
        python persona_analytics.py user-123 --database-url postgresql://user:pass@localhost:5432/core
    """
    # Print header only if not in JSON mode
    if not json_output:
        click.echo(f"\n{'='*80}")
        click.echo("PERSONA ANALYTICS EXTRACTION")
        click.echo(f"{'='*80}")
        click.echo(f"User ID: {user_id}")
        if start_time:
            click.echo(f"Start Time: {start_time}")
        click.echo(f"{'='*80}\n")

    # Connect to Postgres (quiet mode if JSON output)
    pg_conn = PostgresConnection(database_url, quiet=json_output)

    try:
        # Fetch episodes
        episodes, contents = pg_conn.get_episodes(user_id, start_time)

        # Run analytics (objective metrics only)
        lexicon = extract_lexicon(contents, top_n=50, quiet=json_output)
        style_metrics = extract_style_metrics(contents, quiet=json_output)
        source_distribution = extract_source_distribution(episodes, quiet=json_output)
        temporal_metrics = extract_temporal_metrics(episodes, quiet=json_output)

        # Build output
        output = {
            "totalEpisodes": len(episodes),
            "lexicon": lexicon,
            "style": style_metrics,
            "sources": source_distribution,
            "temporal": temporal_metrics,
            "receipts": []  # LLM extracts receipts with context
        }

        # Output results
        if json_output:
            # JSON output mode - only print JSON
            click.echo(json.dumps(output, indent=2))
        else:
            # Normal output mode - print formatted results
            click.echo(f"\n{'='*80}")
            click.echo("ANALYTICS RESULTS")
            click.echo(f"{'='*80}")
            click.echo(f"\nTotal Episodes: {output['totalEpisodes']}")
            click.echo(f"\nTop Lexicon Terms: {len(output['lexicon'])}")
            click.echo(f"Style Metrics: {output['style']['avgSentenceLength']} avg words/sentence")
            click.echo(f"Sources: {', '.join(output['sources'].keys())}")
            click.echo(f"Time Span: {output['temporal']['timeSpanDays']} days")
            click.echo(f"Receipts Found: {len(output['receipts'])}")
            click.echo(f"\n{'='*80}")
            click.echo("✓ Analysis complete!")
            click.echo(f"{'='*80}\n")

    finally:
        # Always close connection
        pg_conn.close()


if __name__ == '__main__':
    # Load environment variables from .env file if present
    load_dotenv()
    main()

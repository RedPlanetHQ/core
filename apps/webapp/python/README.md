# BERT Topic Modeling CLI for Core Episodes

This CLI tool performs topic modeling on Core episodes using BERTopic. It connects to Neo4j, retrieves episodes with their pre-computed embeddings for a given user, and discovers thematic clusters using HDBSCAN clustering.

## Features

- Connects to Neo4j database to fetch episodes
- Uses pre-computed embeddings (no need to regenerate them)
- Performs semantic topic clustering with BERTopic
- Displays topics with:
  - Top keywords per topic
  - Episode count per topic
  - Sample episodes for each topic
- Configurable minimum topic size
- Environment variable support for easy configuration

## Prerequisites

- Python 3.8+
- Access to Neo4j database with episodes stored
- Pre-computed embeddings stored in Neo4j (in `contentEmbedding` field)

## Installation

1. Navigate to the bert directory:

```bash
cd apps/webapp/app/bert
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

## Configuration

The CLI can read Neo4j connection details from:

1. **Environment variables** (recommended) - Create a `.env` file or export:

   ```bash
   export NEO4J_URI=bolt://localhost:7687
   export NEO4J_USERNAME=neo4j
   export NEO4J_PASSWORD=your_password
   ```

2. **Command-line options** - Pass credentials directly as flags

3. **From project root** - The tool automatically loads `.env` from the project root

## Usage

### Basic Usage

Using environment variables (most common):

```bash
python main.py <user_id>
```

### Advanced Options

```bash
python main.py <user_id> [OPTIONS]
```

**Options:**

- `--min-topic-size INTEGER`: Minimum number of episodes per topic (default: 10)
- `--nr-topics INTEGER`: Target number of topics for reduction (optional)
- `--propose-spaces`: Generate space proposals using OpenAI (requires OPENAI_API_KEY)
- `--openai-api-key TEXT`: OpenAI API key for space proposals (or use OPENAI_API_KEY env var)
- `--json`: Output only final results in JSON format (suppresses all other output)
- `--neo4j-uri TEXT`: Neo4j connection URI (default: bolt://localhost:7687)
- `--neo4j-username TEXT`: Neo4j username (default: neo4j)
- `--neo4j-password TEXT`: Neo4j password (required)

### Examples

1. **Basic usage with environment variables:**

   ```bash
   python main.py user-123
   ```

2. **Custom minimum topic size:**

   ```bash
   python main.py user-123 --min-topic-size 10
   ```

3. **Explicit credentials:**

   ```bash
   python main.py user-123 \
     --neo4j-uri bolt://neo4j:7687 \
     --neo4j-username neo4j \
     --neo4j-password mypassword
   ```

4. **Using Docker compose Neo4j:**

   ```bash
   python main.py user-123 \
     --neo4j-uri bolt://localhost:7687 \
     --neo4j-password 27192e6432564f4788d55c15131bd5ac
   ```

5. **With space proposals:**

   ```bash
   python main.py user-123 --propose-spaces
   ```

6. **JSON output mode (for programmatic use):**

   ```bash
   python main.py user-123 --json
   ```

7. **JSON output with space proposals:**
   ```bash
   python main.py user-123 --propose-spaces --json
   ```

### Get Help

```bash
python main.py --help
```

## Output Formats

### Human-Readable Output (Default)

The CLI outputs:

```
================================================================================
BERT TOPIC MODELING FOR ECHO EPISODES
================================================================================
User ID: user-123
Min Topic Size: 20
================================================================================

✓ Connected to Neo4j at bolt://localhost:7687
✓ Fetched 150 episodes with embeddings

🔍 Running BERTopic analysis (min_topic_size=20)...
✓ Topic modeling complete

================================================================================
TOPIC MODELING RESULTS
================================================================================
Total Topics Found: 5
Total Episodes: 150
================================================================================

────────────────────────────────────────────────────────────────────────────────
Topic 0: 45 episodes
────────────────────────────────────────────────────────────────────────────────
Keywords: authentication, login, user, security, session, password, token, oauth, jwt, credentials

Sample Episodes (showing up to 3):
  1. [uuid-123]
     Discussing authentication flow for the new user login system...

  2. [uuid-456]
     Implementing OAuth2 with JWT tokens for secure sessions...

  3. [uuid-789]
     Password reset functionality with email verification...

────────────────────────────────────────────────────────────────────────────────
Topic 1: 32 episodes
────────────────────────────────────────────────────────────────────────────────
Keywords: database, neo4j, query, graph, cypher, nodes, relationships, index, performance, optimization

Sample Episodes (showing up to 3):
  ...

Topic -1 (Outliers): 8 episodes

================================================================================
✓ Analysis complete!
================================================================================

✓ Neo4j connection closed
```

### JSON Output Mode (--json flag)

When using the `--json` flag, the tool outputs only a clean JSON object with no debug logs:

```json
{
  "topics": {
    "0": {
      "keywords": ["authentication", "login", "user", "security", "session"],
      "episodeIds": ["uuid-123", "uuid-456", "uuid-789"]
    },
    "1": {
      "keywords": ["database", "neo4j", "query", "graph", "cypher"],
      "episodeIds": ["uuid-abc", "uuid-def"]
    }
  },
  "spaces": [
    {
      "name": "User Authentication",
      "intent": "Episodes about user authentication, login systems, and security belong in this space.",
      "confidence": 85,
      "topics": [0, 3],
      "estimatedEpisodes": 120
    }
  ]
}
```

**JSON Output Structure:**

- `topics`: Dictionary of topic IDs with keywords and episode UUIDs
- `spaces`: Array of space proposals (only if `--propose-spaces` is used)
  - `name`: Space name (2-5 words)
  - `intent`: Classification intent (1-2 sentences)
  - `confidence`: Confidence score (0-100)
  - `topics`: Source topic IDs that form this space
  - `estimatedEpisodes`: Estimated number of episodes in this space

**Use Cases for JSON Mode:**

- Programmatic consumption by other tools
- Piping output to jq or other JSON processors
- Integration with CI/CD pipelines
- Automated space creation workflows

## How It Works

1. **Connection**: Establishes connection to Neo4j database
2. **Data Fetching**: Queries all episodes for the given userId that have:
   - Non-null `contentEmbedding` field
   - Non-empty content
3. **Topic Modeling**: Runs BERTopic with:
   - Pre-computed embeddings (no re-embedding needed)
   - HDBSCAN clustering (automatic cluster discovery)
   - Keyword extraction via c-TF-IDF
4. **Results**: Displays topics with keywords and sample episodes

## Neo4j Query

The tool uses this Cypher query to fetch episodes:

```cypher
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
```

## Tuning Parameters

- **`--min-topic-size`**:
  - Smaller values (5-10): More granular topics, may include noise
  - Larger values (20-30): Broader topics, more coherent but fewer clusters
  - Recommended: Start with 20 and adjust based on your data

## Troubleshooting

### No episodes found

- Verify the userId exists in Neo4j
- Check that episodes have `contentEmbedding` populated
- Ensure episodes have non-empty `content` field

### Connection errors

- Verify Neo4j is running: `docker ps | grep neo4j`
- Check URI format: should be `bolt://host:port`
- Verify credentials are correct

### Too few/many topics

- Adjust `--min-topic-size` parameter
- Need more topics: decrease the value (e.g., `--min-topic-size 10`)
- Need fewer topics: increase the value (e.g., `--min-topic-size 30`)

## Dependencies

- `bertopic>=0.16.0` - Topic modeling
- `neo4j>=5.14.0` - Neo4j Python driver
- `click>=8.1.0` - CLI framework
- `numpy>=1.24.0` - Numerical operations
- `python-dotenv>=1.0.0` - Environment variable loading

## License

Part of the Core project.

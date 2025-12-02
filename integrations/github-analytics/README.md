# GitHub Analytics Integration

Track DORA metrics, delivery speed, stability, and code quality metrics for your GitHub repositories.

## Overview

The GitHub Analytics integration provides comprehensive engineering metrics and insights for your GitHub repositories, including:

- **DORA Metrics**: Deployment frequency, lead time for changes, change failure rate
- **Delivery Speed**: PR merge time, PR throughput, commit frequency
- **Stability & Reliability**: Hotfix rate, revert rate
- **Code Quality**: PR size analysis

## Available Actions

### Delivery Speed Metrics

#### `deployment_frequency`
Calculate deployment frequency - number of releases/deployments per week.

**Parameters:**
- `owner` (required): Repository owner (organization or user)
- `repo` (required): Repository name
- `days` (optional): Number of days to analyze (default: 30)

**Example:**
```json
{
  "owner": "redplanethq",
  "repo": "core",
  "days": 30
}
```

#### `lead_time_for_changes`
Calculate lead time for changes - time from first commit to production deployment (in hours/days).

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `days` (optional): Number of days to analyze (default: 30)

#### `pr_merge_time`
Calculate average time from PR creation to merge (in hours).

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `days` (optional): Number of days to analyze (default: 30)

#### `pr_throughput`
Calculate number of PRs merged per week.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `days` (optional): Number of days to analyze (default: 30)

#### `commit_frequency`
Calculate number of commits to main branch per week.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `branch` (optional): Branch name to analyze (default: "main")
- `days` (optional): Number of days to analyze (default: 30)

### Stability & Reliability Metrics

#### `change_failure_rate`
Calculate percentage of deployments that cause production failures.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `days` (optional): Number of days to analyze (default: 30)
- `incidentLabels` (optional): Array of issue labels indicating incidents (default: ["incident", "production", "outage", "bug"])

#### `hotfix_rate`
Calculate percentage of releases that are emergency hotfixes.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `days` (optional): Number of days to analyze (default: 30)
- `hotfixPatterns` (optional): Array of patterns to identify hotfixes (default: ["hotfix", "emergency", "patch"])

#### `revert_rate`
Calculate percentage of merged PRs that get reverted.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `days` (optional): Number of days to analyze (default: 30)

### Code Quality Metrics

#### `pr_size`
Calculate average lines changed (additions + deletions) per PR.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `days` (optional): Number of days to analyze (default: 30)

### All Metrics

#### `all_metrics`
Calculate all GitHub analytics metrics at once.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `days` (optional): Number of days to analyze (default: 30)

**Returns:** Comprehensive report including all delivery speed, stability, and code quality metrics.

## Response Format

All metrics return a structured JSON response with:

```json
{
  "metric": "metric_name",
  "value": 123,
  "unit": "deployments|hours|percentage|lines_changed",
  "period": "last_7_days",
  "details": {
    // Detailed breakdown with supporting data
  }
}
```

## Usage with CORE Memory

Once installed, you can query metrics through CORE's MCP integration:

```javascript
// Get deployment frequency
execute_integration_action({
  integrationSlug: "github-analytics",
  action: "deployment_frequency",
  parameters: {
    owner: "redplanethq",
    repo: "core",
    days: 14
  }
})

// Get all metrics
execute_integration_action({
  integrationSlug: "github-analytics",
  action: "all_metrics",
  parameters: {
    owner: "redplanethq",
    repo: "core"
  }
})
```

## Required GitHub Scopes

This integration requires the following GitHub OAuth scopes:
- `repo`: Access to repository data (PRs, commits, releases)
- `read:org`: Read organization data

## Development

### Build
```bash
npm run build
```

### Test
```bash
# Get integration spec
node bin/index.js spec

# Get available tools
node bin/index.js get-tools --config '{"access_token":"ghp_xxx"}' --integration-definition '{}'

# Call a tool
node bin/index.js call-tool \
  --config '{"access_token":"ghp_xxx"}' \
  --integration-definition '{}' \
  --tool-name "deployment_frequency" \
  --tool-arguments '{"owner":"owner","repo":"repo"}'
```

## Metrics Explained

### DORA Metrics

**Deployment Frequency**: How often an organization successfully releases to production. Elite performers deploy multiple times per day.

**Lead Time for Changes**: The time it takes from code commit to production deployment. Elite performers achieve less than one hour.

**Change Failure Rate**: The percentage of deployments causing failures in production. Elite performers maintain less than 15% failure rate.

### Additional Metrics

**PR Merge Time**: Indicates code review efficiency and team collaboration speed.

**PR Throughput**: Measures team velocity and development cadence.

**Commit Frequency**: Shows development activity and iteration speed.

**Hotfix Rate**: Indicates production stability and testing effectiveness.

**Revert Rate**: Measures code quality and the need for rollbacks.

**PR Size**: Smaller PRs typically mean faster reviews and fewer bugs.

## License

MIT

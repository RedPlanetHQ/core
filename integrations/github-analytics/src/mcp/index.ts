import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  calculateDeploymentFrequency,
  calculateLeadTime,
  calculatePRMergeTime,
  calculatePRThroughput,
  calculateCommitFrequency,
  calculateChangeFailureRate,
  calculateHotfixRate,
  calculateRevertRate,
  calculatePRSize,
  getAllMetrics,
} from '../analytics';

// Schema definitions for all analytics actions
const RepoSchema = z.object({
  owner: z.string().describe('Repository owner (organization or user)'),
  repo: z.string().describe('Repository name'),
  days: z.number().optional().describe('Number of days to analyze (default: 7)'),
});

const CommitFrequencySchema = z.object({
  owner: z.string().describe('Repository owner (organization or user)'),
  repo: z.string().describe('Repository name'),
  branch: z.string().optional().describe('Branch name to analyze (default: main)'),
  days: z.number().optional().describe('Number of days to analyze (default: 7)'),
});

const ChangeFailureRateSchema = z.object({
  owner: z.string().describe('Repository owner (organization or user)'),
  repo: z.string().describe('Repository name'),
  days: z.number().optional().describe('Number of days to analyze (default: 7)'),
  incidentLabels: z
    .array(z.string())
    .optional()
    .describe(
      'Array of issue labels that indicate production incidents (default: ["incident", "production", "outage", "bug"])'
    ),
});

const HotfixRateSchema = z.object({
  owner: z.string().describe('Repository owner (organization or user)'),
  repo: z.string().describe('Repository name'),
  days: z.number().optional().describe('Number of days to analyze (default: 7)'),
  hotfixPatterns: z
    .array(z.string())
    .optional()
    .describe(
      'Array of patterns to identify hotfix releases (default: ["hotfix", "emergency", "patch"])'
    ),
});

/**
 * Get list of available tools without starting the MCP server
 */
export async function getTools() {
  return [
    {
      name: 'deployment_frequency',
      description:
        'Calculate deployment frequency - number of releases/deployments per week. DORA metric for delivery speed.',
      inputSchema: zodToJsonSchema(RepoSchema),
    },
    {
      name: 'lead_time_for_changes',
      description:
        'Calculate lead time for changes - time from first commit to production deployment (in hours/days). DORA metric for delivery speed.',
      inputSchema: zodToJsonSchema(RepoSchema),
    },
    {
      name: 'pr_merge_time',
      description:
        'Calculate PR merge time - average time from PR creation to merge (in hours). Delivery speed metric.',
      inputSchema: zodToJsonSchema(RepoSchema),
    },
    {
      name: 'pr_throughput',
      description:
        'Calculate PR throughput - number of PRs merged per week. Delivery speed metric.',
      inputSchema: zodToJsonSchema(RepoSchema),
    },
    {
      name: 'commit_frequency',
      description:
        'Calculate commit frequency - number of commits to main branch per week. Delivery speed metric.',
      inputSchema: zodToJsonSchema(CommitFrequencySchema),
    },
    {
      name: 'change_failure_rate',
      description:
        'Calculate change failure rate - percentage of deployments that cause production failures. DORA metric for stability & reliability.',
      inputSchema: zodToJsonSchema(ChangeFailureRateSchema),
    },
    {
      name: 'hotfix_rate',
      description:
        'Calculate hotfix rate - percentage of releases that are emergency hotfixes. Stability & reliability metric.',
      inputSchema: zodToJsonSchema(HotfixRateSchema),
    },
    {
      name: 'revert_rate',
      description:
        'Calculate revert rate - percentage of merged PRs that get reverted. Stability & reliability metric.',
      inputSchema: zodToJsonSchema(RepoSchema),
    },
    {
      name: 'pr_size',
      description:
        'Calculate PR size - average lines changed (additions + deletions) per PR. Code quality metric.',
      inputSchema: zodToJsonSchema(RepoSchema),
    },
    {
      name: 'all_metrics',
      description:
        'Calculate all GitHub analytics metrics at once - includes all DORA metrics, delivery speed, stability, and code quality metrics.',
      inputSchema: zodToJsonSchema(RepoSchema),
    },
  ];
}

/**
 * Call a specific tool without starting the MCP server
 */
export async function callTool(
  name: string,
  args: Record<string, any>,
  config: { access_token: string }
) {
  try {
    let result: any;

    switch (name) {
      case 'deployment_frequency': {
        const validatedArgs = RepoSchema.parse(args);
        result = await calculateDeploymentFrequency(config, validatedArgs);
        break;
      }

      case 'lead_time_for_changes': {
        const validatedArgs = RepoSchema.parse(args);
        result = await calculateLeadTime(config, validatedArgs);
        break;
      }

      case 'pr_merge_time': {
        const validatedArgs = RepoSchema.parse(args);
        result = await calculatePRMergeTime(config, validatedArgs);
        break;
      }

      case 'pr_throughput': {
        const validatedArgs = RepoSchema.parse(args);
        result = await calculatePRThroughput(config, validatedArgs);
        break;
      }

      case 'commit_frequency': {
        const validatedArgs = CommitFrequencySchema.parse(args);
        result = await calculateCommitFrequency(config, validatedArgs);
        break;
      }

      case 'change_failure_rate': {
        const validatedArgs = ChangeFailureRateSchema.parse(args);
        result = await calculateChangeFailureRate(config, validatedArgs);
        break;
      }

      case 'hotfix_rate': {
        const validatedArgs = HotfixRateSchema.parse(args);
        result = await calculateHotfixRate(config, validatedArgs);
        break;
      }

      case 'revert_rate': {
        const validatedArgs = RepoSchema.parse(args);
        result = await calculateRevertRate(config, validatedArgs);
        break;
      }

      case 'pr_size': {
        const validatedArgs = RepoSchema.parse(args);
        result = await calculatePRSize(config, validatedArgs);
        break;
      }

      case 'all_metrics': {
        const validatedArgs = RepoSchema.parse(args);
        result = await getAllMetrics(config, validatedArgs);
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    // Return in MCP format
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

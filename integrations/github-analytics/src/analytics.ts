import { getGithubData } from './utils';

/**
 * GitHub Analytics Actions
 * Provides tools to calculate DORA metrics and code quality metrics
 */

interface AnalyticsConfig {
  access_token: string;
  owner?: string;
  repo?: string;
}

interface DateRangeParams {
  days?: number;
  startDate?: string;
  endDate?: string;
}

/**
 * Helper: Calculate date range for metrics
 * Supports both relative (days) and absolute (startDate/endDate) ranges
 *
 * Edge cases:
 * 1. startDate + endDate → Use exact range
 * 2. Only startDate → From startDate to today
 * 3. Only endDate → Go back 'days' from endDate
 * 4. Neither → Go back 'days' from today (default: 30 days)
 */
function getDateRange(params: DateRangeParams = {}): { startDate: string; endDate: string; periodDays: number } {
  let startDate: Date;
  let endDate: Date;

  if (params.startDate && params.endDate) {
    // Case 1: Both dates provided - use exact range
    startDate = new Date(params.startDate);
    endDate = new Date(params.endDate);
  } else if (params.startDate) {
    // Case 2: Only startDate - from startDate to today
    startDate = new Date(params.startDate);
    endDate = new Date();
  } else if (params.endDate) {
    // Case 3: Only endDate - go back 'days' from endDate
    const days = params.days || 30;
    endDate = new Date(params.endDate);
    startDate = new Date(params.endDate);
    startDate.setDate(endDate.getDate() - days);
  } else {
    // Case 4: Neither date provided - relative range (default 30 days back from today)
    const days = params.days || 30;
    endDate = new Date();
    startDate = new Date();
    startDate.setDate(endDate.getDate() - days);
  }

  const periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    periodDays,
  };
}

/**
 * Helper: Calculate previous period for comparison
 */
function getPreviousPeriod(currentStart: string, currentEnd: string): { startDate: string; endDate: string } {
  const start = new Date(currentStart);
  const end = new Date(currentEnd);
  const periodDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);

  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - periodDays + 1);

  return {
    startDate: prevStart.toISOString().split('T')[0],
    endDate: prevEnd.toISOString().split('T')[0],
  };
}

/**
 * Helper: Add comparison data to result object
 * Generic helper to calculate and add period-over-period comparison
 * Reserved for future use when adding comparison logic to remaining metrics
 */
function _addComparisonToResult(
  result: any,
  currentValue: number,
  previousValue: number,
  startDate: string,
  endDate: string
): void {
  const prevPeriod = getPreviousPeriod(startDate, endDate);
  const change = currentValue - previousValue;
  const changePercent = previousValue > 0 ? ((change / previousValue) * 100).toFixed(1) : 'N/A';

  result.comparison = {
    previousPeriod: {
      value: Math.round(previousValue * 100) / 100,
      dateRange: prevPeriod,
    },
    change: {
      absolute: Math.round(change * 100) / 100,
      percent: changePercent,
      direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
    },
  };
}

/**
 * Helper: Add date range and period to result object
 */
function addDateRangeToResult(
  result: any,
  startDate: string,
  endDate: string,
  periodDays: number,
  hasCustomDates: boolean
): void {
  result.period = hasCustomDates ? `${startDate}_to_${endDate}` : `last_${periodDays}_days`;
  result.dateRange = {
    start: startDate,
    end: endDate,
    days: periodDays,
  };
}

/**
 * Deployment Frequency
 * Calculates number of releases/deployments per week
 */
export async function calculateDeploymentFrequency(
  config: AnalyticsConfig,
  params: {
    owner: string;
    repo: string;
    days?: number;
    startDate?: string;
    endDate?: string;
    compareWithPrevious?: boolean;
  }
): Promise<any> {
  const { owner, repo } = params;
  const { startDate, endDate, periodDays } = getDateRange({
    days: params.days,
    startDate: params.startDate,
    endDate: params.endDate,
  });

  try {
    // Get all releases
    const releases = await getGithubData(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`,
      config.access_token
    );

    // Filter releases for current period
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const recentReleases = releases.filter((release: any) => {
      const publishedAt = new Date(release.published_at);
      return publishedAt >= start && publishedAt <= end;
    });

    const result: any = {
      metric: 'deployment_frequency',
      value: recentReleases.length,
      period: params.startDate ? `${startDate}_to_${endDate}` : `last_${periodDays}_days`,
      unit: 'deployments',
      perWeek: (recentReleases.length / periodDays) * 7,
      dateRange: {
        start: startDate,
        end: endDate,
        days: periodDays,
      },
      details: {
        totalReleases: recentReleases.length,
        releases: recentReleases.map((r: any) => ({
          name: r.name,
          tag: r.tag_name,
          published_at: r.published_at,
          url: r.html_url,
        })),
      },
    };

    // Add comparison with previous period
    if (params.compareWithPrevious) {
      const prevPeriod = getPreviousPeriod(startDate, endDate);
      const prevStart = new Date(prevPeriod.startDate);
      const prevEnd = new Date(prevPeriod.endDate);
      prevEnd.setHours(23, 59, 59, 999);

      const prevReleases = releases.filter((release: any) => {
        const publishedAt = new Date(release.published_at);
        return publishedAt >= prevStart && publishedAt <= prevEnd;
      });

      const change = recentReleases.length - prevReleases.length;
      const changePercent = prevReleases.length > 0 ? ((change / prevReleases.length) * 100).toFixed(1) : 'N/A';

      result.comparison = {
        previousPeriod: {
          value: prevReleases.length,
          dateRange: prevPeriod,
        },
        change: {
          absolute: change,
          percent: changePercent,
          direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
        },
      };
    }

    return result;
  } catch (error) {
    return {
      error: `Failed to calculate deployment frequency: ${error}`,
    };
  }
}

/**
 * Lead Time for Changes
 * Time from first commit to production deployment
 */
export async function calculateLeadTime(
  config: AnalyticsConfig,
  params: { owner: string; repo: string; days?: number;
    startDate?: string;
    endDate?: string;
    compareWithPrevious?: boolean }
): Promise<any> {
  const { owner, repo } = params;
  const { startDate, endDate, periodDays } = getDateRange({ days: params.days, startDate: params.startDate, endDate: params.endDate });

  try {
    // Get merged PRs in the time period
    const searchQuery = `repo:${owner}/${repo} is:pr is:merged merged:${startDate}..${endDate}`;
    const prsResponse = await getGithubData(
      `https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=100`,
      config.access_token
    );

    // Get releases
    const releases = await getGithubData(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`,
      config.access_token
    );

    const leadTimes: number[] = [];
    const prDetails: any[] = [];

    for (const pr of prsResponse.items || []) {
      const createdAt = new Date(pr.created_at);
      const mergedAt = new Date(pr.closed_at);

      // Find the next release after merge
      const nextRelease = releases.find((release: any) => {
        return new Date(release.published_at) >= mergedAt;
      });

      if (nextRelease) {
        const deployedAt = new Date(nextRelease.published_at);
        const leadTimeHours = (deployedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
        leadTimes.push(leadTimeHours);

        prDetails.push({
          prNumber: pr.number,
          title: pr.title,
          createdAt: pr.created_at,
          mergedAt: pr.closed_at,
          deployedAt: nextRelease.published_at,
          leadTimeHours: Math.round(leadTimeHours * 100) / 100,
          leadTimeDays: Math.round((leadTimeHours / 24) * 100) / 100,
          release: nextRelease.tag_name,
          url: pr.html_url,
        });
      }
    }

    const avgLeadTime = leadTimes.length > 0
      ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length
      : 0;

    const result: any = {
      metric: 'lead_time_for_changes',
      value: Math.round(avgLeadTime * 100) / 100,
      unit: 'hours',
      period: params.startDate ? `${startDate}_to_${endDate}` : `last_${periodDays}_days`,
      dateRange: {
        start: startDate,
        end: endDate,
        days: periodDays,
      },
      details: {
        averageHours: Math.round(avgLeadTime * 100) / 100,
        averageDays: Math.round((avgLeadTime / 24) * 100) / 100,
        medianHours: leadTimes.length > 0 ? Math.round(leadTimes.sort()[Math.floor(leadTimes.length / 2)] * 100) / 100 : 0,
        prCount: leadTimes.length,
        prs: prDetails,
      },
    };

    // Add comparison with previous period if requested
    if (params.compareWithPrevious) {
      const prevPeriod = getPreviousPeriod(startDate, endDate);
      const prevSearchQuery = `repo:${owner}/${repo} is:pr is:merged merged:${prevPeriod.startDate}..${prevPeriod.endDate}`;

      try {
        const prevPrsResponse = await getGithubData(
          `https://api.github.com/search/issues?q=${encodeURIComponent(prevSearchQuery)}&per_page=100`,
          config.access_token
        );

        const prevLeadTimes: number[] = [];
        for (const pr of prevPrsResponse.items || []) {
          const createdAt = new Date(pr.created_at);
          const mergedAt = new Date(pr.closed_at);
          const nextRelease = releases.find((release: any) => {
            return new Date(release.published_at) >= mergedAt;
          });
          if (nextRelease) {
            const deployedAt = new Date(nextRelease.published_at);
            const leadTimeHours = (deployedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
            prevLeadTimes.push(leadTimeHours);
          }
        }

        const prevAvgLeadTime = prevLeadTimes.length > 0
          ? prevLeadTimes.reduce((a, b) => a + b, 0) / prevLeadTimes.length
          : 0;
        const change = avgLeadTime - prevAvgLeadTime;
        const changePercent = prevAvgLeadTime > 0 ? ((change / prevAvgLeadTime) * 100).toFixed(1) : 'N/A';

        result.comparison = {
          previousPeriod: {
            value: Math.round(prevAvgLeadTime * 100) / 100,
            dateRange: prevPeriod,
          },
          change: {
            absolute: Math.round(change * 100) / 100,
            percent: changePercent,
            direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
          },
        };
      } catch (error) {
        console.error('Failed to calculate previous period comparison:', error);
      }
    }

    return result;
  } catch (error) {
    return {
      error: `Failed to calculate lead time: ${error}`,
    };
  }
}

/**
 * PR Merge Time
 * Time from PR creation to merge
 */
export async function calculatePRMergeTime(
  config: AnalyticsConfig,
  params: { owner: string; repo: string; days?: number;
    startDate?: string;
    endDate?: string;
    compareWithPrevious?: boolean }
): Promise<any> {
  const { owner, repo } = params;
  const { startDate, endDate, periodDays } = getDateRange({ days: params.days, startDate: params.startDate, endDate: params.endDate });

  try {
    const searchQuery = `repo:${owner}/${repo} is:pr is:merged merged:${startDate}..${endDate}`;
    const prsResponse = await getGithubData(
      `https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=100`,
      config.access_token
    );

    const mergeTimes: number[] = [];
    const prDetails: any[] = [];

    for (const pr of prsResponse.items || []) {
      const createdAt = new Date(pr.created_at);
      const mergedAt = new Date(pr.closed_at);
      const mergeTimeHours = (mergedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

      mergeTimes.push(mergeTimeHours);
      prDetails.push({
        prNumber: pr.number,
        title: pr.title,
        createdAt: pr.created_at,
        mergedAt: pr.closed_at,
        mergeTimeHours: Math.round(mergeTimeHours * 100) / 100,
        url: pr.html_url,
      });
    }

    const avgMergeTime = mergeTimes.length > 0
      ? mergeTimes.reduce((a, b) => a + b, 0) / mergeTimes.length
      : 0;

    const result: any = {
      metric: 'pr_merge_time',
      value: Math.round(avgMergeTime * 100) / 100,
      unit: 'hours',
      period: params.startDate ? `${startDate}_to_${endDate}` : `last_${periodDays}_days`,
      dateRange: {
        start: startDate,
        end: endDate,
        days: periodDays,
      },
      details: {
        averageHours: Math.round(avgMergeTime * 100) / 100,
        medianHours: mergeTimes.length > 0 ? Math.round(mergeTimes.sort()[Math.floor(mergeTimes.length / 2)] * 100) / 100 : 0,
        prCount: mergeTimes.length,
        prs: prDetails,
      },
    };

    // Add comparison with previous period if requested
    if (params.compareWithPrevious) {
      const prevPeriod = getPreviousPeriod(startDate, endDate);
      const prevSearchQuery = `repo:${owner}/${repo} is:pr is:merged merged:${prevPeriod.startDate}..${prevPeriod.endDate}`;

      try {
        const prevPrsResponse = await getGithubData(
          `https://api.github.com/search/issues?q=${encodeURIComponent(prevSearchQuery)}&per_page=100`,
          config.access_token
        );

        const prevMergeTimes: number[] = [];
        for (const pr of prevPrsResponse.items || []) {
          const createdAt = new Date(pr.created_at);
          const mergedAt = new Date(pr.closed_at);
          const mergeTimeHours = (mergedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
          prevMergeTimes.push(mergeTimeHours);
        }

        const prevAvgMergeTime = prevMergeTimes.length > 0
          ? prevMergeTimes.reduce((a, b) => a + b, 0) / prevMergeTimes.length
          : 0;
        const change = avgMergeTime - prevAvgMergeTime;
        const changePercent = prevAvgMergeTime > 0 ? ((change / prevAvgMergeTime) * 100).toFixed(1) : 'N/A';

        result.comparison = {
          previousPeriod: {
            value: Math.round(prevAvgMergeTime * 100) / 100,
            dateRange: prevPeriod,
          },
          change: {
            absolute: Math.round(change * 100) / 100,
            percent: changePercent,
            direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
          },
        };
      } catch (error) {
        console.error('Failed to calculate previous period comparison:', error);
      }
    }

    return result;
  } catch (error) {
    return {
      error: `Failed to calculate PR merge time: ${error}`,
    };
  }
}

/**
 * PR Throughput
 * Number of PRs merged per week
 */
export async function calculatePRThroughput(
  config: AnalyticsConfig,
  params: {
    owner: string;
    repo: string;
    days?: number;
    startDate?: string;
    endDate?: string;
    compareWithPrevious?: boolean;
  }
): Promise<any> {
  const { owner, repo } = params;
  const { startDate, endDate, periodDays } = getDateRange({
    days: params.days,
    startDate: params.startDate,
    endDate: params.endDate,
  });

  try {
    // Calculate current period
    const searchQuery = `repo:${owner}/${repo} is:pr is:merged merged:${startDate}..${endDate}`;
    const prsResponse = await getGithubData(
      `https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=100`,
      config.access_token
    );

    const prCount = prsResponse.total_count || 0;
    const result: any = {
      metric: 'pr_throughput',
      value: prCount,
      period: params.startDate ? `${startDate}_to_${endDate}` : `last_${periodDays}_days`,
      unit: 'prs_merged',
      perWeek: (prCount / periodDays) * 7,
      dateRange: {
        start: startDate,
        end: endDate,
        days: periodDays,
      },
      details: {
        totalPRs: prCount,
        prs: (prsResponse.items || []).map((pr: any) => ({
          prNumber: pr.number,
          title: pr.title,
          mergedAt: pr.closed_at,
          url: pr.html_url,
        })),
      },
    };

    // Add comparison with previous period if requested
    if (params.compareWithPrevious) {
      const prevPeriod = getPreviousPeriod(startDate, endDate);
      const prevSearchQuery = `repo:${owner}/${repo} is:pr is:merged merged:${prevPeriod.startDate}..${prevPeriod.endDate}`;

      try {
        const prevPrsResponse = await getGithubData(
          `https://api.github.com/search/issues?q=${encodeURIComponent(prevSearchQuery)}&per_page=100`,
          config.access_token
        );
        const prevPrCount = prevPrsResponse.total_count || 0;
        const change = prCount - prevPrCount;
        const changePercent = prevPrCount > 0 ? ((change / prevPrCount) * 100).toFixed(1) : 'N/A';

        result.comparison = {
          previousPeriod: {
            value: prevPrCount,
            dateRange: prevPeriod,
          },
          change: {
            absolute: change,
            percent: changePercent,
            direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
          },
        };
      } catch (error) {
        result.comparison = {
          error: 'Failed to fetch previous period data',
        };
      }
    }

    return result;
  } catch (error) {
    return {
      error: `Failed to calculate PR throughput: ${error}`,
    };
  }
}

/**
 * Commit Frequency
 * Number of commits to main branch per week
 */
export async function calculateCommitFrequency(
  config: AnalyticsConfig,
  params: { owner: string; repo: string; branch?: string; days?: number;
    startDate?: string;
    endDate?: string;
    compareWithPrevious?: boolean }
): Promise<any> {
  const { owner, repo } = params;
  const branch = params.branch || 'main';
  const { startDate, endDate, periodDays } = getDateRange({
    days: params.days,
    startDate: params.startDate,
    endDate: params.endDate,
  });

  try {
    const sinceDate = new Date(startDate);
    const untilDate = new Date(endDate);
    untilDate.setHours(23, 59, 59, 999);

    const commits = await getGithubData(
      `https://api.github.com/repos/${owner}/${repo}/commits?sha=${branch}&since=${sinceDate.toISOString()}&until=${untilDate.toISOString()}&per_page=100`,
      config.access_token
    );

    const result: any = {
      metric: 'commit_frequency',
      value: commits.length,
      period: params.startDate ? `${startDate}_to_${endDate}` : `last_${periodDays}_days`,
      unit: 'commits',
      perWeek: (commits.length / periodDays) * 7,
      branch: branch,
      dateRange: {
        start: startDate,
        end: endDate,
        days: periodDays,
      },
      details: {
        totalCommits: commits.length,
        commits: commits.map((commit: any) => ({
          sha: commit.sha.substring(0, 7),
          message: commit.commit.message.split('\n')[0],
          author: commit.commit.author.name,
          date: commit.commit.author.date,
          url: commit.html_url,
        })),
      },
    };

    // Add comparison with previous period
    if (params.compareWithPrevious) {
      const prevPeriod = getPreviousPeriod(startDate, endDate);
      const prevStart = new Date(prevPeriod.startDate);
      const prevEnd = new Date(prevPeriod.endDate);
      prevEnd.setHours(23, 59, 59, 999);

      try {
        const prevCommits = await getGithubData(
          `https://api.github.com/repos/${owner}/${repo}/commits?sha=${branch}&since=${prevStart.toISOString()}&until=${prevEnd.toISOString()}&per_page=100`,
          config.access_token
        );

        const change = commits.length - prevCommits.length;
        const changePercent = prevCommits.length > 0 ? ((change / prevCommits.length) * 100).toFixed(1) : 'N/A';

        result.comparison = {
          previousPeriod: {
            value: prevCommits.length,
            dateRange: prevPeriod,
          },
          change: {
            absolute: change,
            percent: changePercent,
            direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
          },
        };
      } catch (error) {
        result.comparison = {
          error: 'Failed to fetch previous period data',
        };
      }
    }

    return result;
  } catch (error) {
    return {
      error: `Failed to calculate commit frequency: ${error}`,
    };
  }
}

/**
 * Change Failure Rate
 * Percentage of deployments that cause production failures
 */
export async function calculateChangeFailureRate(
  config: AnalyticsConfig,
  params: { owner: string; repo: string; days?: number;
    startDate?: string;
    endDate?: string;
    compareWithPrevious?: boolean; incidentLabels?: string[] }
): Promise<any> {
  const { owner, repo } = params;
  const incidentLabels = params.incidentLabels || ['incident', 'production', 'outage', 'bug'];
  const { startDate, endDate, periodDays } = getDateRange({ days: params.days, startDate: params.startDate, endDate: params.endDate });

  try {
    // Get releases
    const releases = await getGithubData(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`,
      config.access_token
    );

    const cutoffDate = new Date(startDate);
    const recentReleases = releases.filter((release: any) => {
      return new Date(release.published_at) >= cutoffDate;
    });

    // Search for production incidents
    const labelQuery = incidentLabels.map(l => `label:${l}`).join(' ');
    const searchQuery = `repo:${owner}/${repo} is:issue ${labelQuery} created:${startDate}..${endDate}`;

    const incidentsResponse = await getGithubData(
      `https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=100`,
      config.access_token
    );

    // Get revert commits
    const commits = await getGithubData(
      `https://api.github.com/repos/${owner}/${repo}/commits?since=${new Date(startDate).toISOString()}&until=${new Date(endDate).toISOString()}&per_page=100`,
      config.access_token
    );

    const revertCommits = commits.filter((commit: any) =>
      commit.commit.message.toLowerCase().includes('revert')
    );

    const totalFailures = (incidentsResponse.total_count || 0) + revertCommits.length;
    const totalDeployments = recentReleases.length || 1;
    const failureRate = (totalFailures / totalDeployments) * 100;

    const result: any = {
      metric: 'change_failure_rate',
      value: Math.round(failureRate * 100) / 100,
      unit: 'percentage',
      details: {
        totalDeployments: totalDeployments,
        totalFailures: totalFailures,
        incidents: incidentsResponse.total_count || 0,
        reverts: revertCommits.length,
        failureRate: `${Math.round(failureRate * 100) / 100}%`,
        incidentIssues: (incidentsResponse.items || []).map((issue: any) => ({
          number: issue.number,
          title: issue.title,
          createdAt: issue.created_at,
          url: issue.html_url,
        })),
      },
    };

    // Add date range
    addDateRangeToResult(result, startDate, endDate, periodDays, !!params.startDate);

    // Add comparison with previous period if requested
    if (params.compareWithPrevious) {
      const prevPeriod = getPreviousPeriod(startDate, endDate);
      try {
        // Get previous period releases
        const prevCutoffDate = new Date(prevPeriod.startDate);
        const prevRecentReleases = releases.filter((release: any) => {
          const releaseDate = new Date(release.published_at);
          return releaseDate >= prevCutoffDate && releaseDate <= new Date(prevPeriod.endDate);
        });

        // Get previous period incidents
        const prevSearchQuery = `repo:${owner}/${repo} is:issue ${labelQuery} created:${prevPeriod.startDate}..${prevPeriod.endDate}`;
        const prevIncidentsResponse = await getGithubData(
          `https://api.github.com/search/issues?q=${encodeURIComponent(prevSearchQuery)}&per_page=100`,
          config.access_token
        );

        // Get previous period revert commits
        const prevCommits = await getGithubData(
          `https://api.github.com/repos/${owner}/${repo}/commits?since=${new Date(prevPeriod.startDate).toISOString()}&until=${new Date(prevPeriod.endDate).toISOString()}&per_page=100`,
          config.access_token
        );

        const prevRevertCommits = prevCommits.filter((commit: any) =>
          commit.commit.message.toLowerCase().includes('revert')
        );

        const prevTotalFailures = (prevIncidentsResponse.total_count || 0) + prevRevertCommits.length;
        const prevTotalDeployments = prevRecentReleases.length || 1;
        const prevFailureRate = (prevTotalFailures / prevTotalDeployments) * 100;

        _addComparisonToResult(result, failureRate, prevFailureRate, startDate, endDate);
      } catch (error) {
        console.error('Failed to calculate previous period comparison:', error);
      }
    }

    return result;
  } catch (error) {
    return {
      error: `Failed to calculate change failure rate: ${error}`,
    };
  }
}

/**
 * Hotfix Rate
 * Percentage of releases that are emergency hotfixes
 */
export async function calculateHotfixRate(
  config: AnalyticsConfig,
  params: { owner: string; repo: string; days?: number;
    startDate?: string;
    endDate?: string;
    compareWithPrevious?: boolean; hotfixPatterns?: string[] }
): Promise<any> {
  const { owner, repo } = params;
  const hotfixPatterns = params.hotfixPatterns || ['hotfix', 'emergency', 'patch'];
  const { startDate, endDate, periodDays } = getDateRange({ days: params.days, startDate: params.startDate, endDate: params.endDate });

  try {
    const releases = await getGithubData(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`,
      config.access_token
    );

    const cutoffDate = new Date(startDate);
    const endDateObj = new Date(endDate);

    const recentReleases = releases.filter((release: any) => {
      const releaseDate = new Date(release.published_at);
      return releaseDate >= cutoffDate && releaseDate <= endDateObj;
    });

    const hotfixes = recentReleases.filter((release: any) => {
      const releaseText = `${release.name} ${release.tag_name}`.toLowerCase();
      return hotfixPatterns.some(pattern => releaseText.includes(pattern));
    });

    const totalReleases = recentReleases.length || 1;
    const hotfixRate = (hotfixes.length / totalReleases) * 100;

    const result: any = {
      metric: 'hotfix_rate',
      value: Math.round(hotfixRate * 100) / 100,
      unit: 'percentage',
      details: {
        totalReleases: totalReleases,
        hotfixes: hotfixes.length,
        hotfixRate: `${Math.round(hotfixRate * 100) / 100}%`,
        hotfixReleases: hotfixes.map((r: any) => ({
          name: r.name,
          tag: r.tag_name,
          published_at: r.published_at,
          url: r.html_url,
        })),
      },
    };

    // Add date range
    addDateRangeToResult(result, startDate, endDate, periodDays, !!params.startDate);

    // Add comparison with previous period if requested
    if (params.compareWithPrevious) {
      const prevPeriod = getPreviousPeriod(startDate, endDate);
      try {
        const prevCutoffDate = new Date(prevPeriod.startDate);
        const prevEndDate = new Date(prevPeriod.endDate);

        const prevRecentReleases = releases.filter((release: any) => {
          const releaseDate = new Date(release.published_at);
          return releaseDate >= prevCutoffDate && releaseDate <= prevEndDate;
        });

        const prevHotfixes = prevRecentReleases.filter((release: any) => {
          const releaseText = `${release.name} ${release.tag_name}`.toLowerCase();
          return hotfixPatterns.some(pattern => releaseText.includes(pattern));
        });

        const prevTotalReleases = prevRecentReleases.length || 1;
        const prevHotfixRate = (prevHotfixes.length / prevTotalReleases) * 100;

        _addComparisonToResult(result, hotfixRate, prevHotfixRate, startDate, endDate);
      } catch (error) {
        console.error('Failed to calculate previous period comparison:', error);
      }
    }

    return result;
  } catch (error) {
    return {
      error: `Failed to calculate hotfix rate: ${error}`,
    };
  }
}

/**
 * Revert Rate
 * Percentage of merged PRs that get reverted
 */
export async function calculateRevertRate(
  config: AnalyticsConfig,
  params: { owner: string; repo: string; days?: number;
    startDate?: string;
    endDate?: string;
    compareWithPrevious?: boolean }
): Promise<any> {
  const { owner, repo } = params;
  const { startDate, endDate, periodDays } = getDateRange({ days: params.days, startDate: params.startDate, endDate: params.endDate });

  try {
    // Get merged PRs
    const searchQuery = `repo:${owner}/${repo} is:pr is:merged merged:${startDate}..${endDate}`;
    const prsResponse = await getGithubData(
      `https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=100`,
      config.access_token
    );

    // Get revert commits
    const commits = await getGithubData(
      `https://api.github.com/repos/${owner}/${repo}/commits?since=${new Date(startDate).toISOString()}&until=${new Date(endDate).toISOString()}&per_page=100`,
      config.access_token
    );

    const revertCommits = commits.filter((commit: any) =>
      commit.commit.message.toLowerCase().includes('revert')
    );

    const totalPRs = prsResponse.total_count || 1;
    const revertRate = (revertCommits.length / totalPRs) * 100;

    const result: any = {
      metric: 'revert_rate',
      value: Math.round(revertRate * 100) / 100,
      unit: 'percentage',
      details: {
        totalPRs: totalPRs,
        reverts: revertCommits.length,
        revertRate: `${Math.round(revertRate * 100) / 100}%`,
        revertCommits: revertCommits.map((commit: any) => ({
          sha: commit.sha.substring(0, 7),
          message: commit.commit.message.split('\n')[0],
          author: commit.commit.author.name,
          date: commit.commit.author.date,
          url: commit.html_url,
        })),
      },
    };

    // Add date range
    addDateRangeToResult(result, startDate, endDate, periodDays, !!params.startDate);

    // Add comparison with previous period if requested
    if (params.compareWithPrevious) {
      const prevPeriod = getPreviousPeriod(startDate, endDate);
      try {
        // Get previous period merged PRs
        const prevSearchQuery = `repo:${owner}/${repo} is:pr is:merged merged:${prevPeriod.startDate}..${prevPeriod.endDate}`;
        const prevPrsResponse = await getGithubData(
          `https://api.github.com/search/issues?q=${encodeURIComponent(prevSearchQuery)}&per_page=100`,
          config.access_token
        );

        // Get previous period revert commits
        const prevCommits = await getGithubData(
          `https://api.github.com/repos/${owner}/${repo}/commits?since=${new Date(prevPeriod.startDate).toISOString()}&until=${new Date(prevPeriod.endDate).toISOString()}&per_page=100`,
          config.access_token
        );

        const prevRevertCommits = prevCommits.filter((commit: any) =>
          commit.commit.message.toLowerCase().includes('revert')
        );

        const prevTotalPRs = prevPrsResponse.total_count || 1;
        const prevRevertRate = (prevRevertCommits.length / prevTotalPRs) * 100;

        _addComparisonToResult(result, revertRate, prevRevertRate, startDate, endDate);
      } catch (error) {
        console.error('Failed to calculate previous period comparison:', error);
      }
    }

    return result;
  } catch (error) {
    return {
      error: `Failed to calculate revert rate: ${error}`,
    };
  }
}

/**
 * PR Size
 * Average lines changed per PR
 */
export async function calculatePRSize(
  config: AnalyticsConfig,
  params: { owner: string; repo: string; days?: number;
    startDate?: string;
    endDate?: string;
    compareWithPrevious?: boolean }
): Promise<any> {
  const { owner, repo } = params;
  const { startDate, endDate, periodDays } = getDateRange({ days: params.days, startDate: params.startDate, endDate: params.endDate });

  try {
    const searchQuery = `repo:${owner}/${repo} is:pr is:merged merged:${startDate}..${endDate}`;
    const prsResponse = await getGithubData(
      `https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=100`,
      config.access_token
    );

    const prSizes: number[] = [];
    const prDetails: any[] = [];

    // Get detailed PR info for each PR
    for (const pr of (prsResponse.items || []).slice(0, 30)) {
      try {
        const prData = await getGithubData(
          pr.pull_request.url,
          config.access_token
        );

        const totalChanges = (prData.additions || 0) + (prData.deletions || 0);
        prSizes.push(totalChanges);

        prDetails.push({
          prNumber: pr.number,
          title: pr.title,
          additions: prData.additions,
          deletions: prData.deletions,
          totalChanges: totalChanges,
          filesChanged: prData.changed_files,
          url: pr.html_url,
        });
      } catch (error) {
        // Skip PRs that can't be fetched
        continue;
      }
    }

    const avgSize = prSizes.length > 0
      ? prSizes.reduce((a, b) => a + b, 0) / prSizes.length
      : 0;

    const result: any = {
      metric: 'pr_size',
      value: Math.round(avgSize),
      unit: 'lines_changed',
      details: {
        averageSize: Math.round(avgSize),
        medianSize: prSizes.length > 0 ? Math.round(prSizes.sort()[Math.floor(prSizes.length / 2)]) : 0,
        prCount: prSizes.length,
        prs: prDetails,
      },
    };

    // Add date range
    addDateRangeToResult(result, startDate, endDate, periodDays, !!params.startDate);

    // Add comparison with previous period if requested
    if (params.compareWithPrevious) {
      const prevPeriod = getPreviousPeriod(startDate, endDate);
      try {
        const prevSearchQuery = `repo:${owner}/${repo} is:pr is:merged merged:${prevPeriod.startDate}..${prevPeriod.endDate}`;
        const prevPrsResponse = await getGithubData(
          `https://api.github.com/search/issues?q=${encodeURIComponent(prevSearchQuery)}&per_page=100`,
          config.access_token
        );

        const prevPrSizes: number[] = [];

        // Get detailed PR info for each previous period PR
        for (const pr of (prevPrsResponse.items || []).slice(0, 30)) {
          try {
            const prData = await getGithubData(
              pr.pull_request.url,
              config.access_token
            );

            const totalChanges = (prData.additions || 0) + (prData.deletions || 0);
            prevPrSizes.push(totalChanges);
          } catch (error) {
            // Skip PRs that can't be fetched
            continue;
          }
        }

        const prevAvgSize = prevPrSizes.length > 0
          ? prevPrSizes.reduce((a, b) => a + b, 0) / prevPrSizes.length
          : 0;

        _addComparisonToResult(result, avgSize, prevAvgSize, startDate, endDate);
      } catch (error) {
        console.error('Failed to calculate previous period comparison:', error);
      }
    }

    return result;
  } catch (error) {
    return {
      error: `Failed to calculate PR size: ${error}`,
    };
  }
}

/**
 * Get all analytics metrics
 */
export async function getAllMetrics(
  config: AnalyticsConfig,
  params: { owner: string; repo: string; days?: number }
): Promise<any> {
  try {
    const [
      deploymentFreq,
      leadTime,
      prMergeTime,
      prThroughput,
      commitFreq,
      changeFailure,
      hotfixRate,
      revertRate,
      prSize,
    ] = await Promise.all([
      calculateDeploymentFrequency(config, params),
      calculateLeadTime(config, params),
      calculatePRMergeTime(config, params),
      calculatePRThroughput(config, params),
      calculateCommitFrequency(config, params),
      calculateChangeFailureRate(config, params),
      calculateHotfixRate(config, params),
      calculateRevertRate(config, params),
      calculatePRSize(config, params),
    ]);

    return {
      repository: `${params.owner}/${params.repo}`,
      period: `last_${params.days || 7}_days`,
      metrics: {
        delivery_speed: {
          deployment_frequency: deploymentFreq,
          lead_time_for_changes: leadTime,
          pr_merge_time: prMergeTime,
          pr_throughput: prThroughput,
          commit_frequency: commitFreq,
        },
        stability_reliability: {
          change_failure_rate: changeFailure,
          hotfix_rate: hotfixRate,
          revert_rate: revertRate,
        },
        code_quality: {
          pr_size: prSize,
        },
      },
    };
  } catch (error) {
    return {
      error: `Failed to get all metrics: ${error}`,
    };
  }
}

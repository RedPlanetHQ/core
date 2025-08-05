import { getUserEvents, getGithubData } from './utils';

interface GitHubActivityCreateParams {
  text: string;
  sourceURL: string;
}

interface GitHubSettings {
  lastSyncTime?: string;
  lastUserEventTime?: string;
  username?: string;
}

/**
 * Creates an activity message based on GitHub data
 */
function createActivityMessage(params: GitHubActivityCreateParams) {
  return {
    type: 'activity',
    data: {
      text: params.text,
      sourceURL: params.sourceURL,
    },
  };
}

/**
 * Gets default sync time (24 hours ago)
 */
function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Fetches user information from GitHub
 */
async function fetchUserInfo(accessToken: string) {
  try {
    return await getGithubData('https://api.github.com/user', accessToken);
  } catch (error) {
    console.error('Error fetching GitHub user info:', error);
    return null;
  }
}

/**
 * Processes GitHub notifications into activity messages
 */
async function processNotifications(accessToken: string, lastSyncTime: string): Promise<any[]> {
  const activities = [];
  const allowedReasons = [
    'assign',
    'review_requested',
    'mention',
    'state_change',
    'subscribed',
    'author',
    'approval_requested',
    'comment',
    'ci_activity',
    'invitation',
    'member_feature_requested',
    'security_alert',
    'security_advisory_credit',
    'team_mention',
  ];

  let page = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    try {
      const notifications = await getGithubData(
        `https://api.github.com/notifications?page=${page}&per_page=50&all=true&since=${lastSyncTime}`,
        accessToken,
      );

      if (!notifications || notifications.length === 0) {
        hasMorePages = false;
        break;
      }

      if (notifications.length < 50) {
        hasMorePages = false;
      } else {
        page++;
      }

      for (const notification of notifications) {
        try {
          if (!allowedReasons.includes(notification.reason)) {
            continue;
          }

          const repository = notification.repository;
          const subject = notification.subject;
          let title = '';
          let sourceURL = '';

          // Get the actual GitHub data for the notification
          let githubData: any = {};
          if (subject.url) {
            try {
              githubData = await getGithubData(subject.url, accessToken);
            } catch (error) {
              console.error('Error fetching GitHub data for notification:', error);
              continue;
            }
          }

          const url = githubData.html_url || notification.subject.url || '';
          sourceURL = url;

          const isIssue = subject.type === 'Issue';
          const isPullRequest = subject.type === 'PullRequest';
          const isComment = notification.reason === 'comment';

          switch (notification.reason) {
            case 'assign':
              title = `${isIssue ? 'Issue' : 'PR'} assigned to you: #${githubData.number} - ${githubData.title}`;
              break;

            case 'author':
              if (isComment) {
                title = `New comment on your ${isIssue ? 'issue' : 'PR'} by ${githubData.user?.login}: ${githubData.body}`;
              } else {
                title = `You created this ${isIssue ? 'issue' : 'PR'}: #${githubData.number} - ${githubData.title}`;
              }
              break;

            case 'comment':
              title = `New comment by ${githubData.user?.login} in ${repository.full_name}: ${githubData.body}`;
              break;

            case 'manual':
              title = `You subscribed to: #${githubData.number} - ${githubData.title}`;
              break;

            case 'mention':
              title = `@mentioned by ${githubData.user?.login} in ${repository.full_name}: ${githubData.body}`;
              break;

            case 'review_requested':
              title = `PR review requested in ${repository.full_name}: #${githubData.number} - ${githubData.title}`;
              break;

            case 'state_change': {
              let stateInfo = '';
              if (githubData.state) {
                stateInfo = `to ${githubData.state}`;
              } else if (githubData.merged) {
                stateInfo = 'to merged';
              } else if (githubData.closed_at) {
                stateInfo = 'to closed';
              }
              title = `State changed ${stateInfo} in ${repository.full_name}: #${githubData.number} - ${githubData.title}`;
              break;
            }

            case 'subscribed':
              if (isComment) {
                title = `New comment on watched ${isIssue ? 'issue' : 'PR'} in ${repository.full_name} by ${githubData.user?.login}: ${githubData.body}`;
              } else if (isPullRequest) {
                title = `New PR created in watched repo ${repository.full_name}: #${githubData.number} - ${githubData.title}`;
              } else if (isIssue) {
                title = `New issue created in watched repo ${repository.full_name}: #${githubData.number} - ${githubData.title}`;
              } else {
                title = `Update in watched repo ${repository.full_name}: #${githubData.number} - ${githubData.title}`;
              }
              break;

            case 'team_mention':
              title = `Your team was mentioned in ${repository.full_name}`;
              break;

            default:
              title = `GitHub notification: ${repository.full_name}`;
              break;
          }

          if (title && sourceURL) {
            activities.push(
              createActivityMessage({
                text: title,
                sourceURL: sourceURL,
              }),
            );
          }
        } catch (error) {
          // Silently ignore errors to prevent stdout pollution
        }
      }
    } catch (error) {
      // Silently ignore errors to prevent stdout pollution
      hasMorePages = false;
    }
  }

  return activities;
}

/**
 * Processes user events (PRs, issues, comments) into activity messages
 */
async function processUserEvents(
  username: string,
  accessToken: string,
  lastUserEventTime: string,
): Promise<any[]> {
  const activities = [];
  let page = 1;
  let hasMorePages = true;

  console.log('Processing user events');

  while (hasMorePages) {
    try {
      const userEvents = await getUserEvents(username, page, accessToken, lastUserEventTime);
      console.log('User events', userEvents);

      if (!userEvents || userEvents.length === 0) {
        hasMorePages = false;
        break;
      }

      if (userEvents.length < 30) {
        hasMorePages = false;
      } else {
        page++;
      }

      for (const event of userEvents) {
        try {
          let title = '';
          const sourceURL = event.html_url || '';

          switch (event.type) {
            case 'pr':
              title = `You created PR #${event.number}: ${event.title}`;
              break;
            case 'issue':
              title = `You created issue #${event.number}: ${event.title}`;
              break;
            case 'pr_comment':
              title = `You commented on PR #${event.number}: ${event.title}`;
              break;
            case 'issue_comment':
              title = `You commented on issue #${event.number}: ${event.title}`;
              break;
            case 'self_assigned_issue':
              title = `You assigned yourself to issue #${event.number}: ${event.title}`;
              break;
            default:
              title = `GitHub activity: ${event.title || 'Unknown'}`;
              break;
          }

          if (title && sourceURL) {
            activities.push(
              createActivityMessage({
                text: title,
                sourceURL: sourceURL,
              }),
            );
          }

          console.log('Activities', activities);
        } catch (error) {
          // Silently ignore errors to prevent stdout pollution
        }
      }
    } catch (error) {
      // Silently ignore errors to prevent stdout pollution
      hasMorePages = false;
    }
  }

  return activities;
}

export async function handleSchedule(config: any, state: any) {
  try {
    const integrationConfiguration = config;

    // Check if we have a valid access token
    if (!integrationConfiguration?.access_token) {
      return [];
    }

    // Get settings or initialize if not present
    let settings = (state || {}) as GitHubSettings;

    // Default to 24 hours ago if no last sync times
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();
    const lastUserEventTime = settings.lastUserEventTime || getDefaultSyncTime();

    // Fetch user info to get username if not available
    let user;
    try {
      user = await fetchUserInfo(integrationConfiguration.access_token);
    } catch (error) {
      return [];
    }

    if (!user) {
      return [];
    }

    // Update username in settings if not present
    if (!settings.username && user.login) {
      settings.username = user.login;
    }

    // Collect all messages
    const messages = [];

    // Process notifications
    try {
      const notificationActivities = await processNotifications(
        integrationConfiguration.access_token,
        lastSyncTime,
      );
      messages.push(...notificationActivities);
    } catch (error) {
      // Silently ignore errors to prevent stdout pollution
    }

    // Process user events if we have a username
    if (settings.username) {
      console.log('Processing user events');
      try {
        const userEventActivities = await processUserEvents(
          settings.username,
          integrationConfiguration.access_token,
          lastUserEventTime,
        );
        messages.push(...userEventActivities);
      } catch (error) {
        // Silently ignore errors to prevent stdout pollution
      }
    }

    // Update last sync times
    const newSyncTime = new Date().toISOString();

    // Add state message for saving settings
    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: newSyncTime,
        lastUserEventTime: newSyncTime,
      },
    });

    return messages;
  } catch (error) {
    return [];
  }
}

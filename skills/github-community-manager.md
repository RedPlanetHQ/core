# GitHub Community Manager Skill

## Purpose
Automate daily monitoring and management of the RedplanetHQ/core open source community by analyzing recent issues, comments, and suggesting personalized responses.

## Trigger Phrase
When the user says any of:
- "Check GitHub activity"
- "Review community issues"
- "Daily GitHub update"
- "What's new on the repo"
- "Community management check"

## Workflow

### Step 1: Initialize Memory Session
```
Always start by initializing a conversation session for memory storage:
- Call: CORE Memory:initialize_conversation_session with new=true
- Store the returned sessionId for later use
```

### Step 2: Retrieve GitHub Integration
```
Access GitHub through CORE Memory MCP:
1. Call: CORE Memory:get_integrations
2. Identify the GitHub integration (slug: "github")
3. Call: CORE Memory:get_integration_actions with integrationSlug="github"
4. Confirm availability of: search_issues, issue_read actions
```

### Step 3: Search Recent Issues (Last 7 Days)
```
Calculate date range:
- Current date: {CURRENT_DATE}
- Start date: 7 days ago in ISO format (YYYY-MM-DDTHH:MM:SSZ)

Execute search:
- Action: search_issues
- Parameters:
  - owner: "RedplanetHQ"
  - repo: "core"
  - query: "created:>={START_DATE}"
  - sort: "created"
  - order: "desc"
  - perPage: 30
```

### Step 4: Search Recent Comments (Last 7 Days)
```
For each issue found (both new and existing):
1. Call: issue_read
   - method: "get_comments"
   - owner: "RedplanetHQ"
   - repo: "core"
   - issue_number: {ISSUE_NUMBER}

2. Filter comments by date (last 7 days)
3. Track which issues have new activity
```

### Step 5: Analyze and Categorize
```
Create summary with following sections:

A. NEW ISSUES (Created in last 7 days)
   For each new issue:
   - Issue number and title
   - Reporter username
   - Labels
   - Brief description
   - Current status (open/closed)
   - Assignee (if any)
   - Number of comments

B. ACTIVE OLD ISSUES (Comments in last 7 days)
   For each issue with new comments:
   - Issue number and title
   - New comment count
   - Key discussion points
   - Who commented (usernames)
   - Current status

C. PRIORITY CLASSIFICATION
   Mark issues as:
   - 🔴 URGENT: Bugs, blockers, production issues
   - 🟡 HIGH: Feature requests with community interest, integration issues
   - 🟢 NORMAL: Documentation, enhancements, questions
   - ⚪ LOW: Duplicate, invalid, or already addressed
```

### Step 6: Action Recommendation
```
For each issue/comment, determine if action is needed:

RESPOND IF:
- User is asking a question and no team member has answered
- Bug report needs acknowledgment or triage
- Feature request needs feedback or roadmap context
- Community member needs clarification
- Issue is stale and needs update

NO RESPONSE NEEDED IF:
- Team member already responded
- Issue is assigned and being worked on
- Duplicate or spam
- Question already answered
- Waiting on external dependency
```

### Step 7: Retrieve User Writing Style
```
Before suggesting responses:
1. Call: CORE Memory:memory_search
   - query: "Manik's communication style writing preferences GitHub responses"
   - Retrieve user's tone, style, common phrases

Key style attributes to apply:
- Direct and concise (no corporate fluff)
- Problem-first messaging
- Technical but approachable
- Action-oriented
```

### Step 8: Generate Response Suggestions
```
For issues requiring response, provide:

1. ISSUE CONTEXT
   - Issue #, title, reporter
   - Key problem/request

2. SUGGESTED RESPONSE
   - Draft comment in user's style
   - Include: acknowledgment, context, timeline (if applicable), next steps

3. RESPONSE RATIONALE
   - Why this response is needed
   - What it accomplishes
   - Priority level
```

### Step 9: Store Session Summary
```
At the end of analysis:
1. Call: CORE Memory:memory_ingest
   - sessionId: {from Step 1}
   - message: Comprehensive summary including:
     - Date of check
     - Number of new issues
     - Number of active discussions
     - Key themes/patterns
     - Actions taken or recommended
```

## Output Format

Present findings as:

```markdown
# GitHub Community Report - {DATE}

## 📊 Summary
- **New Issues**: X
- **Active Discussions**: Y
- **Urgent Items**: Z
- **Action Required**: Yes/No

## 🆕 New Issues (Last 7 Days)

### 🔴 Issue #{NUM} - {TITLE}
- **Reporter**: @username
- **Created**: {DATE}
- **Status**: Open/Closed
- **Labels**: label1, label2
- **Summary**: Brief description
- **Team Response**: Yes/No/Pending

[Repeat for each new issue]

## 💬 Active Old Issues (New Comments)

### Issue #{NUM} - {TITLE}
- **New Comments**: X (by @user1, @user2)
- **Last Activity**: {DATE}
- **Discussion**: Key points from recent comments
- **Status Update**: Any changes

[Repeat for each active issue]

## ✅ Suggested Actions

### Priority 1: Issues Needing Response

#### Issue #{NUM}
**Why respond**: Reason
**Suggested comment**:
```
[Draft response in user's style]
```

### Priority 2: Issues to Monitor
- Issue #X - Reason
- Issue #Y - Reason

### Priority 3: No Action Needed
- Issue #X - Already handled
- Issue #Y - Assigned and in progress

## 🎯 Key Insights
- Pattern 1: Description
- Pattern 2: Description
- Recommendation: Suggestion

## 📝 Quick Stats
- Most active contributor: @username (X comments)
- Most discussed topic: Topic name
- Integration requests: X
- Bug reports: Y
- Feature requests: Z
```

## Error Handling

If GitHub integration fails:
- Notify user that integration is unavailable
- Suggest manual check at https://github.com/RedplanetHQ/core/issues

If no new activity:
- Report "No new issues or comments in the last 7 days"
- Suggest checking older issues or adjusting time range

If memory search fails:
- Use generic professional tone for response suggestions
- Note that personalization is limited

## Notes

- Always use ISO 8601 format for dates (YYYY-MM-DDTHH:MM:SSZ)
- Current date context is available in system prompt
- Search covers both issues AND pull requests (GitHub treats them similarly)
- Priority classification should be based on:
  - Labels (bug, enhancement, feature-request, etc.)
  - User sentiment in description
  - Impact on users (breaking changes, blockers)
  - Community interest (reactions, comments)

## Customization

User can modify:
- Time range (default: 7 days)
- Repository (default: RedplanetHQ/core)
- Priority thresholds
- Response template style
- Filtering criteria (labels, assignees, etc.)

## Success Criteria

Skill is successful if:
1. All recent issues are identified and categorized
2. Action items are clearly prioritized
3. Suggested responses match user's writing style
4. Summary is concise yet comprehensive
5. User can act immediately on recommendations

import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

function createAsanaClient(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: 'https://app.asana.com/api/1.0',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
}

// ============================================================================
// SCHEMAS
// ============================================================================

const ListWorkspacesSchema = z.object({
  limit: z.number().optional().default(50).describe('Number of results per page (max 100)'),
  offset: z.string().optional().describe('Pagination offset token from a previous response'),
});

const ListProjectsSchema = z.object({
  workspace: z.string().describe('Workspace GID to list projects from'),
  limit: z.number().optional().default(50).describe('Number of results per page (max 100)'),
  offset: z.string().optional().describe('Pagination offset token from a previous response'),
  archived: z.boolean().optional().describe('Filter by archived status'),
});

const ListTasksSchema = z.object({
  project: z.string().describe('Project GID to list tasks from'),
  limit: z.number().optional().default(50).describe('Number of results per page (max 100)'),
  offset: z.string().optional().describe('Pagination offset token from a previous response'),
  completed_since: z
    .string()
    .optional()
    .describe('ISO 8601 date-time; only return tasks completed after this time'),
});

const GetTaskSchema = z.object({
  task_gid: z.string().describe('Task GID'),
});

const CreateTaskSchema = z.object({
  name: z.string().describe('Task name'),
  workspace: z.string().describe('Workspace GID (required if no projects specified)'),
  projects: z.array(z.string()).optional().describe('Array of project GIDs to add the task to'),
  notes: z.string().optional().describe('Task description / notes (plain text)'),
  assignee: z.string().optional().describe('User GID or "me" to assign the task'),
  due_on: z.string().optional().describe('Due date in YYYY-MM-DD format'),
  due_at: z.string().optional().describe('Due date-time in ISO 8601 format'),
  parent: z.string().optional().describe('Parent task GID (for subtasks)'),
});

const AddCommentSchema = z.object({
  task_gid: z.string().describe('Task GID to comment on'),
  text: z.string().describe('Comment text (plain text)'),
  is_pinned: z.boolean().optional().describe('Pin this comment to the task'),
});

const AddFollowersToProjectSchema = z.object({
  project_gid: z.string().describe('Project GID'),
  followers: z.array(z.string()).describe('Array of user GIDs, emails, or "me"'),
});
const AddFollowersToTaskSchema = z.object({
  task_gid: z.string().describe('Task GID'),
  followers: z.array(z.string()).describe('Array of user GIDs, emails, or "me"'),
});
const AddItemToPortfolioSchema = z.object({
  portfolio_gid: z.string().describe('Portfolio GID'),
  item: z.string().describe('Project GID to add to the portfolio'),
});
const AddMembersToProjectSchema = z.object({
  project_gid: z.string().describe('Project GID'),
  members: z.array(z.string()).describe('Array of user GIDs or emails'),
});
const AddProjectToTaskSchema = z.object({
  task_gid: z.string().describe('Task GID'),
  project: z.string().describe('Project GID'),
  insert_before: z.string().optional().describe('Insert task before this task GID'),
  insert_after: z.string().optional().describe('Insert task after this task GID'),
  section: z.string().optional().describe('Section GID to place the task in'),
});
const AddSupportingRelationshipToGoalSchema = z.object({
  goal_gid: z.string().describe('Goal GID'),
  supporting_resource: z.string().describe('GID of supporting goal/project/task/portfolio'),
  contribution_weight: z.number().optional().describe('Weight of the contribution (0-100)'),
});
const AddTagToTaskSchema = z.object({
  task_gid: z.string().describe('Task GID'),
  tag: z.string().describe('Tag GID to add'),
});
const AddTaskDependenciesSchema = z.object({
  task_gid: z.string().describe('Task GID'),
  dependencies: z.array(z.string()).describe('Array of task GIDs that are prerequisites'),
});
const AddTaskToSectionSchema = z.object({
  section_gid: z.string().describe('Section GID'),
  task: z.string().describe('Task GID'),
  insert_before: z.string().optional().describe('Insert before this task GID'),
  insert_after: z.string().optional().describe('Insert after this task GID'),
});
const AddUserForTeamSchema = z.object({
  team_gid: z.string().describe('Team GID'),
  user: z.string().describe('User GID, email, or "me"'),
});
const AddUserForWorkspaceSchema = z.object({
  workspace_gid: z.string().describe('Workspace GID'),
  user: z.string().describe('User GID, email, or "me"'),
});
const ApproveAccessRequestSchema = z.object({
  access_request_gid: z.string().describe('Access request GID'),
});
const CreateAccessRequestSchema = z.object({
  resource_gid: z.string().describe('GID of the resource to request access to'),
  message: z.string().optional().describe('Optional message to include with the request'),
});
const CreateAllocationSchema = z.object({
  assignee: z.string().describe('User GID to allocate'),
  parent: z.string().describe('Project or task GID'),
  start_date: z.string().describe('Start date (YYYY-MM-DD)'),
  end_date: z.string().describe('End date (YYYY-MM-DD)'),
  effort_per_week_minutes: z.number().optional().describe('Minutes per week allocated'),
  workspace: z.string().optional().describe('Workspace GID'),
});
const CreateProjectSchema = z.object({
  name: z.string().describe('Project name'),
  workspace: z.string().describe('Workspace GID'),
  team: z.string().optional().describe('Team GID (required for organization workspaces)'),
  notes: z.string().optional().describe('Project description'),
  color: z.string().optional().describe('Project color (e.g. light-green, light-red)'),
  layout: z.string().optional().describe('Layout: board, list, timeline, or calendar'),
  public: z.boolean().optional().describe('Whether the project is public to the workspace'),
});
const CreateTagInWorkspaceSchema = z.object({
  workspace_gid: z.string().describe('Workspace GID'),
  name: z.string().describe('Tag name'),
  color: z.string().optional().describe('Tag color'),
  notes: z.string().optional().describe('Tag description'),
});
const CreateTaskDetailedSchema = z.object({
  name: z.string().describe('Task name'),
  workspace: z.string().optional().describe('Workspace GID'),
  parent: z.string().optional().describe('Parent task GID (for subtasks)'),
  projects: z.array(z.string()).optional().describe('Project GIDs to associate'),
  followers: z.array(z.string()).optional().describe('User GIDs to add as followers'),
  tags: z.array(z.string()).optional().describe('Tag GIDs to apply'),
  assignee: z.string().optional().describe('User GID or "me"'),
  notes: z.string().optional().describe('Plain text notes'),
  html_notes: z.string().optional().describe('HTML notes'),
  due_on: z.string().optional().describe('Due date (YYYY-MM-DD)'),
  due_at: z.string().optional().describe('Due datetime (ISO 8601)'),
  start_on: z.string().optional().describe('Start date (YYYY-MM-DD)'),
  resource_subtype: z.string().optional().describe('default_task, milestone, or approval'),
  assignee_section: z.string().optional().describe('Section GID in the assignee\'s My Tasks'),
});
const CreateAttachmentForObjectSchema = z.object({
  parent_gid: z.string().describe('GID of the parent object (task, project, project_brief)'),
  resource_subtype: z.string().describe('Attachment type: external, gdrive, onedrive, dropbox, box'),
  url: z.string().describe('URL of the external resource to link'),
  name: z.string().optional().describe('Display name for the attachment'),
});
const CreateCustomFieldSchema = z.object({
  workspace_gid: z.string().describe('Workspace GID'),
  name: z.string().describe('Custom field name'),
  resource_subtype: z.string().describe('Type: text, number, enum, multi_enum, date, or people'),
  description: z.string().optional().describe('Field description'),
  precision: z.number().optional().describe('Decimal precision (for number type)'),
  is_global_to_workspace: z.boolean().optional().describe('Whether visible across the workspace'),
});
const CreateEnumOptionSchema = z.object({
  custom_field_gid: z.string().describe('Custom field GID'),
  name: z.string().describe('Option name'),
  color: z.string().optional().describe('Option color'),
  enabled: z.boolean().optional().describe('Whether the option is enabled'),
  insert_before: z.string().optional().describe('Insert before this enum option GID'),
  insert_after: z.string().optional().describe('Insert after this enum option GID'),
});
const CreateMembershipSchema = z.object({
  parent_gid: z.string().describe('GID of the project, goal, or portfolio'),
  member_gid: z.string().describe('GID of the user or team'),
  access_level: z.string().optional().describe('Access level: editor, viewer, or commenter'),
});
const CreateProjectBriefSchema = z.object({
  project_gid: z.string().describe('Project GID'),
  title: z.string().optional().describe('Brief title'),
  text: z.string().optional().describe('Plain text content'),
  html_text: z.string().optional().describe('HTML content'),
});
const CreateProjectForTeamSchema = z.object({
  team_gid: z.string().describe('Team GID'),
  name: z.string().describe('Project name'),
  notes: z.string().optional().describe('Project description'),
  color: z.string().optional().describe('Project color'),
  layout: z.string().optional().describe('Layout: board, list, timeline, or calendar'),
});
const CreateProjectForWorkspaceSchema = z.object({
  workspace_gid: z.string().describe('Workspace GID'),
  name: z.string().describe('Project name'),
  team: z.string().describe('Team GID (required for organization workspaces)'),
  notes: z.string().optional().describe('Project description'),
  color: z.string().optional().describe('Project color'),
  layout: z.string().optional().describe('Layout: board, list, timeline, or calendar'),
});
const CreateProjectStatusUpdateSchema = z.object({
  project_gid: z.string().describe('Project GID'),
  title: z.string().describe('Status update title'),
  text: z.string().describe('Status update text'),
  color: z.string().optional().describe('Color: green, yellow, red, or blue'),
  html_text: z.string().optional().describe('HTML text'),
});
const CreateSectionInProjectSchema = z.object({
  project_gid: z.string().describe('Project GID'),
  name: z.string().describe('Section name'),
  insert_before: z.string().optional().describe('Insert before this section GID'),
  insert_after: z.string().optional().describe('Insert after this section GID'),
});
const CreateStatusUpdateForObjectSchema = z.object({
  parent_gid: z.string().describe('GID of the project, portfolio, or goal'),
  title: z.string().describe('Status update title'),
  text: z.string().describe('Status update text'),
  status_type: z.string().describe('Status: on_track, at_risk, off_track, on_hold, or paused'),
  html_text: z.string().optional().describe('HTML text'),
});
const CreateSubtaskSchema = z.object({
  task_gid: z.string().describe('Parent task GID'),
  name: z.string().describe('Subtask name'),
  assignee: z.string().optional().describe('User GID or "me"'),
  notes: z.string().optional().describe('Plain text notes'),
  due_on: z.string().optional().describe('Due date (YYYY-MM-DD)'),
  due_at: z.string().optional().describe('Due datetime (ISO 8601)'),
});
const CreateTagSchema = z.object({
  workspace_gid: z.string().describe('Workspace GID'),
  name: z.string().describe('Tag name'),
  color: z.string().optional().describe('Tag color'),
  notes: z.string().optional().describe('Tag description'),
});
const CreateTaskCommentSchema = z.object({
  task_gid: z.string().describe('Task GID'),
  text: z.string().describe('Comment text'),
  html_text: z.string().optional().describe('HTML comment text'),
  is_pinned: z.boolean().optional().describe('Pin this comment'),
});
const CreateTeamSchema = z.object({
  workspace_gid: z.string().describe('Workspace/organization GID'),
  name: z.string().describe('Team name'),
  description: z.string().optional().describe('Team description'),
  html_description: z.string().optional().describe('HTML team description'),
  visibility: z.string().optional().describe('Visibility: secret, request_to_join, or public'),
});
const DeleteAllocationSchema = z.object({ allocation_gid: z.string().describe('Allocation GID') });
const DeleteAttachmentSchema = z.object({ attachment_gid: z.string().describe('Attachment GID') });
const DeleteCustomFieldSchema = z.object({ custom_field_gid: z.string().describe('Custom field GID') });
const DeleteMembershipSchema = z.object({ membership_gid: z.string().describe('Membership GID') });
const DeleteProjectSchema = z.object({ project_gid: z.string().describe('Project GID') });
const DeleteProjectBriefSchema = z.object({ project_brief_gid: z.string().describe('Project brief GID') });
const DeleteProjectStatusSchema = z.object({ project_status_gid: z.string().describe('Project status GID') });
const DeleteSectionSchema = z.object({ section_gid: z.string().describe('Section GID') });
const DeleteStatusUpdateSchema = z.object({ status_update_gid: z.string().describe('Status update GID') });
const DeleteStorySchema = z.object({ story_gid: z.string().describe('Story GID') });
const DeleteTagSchema = z.object({ tag_gid: z.string().describe('Tag GID') });
const DeleteTaskSchema = z.object({ task_gid: z.string().describe('Task GID') });
const DuplicateProjectSchema = z.object({
  project_gid: z.string().describe('Project GID'),
  name: z.string().describe('Name for the duplicated project'),
  team: z.string().optional().describe('Team GID for the duplicate'),
  include: z.array(z.string()).optional().describe('Fields to include: members, task_notes, task_assignee, task_subtasks, task_dependencies, task_tags, settings, task_dates'),
});
const DuplicateTaskSchema = z.object({
  task_gid: z.string().describe('Task GID'),
  name: z.string().describe('Name for the duplicated task'),
  include: z.array(z.string()).optional().describe('Fields to include: assignee, attachments, dates, dependencies, followers, notes, parent, projects, subtasks, tags'),
});
const GetAccessRequestsSchema = z.object({
  target_gid: z.string().describe('GID of the resource to get access requests for'),
});
const GetAllocationSchema = z.object({
  allocation_gid: z.string().describe('Allocation GID'),
  opt_fields: z.string().optional().describe('Comma-separated list of optional fields'),
});
const GetAllocationsSchema = z.object({
  parent: z.string().optional().describe('Project GID filter'),
  assignee: z.string().optional().describe('User GID filter'),
  workspace: z.string().optional().describe('Workspace GID (required with assignee)'),
  limit: z.number().optional().default(50).describe('Results per page (max 100)'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetProjectSchema = z.object({
  project_gid: z.string().describe('Project GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetAttachmentSchema = z.object({
  attachment_gid: z.string().describe('Attachment GID'),
});
const GetAuditLogEventsSchema = z.object({
  workspace_gid: z.string().describe('Workspace GID'),
  start_at: z.string().optional().describe('Start time (ISO 8601)'),
  end_at: z.string().optional().describe('End time (ISO 8601)'),
  event_type: z.string().optional().describe('Event type filter'),
  actor_gid: z.string().optional().describe('Actor GID filter'),
  resource_gid: z.string().optional().describe('Resource GID filter'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetUserTaskListByGidSchema = z.object({
  user_task_list_gid: z.string().describe('User task list GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetCurrentUserSchema = z.object({
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetCustomFieldSchema = z.object({
  custom_field_gid: z.string().describe('Custom field GID'),
});
const GetCustomFieldsForWorkspaceSchema = z.object({
  workspace_gid: z.string().describe('Workspace GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetCustomTypesSchema = z.object({
  project_gid: z.string().describe('Project GID'),
});
const GetEventsSchema = z.object({
  resource: z.string().describe('Resource GID to get events for'),
  sync: z.string().optional().describe('Sync token from a previous response'),
});
const GetFavoritesForUserSchema = z.object({
  user_gid: z.string().describe('User GID or "me"'),
  workspace: z.string().describe('Workspace GID'),
  resource_type: z.string().describe('Type: portfolio, project, tag, task, or user'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetGoalSchema = z.object({
  goal_gid: z.string().describe('Goal GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetGoalRelationshipsSchema = z.object({
  goal_gid: z.string().describe('Goal GID'),
  resource_subtype: z.string().optional().describe('Filter by subtype'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetGoalsSchema = z.object({
  workspace: z.string().optional().describe('Workspace GID'),
  team: z.string().optional().describe('Team GID'),
  portfolio: z.string().optional().describe('Portfolio GID'),
  project: z.string().optional().describe('Project GID'),
  is_workspace_level: z.boolean().optional().describe('Filter to workspace-level goals'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetJobSchema = z.object({
  job_gid: z.string().describe('Job GID'),
});
const GetMembershipSchema = z.object({
  membership_gid: z.string().describe('Membership GID'),
});
const GetMembershipsSchema = z.object({
  parent: z.string().optional().describe('Resource GID filter'),
  member: z.string().optional().describe('User or team GID filter'),
  workspace: z.string().optional().describe('Workspace GID filter'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetPortfolioSchema = z.object({
  portfolio_gid: z.string().describe('Portfolio GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetPortfolioItemsSchema = z.object({
  portfolio_gid: z.string().describe('Portfolio GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetPortfolioMembershipsSchema = z.object({
  portfolio: z.string().optional().describe('Portfolio GID filter'),
  workspace: z.string().optional().describe('Workspace GID filter'),
  user: z.string().optional().describe('User GID filter'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetPortfoliosSchema = z.object({
  workspace: z.string().describe('Workspace GID'),
  owner: z.string().optional().describe('Filter by owner GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetProjectBriefSchema = z.object({
  project_brief_gid: z.string().describe('Project brief GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetProjectMembershipSchema = z.object({
  project_membership_gid: z.string().describe('Project membership GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetProjectMembershipsForProjectSchema = z.object({
  project_gid: z.string().describe('Project GID'),
  user: z.string().optional().describe('Filter by user GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetProjectsForTaskSchema = z.object({
  task_gid: z.string().describe('Task GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetProjectsForTeamSchema = z.object({
  team_gid: z.string().describe('Team GID'),
  archived: z.boolean().optional().describe('Filter by archived status'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetProjectStatusSchema = z.object({
  project_status_gid: z.string().describe('Project status GID'),
});
const GetProjectStatusUpdatesSchema = z.object({
  project_gid: z.string().describe('Project GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetProjectTemplatesSchema = z.object({
  workspace: z.string().optional().describe('Workspace GID'),
  team: z.string().optional().describe('Team GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetProjectTemplatesForTeamSchema = z.object({
  team_gid: z.string().describe('Team GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetReactionsOnObjectSchema = z.object({
  object_gid: z.string().describe('GID of the story or status update'),
  emoji_base: z.string().describe('Emoji base character to filter by'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetSectionSchema = z.object({
  section_gid: z.string().describe('Section GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetSectionsInProjectSchema = z.object({
  project_gid: z.string().describe('Project GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetStatusUpdateSchema = z.object({
  status_update_gid: z.string().describe('Status update GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetStatusUpdatesSchema = z.object({
  parent_gid: z.string().describe('GID of the parent resource'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetStoriesForTaskSchema = z.object({
  task_gid: z.string().describe('Task GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetStorySchema = z.object({
  story_gid: z.string().describe('Story GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetTagSchema = z.object({
  tag_gid: z.string().describe('Tag GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetTagsSchema = z.object({
  workspace: z.string().describe('Workspace GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetTagsForTaskSchema = z.object({
  task_gid: z.string().describe('Task GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetTagsForWorkspaceSchema = z.object({
  workspace_gid: z.string().describe('Workspace GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetTaskAttachmentsSchema = z.object({
  parent_gid: z.string().describe('GID of the parent object'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetTaskCountsForProjectSchema = z.object({
  project_gid: z.string().describe('Project GID'),
  opt_fields: z.string().describe('Required: comma-separated fields (num_tasks, num_completed_tasks, num_incomplete_tasks, num_milestones)'),
});
const GetTasksForTagSchema = z.object({
  tag_gid: z.string().describe('Tag GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetTasksForUserTaskListSchema = z.object({
  user_task_list_gid: z.string().describe('User task list GID'),
  completed_since: z.string().optional().describe('ISO 8601 datetime; return tasks completed after'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const RetrieveTasksForProjectSchema = z.object({
  project_gid: z.string().describe('Project GID'),
  completed_since: z.string().optional().describe('ISO 8601 datetime filter'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetTasksFromSectionSchema = z.object({
  section_gid: z.string().describe('Section GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetTaskSubtasksSchema = z.object({
  task_gid: z.string().describe('Task GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetTaskTemplatesSchema = z.object({
  workspace: z.string().optional().describe('Workspace GID'),
  team: z.string().optional().describe('Team GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetTeamSchema = z.object({
  team_gid: z.string().describe('Team GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetTeamMembershipSchema = z.object({
  team_membership_gid: z.string().describe('Team membership GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetTeamMembershipsSchema = z.object({
  team: z.string().optional().describe('Team GID filter'),
  user: z.string().optional().describe('User GID filter'),
  workspace: z.string().optional().describe('Workspace GID filter'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetTeamMembershipsForTeamSchema = z.object({
  team_gid: z.string().describe('Team GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetTeamMembershipsForUserSchema = z.object({
  user_gid: z.string().describe('User GID'),
  workspace: z.string().describe('Workspace GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetTeamsForUserSchema = z.object({
  user_gid: z.string().describe('User GID'),
  organization: z.string().describe('Organization/workspace GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetTeamsInWorkspaceSchema = z.object({
  workspace_gid: z.string().describe('Workspace GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetTimePeriodSchema = z.object({
  time_period_gid: z.string().describe('Time period GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetTimePeriodsSchema = z.object({
  workspace: z.string().describe('Workspace GID'),
  start_on: z.string().optional().describe('Filter periods starting on or after (YYYY-MM-DD)'),
  end_on: z.string().optional().describe('Filter periods ending on or before (YYYY-MM-DD)'),
  parent: z.string().optional().describe('Parent time period GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetTimeTrackingEntriesSchema = z.object({
  workspace: z.string().optional().describe('Workspace GID'),
  task: z.string().optional().describe('Task GID filter'),
  user: z.string().optional().describe('User GID filter'),
  created_by: z.string().optional().describe('Creator GID filter'),
  started_after: z.string().optional().describe('ISO 8601 start filter'),
  started_before: z.string().optional().describe('ISO 8601 end filter'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetTimeTrackingEntriesForTaskSchema = z.object({
  task_gid: z.string().describe('Task GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetObjectsViaTypeaheadSchema = z.object({
  workspace_gid: z.string().describe('Workspace GID'),
  type: z.string().describe('Object type: custom_field, portfolio, project, tag, task, or user'),
  query: z.string().optional().describe('Search query string'),
  count: z.number().optional().describe('Number of results (max 100)'),
});
const GetUserSchema = z.object({
  user_gid: z.string().describe('User GID or "me"'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetUserInWorkspaceSchema = z.object({
  user_gid: z.string().describe('User GID'),
  workspace_gid: z.string().describe('Workspace GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetUsersForTeamSchema = z.object({
  team_gid: z.string().describe('Team GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetUsersInWorkspaceSchema = z.object({
  workspace_gid: z.string().describe('Workspace GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetUserTaskListForUserSchema = z.object({
  user_gid: z.string().describe('User GID or "me"'),
  workspace: z.string().describe('Workspace GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetWebhooksSchema = z.object({
  workspace: z.string().describe('Workspace GID'),
  resource: z.string().optional().describe('Resource GID filter'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetWorkspaceSchema = z.object({
  workspace_gid: z.string().describe('Workspace GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetWorkspaceMembershipSchema = z.object({
  workspace_membership_gid: z.string().describe('Workspace membership GID'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const GetWorkspaceMembershipsSchema = z.object({
  workspace_gid: z.string().describe('Workspace GID'),
  user: z.string().optional().describe('User GID filter'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetWorkspaceMembershipsForUserSchema = z.object({
  user_gid: z.string().describe('User GID'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const GetWorkspaceProjectsSchema = z.object({
  workspace_gid: z.string().describe('Workspace GID'),
  archived: z.boolean().optional().describe('Filter by archived status'),
  limit: z.number().optional().default(50).describe('Results per page'),
  offset: z.string().optional().describe('Pagination offset token'),
});
const ReorderEnumOptionSchema = z.object({
  custom_field_gid: z.string().describe('Custom field GID'),
  enum_option_gid: z.string().describe('Enum option GID to reorder'),
  insert_before: z.string().optional().describe('Insert before this enum option GID'),
  insert_after: z.string().optional().describe('Insert after this enum option GID'),
});
const MoveSectionInProjectSchema = z.object({
  project_gid: z.string().describe('Project GID'),
  section_gid: z.string().describe('Section GID to move'),
  insert_before: z.string().optional().describe('Insert before this section GID'),
  insert_after: z.string().optional().describe('Insert after this section GID'),
});
const InstantiateProjectTemplateSchema = z.object({
  project_template_gid: z.string().describe('Project template GID'),
  name: z.string().describe('Name for the new project'),
  team: z.string().describe('Team GID for the new project'),
  public: z.boolean().optional().describe('Whether the project is public'),
  start_on: z.string().optional().describe('Start date for the project (YYYY-MM-DD)'),
  workspace: z.string().optional().describe('Workspace GID'),
});
const RejectAccessRequestSchema = z.object({
  access_request_gid: z.string().describe('Access request GID'),
});
const RemoveFollowerFromTaskSchema = z.object({
  task_gid: z.string().describe('Task GID'),
  followers: z.array(z.string()).describe('Array of user GIDs to remove'),
});
const RemoveFollowersForProjectSchema = z.object({
  project_gid: z.string().describe('Project GID'),
  followers: z.array(z.string()).describe('Array of user GIDs to remove'),
});
const RemoveItemFromPortfolioSchema = z.object({
  portfolio_gid: z.string().describe('Portfolio GID'),
  item: z.string().describe('Item GID to remove'),
});
const RemoveMembersFromProjectSchema = z.object({
  project_gid: z.string().describe('Project GID'),
  members: z.array(z.string()).describe('Array of user GIDs to remove'),
});
const RemoveProjectFromTaskSchema = z.object({
  task_gid: z.string().describe('Task GID'),
  project: z.string().describe('Project GID to remove from the task'),
});
const RemoveTagFromTaskSchema = z.object({
  task_gid: z.string().describe('Task GID'),
  tag: z.string().describe('Tag GID to remove'),
});
const RemoveUserForTeamSchema = z.object({
  team_gid: z.string().describe('Team GID'),
  user: z.string().describe('User GID, email, or "me"'),
});
const RemoveUserFromWorkspaceSchema = z.object({
  workspace_gid: z.string().describe('Workspace GID'),
  user: z.string().describe('User GID, email, or "me"'),
});
const SearchTasksInWorkspaceSchema = z.object({
  workspace_gid: z.string().describe('Workspace GID'),
  text: z.string().optional().describe('Full-text search string'),
  resource_subtype: z.string().optional().describe('Filter by subtype: default_task, milestone, approval'),
  assignee_any: z.array(z.string()).optional().describe('Filter by assignee GIDs'),
  completed: z.boolean().optional().describe('Filter by completion status'),
  is_subtask: z.boolean().optional().describe('Filter subtasks'),
  due_on_before: z.string().optional().describe('Due date before (YYYY-MM-DD)'),
  due_on_after: z.string().optional().describe('Due date after (YYYY-MM-DD)'),
  projects_any: z.array(z.string()).optional().describe('Filter by project GIDs'),
  sort_by: z.string().optional().describe('Sort by: due_date, created_at, completed_at, likes, modified_at'),
  sort_ascending: z.boolean().optional().describe('Sort ascending (default false)'),
  limit: z.number().optional().default(20).describe('Results per page (max 100)'),
  offset: z.string().optional().describe('Pagination offset token'),
  opt_fields: z.string().optional().describe('Comma-separated optional fields'),
});
const SetParentForTaskSchema = z.object({
  task_gid: z.string().describe('Task GID'),
  parent: z.string().nullable().describe('Parent task GID, or null to remove parent'),
  insert_before: z.string().optional().describe('Insert before this sibling task GID'),
  insert_after: z.string().optional().describe('Insert after this sibling task GID'),
});
const SubmitParallelRequestsSchema = z.object({
  actions: z.array(z.object({
    relative_path: z.string().describe('API path relative to /api/1.0 (e.g. /tasks/123)'),
    method: z.string().describe('HTTP method: GET, POST, PUT, or DELETE'),
    data: z.record(z.any()).optional().describe('Request body data'),
    params: z.record(z.any()).optional().describe('Query parameters'),
  })).describe('Array of API actions to execute in parallel'),
});
const UpdateAllocationSchema = z.object({
  allocation_gid: z.string().describe('Allocation GID'),
  start_date: z.string().optional().describe('New start date (YYYY-MM-DD)'),
  end_date: z.string().optional().describe('New end date (YYYY-MM-DD)'),
  effort_per_week_minutes: z.number().optional().describe('Minutes per week'),
  assignee: z.string().optional().describe('User GID'),
});
const UpdateTaskSchema = z.object({
  task_gid: z.string().describe('Task GID'),
  name: z.string().optional().describe('New task name'),
  notes: z.string().optional().describe('Plain text notes'),
  html_notes: z.string().optional().describe('HTML notes'),
  assignee: z.string().optional().describe('User GID or "me" (null to unassign)'),
  due_on: z.string().optional().describe('Due date (YYYY-MM-DD)'),
  due_at: z.string().optional().describe('Due datetime (ISO 8601)'),
  completed: z.boolean().optional().describe('Mark task as completed'),
  start_on: z.string().optional().describe('Start date (YYYY-MM-DD)'),
  resource_subtype: z.string().optional().describe('default_task, milestone, or approval'),
  liked: z.boolean().optional().describe('Like/unlike the task'),
  approval_status: z.string().optional().describe('Approval status: pending, approved, rejected, changes_requested'),
});
const UpdateCustomFieldSchema = z.object({
  custom_field_gid: z.string().describe('Custom field GID'),
  name: z.string().optional().describe('New name'),
  description: z.string().optional().describe('New description'),
  precision: z.number().optional().describe('Decimal precision'),
  enabled: z.boolean().optional().describe('Whether the field is enabled'),
});
const UpdateEnumOptionSchema = z.object({
  custom_field_gid: z.string().describe('Custom field GID'),
  enum_option_gid: z.string().describe('Enum option GID'),
  name: z.string().optional().describe('New option name'),
  color: z.string().optional().describe('New color'),
  enabled: z.boolean().optional().describe('Whether the option is enabled'),
});
const UpdateProjectSchema = z.object({
  project_gid: z.string().describe('Project GID'),
  name: z.string().optional().describe('New project name'),
  notes: z.string().optional().describe('Project description'),
  color: z.string().optional().describe('Project color'),
  archived: z.boolean().optional().describe('Archive/unarchive the project'),
  public: z.boolean().optional().describe('Public to workspace'),
  team: z.string().optional().describe('Team GID'),
  default_view: z.string().optional().describe('Default view: list, board, calendar, timeline'),
  due_on: z.string().optional().describe('Due date (YYYY-MM-DD)'),
  start_on: z.string().optional().describe('Start date (YYYY-MM-DD)'),
});
const UpdateProjectBriefSchema = z.object({
  project_brief_gid: z.string().describe('Project brief GID'),
  title: z.string().optional().describe('New title'),
  text: z.string().optional().describe('Plain text content'),
  html_text: z.string().optional().describe('HTML content'),
});
const UpdateSectionSchema = z.object({
  section_gid: z.string().describe('Section GID'),
  name: z.string().optional().describe('New section name'),
  insert_before: z.string().optional().describe('Reorder: insert before this section GID'),
  insert_after: z.string().optional().describe('Reorder: insert after this section GID'),
});
const UpdateStorySchema = z.object({
  story_gid: z.string().describe('Story GID'),
  text: z.string().optional().describe('New comment text'),
  html_text: z.string().optional().describe('New HTML comment text'),
  is_pinned: z.boolean().optional().describe('Pin or unpin the story'),
});
const UpdateTagSchema = z.object({
  tag_gid: z.string().describe('Tag GID'),
  name: z.string().optional().describe('New tag name'),
  color: z.string().optional().describe('New tag color'),
  notes: z.string().optional().describe('Tag description'),
});
const UpdateTeamSchema = z.object({
  team_gid: z.string().describe('Team GID'),
  name: z.string().optional().describe('New team name'),
  description: z.string().optional().describe('Team description'),
  html_description: z.string().optional().describe('HTML team description'),
  visibility: z.string().optional().describe('Visibility: secret, request_to_join, or public'),
});
const UpdateUserForWorkspaceSchema = z.object({
  user_gid: z.string().describe('User GID'),
  workspace_gid: z.string().describe('Workspace GID'),
  custom_fields: z.record(z.any()).optional().describe('Custom field GID to value map'),
});
const UpdateWebhookSchema = z.object({
  webhook_gid: z.string().describe('Webhook GID'),
  filters: z.array(z.object({
    resource_type: z.string().optional().describe('Resource type filter'),
    resource_subtype: z.string().optional().describe('Resource subtype filter'),
    action: z.string().optional().describe('Action filter (changed, added, removed, deleted)'),
    fields: z.array(z.string()).optional().describe('Fields to watch'),
  })).optional().describe('Array of event filters'),
});

// ============================================================================
// TOOL LIST
// ============================================================================

export async function getTools() {
  return [
    {
      name: 'asana_list_workspaces',
      description: 'List all Asana workspaces the authenticated user can access',
      inputSchema: zodToJsonSchema(ListWorkspacesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'asana_list_projects',
      description: 'List projects within a workspace, with pagination',
      inputSchema: zodToJsonSchema(ListProjectsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'asana_list_tasks',
      description: 'List tasks within a project, with pagination',
      inputSchema: zodToJsonSchema(ListTasksSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'asana_get_task',
      description: 'Get full details of a specific Asana task by GID',
      inputSchema: zodToJsonSchema(GetTaskSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'asana_create_task',
      description: 'Create a new task in Asana',
      inputSchema: zodToJsonSchema(CreateTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'asana_add_comment',
      description: 'Add a comment (story) to an Asana task',
      inputSchema: zodToJsonSchema(AddCommentSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    { name: 'asana_add_followers_to_project', description: 'Add followers to a project in Asana', inputSchema: zodToJsonSchema(AddFollowersToProjectSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_add_followers_to_task', description: 'Add followers to a task in Asana', inputSchema: zodToJsonSchema(AddFollowersToTaskSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_add_item_to_portfolio', description: 'Add a project to an Asana portfolio', inputSchema: zodToJsonSchema(AddItemToPortfolioSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_add_members_to_project', description: 'Add members to a project in Asana', inputSchema: zodToJsonSchema(AddMembersToProjectSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_add_project_to_task', description: 'Associate a task with a project in Asana', inputSchema: zodToJsonSchema(AddProjectToTaskSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_add_supporting_relationship_to_goal', description: 'Add a supporting relationship to a goal in Asana', inputSchema: zodToJsonSchema(AddSupportingRelationshipToGoalSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_add_tag_to_task', description: 'Add an existing tag to a task in Asana', inputSchema: zodToJsonSchema(AddTagToTaskSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_add_task_dependencies', description: 'Add dependency relationships to an Asana task', inputSchema: zodToJsonSchema(AddTaskDependenciesSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_add_task_to_section', description: 'Add a task to a section in Asana', inputSchema: zodToJsonSchema(AddTaskToSectionSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_add_user_for_team', description: 'Add a user to a team in Asana', inputSchema: zodToJsonSchema(AddUserForTeamSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_add_user_for_workspace', description: 'Add a user to a workspace in Asana', inputSchema: zodToJsonSchema(AddUserForWorkspaceSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_approve_access_request', description: 'Approve an access request in Asana', inputSchema: zodToJsonSchema(ApproveAccessRequestSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_access_request', description: 'Create an access request in Asana', inputSchema: zodToJsonSchema(CreateAccessRequestSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_allocation', description: 'Create a new allocation in Asana', inputSchema: zodToJsonSchema(CreateAllocationSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_project', description: 'Create a new project in Asana', inputSchema: zodToJsonSchema(CreateProjectSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_tag_in_workspace', description: 'Create a new tag in an Asana workspace', inputSchema: zodToJsonSchema(CreateTagInWorkspaceSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_task_detailed', description: 'Create a new Asana task with full detail options including followers, tags, and subtype', inputSchema: zodToJsonSchema(CreateTaskDetailedSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_attachment_for_object', description: 'Link an external attachment to a task, project, or project_brief in Asana', inputSchema: zodToJsonSchema(CreateAttachmentForObjectSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_custom_field', description: 'Create a new custom field in an Asana workspace', inputSchema: zodToJsonSchema(CreateCustomFieldSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_enum_option_for_custom_field', description: 'Create a new enum option for an Asana custom field', inputSchema: zodToJsonSchema(CreateEnumOptionSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_membership', description: 'Add a user or team to a project, goal, or portfolio in Asana', inputSchema: zodToJsonSchema(CreateMembershipSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_project_brief', description: 'Create a project brief for an Asana project', inputSchema: zodToJsonSchema(CreateProjectBriefSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_project_for_team', description: 'Create a project within a specific Asana team', inputSchema: zodToJsonSchema(CreateProjectForTeamSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_project_for_workspace', description: 'Create a project within a specific Asana workspace', inputSchema: zodToJsonSchema(CreateProjectForWorkspaceSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_project_status_update', description: 'Create a status update on an Asana project', inputSchema: zodToJsonSchema(CreateProjectStatusUpdateSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_section_in_project', description: 'Create a new section in an Asana project', inputSchema: zodToJsonSchema(CreateSectionInProjectSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_status_update_for_object', description: 'Create a status update on a project, portfolio, or goal', inputSchema: zodToJsonSchema(CreateStatusUpdateForObjectSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_subtask', description: 'Create a subtask under an existing Asana task', inputSchema: zodToJsonSchema(CreateSubtaskSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_tag', description: 'Create a new tag in an Asana workspace', inputSchema: zodToJsonSchema(CreateTagSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_task_comment', description: 'Add a text comment to an Asana task', inputSchema: zodToJsonSchema(CreateTaskCommentSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_create_team', description: 'Create a new team in an Asana workspace', inputSchema: zodToJsonSchema(CreateTeamSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_delete_allocation', description: 'Delete an allocation in Asana', inputSchema: zodToJsonSchema(DeleteAllocationSchema), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true } },
    { name: 'asana_delete_attachment', description: 'Delete an attachment in Asana', inputSchema: zodToJsonSchema(DeleteAttachmentSchema), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true } },
    { name: 'asana_delete_custom_field', description: 'Delete a custom field in Asana', inputSchema: zodToJsonSchema(DeleteCustomFieldSchema), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true } },
    { name: 'asana_delete_membership', description: 'Delete a membership in Asana', inputSchema: zodToJsonSchema(DeleteMembershipSchema), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true } },
    { name: 'asana_delete_project', description: 'Delete a project in Asana', inputSchema: zodToJsonSchema(DeleteProjectSchema), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true } },
    { name: 'asana_delete_project_brief', description: 'Delete a project brief in Asana', inputSchema: zodToJsonSchema(DeleteProjectBriefSchema), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true } },
    { name: 'asana_delete_project_status', description: 'Delete a project status update in Asana', inputSchema: zodToJsonSchema(DeleteProjectStatusSchema), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true } },
    { name: 'asana_delete_section', description: 'Delete a section in Asana', inputSchema: zodToJsonSchema(DeleteSectionSchema), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true } },
    { name: 'asana_delete_status_update', description: 'Delete a status update in Asana', inputSchema: zodToJsonSchema(DeleteStatusUpdateSchema), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true } },
    { name: 'asana_delete_story', description: 'Delete a story in Asana', inputSchema: zodToJsonSchema(DeleteStorySchema), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true } },
    { name: 'asana_delete_tag', description: 'Delete a tag in Asana', inputSchema: zodToJsonSchema(DeleteTagSchema), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true } },
    { name: 'asana_delete_task', description: 'Delete a task in Asana', inputSchema: zodToJsonSchema(DeleteTaskSchema), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true } },
    { name: 'asana_duplicate_project', description: 'Duplicate a project in Asana', inputSchema: zodToJsonSchema(DuplicateProjectSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_duplicate_task', description: 'Duplicate a task in Asana', inputSchema: zodToJsonSchema(DuplicateTaskSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_get_access_requests', description: 'Get access requests for a resource in Asana', inputSchema: zodToJsonSchema(GetAccessRequestsSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_allocation', description: 'Get a single allocation by GID', inputSchema: zodToJsonSchema(GetAllocationSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_allocations', description: 'Get multiple allocations in Asana', inputSchema: zodToJsonSchema(GetAllocationsSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_project', description: 'Get details of a specific Asana project', inputSchema: zodToJsonSchema(GetProjectSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_attachment', description: 'Get details of a specific attachment in Asana', inputSchema: zodToJsonSchema(GetAttachmentSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_audit_log_events', description: 'Get audit log events for an Asana workspace', inputSchema: zodToJsonSchema(GetAuditLogEventsSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_user_task_list', description: 'Get a user task list by GID', inputSchema: zodToJsonSchema(GetUserTaskListByGidSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_current_user', description: 'Get the currently authenticated Asana user', inputSchema: zodToJsonSchema(GetCurrentUserSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_custom_field', description: 'Get a custom field by GID in Asana', inputSchema: zodToJsonSchema(GetCustomFieldSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_custom_fields_for_workspace', description: 'Get all custom fields in an Asana workspace', inputSchema: zodToJsonSchema(GetCustomFieldsForWorkspaceSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_custom_types', description: 'Get custom types for an Asana project', inputSchema: zodToJsonSchema(GetCustomTypesSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_events_on_resource', description: 'Get events on a resource to monitor changes', inputSchema: zodToJsonSchema(GetEventsSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_favorites_for_user', description: 'Get a user\'s favorites in an Asana workspace', inputSchema: zodToJsonSchema(GetFavoritesForUserSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_goal', description: 'Get a goal by GID in Asana', inputSchema: zodToJsonSchema(GetGoalSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_goal_relationships', description: 'Get relationships for a goal in Asana', inputSchema: zodToJsonSchema(GetGoalRelationshipsSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_goals', description: 'Get multiple goals in Asana', inputSchema: zodToJsonSchema(GetGoalsSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_job', description: 'Get an asynchronous job by GID in Asana', inputSchema: zodToJsonSchema(GetJobSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_membership', description: 'Get a membership by GID in Asana', inputSchema: zodToJsonSchema(GetMembershipSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_memberships', description: 'Get memberships for a resource in Asana', inputSchema: zodToJsonSchema(GetMembershipsSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_portfolio', description: 'Get a portfolio by GID in Asana', inputSchema: zodToJsonSchema(GetPortfolioSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_portfolio_items', description: 'Get items in an Asana portfolio', inputSchema: zodToJsonSchema(GetPortfolioItemsSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_portfolio_memberships', description: 'Get portfolio memberships in Asana', inputSchema: zodToJsonSchema(GetPortfolioMembershipsSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_portfolios', description: 'Get portfolios in an Asana workspace', inputSchema: zodToJsonSchema(GetPortfoliosSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_project_brief', description: 'Get a project brief by GID in Asana', inputSchema: zodToJsonSchema(GetProjectBriefSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_project_membership', description: 'Get a project membership by GID in Asana', inputSchema: zodToJsonSchema(GetProjectMembershipSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_project_memberships_for_project', description: 'Get all memberships for an Asana project', inputSchema: zodToJsonSchema(GetProjectMembershipsForProjectSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_projects_for_task', description: 'Get all projects a task belongs to in Asana', inputSchema: zodToJsonSchema(GetProjectsForTaskSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_projects_for_team', description: 'Get projects for an Asana team', inputSchema: zodToJsonSchema(GetProjectsForTeamSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_project_status', description: 'Get a project status update by GID in Asana', inputSchema: zodToJsonSchema(GetProjectStatusSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_project_status_updates', description: 'Get status updates for an Asana project', inputSchema: zodToJsonSchema(GetProjectStatusUpdatesSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_project_templates', description: 'Get project templates in Asana', inputSchema: zodToJsonSchema(GetProjectTemplatesSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_project_templates_for_team', description: 'Get project templates for an Asana team', inputSchema: zodToJsonSchema(GetProjectTemplatesForTeamSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_reactions_on_object', description: 'Get reactions on a story or status update in Asana', inputSchema: zodToJsonSchema(GetReactionsOnObjectSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_section', description: 'Get a section by GID in Asana', inputSchema: zodToJsonSchema(GetSectionSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_sections_in_project', description: 'Get all sections in an Asana project', inputSchema: zodToJsonSchema(GetSectionsInProjectSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_status_update', description: 'Get a status update by GID in Asana', inputSchema: zodToJsonSchema(GetStatusUpdateSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_status_updates', description: 'Get status updates for a resource in Asana', inputSchema: zodToJsonSchema(GetStatusUpdatesSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_stories_for_task', description: 'Get stories (comments/history) for an Asana task', inputSchema: zodToJsonSchema(GetStoriesForTaskSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_story', description: 'Get a story by GID in Asana', inputSchema: zodToJsonSchema(GetStorySchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_tag', description: 'Get a tag by GID in Asana', inputSchema: zodToJsonSchema(GetTagSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_tags', description: 'Get tags in an Asana workspace', inputSchema: zodToJsonSchema(GetTagsSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_tags_for_task', description: 'Get all tags on an Asana task', inputSchema: zodToJsonSchema(GetTagsForTaskSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_tags_for_workspace', description: 'Get all tags in an Asana workspace', inputSchema: zodToJsonSchema(GetTagsForWorkspaceSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_task_attachments', description: 'Get attachments for a task or other object in Asana', inputSchema: zodToJsonSchema(GetTaskAttachmentsSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_task_counts_for_project', description: 'Get task count statistics for an Asana project', inputSchema: zodToJsonSchema(GetTaskCountsForProjectSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_tasks_for_tag', description: 'Get tasks associated with a tag in Asana', inputSchema: zodToJsonSchema(GetTasksForTagSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_tasks_for_user_task_list', description: 'Get tasks from a user task list in Asana', inputSchema: zodToJsonSchema(GetTasksForUserTaskListSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_retrieve_tasks_for_project', description: 'Retrieve tasks from an Asana project with filters', inputSchema: zodToJsonSchema(RetrieveTasksForProjectSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_tasks_from_section', description: 'Get tasks in a specific Asana section', inputSchema: zodToJsonSchema(GetTasksFromSectionSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_task_subtasks', description: 'Get subtasks of a task in Asana', inputSchema: zodToJsonSchema(GetTaskSubtasksSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_task_templates', description: 'Get task templates in Asana', inputSchema: zodToJsonSchema(GetTaskTemplatesSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_team', description: 'Get a team by GID in Asana', inputSchema: zodToJsonSchema(GetTeamSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_team_membership', description: 'Get a team membership by GID in Asana', inputSchema: zodToJsonSchema(GetTeamMembershipSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_team_memberships', description: 'Get team memberships in Asana', inputSchema: zodToJsonSchema(GetTeamMembershipsSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_team_memberships_for_team', description: 'Get memberships for an Asana team', inputSchema: zodToJsonSchema(GetTeamMembershipsForTeamSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_team_memberships_for_user', description: 'Get team memberships for a user in Asana', inputSchema: zodToJsonSchema(GetTeamMembershipsForUserSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_teams_for_user', description: 'Get teams for a user in an Asana organization', inputSchema: zodToJsonSchema(GetTeamsForUserSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_teams_in_workspace', description: 'Get all teams in an Asana workspace', inputSchema: zodToJsonSchema(GetTeamsInWorkspaceSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_time_period', description: 'Get a time period by GID in Asana', inputSchema: zodToJsonSchema(GetTimePeriodSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_time_periods', description: 'Get time periods in an Asana workspace', inputSchema: zodToJsonSchema(GetTimePeriodsSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_time_tracking_entries', description: 'Get time tracking entries in Asana', inputSchema: zodToJsonSchema(GetTimeTrackingEntriesSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_time_tracking_entries_for_task', description: 'Get time tracking entries for an Asana task', inputSchema: zodToJsonSchema(GetTimeTrackingEntriesForTaskSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_objects_via_typeahead', description: 'Search for Asana objects via typeahead', inputSchema: zodToJsonSchema(GetObjectsViaTypeaheadSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_user', description: 'Get a user by GID in Asana', inputSchema: zodToJsonSchema(GetUserSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_user_in_workspace', description: 'Get a user in a specific Asana workspace', inputSchema: zodToJsonSchema(GetUserInWorkspaceSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_users_for_team', description: 'Get users in an Asana team', inputSchema: zodToJsonSchema(GetUsersForTeamSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_users_in_workspace', description: 'Get users in an Asana workspace', inputSchema: zodToJsonSchema(GetUsersInWorkspaceSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_user_task_list_for_user', description: 'Get a user\'s My Tasks list in Asana', inputSchema: zodToJsonSchema(GetUserTaskListForUserSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_webhooks', description: 'Get webhooks in an Asana workspace', inputSchema: zodToJsonSchema(GetWebhooksSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_workspace', description: 'Get a workspace by GID in Asana', inputSchema: zodToJsonSchema(GetWorkspaceSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_workspace_membership', description: 'Get a workspace membership by GID in Asana', inputSchema: zodToJsonSchema(GetWorkspaceMembershipSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_workspace_memberships', description: 'Get memberships for an Asana workspace', inputSchema: zodToJsonSchema(GetWorkspaceMembershipsSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_workspace_memberships_for_user', description: 'Get workspace memberships for a user in Asana', inputSchema: zodToJsonSchema(GetWorkspaceMembershipsForUserSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_get_workspace_projects', description: 'Get projects in an Asana workspace', inputSchema: zodToJsonSchema(GetWorkspaceProjectsSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_reorder_enum_option_for_custom_field', description: 'Reorder an enum option within an Asana custom field', inputSchema: zodToJsonSchema(ReorderEnumOptionSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_move_section_in_project', description: 'Move or reorder a section within an Asana project', inputSchema: zodToJsonSchema(MoveSectionInProjectSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_instantiate_project_template', description: 'Create a new project from an Asana project template', inputSchema: zodToJsonSchema(InstantiateProjectTemplateSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_reject_access_request', description: 'Reject an access request in Asana', inputSchema: zodToJsonSchema(RejectAccessRequestSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_remove_follower_from_task', description: 'Remove followers from an Asana task', inputSchema: zodToJsonSchema(RemoveFollowerFromTaskSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_remove_followers_for_project', description: 'Remove followers from an Asana project', inputSchema: zodToJsonSchema(RemoveFollowersForProjectSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_remove_item_from_portfolio', description: 'Remove an item from an Asana portfolio', inputSchema: zodToJsonSchema(RemoveItemFromPortfolioSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_remove_members_from_project', description: 'Remove members from an Asana project', inputSchema: zodToJsonSchema(RemoveMembersFromProjectSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_remove_project_from_task', description: 'Remove a project association from an Asana task', inputSchema: zodToJsonSchema(RemoveProjectFromTaskSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_remove_tag_from_task', description: 'Remove a tag from an Asana task', inputSchema: zodToJsonSchema(RemoveTagFromTaskSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_remove_user_for_team', description: 'Remove a user from an Asana team', inputSchema: zodToJsonSchema(RemoveUserForTeamSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_remove_user_from_workspace', description: 'Remove a user from an Asana workspace', inputSchema: zodToJsonSchema(RemoveUserFromWorkspaceSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_search_tasks_in_workspace', description: 'Search tasks in an Asana workspace with advanced filters', inputSchema: zodToJsonSchema(SearchTasksInWorkspaceSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    { name: 'asana_set_parent_for_task', description: 'Set or change the parent of an Asana task', inputSchema: zodToJsonSchema(SetParentForTaskSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_submit_parallel_requests', description: 'Submit multiple Asana API requests in parallel via the Batch API', inputSchema: zodToJsonSchema(SubmitParallelRequestsSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_update_allocation', description: 'Update an existing allocation in Asana', inputSchema: zodToJsonSchema(UpdateAllocationSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_update_task', description: 'Update attributes of an existing Asana task', inputSchema: zodToJsonSchema(UpdateTaskSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_update_custom_field', description: 'Update a custom field in Asana', inputSchema: zodToJsonSchema(UpdateCustomFieldSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_update_enum_option', description: 'Update an enum option for a custom field in Asana', inputSchema: zodToJsonSchema(UpdateEnumOptionSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_update_project', description: 'Update an existing Asana project', inputSchema: zodToJsonSchema(UpdateProjectSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_update_project_brief', description: 'Update a project brief in Asana', inputSchema: zodToJsonSchema(UpdateProjectBriefSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_update_section', description: 'Update a section in Asana', inputSchema: zodToJsonSchema(UpdateSectionSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_update_story', description: 'Update a story (comment) in Asana', inputSchema: zodToJsonSchema(UpdateStorySchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_update_tag', description: 'Update a tag in Asana', inputSchema: zodToJsonSchema(UpdateTagSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_update_team', description: 'Update a team in Asana', inputSchema: zodToJsonSchema(UpdateTeamSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_update_user_for_workspace', description: 'Update a user\'s custom fields in an Asana workspace', inputSchema: zodToJsonSchema(UpdateUserForWorkspaceSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    { name: 'asana_update_webhook', description: 'Update an Asana webhook\'s filter configuration', inputSchema: zodToJsonSchema(UpdateWebhookSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
  ];
}

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, any>,
) {
  const accessToken = config?.access_token ?? config?.mcp?.tokens?.access_token;

  if (!accessToken) {
    return { content: [{ type: 'text', text: 'Error: missing access_token in config' }] };
  }

  const client = createAsanaClient(accessToken);

  try {
    switch (name) {
      case 'asana_list_workspaces': {
        const { limit, offset } = ListWorkspacesSchema.parse(args);

        const params: Record<string, any> = { limit, opt_fields: 'gid,name,is_organization' };
        if (offset) params.offset = offset;

        const response = await client.get('/workspaces', { params });
        const { data, next_page } = response.data;

        if (!data || data.length === 0) {
          return { content: [{ type: 'text', text: 'No workspaces found.' }] };
        }

        let text = `Found ${data.length} workspace(s):\n\n`;
        data.forEach((ws: any) => {
          text += `${ws.name}\n  GID: ${ws.gid}\n`;
          if (ws.is_organization) text += `  Type: Organization\n`;
          text += '\n';
        });

        if (next_page?.offset) {
          text += `More workspaces available. Use offset: "${next_page.offset}"`;
        }

        return { content: [{ type: 'text', text }] };
      }

      case 'asana_list_projects': {
        const { workspace, limit, offset, archived } = ListProjectsSchema.parse(args);

        const params: Record<string, any> = {
          workspace,
          limit,
          opt_fields: 'gid,name,archived,created_at,modified_at,owner.name,color',
        };
        if (offset) params.offset = offset;
        if (archived !== undefined) params.archived = archived;

        const response = await client.get('/projects', { params });
        const { data, next_page } = response.data;

        if (!data || data.length === 0) {
          return { content: [{ type: 'text', text: 'No projects found.' }] };
        }

        let text = `Found ${data.length} project(s):\n\n`;
        data.forEach((proj: any) => {
          text += `${proj.name}\n  GID: ${proj.gid}\n`;
          if (proj.archived) text += `  [archived]\n`;
          if (proj.owner?.name) text += `  Owner: ${proj.owner.name}\n`;
          text += '\n';
        });

        if (next_page?.offset) {
          text += `More projects available. Use offset: "${next_page.offset}"`;
        }

        return { content: [{ type: 'text', text }] };
      }

      case 'asana_list_tasks': {
        const { project, limit, offset, completed_since } = ListTasksSchema.parse(args);

        const params: Record<string, any> = {
          project,
          limit,
          opt_fields:
            'gid,name,completed,due_on,due_at,assignee.name,created_at,modified_at,notes',
        };
        if (offset) params.offset = offset;
        if (completed_since) params.completed_since = completed_since;

        const response = await client.get('/tasks', { params });
        const { data, next_page } = response.data;

        if (!data || data.length === 0) {
          return { content: [{ type: 'text', text: 'No tasks found.' }] };
        }

        let text = `Found ${data.length} task(s):\n\n`;
        data.forEach((task: any) => {
          text += `${task.name}\n  GID: ${task.gid}\n`;
          text += `  Completed: ${task.completed ? 'Yes' : 'No'}\n`;
          if (task.assignee?.name) text += `  Assignee: ${task.assignee.name}\n`;
          if (task.due_on) text += `  Due: ${task.due_on}\n`;
          text += '\n';
        });

        if (next_page?.offset) {
          text += `More tasks available. Use offset: "${next_page.offset}"`;
        }

        return { content: [{ type: 'text', text }] };
      }

      case 'asana_get_task': {
        const { task_gid } = GetTaskSchema.parse(args);

        const response = await client.get(`/tasks/${task_gid}`, {
          params: {
            opt_fields:
              'gid,name,notes,completed,due_on,due_at,assignee.name,assignee.email,projects.name,workspace.name,created_at,modified_at,parent.name,num_subtasks,tags.name,permalink_url',
          },
        });
        const task = response.data.data;

        let text = `${task.name}\n`;
        text += `GID: ${task.gid}\n`;
        text += `Completed: ${task.completed ? 'Yes' : 'No'}\n`;
        if (task.assignee) text += `Assignee: ${task.assignee.name} (${task.assignee.email})\n`;
        if (task.due_on) text += `Due: ${task.due_on}\n`;
        if (task.projects?.length) {
          text += `Projects: ${task.projects.map((p: any) => p.name).join(', ')}\n`;
        }
        if (task.workspace) text += `Workspace: ${task.workspace.name}\n`;
        if (task.parent) text += `Parent: ${task.parent.name}\n`;
        if (task.num_subtasks) text += `Subtasks: ${task.num_subtasks}\n`;
        if (task.notes) text += `\nNotes:\n${task.notes}\n`;
        if (task.permalink_url) text += `\nURL: ${task.permalink_url}\n`;

        return { content: [{ type: 'text', text }] };
      }

      case 'asana_create_task': {
        const validated = CreateTaskSchema.parse(args);

        const body: Record<string, any> = {
          data: {
            name: validated.name,
            workspace: validated.workspace,
          },
        };

        if (validated.notes) body.data.notes = validated.notes;
        if (validated.assignee) body.data.assignee = validated.assignee;
        if (validated.due_on) body.data.due_on = validated.due_on;
        if (validated.due_at) body.data.due_at = validated.due_at;
        if (validated.projects?.length) body.data.projects = validated.projects;
        if (validated.parent) body.data.parent = validated.parent;

        const response = await client.post('/tasks', body);
        const task = response.data.data;

        let text = `Task created successfully.\n`;
        text += `Name: ${task.name}\n`;
        text += `GID: ${task.gid}\n`;
        if (task.permalink_url) text += `URL: ${task.permalink_url}\n`;

        return { content: [{ type: 'text', text }] };
      }

      case 'asana_add_comment': {
        const { task_gid, text: commentText, is_pinned } = AddCommentSchema.parse(args);

        const body: Record<string, any> = {
          data: {
            text: commentText,
          },
        };
        if (is_pinned !== undefined) body.data.is_pinned = is_pinned;

        const response = await client.post(`/tasks/${task_gid}/stories`, body);
        const story = response.data.data;

        return {
          content: [
            {
              type: 'text',
              text: `Comment added successfully.\nStory GID: ${story.gid}\nText: ${story.text}`,
            },
          ],
        };
      }

      case 'asana_add_followers_to_project': {
        const { project_gid, followers } = AddFollowersToProjectSchema.parse(args);
        const r = await client.post(`/projects/${project_gid}/addFollowers`, { data: { followers } });
        return { content: [{ type: 'text', text: `Followers added to project.\nProject GID: ${r.data.data?.gid}` }] };
      }
      case 'asana_add_followers_to_task': {
        const { task_gid, followers } = AddFollowersToTaskSchema.parse(args);
        const r = await client.post(`/tasks/${task_gid}/addFollowers`, { data: { followers } });
        return { content: [{ type: 'text', text: `Followers added to task.\nTask GID: ${r.data.data?.gid}` }] };
      }
      case 'asana_add_item_to_portfolio': {
        const { portfolio_gid, item } = AddItemToPortfolioSchema.parse(args);
        await client.post(`/portfolios/${portfolio_gid}/addItem`, { data: { item } });
        return { content: [{ type: 'text', text: `Item ${item} added to portfolio ${portfolio_gid}.` }] };
      }
      case 'asana_add_members_to_project': {
        const { project_gid, members } = AddMembersToProjectSchema.parse(args);
        const r = await client.post(`/projects/${project_gid}/addMembers`, { data: { members } });
        return { content: [{ type: 'text', text: `Members added to project.\nProject GID: ${r.data.data?.gid}` }] };
      }
      case 'asana_add_project_to_task': {
        const { task_gid, project, insert_before, insert_after, section } = AddProjectToTaskSchema.parse(args);
        const body: any = { project };
        if (insert_before) body.insert_before = insert_before;
        if (insert_after) body.insert_after = insert_after;
        if (section) body.section = section;
        await client.post(`/tasks/${task_gid}/addProject`, { data: body });
        return { content: [{ type: 'text', text: `Project ${project} added to task ${task_gid}.` }] };
      }
      case 'asana_add_supporting_relationship_to_goal': {
        const { goal_gid, supporting_resource, contribution_weight } = AddSupportingRelationshipToGoalSchema.parse(args);
        const body: any = { supporting_resource: { gid: supporting_resource } };
        if (contribution_weight !== undefined) body.contribution_weight = contribution_weight;
        const r = await client.post(`/goals/${goal_gid}/addSupportingRelationship`, { data: body });
        return { content: [{ type: 'text', text: `Supporting relationship added.\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_add_tag_to_task': {
        const { task_gid, tag } = AddTagToTaskSchema.parse(args);
        await client.post(`/tasks/${task_gid}/addTag`, { data: { tag } });
        return { content: [{ type: 'text', text: `Tag ${tag} added to task ${task_gid}.` }] };
      }
      case 'asana_add_task_dependencies': {
        const { task_gid, dependencies } = AddTaskDependenciesSchema.parse(args);
        await client.post(`/tasks/${task_gid}/addDependencies`, { data: { dependencies } });
        return { content: [{ type: 'text', text: `Dependencies added to task ${task_gid}.` }] };
      }
      case 'asana_add_task_to_section': {
        const { section_gid, task, insert_before, insert_after } = AddTaskToSectionSchema.parse(args);
        const body: any = { task };
        if (insert_before) body.insert_before = insert_before;
        if (insert_after) body.insert_after = insert_after;
        await client.post(`/sections/${section_gid}/addTask`, { data: body });
        return { content: [{ type: 'text', text: `Task ${task} added to section ${section_gid}.` }] };
      }
      case 'asana_add_user_for_team': {
        const { team_gid, user } = AddUserForTeamSchema.parse(args);
        const r = await client.post(`/teams/${team_gid}/addUser`, { data: { user } });
        return { content: [{ type: 'text', text: `User added to team.\nUser GID: ${r.data.data?.gid}` }] };
      }
      case 'asana_add_user_for_workspace': {
        const { workspace_gid, user } = AddUserForWorkspaceSchema.parse(args);
        const r = await client.post(`/workspaces/${workspace_gid}/addUser`, { data: { user } });
        return { content: [{ type: 'text', text: `User added to workspace.\nUser GID: ${r.data.data?.gid}` }] };
      }
      case 'asana_approve_access_request': {
        const { access_request_gid } = ApproveAccessRequestSchema.parse(args);
        await client.post(`/access_requests/${access_request_gid}/approve`, { data: {} });
        return { content: [{ type: 'text', text: `Access request ${access_request_gid} approved.` }] };
      }
      case 'asana_create_access_request': {
        const { resource_gid, message } = CreateAccessRequestSchema.parse(args);
        const body: any = { resource: { gid: resource_gid } };
        if (message) body.message = message;
        const r = await client.post('/access_requests', { data: body });
        return { content: [{ type: 'text', text: `Access request created.\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_create_allocation': {
        const v = CreateAllocationSchema.parse(args);
        const body: any = { assignee: { gid: v.assignee }, parent: { gid: v.parent }, start_date: v.start_date, end_date: v.end_date };
        if (v.effort_per_week_minutes) body.effort = { type: 'effort', value: v.effort_per_week_minutes, unit: 'minutes' };
        if (v.workspace) body.workspace = { gid: v.workspace };
        const r = await client.post('/allocations', { data: body });
        return { content: [{ type: 'text', text: `Allocation created.\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_create_project': {
        const v = CreateProjectSchema.parse(args);
        const body: any = { name: v.name, workspace: { gid: v.workspace } };
        if (v.team) body.team = { gid: v.team };
        if (v.notes) body.notes = v.notes;
        if (v.color) body.color = v.color;
        if (v.layout) body.default_view = v.layout;
        if (v.public !== undefined) body.public = v.public;
        const r = await client.post('/projects', { data: body });
        const p = r.data.data;
        return { content: [{ type: 'text', text: `Project created.\nName: ${p.name}\nGID: ${p.gid}` }] };
      }
      case 'asana_create_tag_in_workspace': {
        const { workspace_gid, name, color, notes } = CreateTagInWorkspaceSchema.parse(args);
        const body: any = { name };
        if (color) body.color = color;
        if (notes) body.notes = notes;
        const r = await client.post(`/workspaces/${workspace_gid}/tags`, { data: body });
        const t = r.data.data;
        return { content: [{ type: 'text', text: `Tag created.\nName: ${t.name}\nGID: ${t.gid}` }] };
      }
      case 'asana_create_task_detailed': {
        const v = CreateTaskDetailedSchema.parse(args);
        const body: any = { name: v.name };
        if (v.workspace) body.workspace = v.workspace;
        if (v.parent) body.parent = v.parent;
        if (v.projects?.length) body.projects = v.projects;
        if (v.followers?.length) body.followers = v.followers;
        if (v.tags?.length) body.tags = v.tags;
        if (v.assignee) body.assignee = v.assignee;
        if (v.notes) body.notes = v.notes;
        if (v.html_notes) body.html_notes = v.html_notes;
        if (v.due_on) body.due_on = v.due_on;
        if (v.due_at) body.due_at = v.due_at;
        if (v.start_on) body.start_on = v.start_on;
        if (v.resource_subtype) body.resource_subtype = v.resource_subtype;
        if (v.assignee_section) body.assignee_section = v.assignee_section;
        const r = await client.post('/tasks', { data: body });
        const task = r.data.data;
        return { content: [{ type: 'text', text: `Task created.\nName: ${task.name}\nGID: ${task.gid}${task.permalink_url ? `\nURL: ${task.permalink_url}` : ''}` }] };
      }
      case 'asana_create_attachment_for_object': {
        const { parent_gid, resource_subtype, url, name } = CreateAttachmentForObjectSchema.parse(args);
        const body: any = { parent: { gid: parent_gid }, resource_subtype, url };
        if (name) body.name = name;
        const r = await client.post('/attachments', { data: body });
        return { content: [{ type: 'text', text: `Attachment created.\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_create_custom_field': {
        const v = CreateCustomFieldSchema.parse(args);
        const body: any = { workspace: { gid: v.workspace_gid }, name: v.name, resource_subtype: v.resource_subtype };
        if (v.description) body.description = v.description;
        if (v.precision !== undefined) body.precision = v.precision;
        if (v.is_global_to_workspace !== undefined) body.is_global_to_workspace = v.is_global_to_workspace;
        const r = await client.post('/custom_fields', { data: body });
        return { content: [{ type: 'text', text: `Custom field created.\nName: ${r.data.data?.name}\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_create_enum_option_for_custom_field': {
        const { custom_field_gid, name, color, enabled, insert_before, insert_after } = CreateEnumOptionSchema.parse(args);
        const body: any = { name };
        if (color) body.color = color;
        if (enabled !== undefined) body.enabled = enabled;
        if (insert_before) body.insert_before = insert_before;
        if (insert_after) body.insert_after = insert_after;
        const r = await client.post(`/custom_fields/${custom_field_gid}/enum_options`, { data: body });
        return { content: [{ type: 'text', text: `Enum option created.\nName: ${r.data.data?.name}\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_create_membership': {
        const { parent_gid, member_gid, access_level } = CreateMembershipSchema.parse(args);
        const body: any = { parent: { gid: parent_gid }, member: { gid: member_gid } };
        if (access_level) body.access_level = access_level;
        const r = await client.post('/memberships', { data: body });
        return { content: [{ type: 'text', text: `Membership created.\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_create_project_brief': {
        const { project_gid, title, text, html_text } = CreateProjectBriefSchema.parse(args);
        const body: any = {};
        if (title) body.title = title;
        if (text) body.text = text;
        if (html_text) body.html_text = html_text;
        const r = await client.post(`/projects/${project_gid}/project_briefs`, { data: body });
        return { content: [{ type: 'text', text: `Project brief created.\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_create_project_for_team': {
        const { team_gid, name, notes, color, layout } = CreateProjectForTeamSchema.parse(args);
        const body: any = { name };
        if (notes) body.notes = notes;
        if (color) body.color = color;
        if (layout) body.default_view = layout;
        const r = await client.post(`/teams/${team_gid}/projects`, { data: body });
        const p = r.data.data;
        return { content: [{ type: 'text', text: `Project created.\nName: ${p.name}\nGID: ${p.gid}` }] };
      }
      case 'asana_create_project_for_workspace': {
        const { workspace_gid, name, team, notes, color, layout } = CreateProjectForWorkspaceSchema.parse(args);
        const body: any = { name, team: { gid: team } };
        if (notes) body.notes = notes;
        if (color) body.color = color;
        if (layout) body.default_view = layout;
        const r = await client.post(`/workspaces/${workspace_gid}/projects`, { data: body });
        const p = r.data.data;
        return { content: [{ type: 'text', text: `Project created.\nName: ${p.name}\nGID: ${p.gid}` }] };
      }
      case 'asana_create_project_status_update': {
        const { project_gid, title, text, color, html_text } = CreateProjectStatusUpdateSchema.parse(args);
        const body: any = { title, text };
        if (color) body.color = color;
        if (html_text) body.html_text = html_text;
        const r = await client.post(`/projects/${project_gid}/project_statuses`, { data: body });
        return { content: [{ type: 'text', text: `Status update created.\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_create_section_in_project': {
        const { project_gid, name, insert_before, insert_after } = CreateSectionInProjectSchema.parse(args);
        const body: any = { name };
        if (insert_before) body.insert_before = insert_before;
        if (insert_after) body.insert_after = insert_after;
        const r = await client.post(`/projects/${project_gid}/sections`, { data: body });
        return { content: [{ type: 'text', text: `Section created.\nName: ${r.data.data?.name}\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_create_status_update_for_object': {
        const { parent_gid, title, text, status_type, html_text } = CreateStatusUpdateForObjectSchema.parse(args);
        const body: any = { parent: { gid: parent_gid }, title, text, status_type };
        if (html_text) body.html_text = html_text;
        const r = await client.post('/status_updates', { data: body });
        return { content: [{ type: 'text', text: `Status update created.\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_create_subtask': {
        const { task_gid, name, assignee, notes, due_on, due_at } = CreateSubtaskSchema.parse(args);
        const body: any = { name };
        if (assignee) body.assignee = assignee;
        if (notes) body.notes = notes;
        if (due_on) body.due_on = due_on;
        if (due_at) body.due_at = due_at;
        const r = await client.post(`/tasks/${task_gid}/subtasks`, { data: body });
        const t = r.data.data;
        return { content: [{ type: 'text', text: `Subtask created.\nName: ${t.name}\nGID: ${t.gid}` }] };
      }
      case 'asana_create_tag': {
        const { workspace_gid, name, color, notes } = CreateTagSchema.parse(args);
        const body: any = { workspace: { gid: workspace_gid }, name };
        if (color) body.color = color;
        if (notes) body.notes = notes;
        const r = await client.post('/tags', { data: body });
        return { content: [{ type: 'text', text: `Tag created.\nName: ${r.data.data?.name}\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_create_task_comment': {
        const { task_gid, text: commentText, html_text, is_pinned } = CreateTaskCommentSchema.parse(args);
        const body: any = { text: commentText };
        if (html_text) body.html_text = html_text;
        if (is_pinned !== undefined) body.is_pinned = is_pinned;
        const r = await client.post(`/tasks/${task_gid}/stories`, { data: body });
        return { content: [{ type: 'text', text: `Comment added.\nStory GID: ${r.data.data?.gid}` }] };
      }
      case 'asana_create_team': {
        const { workspace_gid, name, description, html_description, visibility } = CreateTeamSchema.parse(args);
        const body: any = { organization: { gid: workspace_gid }, name };
        if (description) body.description = description;
        if (html_description) body.html_description = html_description;
        if (visibility) body.visibility = visibility;
        const r = await client.post('/teams', { data: body });
        return { content: [{ type: 'text', text: `Team created.\nName: ${r.data.data?.name}\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_delete_allocation': {
        const { allocation_gid } = DeleteAllocationSchema.parse(args);
        await client.delete(`/allocations/${allocation_gid}`);
        return { content: [{ type: 'text', text: `Allocation ${allocation_gid} deleted.` }] };
      }
      case 'asana_delete_attachment': {
        const { attachment_gid } = DeleteAttachmentSchema.parse(args);
        await client.delete(`/attachments/${attachment_gid}`);
        return { content: [{ type: 'text', text: `Attachment ${attachment_gid} deleted.` }] };
      }
      case 'asana_delete_custom_field': {
        const { custom_field_gid } = DeleteCustomFieldSchema.parse(args);
        await client.delete(`/custom_fields/${custom_field_gid}`);
        return { content: [{ type: 'text', text: `Custom field ${custom_field_gid} deleted.` }] };
      }
      case 'asana_delete_membership': {
        const { membership_gid } = DeleteMembershipSchema.parse(args);
        await client.delete(`/memberships/${membership_gid}`);
        return { content: [{ type: 'text', text: `Membership ${membership_gid} deleted.` }] };
      }
      case 'asana_delete_project': {
        const { project_gid } = DeleteProjectSchema.parse(args);
        await client.delete(`/projects/${project_gid}`);
        return { content: [{ type: 'text', text: `Project ${project_gid} deleted.` }] };
      }
      case 'asana_delete_project_brief': {
        const { project_brief_gid } = DeleteProjectBriefSchema.parse(args);
        await client.delete(`/project_briefs/${project_brief_gid}`);
        return { content: [{ type: 'text', text: `Project brief ${project_brief_gid} deleted.` }] };
      }
      case 'asana_delete_project_status': {
        const { project_status_gid } = DeleteProjectStatusSchema.parse(args);
        await client.delete(`/project_statuses/${project_status_gid}`);
        return { content: [{ type: 'text', text: `Project status ${project_status_gid} deleted.` }] };
      }
      case 'asana_delete_section': {
        const { section_gid } = DeleteSectionSchema.parse(args);
        await client.delete(`/sections/${section_gid}`);
        return { content: [{ type: 'text', text: `Section ${section_gid} deleted.` }] };
      }
      case 'asana_delete_status_update': {
        const { status_update_gid } = DeleteStatusUpdateSchema.parse(args);
        await client.delete(`/status_updates/${status_update_gid}`);
        return { content: [{ type: 'text', text: `Status update ${status_update_gid} deleted.` }] };
      }
      case 'asana_delete_story': {
        const { story_gid } = DeleteStorySchema.parse(args);
        await client.delete(`/stories/${story_gid}`);
        return { content: [{ type: 'text', text: `Story ${story_gid} deleted.` }] };
      }
      case 'asana_delete_tag': {
        const { tag_gid } = DeleteTagSchema.parse(args);
        await client.delete(`/tags/${tag_gid}`);
        return { content: [{ type: 'text', text: `Tag ${tag_gid} deleted.` }] };
      }
      case 'asana_delete_task': {
        const { task_gid } = DeleteTaskSchema.parse(args);
        await client.delete(`/tasks/${task_gid}`);
        return { content: [{ type: 'text', text: `Task ${task_gid} deleted.` }] };
      }
      case 'asana_duplicate_project': {
        const { project_gid, name, team, include } = DuplicateProjectSchema.parse(args);
        const body: any = { name };
        if (team) body.team = { gid: team };
        if (include?.length) body.include = include;
        const r = await client.post(`/projects/${project_gid}/duplicate`, { data: body });
        return { content: [{ type: 'text', text: `Project duplication job started.\nJob GID: ${r.data.data?.gid}` }] };
      }
      case 'asana_duplicate_task': {
        const { task_gid, name, include } = DuplicateTaskSchema.parse(args);
        const body: any = { name };
        if (include?.length) body.include = include;
        const r = await client.post(`/tasks/${task_gid}/duplicate`, { data: body });
        return { content: [{ type: 'text', text: `Task duplication job started.\nJob GID: ${r.data.data?.gid}` }] };
      }
      case 'asana_get_access_requests': {
        const { target_gid } = GetAccessRequestsSchema.parse(args);
        const r = await client.get('/access_requests', { params: { target: target_gid } });
        const data = r.data.data ?? [];
        if (!data.length) return { content: [{ type: 'text', text: 'No access requests found.' }] };
        let text = `Found ${data.length} access request(s):\n\n`;
        data.forEach((a: any) => { text += `GID: ${a.gid}\nStatus: ${a.status ?? 'pending'}\n\n`; });
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_allocation': {
        const { allocation_gid, opt_fields } = GetAllocationSchema.parse(args);
        const params: any = {};
        if (opt_fields) params.opt_fields = opt_fields;
        const r = await client.get(`/allocations/${allocation_gid}`, { params });
        const a = r.data.data;
        let text = `Allocation GID: ${a.gid}\n`;
        if (a.assignee?.name) text += `Assignee: ${a.assignee.name}\n`;
        if (a.start_date) text += `Start: ${a.start_date}\n`;
        if (a.end_date) text += `End: ${a.end_date}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_allocations': {
        const { parent, assignee, workspace, limit, offset } = GetAllocationsSchema.parse(args);
        const params: any = { limit };
        if (parent) params.parent = parent;
        if (assignee) params.assignee = assignee;
        if (workspace) params.workspace = workspace;
        if (offset) params.offset = offset;
        const r = await client.get('/allocations', { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No allocations found.' }] };
        let text = `Found ${data.length} allocation(s):\n\n`;
        data.forEach((a: any) => { text += `GID: ${a.gid}\n${a.assignee?.name ? `Assignee: ${a.assignee.name}\n` : ''}${a.start_date ? `Start: ${a.start_date}\n` : ''}\n`; });
        if (next_page?.offset) text += `\nMore results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_project': {
        const { project_gid, opt_fields } = GetProjectSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,name,notes,archived,created_at,modified_at,owner.name,team.name,workspace.name,color,default_view' };
        const r = await client.get(`/projects/${project_gid}`, { params });
        const p = r.data.data;
        let text = `${p.name}\nGID: ${p.gid}\n`;
        if (p.archived) text += `[archived]\n`;
        if (p.owner?.name) text += `Owner: ${p.owner.name}\n`;
        if (p.team?.name) text += `Team: ${p.team.name}\n`;
        if (p.workspace?.name) text += `Workspace: ${p.workspace.name}\n`;
        if (p.notes) text += `\nNotes:\n${p.notes}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_attachment': {
        const { attachment_gid } = GetAttachmentSchema.parse(args);
        const r = await client.get(`/attachments/${attachment_gid}`, { params: { opt_fields: 'gid,name,resource_subtype,download_url,view_url,created_at,size' } });
        const a = r.data.data;
        let text = `${a.name ?? 'Attachment'}\nGID: ${a.gid}\nType: ${a.resource_subtype}\n`;
        if (a.size) text += `Size: ${a.size} bytes\n`;
        if (a.download_url) text += `Download: ${a.download_url}\n`;
        if (a.view_url) text += `View: ${a.view_url}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_audit_log_events': {
        const v = GetAuditLogEventsSchema.parse(args);
        const params: any = { limit: v.limit };
        if (v.start_at) params.start_at = v.start_at;
        if (v.end_at) params.end_at = v.end_at;
        if (v.event_type) params.event_type = v.event_type;
        if (v.actor_gid) params.actor_gid = v.actor_gid;
        if (v.resource_gid) params.resource_gid = v.resource_gid;
        if (v.offset) params.offset = v.offset;
        const r = await client.get(`/workspaces/${v.workspace_gid}/audit_log_events`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No audit log events found.' }] };
        let text = `Found ${data.length} event(s):\n\n`;
        data.forEach((e: any) => { text += `${e.event_type ?? e.type}\n  Time: ${e.created_at}\n  Actor: ${e.actor?.name ?? e.actor?.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_user_task_list': {
        const { user_task_list_gid, opt_fields } = GetUserTaskListByGidSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,name,owner.name,workspace.name' };
        const r = await client.get(`/user_task_lists/${user_task_list_gid}`, { params });
        const utl = r.data.data;
        let text = `User Task List: ${utl.name ?? 'My Tasks'}\nGID: ${utl.gid}\n`;
        if (utl.owner?.name) text += `Owner: ${utl.owner.name}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_current_user': {
        const { opt_fields } = GetCurrentUserSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,name,email,workspaces.name,photo' };
        const r = await client.get('/users/me', { params });
        const u = r.data.data;
        let text = `${u.name}\nGID: ${u.gid}\nEmail: ${u.email}\n`;
        if (u.workspaces?.length) text += `Workspaces: ${u.workspaces.map((w: any) => w.name).join(', ')}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_custom_field': {
        const { custom_field_gid } = GetCustomFieldSchema.parse(args);
        const r = await client.get(`/custom_fields/${custom_field_gid}`, { params: { opt_fields: 'gid,name,resource_subtype,description,enabled,enum_options.name,is_global_to_workspace' } });
        const cf = r.data.data;
        let text = `${cf.name}\nGID: ${cf.gid}\nType: ${cf.resource_subtype}\n`;
        if (cf.description) text += `Description: ${cf.description}\n`;
        if (cf.enum_options?.length) text += `Options: ${cf.enum_options.map((o: any) => o.name).join(', ')}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_custom_fields_for_workspace': {
        const { workspace_gid, limit, offset } = GetCustomFieldsForWorkspaceSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,resource_subtype,enabled' };
        if (offset) params.offset = offset;
        const r = await client.get(`/workspaces/${workspace_gid}/custom_fields`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No custom fields found.' }] };
        let text = `Found ${data.length} custom field(s):\n\n`;
        data.forEach((cf: any) => { text += `${cf.name}\n  GID: ${cf.gid}\n  Type: ${cf.resource_subtype}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_custom_types': {
        const { project_gid } = GetCustomTypesSchema.parse(args);
        const r = await client.get('/custom_types', { params: { project: project_gid } });
        const data = r.data.data ?? [];
        if (!data.length) return { content: [{ type: 'text', text: 'No custom types found.' }] };
        let text = `Found ${data.length} custom type(s):\n\n`;
        data.forEach((ct: any) => { text += `${ct.name ?? ct.gid}\n  GID: ${ct.gid}\n\n`; });
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_events_on_resource': {
        const { resource, sync } = GetEventsSchema.parse(args);
        const params: any = { resource };
        if (sync) params.sync = sync;
        const r = await client.get('/events', { params });
        const events = r.data.data ?? [];
        const newSync = r.data.sync;
        if (!events.length) return { content: [{ type: 'text', text: `No new events.\nSync token: ${newSync}` }] };
        let text = `Found ${events.length} event(s):\nSync token: ${newSync}\n\n`;
        events.forEach((e: any) => { text += `${e.type} - ${e.action}\n  Resource: ${e.resource?.gid}\n\n`; });
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_favorites_for_user': {
        const { user_gid, workspace, resource_type, limit, offset } = GetFavoritesForUserSchema.parse(args);
        const params: any = { workspace, resource_type, limit };
        if (offset) params.offset = offset;
        const r = await client.get(`/users/${user_gid}/favorites`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No favorites found.' }] };
        let text = `Found ${data.length} favorite(s):\n\n`;
        data.forEach((f: any) => { text += `${f.name ?? f.gid}\n  GID: ${f.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_goal': {
        const { goal_gid, opt_fields } = GetGoalSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,name,notes,status,due_on,start_on,owner.name,workspace.name' };
        const r = await client.get(`/goals/${goal_gid}`, { params });
        const g = r.data.data;
        let text = `${g.name}\nGID: ${g.gid}\n`;
        if (g.status) text += `Status: ${g.status}\n`;
        if (g.due_on) text += `Due: ${g.due_on}\n`;
        if (g.owner?.name) text += `Owner: ${g.owner.name}\n`;
        if (g.notes) text += `\nNotes:\n${g.notes}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_goal_relationships': {
        const { goal_gid, resource_subtype, limit, offset } = GetGoalRelationshipsSchema.parse(args);
        const params: any = { limit };
        if (resource_subtype) params.resource_subtype = resource_subtype;
        if (offset) params.offset = offset;
        const r = await client.get(`/goals/${goal_gid}/goal_relationships`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No goal relationships found.' }] };
        let text = `Found ${data.length} relationship(s):\n\n`;
        data.forEach((gr: any) => { text += `GID: ${gr.gid}\nType: ${gr.resource_subtype}\nSupporting: ${gr.supporting_resource?.name ?? gr.supporting_resource?.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_goals': {
        const v = GetGoalsSchema.parse(args);
        const params: any = { limit: v.limit, opt_fields: 'gid,name,status,due_on,owner.name' };
        if (v.workspace) params.workspace = v.workspace;
        if (v.team) params.team = v.team;
        if (v.portfolio) params.portfolio = v.portfolio;
        if (v.project) params.project = v.project;
        if (v.is_workspace_level !== undefined) params.is_workspace_level = v.is_workspace_level;
        if (v.offset) params.offset = v.offset;
        const r = await client.get('/goals', { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No goals found.' }] };
        let text = `Found ${data.length} goal(s):\n\n`;
        data.forEach((g: any) => { text += `${g.name}\n  GID: ${g.gid}\n  Status: ${g.status}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_job': {
        const { job_gid } = GetJobSchema.parse(args);
        const r = await client.get(`/jobs/${job_gid}`, { params: { opt_fields: 'gid,resource_type,status,new_project.gid,new_project.name,new_task.gid,new_task.name' } });
        const j = r.data.data;
        let text = `Job GID: ${j.gid}\nStatus: ${j.status}\nType: ${j.resource_type}\n`;
        if (j.new_project) text += `New Project: ${j.new_project.name} (${j.new_project.gid})\n`;
        if (j.new_task) text += `New Task: ${j.new_task.name} (${j.new_task.gid})\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_membership': {
        const { membership_gid } = GetMembershipSchema.parse(args);
        const r = await client.get(`/memberships/${membership_gid}`, { params: { opt_fields: 'gid,parent.name,member.name,access_level' } });
        const m = r.data.data;
        let text = `Membership GID: ${m.gid}\n`;
        if (m.member?.name) text += `Member: ${m.member.name}\n`;
        if (m.parent?.name) text += `Resource: ${m.parent.name}\n`;
        if (m.access_level) text += `Access: ${m.access_level}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_memberships': {
        const { parent, member, workspace, limit, offset } = GetMembershipsSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,parent.name,member.name,access_level' };
        if (parent) params.parent = parent;
        if (member) params.member = member;
        if (workspace) params.workspace = workspace;
        if (offset) params.offset = offset;
        const r = await client.get('/memberships', { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No memberships found.' }] };
        let text = `Found ${data.length} membership(s):\n\n`;
        data.forEach((m: any) => { text += `GID: ${m.gid}\nMember: ${m.member?.name}\nAccess: ${m.access_level}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_portfolio': {
        const { portfolio_gid, opt_fields } = GetPortfolioSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,name,color,created_at,owner.name,workspace.name' };
        const r = await client.get(`/portfolios/${portfolio_gid}`, { params });
        const p = r.data.data;
        let text = `${p.name}\nGID: ${p.gid}\n`;
        if (p.color) text += `Color: ${p.color}\n`;
        if (p.owner?.name) text += `Owner: ${p.owner.name}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_portfolio_items': {
        const { portfolio_gid, limit, offset, opt_fields } = GetPortfolioItemsSchema.parse(args);
        const params: any = { limit, opt_fields: opt_fields ?? 'gid,name,archived,owner.name' };
        if (offset) params.offset = offset;
        const r = await client.get(`/portfolios/${portfolio_gid}/items`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No items found in portfolio.' }] };
        let text = `Found ${data.length} item(s):\n\n`;
        data.forEach((i: any) => { text += `${i.name}\n  GID: ${i.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_portfolio_memberships': {
        const { portfolio, workspace, user, limit, offset } = GetPortfolioMembershipsSchema.parse(args);
        const params: any = { limit };
        if (portfolio) params.portfolio = portfolio;
        if (workspace) params.workspace = workspace;
        if (user) params.user = user;
        if (offset) params.offset = offset;
        const r = await client.get('/portfolio_memberships', { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No portfolio memberships found.' }] };
        let text = `Found ${data.length} membership(s):\n\n`;
        data.forEach((m: any) => { text += `GID: ${m.gid}\nUser: ${m.user?.name}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_portfolios': {
        const { workspace, owner, limit, offset } = GetPortfoliosSchema.parse(args);
        const params: any = { workspace, limit, opt_fields: 'gid,name,color,owner.name' };
        if (owner) params.owner = owner;
        if (offset) params.offset = offset;
        const r = await client.get('/portfolios', { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No portfolios found.' }] };
        let text = `Found ${data.length} portfolio(s):\n\n`;
        data.forEach((p: any) => { text += `${p.name}\n  GID: ${p.gid}\n  Owner: ${p.owner?.name}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_project_brief': {
        const { project_brief_gid, opt_fields } = GetProjectBriefSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,title,text,html_text,project.name' };
        const r = await client.get(`/project_briefs/${project_brief_gid}`, { params });
        const b = r.data.data;
        let text = `Project Brief: ${b.title ?? 'Untitled'}\nGID: ${b.gid}\n`;
        if (b.project?.name) text += `Project: ${b.project.name}\n`;
        if (b.text) text += `\n${b.text}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_project_membership': {
        const { project_membership_gid, opt_fields } = GetProjectMembershipSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,project.name,user.name,access_level' };
        const r = await client.get(`/project_memberships/${project_membership_gid}`, { params });
        const m = r.data.data;
        let text = `Membership GID: ${m.gid}\n`;
        if (m.user?.name) text += `User: ${m.user.name}\n`;
        if (m.project?.name) text += `Project: ${m.project.name}\n`;
        if (m.access_level) text += `Access: ${m.access_level}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_project_memberships_for_project': {
        const { project_gid, user, limit, offset } = GetProjectMembershipsForProjectSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,user.name,access_level' };
        if (user) params.user = user;
        if (offset) params.offset = offset;
        const r = await client.get(`/projects/${project_gid}/project_memberships`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No memberships found.' }] };
        let text = `Found ${data.length} membership(s):\n\n`;
        data.forEach((m: any) => { text += `${m.user?.name}\n  GID: ${m.gid}\n  Access: ${m.access_level}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_projects_for_task': {
        const { task_gid, limit, offset } = GetProjectsForTaskSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,archived' };
        if (offset) params.offset = offset;
        const r = await client.get(`/tasks/${task_gid}/projects`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'Task is not in any projects.' }] };
        let text = `Task is in ${data.length} project(s):\n\n`;
        data.forEach((p: any) => { text += `${p.name}\n  GID: ${p.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_projects_for_team': {
        const { team_gid, archived, limit, offset } = GetProjectsForTeamSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,archived,owner.name' };
        if (archived !== undefined) params.archived = archived;
        if (offset) params.offset = offset;
        const r = await client.get(`/teams/${team_gid}/projects`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No projects found for team.' }] };
        let text = `Found ${data.length} project(s):\n\n`;
        data.forEach((p: any) => { text += `${p.name}\n  GID: ${p.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_project_status': {
        const { project_status_gid } = GetProjectStatusSchema.parse(args);
        const r = await client.get(`/project_statuses/${project_status_gid}`, { params: { opt_fields: 'gid,title,text,color,author.name,created_at' } });
        const s = r.data.data;
        let text = `${s.title ?? 'Status Update'}\nGID: ${s.gid}\nColor: ${s.color}\n`;
        if (s.author?.name) text += `Author: ${s.author.name}\n`;
        if (s.created_at) text += `Created: ${s.created_at}\n`;
        if (s.text) text += `\n${s.text}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_project_status_updates': {
        const { project_gid, limit, offset } = GetProjectStatusUpdatesSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,title,color,author.name,created_at' };
        if (offset) params.offset = offset;
        const r = await client.get(`/projects/${project_gid}/project_statuses`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No status updates found.' }] };
        let text = `Found ${data.length} status update(s):\n\n`;
        data.forEach((s: any) => { text += `${s.title ?? 'Update'}\n  GID: ${s.gid}\n  Color: ${s.color}\n  Author: ${s.author?.name}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_project_templates': {
        const { workspace, team, limit, offset } = GetProjectTemplatesSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,description,team.name' };
        if (workspace) params.workspace = workspace;
        if (team) params.team = team;
        if (offset) params.offset = offset;
        const r = await client.get('/project_templates', { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No project templates found.' }] };
        let text = `Found ${data.length} template(s):\n\n`;
        data.forEach((t: any) => { text += `${t.name}\n  GID: ${t.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_project_templates_for_team': {
        const { team_gid, limit, offset } = GetProjectTemplatesForTeamSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,description' };
        if (offset) params.offset = offset;
        const r = await client.get(`/teams/${team_gid}/project_templates`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No templates found.' }] };
        let text = `Found ${data.length} template(s):\n\n`;
        data.forEach((t: any) => { text += `${t.name}\n  GID: ${t.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_reactions_on_object': {
        const { object_gid, emoji_base, limit, offset } = GetReactionsOnObjectSchema.parse(args);
        const params: any = { emoji_base, limit };
        if (offset) params.offset = offset;
        const r = await client.get(`/stories/${object_gid}/reactions`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No reactions found.' }] };
        let text = `Found ${data.length} reaction(s) for "${emoji_base}":\n\n`;
        data.forEach((reaction: any) => { text += `GID: ${reaction.gid}\nUser: ${reaction.user?.name}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_section': {
        const { section_gid, opt_fields } = GetSectionSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,name,project.name,created_at' };
        const r = await client.get(`/sections/${section_gid}`, { params });
        const s = r.data.data;
        let text = `${s.name}\nGID: ${s.gid}\n`;
        if (s.project?.name) text += `Project: ${s.project.name}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_sections_in_project': {
        const { project_gid, limit, offset } = GetSectionsInProjectSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,created_at' };
        if (offset) params.offset = offset;
        const r = await client.get(`/projects/${project_gid}/sections`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No sections found.' }] };
        let text = `Found ${data.length} section(s):\n\n`;
        data.forEach((s: any) => { text += `${s.name}\n  GID: ${s.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_status_update': {
        const { status_update_gid, opt_fields } = GetStatusUpdateSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,title,text,status_type,author.name,created_at,parent.name' };
        const r = await client.get(`/status_updates/${status_update_gid}`, { params });
        const s = r.data.data;
        let text = `${s.title ?? 'Status Update'}\nGID: ${s.gid}\nType: ${s.status_type}\n`;
        if (s.author?.name) text += `Author: ${s.author.name}\n`;
        if (s.parent?.name) text += `Parent: ${s.parent.name}\n`;
        if (s.text) text += `\n${s.text}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_status_updates': {
        const { parent_gid, limit, offset } = GetStatusUpdatesSchema.parse(args);
        const params: any = { parent: parent_gid, limit, opt_fields: 'gid,title,status_type,author.name,created_at' };
        if (offset) params.offset = offset;
        const r = await client.get('/status_updates', { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No status updates found.' }] };
        let text = `Found ${data.length} status update(s):\n\n`;
        data.forEach((s: any) => { text += `${s.title}\n  GID: ${s.gid}\n  Type: ${s.status_type}\n  Author: ${s.author?.name}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_stories_for_task': {
        const { task_gid, limit, offset } = GetStoriesForTaskSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,text,type,created_by.name,created_at,is_pinned' };
        if (offset) params.offset = offset;
        const r = await client.get(`/tasks/${task_gid}/stories`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No stories found.' }] };
        let text = `Found ${data.length} stor(y/ies):\n\n`;
        data.forEach((s: any) => { text += `[${s.type}] ${s.created_by?.name ?? 'System'}\n  GID: ${s.gid}\n  ${s.text ? s.text.substring(0, 100) : ''}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_story': {
        const { story_gid, opt_fields } = GetStorySchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,text,html_text,type,resource_subtype,created_by.name,created_at,is_pinned,target.name' };
        const r = await client.get(`/stories/${story_gid}`, { params });
        const s = r.data.data;
        let text = `Story GID: ${s.gid}\nType: ${s.type}\n`;
        if (s.created_by?.name) text += `Author: ${s.created_by.name}\n`;
        if (s.created_at) text += `Created: ${s.created_at}\n`;
        if (s.is_pinned) text += `Pinned: Yes\n`;
        if (s.text) text += `\n${s.text}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_tag': {
        const { tag_gid, opt_fields } = GetTagSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,name,color,notes,workspace.name' };
        const r = await client.get(`/tags/${tag_gid}`, { params });
        const t = r.data.data;
        let text = `${t.name}\nGID: ${t.gid}\n`;
        if (t.color) text += `Color: ${t.color}\n`;
        if (t.workspace?.name) text += `Workspace: ${t.workspace.name}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_tags': {
        const { workspace, limit, offset } = GetTagsSchema.parse(args);
        const params: any = { workspace, limit, opt_fields: 'gid,name,color' };
        if (offset) params.offset = offset;
        const r = await client.get('/tags', { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No tags found.' }] };
        let text = `Found ${data.length} tag(s):\n\n`;
        data.forEach((t: any) => { text += `${t.name}\n  GID: ${t.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_tags_for_task': {
        const { task_gid, limit, offset } = GetTagsForTaskSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,color' };
        if (offset) params.offset = offset;
        const r = await client.get(`/tasks/${task_gid}/tags`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No tags on this task.' }] };
        let text = `Found ${data.length} tag(s):\n\n`;
        data.forEach((t: any) => { text += `${t.name}\n  GID: ${t.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_tags_for_workspace': {
        const { workspace_gid, limit, offset } = GetTagsForWorkspaceSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,color' };
        if (offset) params.offset = offset;
        const r = await client.get(`/workspaces/${workspace_gid}/tags`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No tags found.' }] };
        let text = `Found ${data.length} tag(s):\n\n`;
        data.forEach((t: any) => { text += `${t.name}\n  GID: ${t.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_task_attachments': {
        const { parent_gid, limit, offset } = GetTaskAttachmentsSchema.parse(args);
        const params: any = { parent: parent_gid, limit, opt_fields: 'gid,name,resource_subtype,size,created_at' };
        if (offset) params.offset = offset;
        const r = await client.get('/attachments', { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No attachments found.' }] };
        let text = `Found ${data.length} attachment(s):\n\n`;
        data.forEach((a: any) => { text += `${a.name ?? 'Attachment'}\n  GID: ${a.gid}\n  Type: ${a.resource_subtype}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_task_counts_for_project': {
        const { project_gid, opt_fields } = GetTaskCountsForProjectSchema.parse(args);
        const r = await client.get(`/projects/${project_gid}/task_counts`, { params: { opt_fields } });
        const c = r.data.data;
        let text = `Task counts for project ${project_gid}:\n`;
        if (c.num_tasks !== undefined) text += `Total tasks: ${c.num_tasks}\n`;
        if (c.num_completed_tasks !== undefined) text += `Completed: ${c.num_completed_tasks}\n`;
        if (c.num_incomplete_tasks !== undefined) text += `Incomplete: ${c.num_incomplete_tasks}\n`;
        if (c.num_milestones !== undefined) text += `Milestones: ${c.num_milestones}\n`;
        if (c.num_completed_milestones !== undefined) text += `Completed milestones: ${c.num_completed_milestones}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_tasks_for_tag': {
        const { tag_gid, limit, offset } = GetTasksForTagSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,completed,assignee.name,due_on' };
        if (offset) params.offset = offset;
        const r = await client.get(`/tags/${tag_gid}/tasks`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No tasks with this tag.' }] };
        let text = `Found ${data.length} task(s):\n\n`;
        data.forEach((t: any) => { text += `${t.name}\n  GID: ${t.gid}\n  Completed: ${t.completed ? 'Yes' : 'No'}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_tasks_for_user_task_list': {
        const { user_task_list_gid, completed_since, limit, offset } = GetTasksForUserTaskListSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,completed,due_on,assignee.name' };
        if (completed_since) params.completed_since = completed_since;
        if (offset) params.offset = offset;
        const r = await client.get(`/user_task_lists/${user_task_list_gid}/tasks`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No tasks found.' }] };
        let text = `Found ${data.length} task(s):\n\n`;
        data.forEach((t: any) => { text += `${t.name}\n  GID: ${t.gid}\n  Completed: ${t.completed ? 'Yes' : 'No'}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_retrieve_tasks_for_project': {
        const { project_gid, completed_since, opt_fields, limit, offset } = RetrieveTasksForProjectSchema.parse(args);
        const params: any = { project: project_gid, limit, opt_fields: opt_fields ?? 'gid,name,completed,due_on,assignee.name' };
        if (completed_since) params.completed_since = completed_since;
        if (offset) params.offset = offset;
        const r = await client.get('/tasks', { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No tasks found.' }] };
        let text = `Found ${data.length} task(s):\n\n`;
        data.forEach((t: any) => { text += `${t.name}\n  GID: ${t.gid}\n  Completed: ${t.completed ? 'Yes' : 'No'}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_tasks_from_section': {
        const { section_gid, limit, offset } = GetTasksFromSectionSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,completed,due_on,assignee.name' };
        if (offset) params.offset = offset;
        const r = await client.get(`/sections/${section_gid}/tasks`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No tasks in this section.' }] };
        let text = `Found ${data.length} task(s):\n\n`;
        data.forEach((t: any) => { text += `${t.name}\n  GID: ${t.gid}\n  Completed: ${t.completed ? 'Yes' : 'No'}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_task_subtasks': {
        const { task_gid, limit, offset } = GetTaskSubtasksSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,completed,due_on,assignee.name' };
        if (offset) params.offset = offset;
        const r = await client.get(`/tasks/${task_gid}/subtasks`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No subtasks found.' }] };
        let text = `Found ${data.length} subtask(s):\n\n`;
        data.forEach((t: any) => { text += `${t.name}\n  GID: ${t.gid}\n  Completed: ${t.completed ? 'Yes' : 'No'}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_task_templates': {
        const { workspace, team, limit, offset } = GetTaskTemplatesSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,project.name' };
        if (workspace) params.workspace = workspace;
        if (team) params.team = team;
        if (offset) params.offset = offset;
        const r = await client.get('/task_templates', { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No task templates found.' }] };
        let text = `Found ${data.length} template(s):\n\n`;
        data.forEach((t: any) => { text += `${t.name}\n  GID: ${t.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_team': {
        const { team_gid, opt_fields } = GetTeamSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,name,description,organization.name,visibility' };
        const r = await client.get(`/teams/${team_gid}`, { params });
        const t = r.data.data;
        let text = `${t.name}\nGID: ${t.gid}\n`;
        if (t.visibility) text += `Visibility: ${t.visibility}\n`;
        if (t.organization?.name) text += `Org: ${t.organization.name}\n`;
        if (t.description) text += `\n${t.description}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_team_membership': {
        const { team_membership_gid, opt_fields } = GetTeamMembershipSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,user.name,team.name,is_admin,is_guest' };
        const r = await client.get(`/team_memberships/${team_membership_gid}`, { params });
        const m = r.data.data;
        let text = `Membership GID: ${m.gid}\nUser: ${m.user?.name}\nTeam: ${m.team?.name}\n`;
        if (m.is_admin) text += `Admin: Yes\n`;
        if (m.is_guest) text += `Guest: Yes\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_team_memberships': {
        const { team, user, workspace, limit, offset } = GetTeamMembershipsSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,user.name,team.name,is_admin' };
        if (team) params.team = team;
        if (user) params.user = user;
        if (workspace) params.workspace = workspace;
        if (offset) params.offset = offset;
        const r = await client.get('/team_memberships', { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No team memberships found.' }] };
        let text = `Found ${data.length} membership(s):\n\n`;
        data.forEach((m: any) => { text += `${m.user?.name} → ${m.team?.name}\n  GID: ${m.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_team_memberships_for_team': {
        const { team_gid, limit, offset } = GetTeamMembershipsForTeamSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,user.name,is_admin,is_guest' };
        if (offset) params.offset = offset;
        const r = await client.get(`/teams/${team_gid}/team_memberships`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No members found.' }] };
        let text = `Found ${data.length} member(s):\n\n`;
        data.forEach((m: any) => { text += `${m.user?.name}\n  GID: ${m.gid}\n  Admin: ${m.is_admin ? 'Yes' : 'No'}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_team_memberships_for_user': {
        const { user_gid, workspace, limit, offset } = GetTeamMembershipsForUserSchema.parse(args);
        const params: any = { workspace, limit, opt_fields: 'gid,team.name,is_admin' };
        if (offset) params.offset = offset;
        const r = await client.get(`/users/${user_gid}/team_memberships`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No team memberships found.' }] };
        let text = `Found ${data.length} team(s):\n\n`;
        data.forEach((m: any) => { text += `${m.team?.name}\n  Membership GID: ${m.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_teams_for_user': {
        const { user_gid, organization, limit, offset } = GetTeamsForUserSchema.parse(args);
        const params: any = { organization, limit, opt_fields: 'gid,name,visibility' };
        if (offset) params.offset = offset;
        const r = await client.get(`/users/${user_gid}/teams`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No teams found.' }] };
        let text = `Found ${data.length} team(s):\n\n`;
        data.forEach((t: any) => { text += `${t.name}\n  GID: ${t.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_teams_in_workspace': {
        const { workspace_gid, limit, offset } = GetTeamsInWorkspaceSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,visibility' };
        if (offset) params.offset = offset;
        const r = await client.get(`/workspaces/${workspace_gid}/teams`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No teams found.' }] };
        let text = `Found ${data.length} team(s):\n\n`;
        data.forEach((t: any) => { text += `${t.name}\n  GID: ${t.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_time_period': {
        const { time_period_gid, opt_fields } = GetTimePeriodSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,display_name,start_on,end_on,period,parent.display_name' };
        const r = await client.get(`/time_periods/${time_period_gid}`, { params });
        const tp = r.data.data;
        let text = `${tp.display_name}\nGID: ${tp.gid}\nPeriod: ${tp.period}\nStart: ${tp.start_on}\nEnd: ${tp.end_on}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_time_periods': {
        const { workspace, start_on, end_on, parent, limit, offset } = GetTimePeriodsSchema.parse(args);
        const params: any = { workspace, limit, opt_fields: 'gid,display_name,start_on,end_on,period' };
        if (start_on) params.start_on = start_on;
        if (end_on) params.end_on = end_on;
        if (parent) params.parent = parent;
        if (offset) params.offset = offset;
        const r = await client.get('/time_periods', { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No time periods found.' }] };
        let text = `Found ${data.length} time period(s):\n\n`;
        data.forEach((tp: any) => { text += `${tp.display_name}\n  GID: ${tp.gid}\n  ${tp.start_on} → ${tp.end_on}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_time_tracking_entries': {
        const v = GetTimeTrackingEntriesSchema.parse(args);
        const params: any = { limit: v.limit, opt_fields: 'gid,duration_minutes,entered_on,task.name,user.name' };
        if (v.workspace) params.workspace = v.workspace;
        if (v.task) params.task = v.task;
        if (v.user) params.user = v.user;
        if (v.created_by) params.created_by = v.created_by;
        if (v.started_after) params.started_after = v.started_after;
        if (v.started_before) params.started_before = v.started_before;
        if (v.offset) params.offset = v.offset;
        const r = await client.get('/time_tracking_entries', { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No time tracking entries found.' }] };
        let text = `Found ${data.length} entr(y/ies):\n\n`;
        data.forEach((e: any) => { text += `GID: ${e.gid}\n  Duration: ${e.duration_minutes} min\n  Date: ${e.entered_on}\n  Task: ${e.task?.name}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_time_tracking_entries_for_task': {
        const { task_gid, limit, offset } = GetTimeTrackingEntriesForTaskSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,duration_minutes,entered_on,user.name' };
        if (offset) params.offset = offset;
        const r = await client.get(`/tasks/${task_gid}/time_tracking_entries`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No time tracking entries found.' }] };
        let text = `Found ${data.length} entr(y/ies):\n\n`;
        data.forEach((e: any) => { text += `GID: ${e.gid}\n  Duration: ${e.duration_minutes} min\n  Date: ${e.entered_on}\n  User: ${e.user?.name}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_objects_via_typeahead': {
        const { workspace_gid, type, query, count } = GetObjectsViaTypeaheadSchema.parse(args);
        const params: any = { type };
        if (query) params.query = query;
        if (count) params.count = count;
        const r = await client.get(`/workspaces/${workspace_gid}/typeahead`, { params });
        const data = r.data.data ?? [];
        if (!data.length) return { content: [{ type: 'text', text: 'No results found.' }] };
        let text = `Found ${data.length} result(s) for type "${type}":\n\n`;
        data.forEach((obj: any) => { text += `${obj.name ?? obj.gid}\n  GID: ${obj.gid}\n\n`; });
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_user': {
        const { user_gid, opt_fields } = GetUserSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,name,email,workspaces.name,photo' };
        const r = await client.get(`/users/${user_gid}`, { params });
        const u = r.data.data;
        let text = `${u.name}\nGID: ${u.gid}\nEmail: ${u.email}\n`;
        if (u.workspaces?.length) text += `Workspaces: ${u.workspaces.map((w: any) => w.name).join(', ')}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_user_in_workspace': {
        const { user_gid, workspace_gid, opt_fields } = GetUserInWorkspaceSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,name,email' };
        const r = await client.get(`/workspaces/${workspace_gid}/users/${user_gid}`, { params });
        const u = r.data.data;
        return { content: [{ type: 'text', text: `${u.name}\nGID: ${u.gid}\nEmail: ${u.email}\n` }] };
      }
      case 'asana_get_users_for_team': {
        const { team_gid, limit, offset } = GetUsersForTeamSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,email' };
        if (offset) params.offset = offset;
        const r = await client.get(`/teams/${team_gid}/users`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No users found.' }] };
        let text = `Found ${data.length} user(s):\n\n`;
        data.forEach((u: any) => { text += `${u.name}\n  GID: ${u.gid}\n  Email: ${u.email}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_users_in_workspace': {
        const { workspace_gid, limit, offset } = GetUsersInWorkspaceSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,email' };
        if (offset) params.offset = offset;
        const r = await client.get(`/workspaces/${workspace_gid}/users`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No users found.' }] };
        let text = `Found ${data.length} user(s):\n\n`;
        data.forEach((u: any) => { text += `${u.name}\n  GID: ${u.gid}\n  Email: ${u.email}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_user_task_list_for_user': {
        const { user_gid, workspace, opt_fields } = GetUserTaskListForUserSchema.parse(args);
        const params: any = { workspace, opt_fields: opt_fields ?? 'gid,name,owner.name' };
        const r = await client.get(`/users/${user_gid}/user_task_list`, { params });
        const utl = r.data.data;
        return { content: [{ type: 'text', text: `My Tasks: ${utl.name ?? 'My Tasks'}\nGID: ${utl.gid}\nOwner: ${utl.owner?.name}\n` }] };
      }
      case 'asana_get_webhooks': {
        const { workspace, resource, limit, offset } = GetWebhooksSchema.parse(args);
        const params: any = { workspace, limit, opt_fields: 'gid,active,resource.name,target' };
        if (resource) params.resource = resource;
        if (offset) params.offset = offset;
        const r = await client.get('/webhooks', { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No webhooks found.' }] };
        let text = `Found ${data.length} webhook(s):\n\n`;
        data.forEach((w: any) => { text += `GID: ${w.gid}\n  Active: ${w.active ? 'Yes' : 'No'}\n  Resource: ${w.resource?.name}\n  Target: ${w.target}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_workspace': {
        const { workspace_gid, opt_fields } = GetWorkspaceSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,name,is_organization,email_domains' };
        const r = await client.get(`/workspaces/${workspace_gid}`, { params });
        const w = r.data.data;
        let text = `${w.name}\nGID: ${w.gid}\nType: ${w.is_organization ? 'Organization' : 'Workspace'}\n`;
        if (w.email_domains?.length) text += `Domains: ${w.email_domains.join(', ')}\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_workspace_membership': {
        const { workspace_membership_gid, opt_fields } = GetWorkspaceMembershipSchema.parse(args);
        const params: any = { opt_fields: opt_fields ?? 'gid,user.name,workspace.name,is_admin,is_guest' };
        const r = await client.get(`/workspace_memberships/${workspace_membership_gid}`, { params });
        const m = r.data.data;
        let text = `Membership GID: ${m.gid}\nUser: ${m.user?.name}\nWorkspace: ${m.workspace?.name}\n`;
        if (m.is_admin) text += `Admin: Yes\n`;
        if (m.is_guest) text += `Guest: Yes\n`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_workspace_memberships': {
        const { workspace_gid, user, limit, offset } = GetWorkspaceMembershipsSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,user.name,is_admin,is_guest' };
        if (user) params.user = user;
        if (offset) params.offset = offset;
        const r = await client.get(`/workspaces/${workspace_gid}/workspace_memberships`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No members found.' }] };
        let text = `Found ${data.length} member(s):\n\n`;
        data.forEach((m: any) => { text += `${m.user?.name}\n  GID: ${m.gid}\n  Admin: ${m.is_admin ? 'Yes' : 'No'}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_workspace_memberships_for_user': {
        const { user_gid, limit, offset } = GetWorkspaceMembershipsForUserSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,workspace.name,is_admin' };
        if (offset) params.offset = offset;
        const r = await client.get(`/users/${user_gid}/workspace_memberships`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No workspace memberships found.' }] };
        let text = `Found ${data.length} workspace(s):\n\n`;
        data.forEach((m: any) => { text += `${m.workspace?.name}\n  Membership GID: ${m.gid}\n\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_get_workspace_projects': {
        const { workspace_gid, archived, limit, offset } = GetWorkspaceProjectsSchema.parse(args);
        const params: any = { limit, opt_fields: 'gid,name,archived,owner.name,color' };
        if (archived !== undefined) params.archived = archived;
        if (offset) params.offset = offset;
        const r = await client.get(`/workspaces/${workspace_gid}/projects`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No projects found.' }] };
        let text = `Found ${data.length} project(s):\n\n`;
        data.forEach((p: any) => { text += `${p.name}\n  GID: ${p.gid}\n${p.archived ? '  [archived]\n' : ''}\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_reorder_enum_option_for_custom_field': {
        const { custom_field_gid, enum_option_gid, insert_before, insert_after } = ReorderEnumOptionSchema.parse(args);
        const body: any = { enum_option: { gid: enum_option_gid } };
        if (insert_before) body.insert_before = insert_before;
        if (insert_after) body.insert_after = insert_after;
        await client.post(`/custom_fields/${custom_field_gid}/enum_options/insert`, { data: body });
        return { content: [{ type: 'text', text: `Enum option ${enum_option_gid} reordered successfully.` }] };
      }
      case 'asana_move_section_in_project': {
        const { project_gid, section_gid, insert_before, insert_after } = MoveSectionInProjectSchema.parse(args);
        const body: any = { section: section_gid };
        if (insert_before) body.insert_before = insert_before;
        if (insert_after) body.insert_after = insert_after;
        await client.post(`/projects/${project_gid}/sections/insert`, { data: body });
        return { content: [{ type: 'text', text: `Section ${section_gid} moved successfully.` }] };
      }
      case 'asana_instantiate_project_template': {
        const { project_template_gid, name, team, public: isPublic, start_on, workspace } = InstantiateProjectTemplateSchema.parse(args);
        const body: any = { name, team: { gid: team } };
        if (isPublic !== undefined) body.public = isPublic;
        if (start_on) body.start_on = start_on;
        if (workspace) body.workspace = { gid: workspace };
        const r = await client.post(`/project_templates/${project_template_gid}/instantiateProject`, { data: body });
        return { content: [{ type: 'text', text: `Project instantiation job started.\nJob GID: ${r.data.data?.gid}` }] };
      }
      case 'asana_reject_access_request': {
        const { access_request_gid } = RejectAccessRequestSchema.parse(args);
        await client.post(`/access_requests/${access_request_gid}/reject`, { data: {} });
        return { content: [{ type: 'text', text: `Access request ${access_request_gid} rejected.` }] };
      }
      case 'asana_remove_follower_from_task': {
        const { task_gid, followers } = RemoveFollowerFromTaskSchema.parse(args);
        await client.post(`/tasks/${task_gid}/removeFollowers`, { data: { followers } });
        return { content: [{ type: 'text', text: `Followers removed from task ${task_gid}.` }] };
      }
      case 'asana_remove_followers_for_project': {
        const { project_gid, followers } = RemoveFollowersForProjectSchema.parse(args);
        await client.post(`/projects/${project_gid}/removeFollowers`, { data: { followers } });
        return { content: [{ type: 'text', text: `Followers removed from project ${project_gid}.` }] };
      }
      case 'asana_remove_item_from_portfolio': {
        const { portfolio_gid, item } = RemoveItemFromPortfolioSchema.parse(args);
        await client.post(`/portfolios/${portfolio_gid}/removeItem`, { data: { item } });
        return { content: [{ type: 'text', text: `Item ${item} removed from portfolio ${portfolio_gid}.` }] };
      }
      case 'asana_remove_members_from_project': {
        const { project_gid, members } = RemoveMembersFromProjectSchema.parse(args);
        await client.post(`/projects/${project_gid}/removeMembers`, { data: { members } });
        return { content: [{ type: 'text', text: `Members removed from project ${project_gid}.` }] };
      }
      case 'asana_remove_project_from_task': {
        const { task_gid, project } = RemoveProjectFromTaskSchema.parse(args);
        await client.post(`/tasks/${task_gid}/removeProject`, { data: { project } });
        return { content: [{ type: 'text', text: `Project ${project} removed from task ${task_gid}.` }] };
      }
      case 'asana_remove_tag_from_task': {
        const { task_gid, tag } = RemoveTagFromTaskSchema.parse(args);
        await client.post(`/tasks/${task_gid}/removeTag`, { data: { tag } });
        return { content: [{ type: 'text', text: `Tag ${tag} removed from task ${task_gid}.` }] };
      }
      case 'asana_remove_user_for_team': {
        const { team_gid, user } = RemoveUserForTeamSchema.parse(args);
        await client.post(`/teams/${team_gid}/removeUser`, { data: { user } });
        return { content: [{ type: 'text', text: `User ${user} removed from team ${team_gid}.` }] };
      }
      case 'asana_remove_user_from_workspace': {
        const { workspace_gid, user } = RemoveUserFromWorkspaceSchema.parse(args);
        await client.post(`/workspaces/${workspace_gid}/removeUser`, { data: { user } });
        return { content: [{ type: 'text', text: `User ${user} removed from workspace ${workspace_gid}.` }] };
      }
      case 'asana_search_tasks_in_workspace': {
        const v = SearchTasksInWorkspaceSchema.parse(args);
        const params: any = { limit: v.limit, opt_fields: v.opt_fields ?? 'gid,name,completed,due_on,assignee.name,projects.name' };
        if (v.text) params.text = v.text;
        if (v.resource_subtype) params.resource_subtype = v.resource_subtype;
        if (v.assignee_any?.length) params['assignee.any'] = v.assignee_any.join(',');
        if (v.completed !== undefined) params.completed = v.completed;
        if (v.is_subtask !== undefined) params.is_subtask = v.is_subtask;
        if (v.due_on_before) params.due_on_before = v.due_on_before;
        if (v.due_on_after) params.due_on_after = v.due_on_after;
        if (v.projects_any?.length) params['projects.any'] = v.projects_any.join(',');
        if (v.sort_by) params.sort_by = v.sort_by;
        if (v.sort_ascending !== undefined) params.sort_ascending = v.sort_ascending;
        if (v.offset) params.offset = v.offset;
        const r = await client.get(`/workspaces/${v.workspace_gid}/tasks/search`, { params });
        const { data, next_page } = r.data;
        if (!data?.length) return { content: [{ type: 'text', text: 'No tasks found.' }] };
        let text = `Found ${data.length} task(s):\n\n`;
        data.forEach((t: any) => { text += `${t.name}\n  GID: ${t.gid}\n  Completed: ${t.completed ? 'Yes' : 'No'}\n${t.due_on ? `  Due: ${t.due_on}\n` : ''}\n`; });
        if (next_page?.offset) text += `More results. Use offset: "${next_page.offset}"`;
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_set_parent_for_task': {
        const { task_gid, parent, insert_before, insert_after } = SetParentForTaskSchema.parse(args);
        const body: any = { parent };
        if (insert_before) body.insert_before = insert_before;
        if (insert_after) body.insert_after = insert_after;
        const r = await client.post(`/tasks/${task_gid}/setParent`, { data: body });
        return { content: [{ type: 'text', text: `Parent updated for task ${task_gid}.\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_submit_parallel_requests': {
        const { actions } = SubmitParallelRequestsSchema.parse(args);
        const r = await client.post('/batch', { data: { actions } });
        const results = r.data.data ?? [];
        let text = `Batch completed. ${results.length} result(s):\n\n`;
        results.forEach((res: any, i: number) => { text += `[${i + 1}] Status: ${res.status_code}\n${res.body ? JSON.stringify(res.body).substring(0, 200) : ''}\n\n`; });
        return { content: [{ type: 'text', text }] };
      }
      case 'asana_update_allocation': {
        const { allocation_gid, start_date, end_date, effort_per_week_minutes, assignee } = UpdateAllocationSchema.parse(args);
        const body: any = {};
        if (start_date) body.start_date = start_date;
        if (end_date) body.end_date = end_date;
        if (effort_per_week_minutes) body.effort = { type: 'effort', value: effort_per_week_minutes, unit: 'minutes' };
        if (assignee) body.assignee = { gid: assignee };
        const r = await client.put(`/allocations/${allocation_gid}`, { data: body });
        return { content: [{ type: 'text', text: `Allocation updated.\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_update_task': {
        const { task_gid, ...rest } = UpdateTaskSchema.parse(args);
        const body: any = {};
        if (rest.name !== undefined) body.name = rest.name;
        if (rest.notes !== undefined) body.notes = rest.notes;
        if (rest.html_notes !== undefined) body.html_notes = rest.html_notes;
        if (rest.assignee !== undefined) body.assignee = rest.assignee;
        if (rest.due_on !== undefined) body.due_on = rest.due_on;
        if (rest.due_at !== undefined) body.due_at = rest.due_at;
        if (rest.completed !== undefined) body.completed = rest.completed;
        if (rest.start_on !== undefined) body.start_on = rest.start_on;
        if (rest.resource_subtype !== undefined) body.resource_subtype = rest.resource_subtype;
        if (rest.liked !== undefined) body.liked = rest.liked;
        if (rest.approval_status !== undefined) body.approval_status = rest.approval_status;
        const r = await client.put(`/tasks/${task_gid}`, { data: body });
        const t = r.data.data;
        return { content: [{ type: 'text', text: `Task updated.\nName: ${t.name}\nGID: ${t.gid}` }] };
      }
      case 'asana_update_custom_field': {
        const { custom_field_gid, ...rest } = UpdateCustomFieldSchema.parse(args);
        const body: any = {};
        if (rest.name !== undefined) body.name = rest.name;
        if (rest.description !== undefined) body.description = rest.description;
        if (rest.precision !== undefined) body.precision = rest.precision;
        if (rest.enabled !== undefined) body.enabled = rest.enabled;
        const r = await client.put(`/custom_fields/${custom_field_gid}`, { data: body });
        return { content: [{ type: 'text', text: `Custom field updated.\nName: ${r.data.data?.name}\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_update_enum_option': {
        const { custom_field_gid, enum_option_gid, name, color, enabled } = UpdateEnumOptionSchema.parse(args);
        const body: any = {};
        if (name !== undefined) body.name = name;
        if (color !== undefined) body.color = color;
        if (enabled !== undefined) body.enabled = enabled;
        const r = await client.put(`/custom_fields/${custom_field_gid}/enum_options/${enum_option_gid}`, { data: body });
        return { content: [{ type: 'text', text: `Enum option updated.\nName: ${r.data.data?.name}\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_update_project': {
        const { project_gid, ...rest } = UpdateProjectSchema.parse(args);
        const body: any = {};
        if (rest.name !== undefined) body.name = rest.name;
        if (rest.notes !== undefined) body.notes = rest.notes;
        if (rest.color !== undefined) body.color = rest.color;
        if (rest.archived !== undefined) body.archived = rest.archived;
        if (rest.public !== undefined) body.public = rest.public;
        if (rest.team !== undefined) body.team = { gid: rest.team };
        if (rest.default_view !== undefined) body.default_view = rest.default_view;
        if (rest.due_on !== undefined) body.due_on = rest.due_on;
        if (rest.start_on !== undefined) body.start_on = rest.start_on;
        const r = await client.put(`/projects/${project_gid}`, { data: body });
        return { content: [{ type: 'text', text: `Project updated.\nName: ${r.data.data?.name}\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_update_project_brief': {
        const { project_brief_gid, title, text: briefText, html_text } = UpdateProjectBriefSchema.parse(args);
        const body: any = {};
        if (title !== undefined) body.title = title;
        if (briefText !== undefined) body.text = briefText;
        if (html_text !== undefined) body.html_text = html_text;
        const r = await client.put(`/project_briefs/${project_brief_gid}`, { data: body });
        return { content: [{ type: 'text', text: `Project brief updated.\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_update_section': {
        const { section_gid, name, insert_before, insert_after } = UpdateSectionSchema.parse(args);
        const body: any = {};
        if (name !== undefined) body.name = name;
        if (insert_before !== undefined) body.insert_before = insert_before;
        if (insert_after !== undefined) body.insert_after = insert_after;
        const r = await client.put(`/sections/${section_gid}`, { data: body });
        return { content: [{ type: 'text', text: `Section updated.\nName: ${r.data.data?.name}\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_update_story': {
        const { story_gid, text: storyText, html_text, is_pinned } = UpdateStorySchema.parse(args);
        const body: any = {};
        if (storyText !== undefined) body.text = storyText;
        if (html_text !== undefined) body.html_text = html_text;
        if (is_pinned !== undefined) body.is_pinned = is_pinned;
        const r = await client.put(`/stories/${story_gid}`, { data: body });
        return { content: [{ type: 'text', text: `Story updated.\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_update_tag': {
        const { tag_gid, name, color, notes } = UpdateTagSchema.parse(args);
        const body: any = {};
        if (name !== undefined) body.name = name;
        if (color !== undefined) body.color = color;
        if (notes !== undefined) body.notes = notes;
        const r = await client.put(`/tags/${tag_gid}`, { data: body });
        return { content: [{ type: 'text', text: `Tag updated.\nName: ${r.data.data?.name}\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_update_team': {
        const { team_gid, name, description, html_description, visibility } = UpdateTeamSchema.parse(args);
        const body: any = {};
        if (name !== undefined) body.name = name;
        if (description !== undefined) body.description = description;
        if (html_description !== undefined) body.html_description = html_description;
        if (visibility !== undefined) body.visibility = visibility;
        const r = await client.put(`/teams/${team_gid}`, { data: body });
        return { content: [{ type: 'text', text: `Team updated.\nName: ${r.data.data?.name}\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_update_user_for_workspace': {
        const { user_gid, workspace_gid, custom_fields } = UpdateUserForWorkspaceSchema.parse(args);
        const body: any = {};
        if (custom_fields !== undefined) body.custom_fields = custom_fields;
        const r = await client.put(`/workspaces/${workspace_gid}/users/${user_gid}`, { data: body });
        return { content: [{ type: 'text', text: `User updated.\nGID: ${r.data.data?.gid}` }] };
      }
      case 'asana_update_webhook': {
        const { webhook_gid, filters } = UpdateWebhookSchema.parse(args);
        const body: any = {};
        if (filters !== undefined) body.filters = filters;
        const r = await client.put(`/webhooks/${webhook_gid}`, { data: body });
        return { content: [{ type: 'text', text: `Webhook updated.\nGID: ${r.data.data?.gid}` }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (error: any) {
    const message =
      error.response?.data?.errors?.[0]?.message ?? error.response?.data?.message ?? error.message;
    return { content: [{ type: 'text', text: `Error: ${message}` }] };
  }
}

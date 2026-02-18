import { Button, Tabs, TabsList, TabsTrigger, TabsContent } from "../ui";
import { cn } from "~/lib/utils";
import { Gmail } from "../icons/gmail";
import { GoogleCalendar } from "../icons/google-calendar";
import { GoogleSheets } from "../icons/google-sheets";
import { LinearIcon } from "../icons/linear-icon";
import { RiGithubFill, RiLinkedinFill } from "@remixicon/react";

interface UseCase {
  icon: any;
  title: string;
  prompt: string;
  category: string;
}

const useCases: UseCase[] = [
  // GitHub Integration
  {
    icon: RiGithubFill,
    title: "Weekly Commit Summary",
    prompt:
      "Get all my GitHub commits from the past 7 days, from repo [add repo link], create a standup-ready summary, and save to CORE memory",
    category: "GitHub",
  },
  {
    icon: RiGithubFill,
    title: "Pending PR Reviews",
    prompt:
      "Find the 3 oldest GitHub pull requests waiting for my review and summarize the changes",
    category: "GitHub",
  },
  {
    icon: RiGithubFill,
    title: "My Project Board Status",
    prompt: "Get all issues from my GitHub project board",
    category: "GitHub",
  },
  {
    icon: RiGithubFill,
    title: "My Open Issues",
    prompt:
      "Show all GitHub issues from repo [add repo link] I created in the last 30 days that are still open, organized by priority",
    category: "GitHub",
  },
  {
    icon: RiGithubFill,
    title: "Bug Triage Helper",
    prompt:
      "Find all issues labeled 'bug' in [repository] created in the last 7 days, prioritize by severity",
    category: "GitHub",
  },
  {
    icon: RiGithubFill,
    title: "Create Issue from Context",
    prompt:
      "Create a new GitHub issue in [repository] with title '[Title]', description based on our conversation, and label it 'enhancement'",
    category: "GitHub",
  },
  // Gmail Integration
  {
    icon: Gmail,
    title: "Learn My Writing Style",
    prompt:
      "Search my last 10 sent emails, analyze patterns in tone, structure, and phrasing, then create a detailed writing style guide and store it in CORE memory",
    category: "Gmail",
  },
  {
    icon: Gmail,
    title: "Daily Email Digest",
    prompt:
      "Find all unread emails from today, group them by sender importance, and create a prioritized summary with action items",
    category: "Gmail",
  },
  {
    icon: Gmail,
    title: "Quick Email Test",
    prompt:
      "Send a test email to myself with subject 'Testing CORE Gmail Integration' and body 'Successfully connected CORE to Gmail. Integration working!'",
    category: "Gmail",
  },
  {
    icon: Gmail,
    title: "Find Important Threads",
    prompt:
      "Search my Gmail for email threads with [contact name/company] from the last 30 days and summarize key decisions",
    category: "Gmail",
  },
  {
    icon: Gmail,
    title: "Draft Response from Context",
    prompt:
      "Read the email thread from [sender], understand the context, and draft a professional response based on my writing style",
    category: "Gmail",
  },
  {
    icon: Gmail,
    title: "Invoice Tracker",
    prompt:
      "Search my Gmail for all emails with PDF attachments containing 'invoice' from the last 3 months and create a new spreadsheet naming Invoice having Date, Invoice details, Amount",
    category: "Gmail",
  },
  // Google Calendar Integration
  {
    icon: GoogleCalendar,
    title: "Deep Work Block",
    prompt:
      "Check my calendar for tomorrow morning, find the first available 2-hour slot before noon, and create an event titled 'Deep Work - No Interruptions'",
    category: "Google Calendar",
  },
  {
    icon: GoogleCalendar,
    title: "This Week's Calendar",
    prompt:
      "Show all my scheduled events for the next 7 days in chronological order with meeting titles, times, and participants",
    category: "Google Calendar",
  },
  {
    icon: GoogleCalendar,
    title: "Meeting Prep Summary",
    prompt:
      "Show my next 3 meetings today with attendees and agendas, then search CORE memory for relevant context about each participant",
    category: "Google Calendar",
  },
  {
    icon: GoogleCalendar,
    title: "Weekly Time Audit",
    prompt:
      "Analyze my calendar for the past week, categorize meetings by type (1:1s, standups, deep work, etc.), and show time distribution",
    category: "Google Calendar",
  },
  // Google Sheets Integration
  {
    icon: GoogleSheets,
    title: "Spreadsheet Insights",
    prompt:
      "Open my most recent spreadsheet [add spreadsheet link], analyze the data trends, identify key patterns, and provide actionable insights with visualizations",
    category: "Google Sheets",
  },
  {
    icon: GoogleSheets,
    title: "Top tech news to sheet",
    prompt:
      "Find top 3 tech news from today about [topic] and add to my Google Sheet [sheet link] with title link and summary",
    category: "Google Sheets",
  },
  // Linear Integration
  {
    icon: LinearIcon,
    title: "My Linear Tasks",
    prompt:
      "Retrieve all Linear issues assigned to me across all teams, filter by status, and create a prioritized task list with due dates",
    category: "Linear",
  },
  {
    icon: LinearIcon,
    title: "Sprint Planning View",
    prompt:
      "Get all Linear issues in current sprint across my teams, group by priority, and show completion percentage",
    category: "Linear",
  },
  {
    icon: LinearIcon,
    title: "Create Task from Chat",
    prompt:
      "Create a new Linear issue in [Team] with title '[Title]', assign to me, set priority to High, and add it to current cycle",
    category: "Linear",
  },
  {
    icon: LinearIcon,
    title: "Blocked Issues Alert",
    prompt:
      "Find all Linear issues assigned to me with status 'Blocked', list the blockers, and prioritize by impact",
    category: "Linear",
  },
  {
    icon: LinearIcon,
    title: "Backlog Review",
    prompt:
      "Show my Linear backlog items that haven't been updated in 30+ days, ranked by original priority",
    category: "Linear",
  },
  {
    icon: LinearIcon,
    title: "Team Workload Check",
    prompt:
      "Get all active Linear issues for [Team name], group by assignee, and show workload distribution",
    category: "Linear",
  },
  // LinkedIn Integration
  {
    icon: RiLinkedinFill,
    title: "Post Professional Update",
    prompt:
      "Post a LinkedIn update about [Topic] based on our conversation, and ask for engagement",
    category: "LinkedIn",
  },
  {
    icon: RiLinkedinFill,
    title: "Fetch My Profile",
    prompt:
      "Get my LinkedIn profile information and summarize my professional background",
    category: "LinkedIn",
  },
];

const categories = [
  {
    category: "GitHub",
    icon: RiGithubFill,
  },
  {
    category: "Gmail",
    icon: Gmail,
  },
  {
    category: "Google Calendar",
    icon: GoogleCalendar,
  },
  {
    category: "Google Sheets",
    icon: GoogleSheets,
  },
  {
    category: "Linear",
    icon: LinearIcon,
  },
  {
    category: "LinkedIn",
    icon: RiLinkedinFill,
  },
];

interface ExampleUseCasesProps {
  onSelectPrompt: (prompt: string) => void;
}

export const ExampleUseCases = ({ onSelectPrompt }: ExampleUseCasesProps) => {
  return (
    <div className="flex w-full max-w-[90ch] flex-col items-center justify-center pb-8">
      <Tabs defaultValue={categories[0].category} className="w-full">
        <TabsList className="mb-2 h-10 gap-2">
          {categories.map((category) => {
            const Icon = category.icon;

            return (
              <TabsTrigger
                key={category.category}
                value={category.category}
                className="flex h-8 gap-2"
              >
                <Icon className="h-5 w-5" />
                {category.category}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {categories.map((category) => (
          <TabsContent key={category.category} value={category.category}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {useCases
                .filter((useCase) => useCase.category === category.category)
                .map((useCase, index) => {
                  return (
                    <div
                      key={index}
                      className={cn(
                        "group hover:bg-background-3/80 relative flex flex-col rounded-xl bg-white p-4 transition-all",
                      )}
                    >
                      <h3 className="mb-4 text-base">{useCase.title}</h3>
                      <div className="mt-auto flex justify-end">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => onSelectPrompt(useCase.prompt)}
                        >
                          Try Prompt
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

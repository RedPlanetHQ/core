import { Mail, Calendar, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "../ui";
import { cn } from "~/lib/utils";
import { Gmail } from "../icons/gmail";
import { GoogleCalendar } from "../icons/google-calendar";
import { GoogleSheets } from "../icons/google-sheets";
import { GoogleDocs } from "../icons/google-docs";

interface UseCase {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  prompt: string;
}

const useCases: UseCase[] = [
  {
    icon: Gmail,
    title: "Summarize today's emails",
    prompt: "Summarize all the important emails I received today",
  },
  {
    icon: Gmail,
    title: "Draft a quick email",
    prompt: "Help me draft a professional email response",
  },
  {
    icon: GoogleCalendar,
    title: "Schedule a meeting",
    prompt: "Find a good time to schedule a team meeting this week",
  },
  {
    icon: GoogleSheets,
    title: "Analyze spreadsheet data",
    prompt: "Analyze the data in my latest spreadsheet and provide insights",
  },
  {
    icon: GoogleDocs,
    title: "Create a document outline",
    prompt: "Create an outline for a project proposal document",
  },
  {
    icon: GoogleCalendar,
    title: "Review upcoming events",
    prompt: "Show me my upcoming events for the next 7 days",
  },
];

interface ExampleUseCasesProps {
  onSelectPrompt: (prompt: string) => void;
}

export const ExampleUseCases = ({ onSelectPrompt }: ExampleUseCasesProps) => {
  return (
    <div className="w-full max-w-[90ch] pb-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {useCases.map((useCase, index) => {
          const Icon = useCase.icon;
          return (
            <div
              key={index}
              className={cn(
                "group relative flex flex-col rounded-xl border border-gray-200 bg-white p-4 transition-all hover:shadow-md",
                "dark:border-gray-700 dark:bg-gray-800",
              )}
            >
              <div className="mb-4 flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
                <Icon className="h-6 w-6 text-gray-700 dark:text-gray-300" />
              </div>
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
    </div>
  );
};

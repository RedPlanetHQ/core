import { Bell } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";

export default function Reminders() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Reminders" />

      <div className="flex h-[calc(100vh)] w-full flex-col items-center justify-center p-4 md:h-[calc(100vh_-_56px)]">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="bg-primary/10 mb-4 flex h-12 w-12 items-center justify-center rounded-full">
            <Bell className="text-primary h-6 w-6" />
          </div>
          <h2 className="mb-2 text-xl font-semibold">Coming Soon</h2>
          <p className="text-muted-foreground max-w-md">
            Set up intelligent reminders that your agent will deliver at the right time through your preferred channel.
          </p>
        </div>
      </div>
    </div>
  );
}

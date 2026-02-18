import { LayoutGrid } from "lucide-react";
import { CustomMcpCard, type McpIntegration } from "./custom-mcp-card";

interface CustomMcpGridProps {
  integrations: McpIntegration[];
  onDelete: () => void;
}

export function CustomMcpGrid({ integrations, onDelete }: CustomMcpGridProps) {
  if (integrations.length === 0) {
    return (
      <div className="mt-8 flex flex-col items-center justify-center">
        <LayoutGrid className="text-muted-foreground mb-2 h-6 w-6" />
        <h3 className="text-muted-foreground text-sm">
          No custom integrations configured
        </h3>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {integrations.map((integration, index) => (
        <CustomMcpCard
          key={index}
          integration={integration}
          index={index}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

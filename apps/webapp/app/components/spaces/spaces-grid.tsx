import { LayoutGrid } from "lucide-react";
import { SpaceCard } from "./space-card";

interface SpacesGridProps {
  spaces: Array<{
    id: string;
    name: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
    autoMode: boolean;
    statementCount: number | null;
    summary: string | null;
    themes?: string[];
  }>;
}

export function SpacesGrid({ spaces }: SpacesGridProps) {
  if (spaces.length === 0) {
    return (
      <div className="mt-20 flex flex-col items-center justify-center">
        <LayoutGrid className="text-muted-foreground mb-2 h-10 w-10" />
        <h3 className="text-lg">No spaces found</h3>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {spaces.map((space) => (
        <SpaceCard key={space.id} space={space} />
      ))}
    </div>
  );
}

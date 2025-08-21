import { useState } from "react";
import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { useLoaderData } from "@remix-run/react";
import { requireUserId } from "~/services/session.server";
import { SpaceService } from "~/services/space.server";
import { SpaceFactsFilters } from "~/components/spaces/space-facts-filters";
import { SpaceFactsList } from "~/components/spaces/space-facts-list";

import type { StatementNode } from "@core/types";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const spaceService = new SpaceService();

  const spaceId = params.spaceId as string;
  const space = await spaceService.getSpace(spaceId, userId);
  const statements = await spaceService.getSpaceStatements(spaceId, userId);

  return {
    space,
    statements: statements || [],
  };
}

export default function Facts() {
  const { statements } = useLoaderData<typeof loader>();
  const [selectedValidDate, setSelectedValidDate] = useState<
    string | undefined
  >();
  const [selectedSpaceFilter, setSelectedSpaceFilter] = useState<
    string | undefined
  >();

  // Filter statements based on selected filters
  const filteredStatements = statements.filter((statement) => {
    // Date filter
    if (selectedValidDate) {
      const now = new Date();
      const statementDate = new Date(statement.validAt);

      switch (selectedValidDate) {
        case "last_week":
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          if (statementDate < weekAgo) return false;
          break;
        case "last_month":
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          if (statementDate < monthAgo) return false;
          break;
        case "last_6_months":
          const sixMonthsAgo = new Date(
            now.getTime() - 180 * 24 * 60 * 60 * 1000,
          );
          if (statementDate < sixMonthsAgo) return false;
          break;
      }
    }

    // Status filter
    if (selectedSpaceFilter) {
      switch (selectedSpaceFilter) {
        case "active":
          if (statement.invalidAt) return false;
          break;
        case "archived":
          if (!statement.invalidAt) return false;
          break;
        case "all":
        default:
          break;
      }
    }

    return true;
  });

  const loadMore = () => {
    // TODO: Implement pagination
  };

  return (
    <div className="flex h-full w-full flex-col pt-5">
      <SpaceFactsFilters
        selectedValidDate={selectedValidDate}
        selectedSpaceFilter={selectedSpaceFilter}
        onValidDateChange={setSelectedValidDate}
        onSpaceFilterChange={setSelectedSpaceFilter}
      />

      <div className="flex h-[calc(100vh_-_140px)] w-full">
        <SpaceFactsList
          facts={filteredStatements}
          hasMore={false} // TODO: Implement real pagination
          loadMore={loadMore}
          isLoading={false}
        />
      </div>
    </div>
  );
}

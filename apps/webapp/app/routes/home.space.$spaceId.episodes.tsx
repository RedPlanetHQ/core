import { useState } from "react";
import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { useLoaderData } from "@remix-run/react";
import { requireUserId } from "~/services/session.server";
import { SpaceService } from "~/services/space.server";
import { SpaceEpisodesFilters } from "~/components/spaces/space-episode-filters";
import { SpaceEpisodesList } from "~/components/spaces/space-episodes-list";

import { ClientOnly } from "remix-utils/client-only";
import { LoaderCircle } from "lucide-react";
import { getLogByEpisode } from "~/services/ingestionLogs.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const spaceService = new SpaceService();

  const spaceId = params.spaceId as string;
  const space = await spaceService.getSpace(spaceId, userId);
  const episodes = await spaceService.getSpaceEpisodes(spaceId, userId);

  const episodesWithLogData = await Promise.all(
    episodes.map(async (ep) => {
      const log = await getLogByEpisode(ep.uuid);

      return {
        ...ep,
        logId: log?.id,
      };
    }),
  );

  return {
    space,
    episodes: episodesWithLogData || [],
  };
}

export default function Episodes() {
  const { episodes, space } = useLoaderData<typeof loader>();
  const [selectedValidDate, setSelectedValidDate] = useState<
    string | undefined
  >();
  const [selectedSpaceFilter, setSelectedSpaceFilter] = useState<
    string | undefined
  >();

  // Filter episodes based on selected filters
  const filteredEpisodes = episodes.filter((episode) => {
    // Date filter
    if (selectedValidDate) {
      const now = new Date();
      const episodeDate = new Date(episode.createdAt);

      switch (selectedValidDate) {
        case "last_week":
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          if (episodeDate < weekAgo) return false;
          break;
        case "last_month":
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          if (episodeDate < monthAgo) return false;
          break;
        case "last_6_months":
          const sixMonthsAgo = new Date(
            now.getTime() - 180 * 24 * 60 * 60 * 1000,
          );
          if (episodeDate < sixMonthsAgo) return false;
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
      <div className="mb-2 flex w-full items-center justify-start gap-2 px-5">
        <SpaceEpisodesFilters
          selectedValidDate={selectedValidDate}
          selectedSpaceFilter={selectedSpaceFilter}
          onValidDateChange={setSelectedValidDate}
          onSpaceFilterChange={setSelectedSpaceFilter}
        />
      </div>

      <div className="flex h-[calc(100vh_-_56px)] w-full">
        <ClientOnly
          fallback={<LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
        >
          {() => (
            <SpaceEpisodesList
              episodes={filteredEpisodes}
              hasMore={false} // TODO: Implement real pagination
              loadMore={loadMore}
              isLoading={false}
              spaceId={space.id as string}
            />
          )}
        </ClientOnly>
      </div>
    </div>
  );
}

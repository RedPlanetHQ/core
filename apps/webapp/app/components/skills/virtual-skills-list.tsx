import { useEffect, useRef } from "react";
import {
  InfiniteLoader,
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  type Index,
  type ListRowProps,
} from "react-virtualized";
import { type SkillItem } from "~/hooks/use-skills";
import { ScrollManagedList } from "../virtualized-list";
import { SkillCard } from "./skill-card";
import { LoaderCircle } from "lucide-react";

interface VirtualSkillsListProps {
  skills: SkillItem[];
  hasMore: boolean;
  loadMore: () => void;
  isLoading: boolean;
}

function SkillItemRenderer(
  props: ListRowProps,
  skills: SkillItem[],
  cache: CellMeasurerCache,
) {
  const { index, key, style, parent } = props;
  const skill = skills[index];

  if (!skill) {
    return (
      <CellMeasurer
        key={key}
        cache={cache}
        columnIndex={0}
        parent={parent}
        rowIndex={index}
      >
        <div key={key} style={style} className="p-4">
          <div className="h-24 animate-pulse rounded bg-gray-200" />
        </div>
      </CellMeasurer>
    );
  }

  return (
    <CellMeasurer
      key={key}
      cache={cache}
      columnIndex={0}
      parent={parent}
      rowIndex={index}
    >
      <div key={key} style={style}>
        <div className="group mx-2 flex cursor-default gap-2">
          <SkillCard skill={skill} />
        </div>
      </div>
    </CellMeasurer>
  );
}

export function VirtualSkillsList({
  skills,
  hasMore,
  loadMore,
  isLoading,
}: VirtualSkillsListProps) {
  const cacheRef = useRef<CellMeasurerCache | null>(null);
  if (!cacheRef.current) {
    cacheRef.current = new CellMeasurerCache({
      defaultHeight: 100,
      fixedWidth: true,
    });
  }
  const cache = cacheRef.current;

  useEffect(() => {
    cache.clearAll();
  }, [skills, cache]);

  const isRowLoaded = ({ index }: { index: number }) => {
    return !!skills[index];
  };

  const loadMoreRows = async () => {
    if (hasMore) {
      return loadMore();
    }
    return false;
  };

  const rowRenderer = (props: ListRowProps) => {
    return SkillItemRenderer(props, skills, cache);
  };

  const rowHeight = ({ index }: Index) => {
    return cache.getHeight(index, 0);
  };

  const itemCount = hasMore ? (skills?.length ?? 0) + 1 : (skills?.length ?? 0);

  return (
    <div className="h-full grow overflow-hidden rounded-lg">
      <AutoSizer className="h-full">
        {({ width, height: autoHeight }) => (
          <InfiniteLoader
            isRowLoaded={isRowLoaded}
            loadMoreRows={loadMoreRows}
            rowCount={itemCount}
            threshold={5}
          >
            {({ onRowsRendered, registerChild }) => (
              <ScrollManagedList
                ref={registerChild}
                className="h-auto overflow-auto"
                height={autoHeight}
                width={width}
                rowCount={itemCount}
                rowHeight={rowHeight}
                onRowsRendered={onRowsRendered}
                rowRenderer={rowRenderer}
                deferredMeasurementCache={cache}
                overscanRowCount={10}
                listId="skills-list"
                onScroll={() => {}}
              />
            )}
          </InfiniteLoader>
        )}
      </AutoSizer>

      {isLoading && (
        <div className="text-muted-foreground p-4 text-center text-sm">
          <LoaderCircle size={18} className="mr-1 animate-spin" />
        </div>
      )}
    </div>
  );
}

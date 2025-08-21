import { useEffect, useRef, useState } from "react";
import {
  InfiniteLoader,
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  type Index,
  type ListRowProps,
} from "react-virtualized";
import { Database } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import type { StatementNode } from "@core/types";
import { ScrollManagedList } from "../virtualized-list";
import { SpaceFactCard } from "./space-fact-card";

interface SpaceFactsListProps {
  facts: any[];
  hasMore: boolean;
  loadMore: () => void;
  isLoading: boolean;
  height?: number;
}

function FactItemRenderer(
  props: ListRowProps,
  facts: StatementNode[],
  cache: CellMeasurerCache,
) {
  const { index, key, style, parent } = props;
  const fact = facts[index];

  return (
    <CellMeasurer
      key={key}
      cache={cache}
      columnIndex={0}
      parent={parent}
      rowIndex={index}
    >
      <div key={key} style={style} className="pb-2">
        <SpaceFactCard fact={fact} />
      </div>
    </CellMeasurer>
  );
}

export function SpaceFactsList({
  facts,
  hasMore,
  loadMore,
  isLoading,
}: SpaceFactsListProps) {
  // Create a CellMeasurerCache instance using useRef to prevent recreation
  const cacheRef = useRef<CellMeasurerCache | null>(null);
  if (!cacheRef.current) {
    cacheRef.current = new CellMeasurerCache({
      defaultHeight: 200, // Default row height for fact cards
      fixedWidth: true, // Rows have fixed width but dynamic height
    });
  }
  const cache = cacheRef.current;

  useEffect(() => {
    cache.clearAll();
  }, [facts, cache]);

  if (facts.length === 0 && !isLoading) {
    return (
      <Card className="bg-background-2 w-full">
        <CardContent className="bg-background-2 flex w-full items-center justify-center py-16">
          <div className="text-center">
            <Database className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
            <h3 className="mb-2 text-lg font-semibold">No facts found</h3>
            <p className="text-muted-foreground">
              This space doesn't contain any facts yet.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isRowLoaded = ({ index }: { index: number }) => {
    return !!facts[index];
  };

  const loadMoreRows = async () => {
    if (hasMore) {
      return loadMore();
    }
    return false;
  };

  const rowRenderer = (props: ListRowProps) => {
    return FactItemRenderer(props, facts, cache);
  };

  const rowHeight = ({ index }: Index) => {
    return cache.getHeight(index, 0);
  };

  const itemCount = hasMore ? facts.length + 1 : facts.length;

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
              />
            )}
          </InfiniteLoader>
        )}
      </AutoSizer>

      {isLoading && (
        <div className="text-muted-foreground p-4 text-center text-sm">
          Loading more facts...
        </div>
      )}
    </div>
  );
}

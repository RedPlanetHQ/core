import { useEffect, useRef } from "react";
import {
  InfiniteLoader,
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  type Index,
  type ListRowProps,
} from "react-virtualized";
import { type LogItem } from "~/hooks/use-logs";
import { ScrollManagedList } from "../virtualized-list";
import { LogTextCollapse } from "./log-text-collapse";

interface VirtualLogsListProps {
  logs: LogItem[];
  hasMore: boolean;
  loadMore: () => void;
  isLoading: boolean;
  height?: number;
}

function LogItemRenderer(
  props: ListRowProps,
  logs: LogItem[],
  cache: CellMeasurerCache,
) {
  const { index, key, style, parent } = props;
  const log = logs[index];

  if (!log) {
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
          <LogTextCollapse
            text={log.ingestText}
            error={log.error}
            logData={log.data}
            log={log}
            id={log.id}
          />
        </div>
      </div>
    </CellMeasurer>
  );
}

export function VirtualLogsList({
  logs,
  hasMore,
  loadMore,
  isLoading,
}: VirtualLogsListProps) {
  // Create a CellMeasurerCache instance using useRef to prevent recreation
  const cacheRef = useRef<CellMeasurerCache | null>(null);
  if (!cacheRef.current) {
    cacheRef.current = new CellMeasurerCache({
      defaultHeight: 120, // Default row height
      fixedWidth: true, // Rows have fixed width but dynamic height
    });
  }
  const cache = cacheRef.current;

  useEffect(() => {
    cache.clearAll();
  }, [logs, cache]);

  const isRowLoaded = ({ index }: { index: number }) => {
    return !!logs[index];
  };

  const loadMoreRows = async () => {
    if (hasMore) {
      return loadMore();
    }

    return false;
  };

  const rowRenderer = (props: ListRowProps) => {
    return LogItemRenderer(props, logs, cache);
  };

  const rowHeight = ({ index }: Index) => {
    return cache.getHeight(index, 0);
  };

  const itemCount = hasMore ? logs.length + 1 : logs.length;

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
          Loading more logs...
        </div>
      )}
    </div>
  );
}

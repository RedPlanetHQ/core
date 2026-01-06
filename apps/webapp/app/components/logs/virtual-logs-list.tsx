import { useEffect, useRef } from "react";
import {
  InfiniteLoader,
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  type Index,
  type ListRowProps,
} from "react-virtualized";
import { type DocumentItem } from "~/hooks/use-documents";
import { ScrollManagedList } from "../virtualized-list";
import { LogTextCollapse } from "./log-text-collapse";
import { LoaderCircle } from "lucide-react";
import { type Label } from "./label-dropdown";

interface VirtualLogsListProps {
  documents: DocumentItem[];
  hasMore: boolean;
  loadMore: () => void;
  isLoading: boolean;
  height?: number;
  reset?: () => void;
  labels: Label[];
}

function DocumentItemRenderer(
  props: ListRowProps,
  documents: DocumentItem[],
  cache: CellMeasurerCache,
  labels: Label[],
) {
  const { index, key, style, parent } = props;
  const document = documents[index];

  if (!document) {
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
            text={document.content}
            error={document.error}
            document={document}
            id={document.id}
            labels={labels}
          />
        </div>
      </div>
    </CellMeasurer>
  );
}

export function VirtualLogsList({
  documents,
  hasMore,
  loadMore,
  isLoading,
  labels,
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
  }, [documents, cache]);

  const isRowLoaded = ({ index }: { index: number }) => {
    return !!documents[index];
  };

  const loadMoreRows = async () => {
    if (hasMore) {
      return loadMore();
    }

    return false;
  };

  const rowRenderer = (props: ListRowProps) => {
    return DocumentItemRenderer(props, documents, cache, labels);
  };

  const rowHeight = ({ index }: Index) => {
    return cache.getHeight(index, 0);
  };

  const itemCount = hasMore ? (documents?.length ?? 0) + 1 : (documents?.length ?? 0);

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
          <LoaderCircle size={18} className="mr-1 animate-spin" />
        </div>
      )}
    </div>
  );
}

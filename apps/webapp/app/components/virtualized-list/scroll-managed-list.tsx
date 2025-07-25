import React from "react";
import { List, type ListProps } from "react-virtualized";

interface ScrollManagedListProps extends ListProps {
  listId: string;
  onScroll: ({ scrollTop }: { scrollTop: number }) => void;
}

export const ScrollManagedList = React.forwardRef<List, ScrollManagedListProps>(
  ({ listId, ...listProps }) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [scrollTop, setScrollTop] = React.useState(
      sessionStorage.getItem(`list-${listId}-scroll`),
    );

    const handleScroll = React.useCallback(
      ({ scrollTop }: { scrollTop: number }) => {
        setScrollTop(scrollTop.toString());
        sessionStorage.setItem(`list-${listId}-scroll`, scrollTop.toString());
        if (listProps.onScroll) {
          listProps.onScroll({ scrollTop });
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [listId, listProps.onScroll],
    );

    return (
      <List
        {...listProps}
        height={listProps.height}
        rowHeight={listProps.rowHeight}
        rowCount={listProps.rowCount}
        width={listProps.width}
        rowRenderer={listProps.rowRenderer}
        scrollTop={parseInt(scrollTop as string, 10)}
        onScroll={handleScroll}
      />
    );
  },
);

ScrollManagedList.displayName = "ScrollManagedList";

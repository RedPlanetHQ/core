import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useNavigate } from "@remix-run/react";
import { useRef } from "react";
import { Tag, Plus, FileText } from "lucide-react";
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  List,
  type ListRowProps,
} from "react-virtualized";
import { PageHeader } from "~/components/common/page-header";
import { withOpacity } from "~/lib/color-utils";
import { LabelService } from "~/services/label.server";
import { getWorkspaceId, requireUser } from "~/services/session.server";
import { cn } from "~/lib/utils";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = await getWorkspaceId(
    request,
    user?.id as string,
    user.workspaceId,
  );
  const labelService = new LabelService();

  try {
    const labels = await labelService.getWorkspaceLabelsWithCounts(
      workspaceId as string,
    );
    return json({ labels });
  } catch (e) {
    return json({ labels: [] });
  }
}

interface LabelItem {
  id: string;
  name: string;
  description: string | null;
  color: string;
  documentCount: number;
}

function LabelRowRenderer(
  props: ListRowProps,
  labels: LabelItem[],
  cache: CellMeasurerCache,
) {
  const { index, key, style, parent } = props;
  const label = labels[index];

  if (!label) {
    return (
      <CellMeasurer
        key={key}
        cache={cache}
        columnIndex={0}
        parent={parent}
        rowIndex={index}
      >
        <div key={key} style={style} className="p-2">
          <div className="h-16 animate-pulse rounded bg-gray-200" />
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
      <div key={key} style={style} className="px-2 py-1">
        <Link
          to={`/home/labels/${label.id}`}
          className={cn(
            "group flex items-start gap-3 rounded-lg border border-gray-300 p-3",
            "bg-background-3 hover:bg-background-3/50 transition-all",
          )}
        >
          {/* Tag Icon */}
          <div
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded"
            style={{ backgroundColor: withOpacity(label.color, 0.12) }}
          >
            <Tag size={16} style={{ color: label.color }} />
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="truncate font-medium">{label.name}</h3>
              <div className="text-muted-foreground flex shrink-0 items-center gap-1">
                <FileText size={16} />
                <span>{label.documentCount}</span>
              </div>
            </div>
            {label.description && (
              <p className="text-muted-foreground mt-0.5 line-clamp-1 text-sm">
                {label.description}
              </p>
            )}
          </div>
        </Link>
      </div>
    </CellMeasurer>
  );
}

export default function LabelsIndex() {
  const { labels } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const cacheRef = useRef<CellMeasurerCache | null>(null);
  if (!cacheRef.current) {
    cacheRef.current = new CellMeasurerCache({
      defaultHeight: 72,
      fixedWidth: true,
    });
  }
  const cache = cacheRef.current;

  const rowRenderer = (props: ListRowProps) => {
    return LabelRowRenderer(props, labels, cache);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Labels"
        actions={[
          {
            label: "New label",
            icon: <Plus size={14} />,
            onClick: () => navigate("/settings/labels"),
            variant: "secondary",
          },
        ]}
      />

      <div className="flex h-[calc(100vh)] w-full flex-col p-2 md:h-[calc(100vh_-_56px)]">
        {labels.length === 0 ? (
          <div className="mt-20 flex flex-col items-center justify-center">
            <Tag className="text-muted-foreground mb-2 h-6 w-6" />
            <h3 className="text-lg">No labels found</h3>
            <p className="text-muted-foreground text-sm">
              Create labels to organize your documents
            </p>
          </div>
        ) : (
          <div className="h-full grow overflow-hidden rounded-lg">
            <AutoSizer className="h-full">
              {({ width, height }) => (
                <List
                  className="h-auto overflow-auto"
                  height={height}
                  width={width}
                  rowCount={labels.length}
                  rowHeight={({ index }) => cache.getHeight(index, 0)}
                  rowRenderer={rowRenderer}
                  deferredMeasurementCache={cache}
                  overscanRowCount={5}
                />
              )}
            </AutoSizer>
          </div>
        )}
      </div>
    </div>
  );
}

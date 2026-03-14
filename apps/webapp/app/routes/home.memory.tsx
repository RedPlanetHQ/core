import { Outlet, useLocation, useNavigate, useParams } from "@remix-run/react";
import { Download, Plus } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { LogOptions } from "~/components/logs/log-options";

export default function MemoryLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const isGraph = location.pathname.includes("/home/memory/graph");
  const isDocuments = location.pathname.includes("/home/memory/documents");
  const isLabels = location.pathname.includes("/home/memory/labels");
  const params = useParams();

  const tabs = [
    {
      label: "Memory graph",
      value: "graph",
      isActive: isGraph,
      onClick: () => navigate("/home/memory/graph"),
    },
    {
      label: "Documents",
      value: "documents",
      isActive: isDocuments,
      onClick: () => navigate("/home/memory/documents"),
    },
    {
      label: "Labels",
      value: "labels",
      isActive: isLabels,
      onClick: () => navigate("/home/memory/labels"),
    },
  ];

  const actions = isDocuments
    ? [
        {
          label: "Export",
          icon: <Download size={14} />,
          onClick: () => {
            window.location.href = "/api/v1/documents/export";
          },
          variant: "secondary" as const,
        },
      ]
    : isLabels && location.pathname === "/home/memory/labels"
      ? [
          {
            label: "New label",
            icon: <Plus size={14} />,
            onClick: () => navigate("/settings/labels"),
            variant: "secondary" as const,
          },
        ]
      : [];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Memory"
        tabs={tabs}
        actions={actions}
        actionsNode={
          <>
            {isDocuments && params.episodeId && (
              <LogOptions id={params.episodeId} />
            )}
          </>
        }
      />
      <div className="flex h-full flex-col">
        <Outlet />
      </div>
    </div>
  );
}

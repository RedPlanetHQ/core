import {
  Outlet,
  useParams,
  useRouteLoaderData,
  useMatches,
  useNavigate,
  useFetcher,
} from "@remix-run/react";
import React, { useState } from "react";
import {
  Trash2,
  EyeOff,
  SquarePen,
  PanelLeft,
  PanelLeftClose,
  ArrowLeft,
  Clock,
} from "lucide-react";
import { redirect, json } from "@remix-run/node";
import { parseWithZod } from "@conform-to/zod/v4";
import type { ActionFunctionArgs } from "@remix-run/server-runtime";
import { requireUserId, requireWorkpace } from "~/services/session.server";
import {
  createConversation,
  CreateConversationSchema,
} from "~/services/conversation.server";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "~/components/ui/resizable";
import { ConversationList } from "~/components/conversation/conversation-list";
import { UnreadConversations } from "~/components/conversation/unread-conversations";
import { PageHeader } from "~/components/common/page-header";
import { Button } from "~/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import type { loader as homeLoader } from "~/routes/home";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method.toUpperCase() !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const userId = await requireUserId(request);
  const workspace = await requireWorkpace(request);
  const formData = await request.formData();

  const submission = parseWithZod(formData, {
    schema: CreateConversationSchema,
  });

  if (submission.status !== "success") {
    return json(submission.reply());
  }

  const conversation = await createConversation(
    workspace?.id as string,
    userId,
    {
      message: submission.value.message,
      title: submission.value.title ?? "Untitled",
      incognito: Boolean(submission.value.incognito),
      parts: [{ text: submission.value.message, type: "text" }],
    },
  );

  if (submission.value.conversationId) {
    return json({ conversation });
  }

  const conversationId = conversation?.conversationId;

  if (submission.value.panelMode) {
    return json({ conversation, conversationId });
  }

  if (conversationId) {
    const modelId = submission.value.modelId;
    const url = modelId
      ? `/home/conversation/${conversationId}?modelId=${encodeURIComponent(modelId)}`
      : `/home/conversation/${conversationId}`;
    return redirect(url);
  }

  return json({ conversation });
}

export default function ConversationLayout() {
  const params = useParams();
  const navigate = useNavigate();
  const fetcher = useFetcher<{ deleted?: boolean }>();
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const homeData = useRouteLoaderData<typeof homeLoader>("routes/home") as any;
  const conversationSources = homeData?.conversationSources ?? [];

  const matches = useMatches();
  const convMatch = matches.find(
    (m) => m.id === "routes/home.conversation.$conversationId",
  );
  const conversation = (convMatch?.data as any)?.conversation ?? null;

  React.useEffect(() => {
    if (fetcher.data?.deleted) {
      navigate("/home/conversation");
    }
  }, [fetcher.data, navigate]);

  const breadcrumbs = conversation
    ? [
        { label: "Conversations", href: "/home/conversation" },
        {
          label: (
            <span className="flex items-center gap-1.5">
              {conversation.title
                ? conversation.title.replace(/<[^>]*>/g, "").trim() ||
                  "Untitled"
                : "Untitled"}
              {conversation.incognito && (
                <EyeOff size={13} className="text-muted-foreground shrink-0" />
              )}
            </span>
          ),
        },
      ]
    : [];

  const actions = conversation
    ? [
        {
          label: "Delete",
          icon: <Trash2 size={14} />,
          onClick: () => setShowDeleteDialog(true),
          variant: "secondary" as const,
        },
      ]
    : [];

  return (
    <div className="h-page-xs flex flex-col">
      <PageHeader
        title="Conversations"
        breadcrumbs={breadcrumbs.length > 0 ? breadcrumbs : undefined}
        actions={actions.length > 0 ? actions : undefined}
        showChatToggle={false}
        actionsNode={
          <Button
            variant="ghost"
            className="gap-1.5 rounded"
            onClick={() => navigate("/home/conversation")}
            title="New chat"
          >
            <SquarePen size={14} />
            <span className="hidden md:inline">New Chat</span>
          </Button>
        }
      />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this conversation. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                fetcher.submit(
                  {},
                  {
                    method: "DELETE",
                    action: `/home/conversation/${params.conversationId}`,
                  },
                )
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex flex-1 overflow-hidden">
        {/* Collapsed icon strip — hidden when sidebar is open */}
        {!sidebarOpen && (
          <div className="flex w-10 shrink-0 flex-col items-center pt-2">
            <Button
              variant="ghost"
              onClick={() => setSidebarOpen(true)}
              title="Show history"
              className="ml-2.5"
            >
              <Clock size={16} />
            </Button>
          </div>
        )}

        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          {/* Sidebar panel — only rendered when open */}
          {sidebarOpen && (
            <ResizablePanel defaultSize="25%" minSize="18%" maxSize="40%">
              <div className="flex h-full flex-col">
                <div className="flex shrink-0 items-center justify-between border-b py-1 pl-4 pr-2">
                  <span className="text-sm font-medium">History</span>
                  <Button
                    variant="ghost"
                    onClick={() => setSidebarOpen(false)}
                    title="Close"
                  >
                    <ArrowLeft size={13} />
                  </Button>
                </div>
                <div className="flex flex-1 flex-col overflow-y-auto">
                  <UnreadConversations
                    currentConversationId={params.conversationId}
                  />
                  <ConversationList
                    currentConversationId={params.conversationId}
                    conversationSources={conversationSources}
                  />
                </div>
              </div>
            </ResizablePanel>
          )}

          {sidebarOpen && <ResizableHandle withHandle />}

          {/* Main content — always in the same panel so Outlet never remounts */}
          <ResizablePanel minSize="50%">
            <Outlet />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

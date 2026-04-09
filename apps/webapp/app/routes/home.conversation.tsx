import {
  Outlet,
  useParams,
  useRouteLoaderData,
  useMatches,
  useNavigate,
  useFetcher,
} from "@remix-run/react";
import React from "react";
import { Trash2, EyeOff, SquarePen } from "lucide-react";
import { redirect, json } from "@remix-run/node";
import { parseWithZod } from "@conform-to/zod/v4";
import type { ActionFunctionArgs } from "@remix-run/server-runtime";
import { requireUserId, requireWorkpace } from "~/services/session.server";
import {
  createConversation,
  CreateConversationSchema,
} from "~/services/conversation.server";
import { noStreamProcess } from "~/services/agent/no-stream-process";
import { isBurstSensitiveChatProvider } from "~/services/llm-provider.server";
import { logger } from "~/services/logger.service";
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

  const shouldPrecomputeFirstReply =
    !!conversationId &&
    !submission.value.conversationId &&
    !submission.value.panelMode &&
    isBurstSensitiveChatProvider();

  if (shouldPrecomputeFirstReply) {
    // Keep the default client autoRegenerate flow for normal providers. Proxy/self-hosted
    // setups can fail after the initial stream starts (late 429s), so we precompute here.
    try {
      await noStreamProcess(
        {
          id: conversationId,
          modelId: submission.value.modelId,
          message: {
            parts: [{ text: submission.value.message, type: "text" }],
            role: "user",
          },
          source: submission.value.source ?? "core",
        },
        userId,
        workspace?.id as string,
      );
    } catch (error) {
      logger.warn("Burst-safe first reply precompute failed; falling back to client retry path", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

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

  const homeData = useRouteLoaderData<typeof homeLoader>("routes/home") as any;
  const conversationSources = homeData?.conversationSources ?? [];

  // Get conversation data from the child route loader via useMatches
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
    <div className="flex h-full flex-col">
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
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          <ResizablePanel defaultSize="25%" minSize="18%" maxSize="40%">
            <div className="mt-2 flex h-full flex-col overflow-y-auto">
              <UnreadConversations
                currentConversationId={params.conversationId}
              />
              <ConversationList
                currentConversationId={params.conversationId}
                conversationSources={conversationSources}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize="75%" minSize="50%">
            <Outlet />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

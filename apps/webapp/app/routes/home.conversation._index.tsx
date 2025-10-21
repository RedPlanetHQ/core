import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/server-runtime";
import { useTypedLoaderData } from "remix-typedjson";
import { parse } from "@conform-to/zod";
import { redirect, json } from "@remix-run/node";
import {
  requireUser,
  requireUserId,
  requireWorkpace,
} from "~/services/session.server";

import { ConversationNew } from "~/components/conversation";
import {
  createConversation,
  CreateConversationSchema,
} from "~/services/conversation.server";

import { PageHeader } from "~/components/common/page-header";

export async function loader({ request }: LoaderFunctionArgs) {
  // Only return userId, not the heavy nodeLinks
  const user = await requireUser(request);

  return { user };
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method.toUpperCase() !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const userId = await requireUserId(request);
  const workspace = await requireWorkpace(request);
  const formData = await request.formData();

  const submission = parse(formData, { schema: CreateConversationSchema });

  if (!submission.value || submission.intent !== "submit") {
    return json(submission);
  }

  const conversation = await createConversation(workspace?.id, userId, {
    message: submission.value.message,
    title: submission.value.title,
    conversationId: submission.value.conversationId,
  });

  // If conversationId exists in submission, return the conversation data (don't redirect)
  if (submission.value.conversationId) {
    return json({ conversation });
  }

  // For new conversations (no conversationId), redirect to the conversation page
  const conversationId = conversation?.conversationId;

  if (conversationId) {
    return redirect(`/home/conversation/${conversationId}`);
  }

  // fallback: just return the conversation object
  return json({ conversation });
}

export default function Chat() {
  const { user } = useTypedLoaderData<typeof loader>();

  return (
    <>
      <PageHeader title="Conversation" />
      {typeof window !== "undefined" && <ConversationNew user={user} />}
    </>
  );
}

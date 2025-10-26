// import { json } from "@remix-run/node";
// import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
// import { UI_MESSAGE_STREAM_HEADERS } from "ai";

// import { getConversationAndHistory } from "~/services/conversation.server";
// import { z } from "zod";
// import { createResumableStreamContext } from "resumable-stream";

// export const ConversationIdSchema = z.object({
//   conversationId: z.string(),
// });

// const { action, loader } = createActionApiRoute(
//   {
//     params: ConversationIdSchema,
//     allowJWT: true,
//     authorization: {
//       action: "oauth",
//     },
//     corsStrategy: "all",
//   },
//   async ({ authentication, params }) => {
//     const conversation = await getConversationAndHistory(
//       params.conversationId,
//       authentication.userId,
//     );

//     const lastConversation = conversation?.ConversationHistory.pop();

//     if (!lastConversation) {
//       return json({}, { status: 204 });
//     }

//     const streamContext = createResumableStreamContext({
//       waitUntil: null,
//     });

//     return new Response(
//       await streamContext.resumeExistingStream(lastConversation.id),
//       { headers: UI_MESSAGE_STREAM_HEADERS },
//     );
//   },
// );

// export { action, loader };

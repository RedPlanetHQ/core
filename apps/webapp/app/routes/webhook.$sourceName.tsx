import { json } from "@remix-run/node";
import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/server-runtime";
import { z } from "zod";
import { webhookService } from "~/services/webhook.server";
import { logger } from "~/services/logger.service";
import { isTriggerDeployment } from "~/lib/queue-adapter.server";
import { isSlackDMOrMention, parseSlackDMEvent } from "~/services/channels/slack/inbound";
import { handleChannelMessage } from "~/services/channels";

const ParamsSchema = z.object({
  sourceName: z.string(),
});

const SearchParamsSchema = z.object({
  integrationAccountId: z.string().optional(),
});

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    const { sourceName } = ParamsSchema.parse(params);
    const url = new URL(request.url);
    const { integrationAccountId } = SearchParamsSchema.parse(
      Object.fromEntries(url.searchParams),
    );

    // Extract headers
    const eventHeaders: Record<string, string | string[]> = {};
    request.headers.forEach((value, key) => {
      eventHeaders[key] = value;
    });

    // Parse body
    const eventBody = await request.json();

    logger.log(`Webhook received for ${sourceName}`, {
      integrationAccountId,
      eventBody:
        typeof eventBody === "object"
          ? JSON.stringify(eventBody).substring(0, 200)
          : eventBody,
    });

    // Check if the event is a URL verification challenge (Slack)
    if (eventBody.type === "url_verification") {
      logger.log("Responding to Slack URL verification challenge");
      return json({ challenge: eventBody.challenge });
    }

    // Slack DM or @mention → route to channel handler
    if (sourceName === "slack" && (await isSlackDMOrMention(eventBody))) {
      const result = await parseSlackDMEvent(eventBody);
      if (result.message) {
        // Fire and forget — respond to Slack immediately
        void handleChannelMessage("slack", result.message);
        return json({ status: "acknowledged" }, { status: 200 });
      }
    }

    webhookService.handleEvents(
      sourceName,
      integrationAccountId,
      eventHeaders,
      eventBody,
    );

    return json({ status: "acknowledged" }, { status: 200 });
  } catch (error) {
    logger.error("Webhook processing failed", { error, params });

    // Still return 200 to acknowledge receipt
    return json(
      { status: "error", message: "Webhook processing failed" },
      { status: 200 },
    );
  }
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { sourceName } = ParamsSchema.parse(params);
    const url = new URL(request.url);
    const { integrationAccountId } = SearchParamsSchema.parse(
      Object.fromEntries(url.searchParams),
    );

    if (!isTriggerDeployment()) {
      return json({ status: "acknowledged" }, { status: 200 });
    }

    // Extract headers
    const eventHeaders: Record<string, string | string[]> = {};
    request.headers.forEach((value, key) => {
      eventHeaders[key] = value;
    });

    // For GET requests, parse query parameters as event body
    const eventBody = Object.fromEntries(url.searchParams);

    logger.log(`Webhook GET request for ${sourceName}`, {
      integrationAccountId,
      eventBody: JSON.stringify(eventBody).substring(0, 200),
    });

    // Check if the event is a URL verification challenge (Slack)
    if (eventBody.type === "url_verification") {
      logger.log("Responding to Slack URL verification challenge");
      return json({ challenge: eventBody.challenge });
    }

    await webhookService.handleEvents(
      sourceName,
      integrationAccountId,
      eventHeaders,
      eventBody,
    );

    return json({ status: "acknowledged" }, { status: 200 });
  } catch (error) {
    logger.error("Webhook GET processing failed", { error, params });

    // Still return 200 to acknowledge receipt
    return json(
      { status: "error", message: "Webhook processing failed" },
      { status: 200 },
    );
  }
}

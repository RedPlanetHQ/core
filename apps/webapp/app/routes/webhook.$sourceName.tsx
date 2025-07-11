import { json } from "@remix-run/node";
import { type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { z } from "zod";
import { webhookService } from "~/services/webhook.server";
import { logger } from "~/services/logger.service";

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
      Object.fromEntries(url.searchParams)
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
      eventBody: typeof eventBody === 'object' ? JSON.stringify(eventBody).substring(0, 200) : eventBody,
    });

    const result = await webhookService.handleEvents(
      sourceName,
      integrationAccountId,
      eventHeaders,
      eventBody
    );

    // Handle URL verification challenge (returns different response)
    if (result.challenge) {
      return json({ challenge: result.challenge });
    }

    return json({ status: result.status });
  } catch (error) {
    logger.error('Webhook processing failed', { error, params });
    
    // Still return 200 to acknowledge receipt
    return json({ status: 'error', message: 'Webhook processing failed' }, { status: 200 });
  }
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { sourceName } = ParamsSchema.parse(params);
    const url = new URL(request.url);
    const { integrationAccountId } = SearchParamsSchema.parse(
      Object.fromEntries(url.searchParams)
    );

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

    const result = await webhookService.handleEvents(
      sourceName,
      integrationAccountId,
      eventHeaders,
      eventBody
    );

    // Handle URL verification challenge (returns different response)
    if (result.challenge) {
      return json({ challenge: result.challenge });
    }

    return json({ status: result.status });
  } catch (error) {
    logger.error('Webhook GET processing failed', { error, params });
    
    // Still return 200 to acknowledge receipt
    return json({ status: 'error', message: 'Webhook processing failed' }, { status: 200 });
  }
}
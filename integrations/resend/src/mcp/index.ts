/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosInstance } from 'axios';

import {
  callEmailAudienceTool,
  getEmailAudienceTools,
} from './email-audience-tools';
import {
  callContactDomainTool,
  getContactDomainTools,
} from './contact-domain-tools';
import {
  callApiKeyBroadcastWebhookTemplateTool,
  getApiKeyBroadcastWebhookTemplateTools,
} from './apikey-broadcast-webhook-template-tools';
import {
  callTopicSegmentContactPropertyTool,
  getTopicSegmentContactPropertyTools,
} from './topic-segment-contactproperty-tools';

let resendClient: AxiosInstance;

function initializeClient(config: Record<string, string>) {
  resendClient = axios.create({
    baseURL: 'https://api.resend.com',
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      'Content-Type': 'application/json',
    },
  });
}

// ─── Tool Registry ──────────────────────────────────────────────────────────

export async function getTools() {
  return [
    ...getEmailAudienceTools(),
    ...getContactDomainTools(),
    ...getApiKeyBroadcastWebhookTemplateTools(),
    ...getTopicSegmentContactPropertyTools(),
  ];
}

// ─── Tool Dispatcher ────────────────────────────────────────────────────────

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, string>
) {
  initializeClient(config);

  try {
    let result: any = null;

    result = await callEmailAudienceTool(name, args, resendClient);
    if (result !== null) return result;

    result = await callContactDomainTool(name, args, resendClient);
    if (result !== null) return result;

    result = await callApiKeyBroadcastWebhookTemplateTool(name, args, resendClient);
    if (result !== null) return result;

    result = await callTopicSegmentContactPropertyTool(name, args, resendClient);
    if (result !== null) return result;

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    };
  } catch (error: any) {
    const message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      'Unknown error';
    return {
      content: [{ type: 'text', text: `Error calling ${name}: ${message}` }],
      isError: true,
    };
  }
}

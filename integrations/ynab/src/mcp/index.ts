/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosInstance } from 'axios';
import { callYnabTool, getYnabTools } from './tools';

function createYnabClient(config: Record<string, string>): AxiosInstance {
  return axios.create({
    baseURL: 'https://api.ynab.com/v1',
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      'Content-Type': 'application/json',
    },
  });
}

export async function getTools() {
  return getYnabTools();
}

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, string>
) {
  const ynabClient = createYnabClient(config);

  try {
    const result = await callYnabTool(name, args, ynabClient);

    if (result !== null) return result;

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    };
  } catch (error: any) {
    const message =
      error.response?.data?.error?.detail ||
      error.response?.data?.error?.id ||
      error.message ||
      'Unknown error';
    return {
      content: [{ type: 'text', text: `Error calling ${name}: ${message}` }],
      isError: true,
    };
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios';

import { getAuthHeaders } from '../utils';
import * as actions from './actions';
import * as boards from './boards';
import * as cards from './cards';
import * as checklists from './checklists';
import * as labels from './labels';
import * as lists from './lists';
import * as members from './members';
import * as notifications from './notifications';
import * as organizations from './organizations';
import * as search from './search';
import * as tokens from './tokens';
import * as webhooks from './webhooks';

const modules = [
  actions,
  boards,
  cards,
  checklists,
  labels,
  lists,
  members,
  notifications,
  organizations,
  search,
  tokens,
  webhooks,
];

export function getTools(): object[] {
  return modules.flatMap((m) => m.getTools());
}

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, string>,
) {
  const client = axios.create({
    baseURL: 'https://api.trello.com/1',
    headers: getAuthHeaders(config.access_token),
  });

  for (const mod of modules) {
    const result = await mod.dispatch(name, args, client);
    if (result !== null) {
      return result;
    }
  }

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
  };
}

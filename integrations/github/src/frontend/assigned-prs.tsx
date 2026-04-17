import React from 'react';
import type { WidgetSpec, WidgetRenderContext, WidgetComponent } from '@redplanethq/sdk';
import { AssignedPRsCard } from './AssignedPRsCard.js';

export const assignedPRsWidget: WidgetSpec = {
  name: 'Assigned PRs',
  slug: 'assigned-prs',
  description: 'Shows all open GitHub Pull Requests currently assigned to you',
  support: ['webapp'],
  configSchema: [],

  async render({ pat, accounts, baseUrl }: WidgetRenderContext): Promise<WidgetComponent> {
    const account = accounts.find((a) => a.slug === 'github');
    const accountId = account?.id ?? '';

    return function AssignedPRs() {
      return <AssignedPRsCard pat={pat} accountId={accountId} baseUrl={baseUrl} />;
    };
  },
};

import React from 'react';
import type { WidgetSpec, WidgetRenderContext, WidgetComponent } from '@redplanethq/sdk';
import { CurrentCycleIssuesCard } from './CurrentCycleIssuesCard.js';

export const currentCycleIssuesWidget: WidgetSpec = {
  name: 'Current Cycle Issues',
  slug: 'current-cycle-issues',
  description:
    'Shows Linear issues assigned to you in the current cycle. Select a team or choose All teams to aggregate across every team’s active cycle.',
  support: ['webapp'],
  configSchema: [
    {
      key: 'teamKey',
      label: 'Team',
      type: 'input',
      placeholder: 'Team key (e.g. ENG) — leave blank for All teams',
      required: false,
    },
  ],

  async render({ pat, accounts, baseUrl, config }: WidgetRenderContext): Promise<WidgetComponent> {
    const account = accounts.find((a) => a.slug === 'linear');
    const accountId = account?.id ?? '';
    const teamKey = config?.teamKey;

    return function CurrentCycleIssues() {
      return (
        <CurrentCycleIssuesCard
          pat={pat}
          accountId={accountId}
          baseUrl={baseUrl}
          teamKey={teamKey}
        />
      );
    };
  },
};

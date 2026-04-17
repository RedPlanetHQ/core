import React from 'react';
import type { WidgetSpec, WidgetRenderContext, WidgetComponent } from '@redplanethq/sdk';
import { DashboardCard } from './dashboard-view/index.js';

export const dashboardWidget: WidgetSpec = {
  name: 'Dashboard',
  slug: 'metabase-dashboard',
  description: 'Show questions from a Metabase dashboard with expandable results',
  support: ['webapp'],
  configSchema: [
    {
      key: 'dashboard_id',
      label: 'Dashboard ID',
      type: 'input',
      placeholder: 'e.g. 1',
      required: true,
    },
  ],

  async render({ pat, accounts, baseUrl, config }: WidgetRenderContext): Promise<WidgetComponent> {
    const account = accounts.find((a) => a.slug === 'metabase');
    const accountId = account?.id ?? '';

    return function MetabaseDashboard() {
      return (
        <DashboardCard pat={pat} accountId={accountId} baseUrl={baseUrl} initialConfig={config} />
      );
    };
  },
};

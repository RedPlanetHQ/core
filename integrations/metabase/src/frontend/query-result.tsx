import React from 'react';
import type { WidgetSpec, WidgetRenderContext, WidgetComponent } from '@redplanethq/sdk';
import { QueryResultCard } from './query-result-view/index.js';

export const queryResultWidget: WidgetSpec = {
  name: 'Query Result',
  slug: 'metabase-query',
  description: 'Execute a saved Metabase question and display results as a table',
  support: ['webapp'],
  configSchema: [
    {
      key: 'question_id',
      label: 'Question ID',
      type: 'input',
      placeholder: 'e.g. 42',
      required: true,
    },
  ],

  async render({ pat, accounts, baseUrl, config }: WidgetRenderContext): Promise<WidgetComponent> {
    const account = accounts.find((a) => a.slug === 'metabase');
    const accountId = account?.id ?? '';

    return function MetabaseQuery() {
      return (
        <QueryResultCard pat={pat} accountId={accountId} baseUrl={baseUrl} initialConfig={config} />
      );
    };
  },
};

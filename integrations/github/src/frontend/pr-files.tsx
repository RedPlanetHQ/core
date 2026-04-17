import React from 'react';
import type { WidgetSpec, WidgetRenderContext, WidgetComponent } from '@redplanethq/sdk';
import { PRFilesCard } from './PRFilesCard.js';

export const prFilesWidget: WidgetSpec = {
  name: 'PR Files',
  slug: 'pr-files',
  description: 'Shows file changes for a GitHub Pull Request with a full diff view',
  support: ['webapp'],
  configSchema: [
    {
      key: 'owner',
      label: 'Owner',
      type: 'input',
      placeholder: 'e.g. RedPlanetHQ',
      required: true,
    },
    { key: 'repo', label: 'Repository', type: 'input', placeholder: 'e.g. core', required: true },
    {
      key: 'pull_number',
      label: 'PR Number',
      type: 'input',
      placeholder: 'Leave empty for latest open PR',
      required: false,
    },
  ],

  async render({ pat, accounts, baseUrl, config }: WidgetRenderContext): Promise<WidgetComponent> {
    const account = accounts.find((a) => a.slug === 'github');
    const accountId = account?.id ?? '';

    return function PRFiles() {
      return (
        <PRFilesCard pat={pat} accountId={accountId} baseUrl={baseUrl} initialConfig={config} />
      );
    };
  },
};

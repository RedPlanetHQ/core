import type { FrontendExport } from '@redplanethq/sdk';

import { reportToolUI } from './tools/report-tool-ui.js';

export const toolUI = reportToolUI;
export const widgets = undefined;

const frontend: FrontendExport = {
  toolUI: reportToolUI,
};

export default frontend;

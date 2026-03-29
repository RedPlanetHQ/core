import type { FrontendExport } from '@redplanethq/sdk';
import { emailToolUI } from './tools/email-tool-ui.js';

export const toolUI = emailToolUI;
export const widgets = undefined;

const frontend: FrontendExport = {
  toolUI: emailToolUI,
};

export default frontend;

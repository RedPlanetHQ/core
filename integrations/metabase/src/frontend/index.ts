import type { WidgetSpec } from '@redplanethq/sdk';
import { queryResultWidget } from './query-result.js';
import { dashboardWidget } from './dashboard.js';

export const widgets: WidgetSpec[] = [queryResultWidget, dashboardWidget];

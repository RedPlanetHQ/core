import { DatadogEvent, DatadogMonitor } from './utils';

function monitorStateLabel(state: string): string {
  switch (state.toLowerCase()) {
    case 'alert':
      return 'ALERT';
    case 'warn':
      return 'WARN';
    case 'no data':
    case 'no_data':
      return 'NO DATA';
    case 'ok':
      return 'OK';
    case 'ignored':
      return 'IGNORED';
    case 'skipped':
      return 'SKIPPED';
    default:
      return state.toUpperCase();
  }
}

export function createActivityFromMonitor(
  monitor: DatadogMonitor,
  baseUrl: string,
): { type: string; data: { text: string; sourceURL: string } } | null {
  // Only surface non-OK monitors as activities
  const state = (monitor.overall_state || monitor.status || '').toLowerCase();
  if (state === 'ok' || state === 'ignored' || state === 'skipped') {
    return null;
  }

  const label = monitorStateLabel(monitor.overall_state || monitor.status);
  const monitorUrl = `${baseUrl}/monitors/${monitor.id}`;
  const tagsStr = monitor.tags?.length ? ` [${monitor.tags.join(', ')}]` : '';

  return {
    type: 'activity',
    data: {
      text: `[${label}] Monitor "${monitor.name}"${tagsStr}`,
      sourceURL: monitorUrl,
    },
  };
}

export function createActivityFromEvent(
  event: DatadogEvent,
): { type: string; data: { text: string; sourceURL: string } } | null {
  if (!event.title && !event.text) {
    return null;
  }

  const alertType = event.alert_type ? ` [${event.alert_type.toUpperCase()}]` : '';
  const host = event.host ? ` on ${event.host}` : '';
  const title = event.title || event.text.slice(0, 120);
  const text = `${alertType} ${title}${host}`.trim();

  return {
    type: 'activity',
    data: {
      text,
      sourceURL: event.url || '',
    },
  };
}

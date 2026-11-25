import type { FathomRecorder } from './utils';

export function fathomRecorderEmail(recorder?: FathomRecorder): string | undefined {
  return typeof recorder === 'string' ? recorder : recorder?.email;
}

type FathomWebhook = {
  recorded_by?: FathomRecorder;
  data?: { recorded_by?: FathomRecorder };
  event?: { data?: { recorded_by?: FathomRecorder } };
};

export async function identify(_integrationDefinition: unknown, eventBody?: FathomWebhook) {
  const recorder =
    eventBody?.recorded_by ?? eventBody?.data?.recorded_by ?? eventBody?.event?.data?.recorded_by;
  const email = fathomRecorderEmail(recorder);
  return email ? [{ type: 'identifier', data: email }] : [];
}

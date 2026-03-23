// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const identify = async (_integrationDefinition: any, eventBody: any) => {
  try {
    // Fathom webhook events include recorded_by (user email) in the event data,
    // which matches the accountId stored during account creation.
    const recordedBy =
      eventBody?.data?.recorded_by || eventBody?.event?.data?.recorded_by;

    if (!recordedBy) return [];

    return [{ type: 'identifier', data: recordedBy }];
  } catch {
    return [];
  }
};

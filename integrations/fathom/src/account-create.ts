import { fathomGet } from './utils';

export async function integrationCreate(data: Record<string, string>) {
  const { api_key } = data;

  const teams = await fathomGet(api_key, '/teams');
  const teamList = Array.isArray(teams) ? teams : teams?.data ?? [];
  const teamName = teamList.length > 0 ? teamList[0].name : undefined;

  const meetings = await fathomGet(api_key, '/meetings', { limit: 1 });
  const meetingList = Array.isArray(meetings) ? meetings : meetings?.data ?? [];
  const accountId = meetingList.length > 0
    ? meetingList[0].recorded_by ?? `fathom-user-${Date.now()}`
    : `fathom-user-${Date.now()}`;

  return [
    {
      type: 'account',
      data: {
        accountId,
        config: { api_key },
        settings: {
          ...(teamName ? { team: teamName } : {}),
        },
      },
    },
  ];
}

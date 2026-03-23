import { fathomGet } from './utils';

export async function integrationCreate(data: Record<string, string>) {
  const { api_key, webhook_secret } = data;

  const teams = await fathomGet(api_key, '/teams');
  const teamList = Array.isArray(teams) ? teams : teams?.data ?? [];
  const firstTeam = teamList[0];
  const teamName = firstTeam?.name;

  // Fetch one meeting to get the recorded_by email — used as accountId to match webhook payloads
  const meetings = await fathomGet(api_key, '/meetings', { limit: 1 });
  const meetingList = Array.isArray(meetings) ? meetings : meetings?.data ?? [];
  const recordedBy: string | undefined = meetingList[0]?.recorded_by;

  const accountId = recordedBy ?? firstTeam?.id ?? `fathom-${Date.now()}`;

  return [
    {
      type: 'account',
      data: {
        accountId,
        config: {
          api_key,
          webhook_secret,
        },
        settings: {
          ...(teamName ? { team: teamName } : {}),
        },
      },
    },
  ];
}

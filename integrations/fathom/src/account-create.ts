import { fathomRecorderEmail } from './identify';
import { type FathomMeeting, fetchAllPages } from './utils';

export async function integrationCreate(data: Record<string, string>) {
  const { api_key, webhook_secret } = data;

  const [firstTeam] = await fetchAllPages<{ id?: string; name?: string }>(
    api_key,
    '/teams',
    {},
    1,
    1,
  );
  const teamName = firstTeam?.name;

  // Use the recorder's email to match incoming webhook payloads.
  const [firstMeeting] = await fetchAllPages<FathomMeeting>(api_key, '/meetings', {}, 1, 1);
  const recordedBy = fathomRecorderEmail(firstMeeting?.recorded_by);

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

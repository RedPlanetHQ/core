import { initializeClient, getPaginatedWhoopData, formatDate, secondsToHMS } from './utils';

interface WhoopSettings {
  lastSyncTime?: string;
}

interface ActivityMessage {
  type: string;
  data: {
    text: string;
    sourceURL: string;
  };
}

function createActivityMessage(text: string): ActivityMessage {
  return {
    type: 'activity',
    data: {
      text,
      sourceURL: 'https://app.whoop.com',
    },
  };
}

function getDefaultSyncTime(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

async function processSleep(accessToken: string, lastSyncTime: string): Promise<ActivityMessage[]> {
  const activities: ActivityMessage[] = [];

  try {
    const sleepRecords = await getPaginatedWhoopData('/v1/activity/sleep', {
      start: lastSyncTime,
    });

    for (const sleep of sleepRecords) {
      try {
        if (!sleep.score) continue;

        const score = sleep.score;
        const startTime = formatDate(sleep.start);
        const duration = secondsToHMS(
          Math.round((new Date(sleep.end).getTime() - new Date(sleep.start).getTime()) / 1000)
        );

        const text =
          `Whoop Sleep on ${startTime}: ` +
          `Performance ${score.sleep_performance_percentage?.toFixed(0) ?? 'N/A'}%, ` +
          `Efficiency ${score.sleep_efficiency_percentage?.toFixed(0) ?? 'N/A'}%, ` +
          `Duration ${duration}, ` +
          `Stage Summary: REM ${secondsToHMS((score.stage_summary?.total_rem_sleep_time_milli ?? 0) / 1000)}, ` +
          `Deep ${secondsToHMS((score.stage_summary?.total_slow_wave_sleep_time_milli ?? 0) / 1000)}`;

        activities.push(createActivityMessage(text));
      } catch {
        // skip malformed records
      }
    }
  } catch (error) {
    console.error('Error fetching sleep data:', error);
  }

  return activities;
}

async function processRecovery(
  accessToken: string,
  lastSyncTime: string
): Promise<ActivityMessage[]> {
  const activities: ActivityMessage[] = [];

  try {
    const recoveryRecords = await getPaginatedWhoopData('/v1/recovery', {
      start: lastSyncTime,
    });

    for (const recovery of recoveryRecords) {
      try {
        if (!recovery.score) continue;

        const score = recovery.score;
        const date = formatDate(recovery.created_at);

        const text =
          `Whoop Recovery on ${date}: ` +
          `Recovery Score ${score.recovery_score?.toFixed(0) ?? 'N/A'}%, ` +
          `HRV ${score.hrv_rmssd_milli?.toFixed(1) ?? 'N/A'}ms, ` +
          `Resting HR ${score.resting_heart_rate?.toFixed(0) ?? 'N/A'}bpm, ` +
          `SpO2 ${score.spo2_percentage?.toFixed(1) ?? 'N/A'}%`;

        activities.push(createActivityMessage(text));
      } catch {
        // skip malformed records
      }
    }
  } catch (error) {
    console.error('Error fetching recovery data:', error);
  }

  return activities;
}

async function processWorkouts(
  accessToken: string,
  lastSyncTime: string
): Promise<ActivityMessage[]> {
  const activities: ActivityMessage[] = [];

  const SPORT_NAMES: Record<number, string> = {
    '-1': 'Activity',
    0: 'Running',
    1: 'Cycling',
    16: 'Baseball',
    17: 'Basketball',
    18: 'Rowing',
    19: 'Fencing',
    20: 'Field Hockey',
    21: 'Football',
    22: 'Golf',
    24: 'Ice Hockey',
    25: 'Lacrosse',
    27: 'Rugby',
    28: 'Sailing',
    29: 'Skiing',
    30: 'Soccer',
    31: 'Softball',
    32: 'Squash',
    33: 'Swimming',
    34: 'Tennis',
    35: 'Track & Field',
    36: 'Volleyball',
    37: 'Water Polo',
    38: 'Wrestling',
    39: 'Boxing',
    42: 'Dance',
    43: 'Pilates',
    44: 'Yoga',
    45: 'Weightlifting',
    47: 'Cross Country Skiing',
    48: 'Functional Fitness',
    49: 'Duathlon',
    51: 'Gymnastics',
    52: 'Hiking/Rucking',
    53: 'Horseback Riding',
    55: 'Kayaking',
    56: 'Martial Arts',
    57: 'Mountain Biking',
    59: 'Powerlifting',
    60: 'Rock Climbing',
    61: 'Paddleboarding',
    62: 'Triathlon',
    63: 'Walking',
    64: 'Surfing',
    65: 'Elliptical',
    66: 'Stairmaster',
    70: 'Meditation',
    71: 'Other',
    73: 'Diving',
    74: 'Operations',
    75: 'Snowboarding',
    76: 'Obstacle Course Racing',
    77: 'Motor Racing',
    82: 'HIIT',
    83: 'Spin',
    84: 'Jiu Jitsu',
    85: 'Manual Labor',
    86: 'Cricket',
    87: 'Pickleball',
    88: 'Inline Skating',
    89: 'Box Fitness',
    90: 'Spikeball',
    91: 'Wheelchair Pushing',
    92: 'Paddle Tennis',
    93: 'Barre',
    94: 'Stage Performance',
    95: 'High Stress Work',
    96: 'Parkour',
    97: 'Gaelic Football',
    98: 'Hurling/Camogie',
    99: 'Cycling (Recumbent)',
    100: 'Functional Strength Training',
    101: 'Walking Treadmill',
    102: 'Cardio',
    103: 'Stroller Walking',
    104: 'Stroller Running',
    105: 'Indoor Cycling',
    106: 'Boxing (Shadow)',
    107: 'Swimming (Open Water)',
    108: 'Netball',
    109: 'Sauna',
    110: 'Cycling (Fixed Gear)',
    111: 'Virtual Cycling',
    112: 'Handball',
    113: 'Cycling (Spin)',
    114: 'Judo',
    115: 'Aquatics',
    116: 'Archery',
  } as any;

  try {
    const workoutRecords = await getPaginatedWhoopData('/v1/activity/workout', {
      start: lastSyncTime,
    });

    for (const workout of workoutRecords) {
      try {
        const sportName = SPORT_NAMES[workout.sport_id] ?? `Sport ${workout.sport_id}`;
        const startTime = formatDate(workout.start);
        const duration = secondsToHMS(
          Math.round((new Date(workout.end).getTime() - new Date(workout.start).getTime()) / 1000)
        );

        let text = `Whoop Workout on ${startTime}: ${sportName}, ` + `Duration ${duration}`;

        if (workout.score) {
          const score = workout.score;
          if (score.strain != null) {
            text += `, Strain ${score.strain?.toFixed(1)}`;
          }
          if (score.average_heart_rate != null) {
            text += `, Avg HR ${score.average_heart_rate}bpm`;
          }
          if (score.max_heart_rate != null) {
            text += `, Max HR ${score.max_heart_rate}bpm`;
          }
          if (score.kilojoule != null) {
            text += `, ${(score.kilojoule / 4.184).toFixed(0)}kcal`;
          }
        }

        activities.push(createActivityMessage(text));
      } catch {
        // skip malformed records
      }
    }
  } catch (error) {
    console.error('Error fetching workout data:', error);
  }

  return activities;
}

export async function handleSchedule(
  config?: Record<string, string>,
  state?: Record<string, string>
) {
  try {
    if (!config?.access_token) {
      return [];
    }

    initializeClient(config.access_token);

    const settings = (state || {}) as WhoopSettings;
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();

    const messages: any[] = [];

    const [sleepActivities, recoveryActivities, workoutActivities] = await Promise.all([
      processSleep(config.access_token, lastSyncTime),
      processRecovery(config.access_token, lastSyncTime),
      processWorkouts(config.access_token, lastSyncTime),
    ]);

    messages.push(...sleepActivities, ...recoveryActivities, ...workoutActivities);

    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: new Date().toISOString(),
      },
    });

    return messages;
  } catch (error) {
    return [];
  }
}

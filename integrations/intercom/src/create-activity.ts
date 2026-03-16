export interface ActivityParams {
  text: string;
  sourceURL: string;
}

export function createActivity(params: ActivityParams) {
  return {
    type: 'activity',
    data: {
      text: params.text,
      sourceURL: params.sourceURL,
    },
  };
}

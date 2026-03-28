interface FigmaActivityCreateParams {
  text: string;
  sourceURL: string;
}

/**
 * Creates a standardised activity message from Figma webhook event data.
 */
export function createActivityMessage(params: FigmaActivityCreateParams) {
  return {
    type: 'activity',
    data: {
      text: params.text,
      sourceURL: params.sourceURL,
    },
  };
}

/**
 * Processes a raw Figma webhook event payload and returns zero or more
 * activity messages to be persisted in CORE.
 *
 * TODO: Expand this handler to cover all Figma webhook event types:
 *   - FILE_UPDATE
 *   - FILE_VERSION_UPDATE
 *   - FILE_COMMENT
 *   - FILE_DELETE
 *   - LIBRARY_PUBLISH
 */
export function createActivityEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventData: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _config: any,
): ReturnType<typeof createActivityMessage>[] {
  if (!eventData || !eventData.event_type) {
    return [];
  }

  const { event_type, file_name, file_key, triggered_by } = eventData;
  const actor: string = triggered_by?.handle ?? 'Someone';
  const fileURL = file_key ? `https://www.figma.com/file/${file_key}` : '';

  switch (event_type) {
    case 'FILE_UPDATE':
      return [
        createActivityMessage({
          text: `${actor} updated Figma file "${file_name ?? file_key}"`,
          sourceURL: fileURL,
        }),
      ];

    case 'FILE_VERSION_UPDATE':
      return [
        createActivityMessage({
          text: `${actor} saved a new version of Figma file "${file_name ?? file_key}"`,
          sourceURL: fileURL,
        }),
      ];

    case 'FILE_COMMENT': {
      const comment: string = eventData.comment?.[0]?.text ?? '';
      return [
        createActivityMessage({
          text: `${actor} commented on Figma file "${file_name ?? file_key}": ${comment}`,
          sourceURL: fileURL,
        }),
      ];
    }

    case 'FILE_DELETE':
      return [
        createActivityMessage({
          text: `${actor} deleted Figma file "${file_name ?? file_key}"`,
          sourceURL: fileURL,
        }),
      ];

    case 'LIBRARY_PUBLISH':
      return [
        createActivityMessage({
          text: `${actor} published a library update for "${file_name ?? file_key}"`,
          sourceURL: fileURL,
        }),
      ];

    default:
      // TODO: Handle additional event types as Figma expands its webhook API.
      return [];
  }
}

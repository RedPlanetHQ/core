export interface TemplateVars {
  title: string;
  description: string;
  answers?: string;
  previousPhaseOutput?: string;
  worktreePath?: string;
  sessionId?: string;
}

const KNOWN_KEYS: ReadonlyArray<keyof TemplateVars> = [
  'title',
  'description',
  'answers',
  'previousPhaseOutput',
  'worktreePath',
  'sessionId',
];

/**
 * Escape the user-supplied {description} so a stray ``` inside it cannot
 * close our enclosing fence. We replace the closing-fence-at-line-start
 * pattern with a backslash-escaped variant; the agent still reads it as
 * text but it doesn't break out of the block.
 */
function escapeDescription(value: string): string {
  if (!value) return '';
  const escaped = value.replace(/^```/gm, '\\`\\`\\`');
  return '```\n' + escaped + '\n```';
}

export function interpolate(prompt: string, vars: TemplateVars): string {
  return prompt.replace(/\{(\w+)\}/g, (_match, key: string) => {
    if (!KNOWN_KEYS.includes(key as keyof TemplateVars)) return '';
    if (key === 'description') {
      return escapeDescription(vars.description ?? '');
    }
    const v = vars[key as keyof TemplateVars];
    return v == null ? '' : String(v);
  });
}

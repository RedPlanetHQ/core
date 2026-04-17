export type FileStatus = 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed';

export interface PRFile {
  filename: string;
  previous_filename?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface PRInfo {
  number: number;
  title: string;
  headRef: string;
  baseRef: string;
}

export type WidgetConfig = {
  owner: string;
  repo: string;
  pull_number?: string;
};

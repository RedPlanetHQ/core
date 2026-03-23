import { Text, Container } from '@mariozechner/pi-tui';
import type { Component } from '@mariozechner/pi-tui';
import chalk from 'chalk';

export interface TaskItem {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled' | string;
  priority?: 'low' | 'medium' | 'high' | 'urgent' | string;
  url?: string;
}

export interface TasksProps {
  title?: string;
  items: TaskItem[];
  emptyText?: string;
}

const STATUS_ICON: Record<string, string> = {
  todo: chalk.dim('○'),
  in_progress: chalk.yellow('◐'),
  done: chalk.green('●'),
  cancelled: chalk.dim('×'),
};

const PRIORITY_COLOR: Record<string, (s: string) => string> = {
  urgent: chalk.red,
  high: chalk.yellow,
  medium: chalk.white,
  low: chalk.dim,
};

export function createTasks(props: TasksProps): Component {
  const container = new Container();

  if (props.title) {
    container.addChild(new Text(chalk.bold(props.title), 0, 0));
  }

  if (props.items.length === 0) {
    container.addChild(
      new Text(chalk.dim(props.emptyText ?? 'No tasks'), 0, 0),
    );
    return container;
  }

  for (const item of props.items) {
    const icon = STATUS_ICON[item.status] ?? chalk.dim('○');
    const colorFn = item.priority ? (PRIORITY_COLOR[item.priority] ?? chalk.white) : chalk.white;
    container.addChild(new Text(`${icon}  ${colorFn(item.title)}`, 0, 0));
  }

  return container;
}

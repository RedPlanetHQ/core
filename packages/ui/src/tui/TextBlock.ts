import { Text, Container } from '@mariozechner/pi-tui';
import type { Component } from '@mariozechner/pi-tui';
import chalk from 'chalk';

export interface TextBlockProps {
  title?: string;
  content: string;
}

export function createTextBlock(props: TextBlockProps): Component {
  const container = new Container();

  if (props.title) {
    container.addChild(new Text(chalk.bold(props.title), 0, 0));
  }

  // Wrap long lines at 80 chars
  const lines = props.content.split('\n');
  for (const line of lines) {
    container.addChild(new Text(chalk.white(line), 0, 0));
  }

  return container;
}

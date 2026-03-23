import { Text, Container } from '@mariozechner/pi-tui';
import type { Component } from '@mariozechner/pi-tui';
import chalk from 'chalk';

export interface StatProps {
  value: string | number;
  label: string;
  sublabel?: string;
}

export function createStat(props: StatProps): Component {
  const container = new Container();
  container.addChild(new Text(chalk.bold.white(String(props.value)), 0, 0));
  container.addChild(new Text(chalk.dim(props.label), 0, 0));

  if (props.sublabel) {
    container.addChild(new Text(chalk.dim(props.sublabel), 0, 0));
  }

  return container;
}

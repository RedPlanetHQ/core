import { Text, Container } from "@mariozechner/pi-tui";
import type { Component } from "@mariozechner/pi-tui";
import chalk from "chalk";

export interface ListItem {
  label: string;
  value?: string;
  sublabel?: string;
  icon?: string;
}

export interface ListProps {
  title?: string;
  items: ListItem[];
  emptyText?: string;
}

export function createList(props: ListProps): Component {
  const container = new Container();

  if (props.title) {
    container.addChild(new Text(chalk.bold(props.title), 0, 0));
  }

  if (props.items.length === 0) {
    container.addChild(new Text(chalk.dim(props.emptyText ?? "No items"), 0, 0));
    return container;
  }

  for (const item of props.items) {
    const prefix = item.icon ? `${item.icon} ` : `${chalk.dim("·")} `;
    const label = chalk.white(item.label);
    const value = item.value ? `  ${chalk.dim(item.value)}` : "";
    container.addChild(new Text(`${prefix}${label}${value}`, 0, 0));

    if (item.sublabel) {
      container.addChild(new Text(`   ${chalk.dim(item.sublabel)}`, 0, 0));
    }
  }

  return container;
}

import { Text, Container } from '@mariozechner/pi-tui';
import type { Component } from '@mariozechner/pi-tui';
import chalk from 'chalk';

export interface PlayerProps {
  track: string;
  artist: string;
  progress?: string;
  isPlaying?: boolean;
}

export function createPlayer(props: PlayerProps): Component {
  const container = new Container();

  const status = props.isPlaying === false ? chalk.dim('⏸') : chalk.green('▶');
  const track = chalk.white(props.track);
  const artist = chalk.dim(props.artist);
  const progress = props.progress ? chalk.dim(`  ${props.progress}`) : '';

  container.addChild(
    new Text(`♫  ${track}  ${chalk.dim('–')}  ${artist}  ${status}${progress}`, 0, 0),
  );

  return container;
}

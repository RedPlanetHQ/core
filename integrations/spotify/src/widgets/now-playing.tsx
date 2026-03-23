import React from 'react';
import type { WidgetSpec, WidgetRenderContext, WidgetComponent } from '@redplanethq/sdk';
import { NowPlayingCard } from './NowPlayingCard.js';

const POLL_INTERVAL_MS = 10_000;

interface TrackData {
  track: string;
  artist: string;
  progress: string;
  isPlaying: boolean;
}

async function fetchCurrentTrack(
  baseUrl: string,
  accountId: string,
  pat: string,
): Promise<TrackData | null> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/integration_account/${accountId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pat}` },
      body: JSON.stringify({ action: 'get_currently_playing' }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = json?.result?.content?.[0]?.text;
    if (!text) return null;
    const parsed = JSON.parse(text);
    if (!parsed?.is_playing) return null;
    const total = Math.floor(parsed.progress_ms / 1000);
    return {
      track: parsed.item.name,
      artist: parsed.item.artists.map((a: { name: string }) => a.name).join(', '),
      progress: `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`,
      isPlaying: true,
    };
  } catch {
    return null;
  }
}

class NowPlayingTuiComponent {
  private lines: string[] = ['♫  Loading...'];
  private timer: ReturnType<typeof setInterval> | null = null;
  private _player: { render: (w: number) => string[] } | null = null;
  // undefined = not tried yet, null = tried but unavailable
  private createPlayer: ((opts: TrackData) => { render: (w: number) => string[] }) | null | undefined = undefined;

  constructor(
    private baseUrl: string,
    private accountId: string,
    private pat: string,
    private requestRender: () => void,
  ) {
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  private async resolveCreatePlayer(): Promise<void> {
    if (this.createPlayer !== undefined) return; // already resolved (or confirmed unavailable)
    try {
      const mod = await import('@redplanethq/ui/tui');
      this.createPlayer = typeof mod.createPlayer === 'function' ? mod.createPlayer : null;
    } catch {
      this.createPlayer = null;
    }
  }

  private async poll(): Promise<void> {
    const data = await fetchCurrentTrack(this.baseUrl, this.accountId, this.pat);

    if (!data) {
      this.lines = ['♫  Nothing playing'];
      this._player = null;
      this.requestRender();
      return;
    }

    await this.resolveCreatePlayer();

    if (this.createPlayer) {
      const player = this.createPlayer(data);
      this._player = player;
    } else {
      // @redplanethq/ui/tui not available — plain text fallback
      this._player = null;
      this.lines = [`♫  ${data.track}  ·  ${data.artist}  [${data.progress}]`];
    }

    this.requestRender();
  }

  render(width: number): string[] {
    const raw = this._player ? this._player.render(width) : this.lines;
    return raw.map(line => {
      const visible = line.replace(/\x1b\[[0-9;]*m/g, '').length;
      const pad = Math.max(0, width - visible);
      return ' '.repeat(pad) + line;
    });
  }

  destroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const nowPlayingWidget: WidgetSpec = {
  name: 'Now Playing',
  slug: 'now-playing',
  description: 'Shows the currently playing track from your Spotify account',
  support: ['tui', 'webapp'],
  tuiPlacement: 'below-input',

  async render({
    placement,
    pat,
    accounts,
    baseUrl,
    requestRender,
  }: WidgetRenderContext): Promise<WidgetComponent> {
    const account = accounts.find((a) => a.slug === 'spotify');

    if (placement === 'tui') {
      if (!account) {
        return { render: (_w: number) => ['♫  Spotify not connected'] };
      }
      return new NowPlayingTuiComponent(
        baseUrl,
        account.id,
        pat,
        requestRender ?? (() => {}),
      );
    }

    // webapp — return a bound React component
    const accountId = account?.id ?? '';
    return function NowPlaying() {
      return <NowPlayingCard pat={pat} accountId={accountId} baseUrl={baseUrl} />;
    };
  },
};

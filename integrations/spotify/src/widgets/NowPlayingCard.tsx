import React, { useEffect, useState } from 'react';
import { Player } from '@redplanethq/ui/web';

interface NowPlayingData {
  is_playing: boolean;
  progress_ms: number;
  item: {
    name: string;
    artists: Array<{ name: string }>;
    album: { images: Array<{ url: string }> };
  };
}

const REFRESH_INTERVAL_MS = 5000;

export interface NowPlayingCardProps {
  pat: string;
  accountId: string;
  baseUrl: string;
}

function formatProgress(ms: number): string {
  const total = Math.floor(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, '0');
  return `${min}:${sec}`;
}

async function fetchCurrentlyPlaying(
  pat: string,
  accountId: string,
  baseUrl: string,
): Promise<NowPlayingData | null> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/integration_account/${accountId}/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pat}`,
      },
      body: JSON.stringify({ action: 'get_currently_playing' }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    console.log(json);
    const text = json?.result?.content?.[0]?.text;
    if (!text) return null;
    const data = JSON.parse(text) as NowPlayingData;
    return data?.is_playing ? data : null;
  } catch {
    return null;
  }
}

export function NowPlayingCard({ pat, accountId, baseUrl }: NowPlayingCardProps) {
  const [data, setData] = useState<NowPlayingData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const result = await fetchCurrentlyPlaying(pat, accountId, baseUrl);
      if (!cancelled) setData(result);
    }

    poll();
    const id = setInterval(poll, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pat, accountId, baseUrl]);

  if (!data?.is_playing) {
    return (
      <div style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem', padding: '8px 0' }}>
        ♫ Nothing playing
      </div>
    );
  }

  return (
    <div className="p-2">
      <Player
        track={data.item.name}
        artist={data.item.artists.map((a: { name: string }) => a.name).join(', ')}
        albumArt={data.item.album.images[0]?.url}
        isPlaying={data.is_playing}
        progress={formatProgress(data.progress_ms)}
      />
    </div>
  );
}

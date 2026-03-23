import React from "react";
import { cn } from "./utils";

export interface PlayerProps {
  track: string;
  artist: string;
  progress?: string;
  albumArt?: string;
  isPlaying?: boolean;
  className?: string;
}

export function Player({ track, artist, progress, albumArt, isPlaying = true, className }: PlayerProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {albumArt ? (
        <img src={albumArt} alt={track} className="h-10 w-10 rounded object-cover" />
      ) : (
        <div className="bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded text-lg">
          ♫
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{track}</p>
        <p className="text-muted-foreground truncate text-xs">{artist}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm">{isPlaying ? "▶" : "⏸"}</span>
        {progress && <span className="text-muted-foreground text-xs">{progress}</span>}
      </div>
    </div>
  );
}

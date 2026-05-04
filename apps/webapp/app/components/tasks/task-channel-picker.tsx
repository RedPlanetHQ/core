import React, { useState } from "react";
import { Mail, MessageSquare, Send, Check } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

export interface ChannelOption {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
}

interface TaskChannelPickerProps {
  channels: ChannelOption[];
  selectedChannelId: string | null;
  defaultChannelName: string | null;
  onChange: (channelId: string | null) => void;
}

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  email: <Mail size={14} />,
  slack: <MessageSquare size={14} />,
  telegram: <Send size={14} />,
  whatsapp: <MessageSquare size={14} />,
};

function channelIconFor(type: string | null | undefined): React.ReactNode {
  if (!type) return <MessageSquare size={14} />;
  return CHANNEL_ICON[type] ?? <MessageSquare size={14} />;
}

export function TaskChannelPicker({
  channels,
  selectedChannelId,
  defaultChannelName,
  onChange,
}: TaskChannelPickerProps) {
  const [open, setOpen] = useState(false);
  if (channels.length === 0) return null;

  const selected = selectedChannelId
    ? (channels.find((c) => c.id === selectedChannelId) ?? null)
    : null;

  const label = selected
    ? selected.name
    : defaultChannelName
      ? `${defaultChannelName} · default`
      : "Default";
  const iconType = selected?.type ?? channels.find((c) => c.isDefault)?.type;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" className="gap-1">
          {channelIconFor(iconType)}
          <span>{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="start">
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
          className="hover:bg-grayAlpha-100 flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm"
        >
          <span className="text-muted-foreground flex w-4 shrink-0 justify-center">
            {selectedChannelId === null ? <Check size={14} /> : null}
          </span>
          <span className="flex-1 truncate text-left">
            Use default
            {defaultChannelName && (
              <span className="text-muted-foreground ml-1">
                · {defaultChannelName}
              </span>
            )}
          </span>
        </button>
        <div className="bg-border my-1 h-px" />
        {channels.map((c) => (
          <button
            type="button"
            key={c.id}
            onClick={() => {
              onChange(c.id);
              setOpen(false);
            }}
            className="hover:bg-grayAlpha-100 flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm"
          >
            <span className="text-muted-foreground flex w-4 shrink-0 justify-center">
              {selectedChannelId === c.id ? <Check size={14} /> : null}
            </span>
            <span className="text-muted-foreground shrink-0">
              {channelIconFor(c.type)}
            </span>
            <span className="flex-1 truncate text-left">{c.name}</span>
            {c.isDefault && (
              <span className="text-muted-foreground shrink-0 text-xs">
                default
              </span>
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

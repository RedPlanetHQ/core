import { History } from "lucide-react";
import { Button } from "../ui";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "../ui/popover";
import React from "react";
import { ConversationList } from "./conversation-list";

export const HistoryDropdown = ({
  currentConversationId,
}: {
  currentConversationId?: string;
}) => {
  const [open, setOpen] = React.useState(false);

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            className="flex items-center justify-between font-normal"
          >
            <History size={16} />
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent className="flex w-72 flex-col p-0" align="end">
            <p className="text-muted-foreground mt-2 px-2">Conversations</p>
            <ConversationList currentConversationId={currentConversationId} />
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </div>
  );
};

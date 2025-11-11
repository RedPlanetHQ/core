import { useState, useEffect } from "react";
import { Check, Plus, X } from "lucide-react";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";
import { useFetcher } from "@remix-run/react";
import { Project } from "../icons/project";
import { VariantProps } from "class-variance-authority";

interface Space {
  id: string;
  name: string;
  description?: string;
}

interface SpaceDropdownProps {
  episodeIds: string[];
  selectedSpaceIds?: string[];
  onSpaceChange?: (spaceIds: string[]) => void;
  className?: string;
  size?: VariantProps<typeof buttonVariants>["size"];
}

export function SpaceDropdown({
  episodeIds,
  selectedSpaceIds = [],
  onSpaceChange,
  className,
  size = "sm",
}: SpaceDropdownProps) {
  const [open, setOpen] = useState(false);
  const [selectedSpaces, setSelectedSpaces] =
    useState<string[]>(selectedSpaceIds);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const spacesFetcher = useFetcher<{ spaces: Space[] }>();
  const assignFetcher = useFetcher();

  // Fetch all spaces
  useEffect(() => {
    spacesFetcher.load("/api/v1/spaces");
  }, []);

  // Update spaces when data is fetched
  useEffect(() => {
    if (spacesFetcher.data?.spaces) {
      setSpaces(spacesFetcher.data.spaces);
    }
  }, [spacesFetcher.data]);

  const handleSpaceToggle = (spaceId: string) => {
    const newSelectedSpaces = selectedSpaces.includes(spaceId)
      ? selectedSpaces.filter((id) => id !== spaceId)
      : [...selectedSpaces, spaceId];

    setSelectedSpaces(newSelectedSpaces);
    if (episodeIds) {
      assignFetcher.submit(
        {
          episodeIds: JSON.stringify(episodeIds),
          spaceId,
          action: selectedSpaces.includes(spaceId) ? "remove" : "assign",
        },
        {
          method: "post",
          action: "/api/v1/episodes/assign-space",
          encType: "application/json",
        },
      );
    }

    // Call the callback if provided
    if (onSpaceChange) {
      onSpaceChange(newSelectedSpaces);
    }
  };

  const selectedSpaceObjects = spaces.filter((space) =>
    selectedSpaces.includes(space.id),
  );

  const getTrigger = () => {
    if (selectedSpaceObjects?.length === 1) {
      return (
        <>
          <Project size={14} /> {selectedSpaceObjects[0].name}
        </>
      );
    }

    if (selectedSpaceObjects?.length > 1) {
      return (
        <>
          <Project size={14} /> {selectedSpaceObjects.length} Spaces
        </>
      );
    }

    return (
      <>
        {" "}
        <Project size={14} />
        Spaces
      </>
    );
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {/* + button to add more spaces */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            size={size}
            role="combobox"
            aria-expanded={open}
            className="h-7 gap-1 rounded"
          >
            {getTrigger()}
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent className="w-[250px] p-0" align="end">
            <Command>
              <CommandInput placeholder="Search spaces..." />
              <CommandList>
                <CommandEmpty>No spaces found.</CommandEmpty>
                <CommandGroup>
                  {spaces.map((space) => (
                    <CommandItem
                      key={space.id}
                      value={space.name}
                      onSelect={() => handleSpaceToggle(space.id)}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedSpaces.includes(space.id)
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <div className="flex flex-col">
                        <span className="text-sm">{space.name}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </div>
  );
}

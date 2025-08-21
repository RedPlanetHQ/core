import {
  Button,
  Input,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../ui";
import * as LucideIcons from "lucide-react";
import { useState } from "react";

import { emojiData } from "./emoji-data";
import { cn } from "~/lib/utils";

interface IconPickerProps {
  onSelectIcon?: (icon: string, color: string) => void;
  onSelectEmoji?: (emoji: string) => void;
  onRemove?: () => void;
  onUploadIcon?: (file: File) => void;
}

const colorOptions = [
  "#000",
  "oklch(66% 0.1835 292)",
  "oklch(66% 0.1835 169)",
  "oklch(66% 0.1835 30)",
  "oklch(66% 0.1835 308)",
  "oklch(66% 0.1835 339)",
  "oklch(66% 0.1835 277)",
  "oklch(66% 0.1835 30)",
  "oklch(66% 0.1835 71)",
  "oklch(66% 0.1835 228)",
];

export function IconPicker({
  onSelectIcon,
  onSelectEmoji,
  onRemove,
}: IconPickerProps) {
  const [activeTab, setActiveTab] = useState("icons");
  const [iconSearch, setIconSearch] = useState("");
  const [emojiSearch, setEmojiSearch] = useState("");
  const [selectedColor, setSelectedColor] = useState(colorOptions[0]);

  // Filter icons based on search
  const filteredIcons = Object.keys(LucideIcons)
    .filter(
      (iconName) =>
        iconName !== "createLucideIcon" &&
        iconName.toLowerCase().includes(iconSearch.toLowerCase()),
    )
    .slice(0, 100); // Limit to 120 icons for performance

  // Filter emojis based on search
  const filteredEmojis = emojiSearch
    ? emojiData.filter((emoji) =>
        emoji.name.toLowerCase().includes(emojiSearch.toLowerCase()),
      )
    : emojiData;

  return (
    <div className="w-full max-w-md overflow-hidden rounded-lg">
      <Tabs
        defaultValue="icons"
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="icons" className="">
            Icons
          </TabsTrigger>
          <TabsTrigger value="emojis" className="">
            Emojis
          </TabsTrigger>
        </TabsList>

        {/* Icons Tab */}
        <TabsContent value="icons" className="p-0">
          <div className="p-1">
            <div className="mb-4 flex flex-wrap gap-2">
              {colorOptions.map((color, index) => (
                <button
                  key={index}
                  className={cn(
                    "h-6 w-6 rounded-full",
                    selectedColor === color ? "ring-2 ring-white" : "",
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => setSelectedColor(color)}
                />
              ))}
            </div>
            <div className="relative mb-4">
              <LucideIcons.Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
              <Input
                placeholder="Search Icons..."
                className="pl-9"
                value={iconSearch}
                onChange={(e) => setIconSearch(e.target.value)}
              />
            </div>
            <ScrollArea className="h-[250px]">
              <div className="grid grid-cols-8 gap-2">
                {filteredIcons.map((iconName) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const IconComponent = (LucideIcons as any)[iconName];
                  return (
                    <Button
                      key={iconName}
                      className="text-foreground flex items-center justify-center p-1"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        onSelectIcon && onSelectIcon(iconName, selectedColor)
                      }
                    >
                      <IconComponent
                        style={
                          selectedColor !== "#000"
                            ? { color: selectedColor }
                            : {}
                        }
                        className={cn("text-foreground")}
                      />
                    </Button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </TabsContent>

        {/* Emojis Tab */}
        <TabsContent value="emojis" className="p-0">
          <div className="p-1">
            <div className="relative mb-4">
              <LucideIcons.Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
              <Input
                placeholder="Search Icons..."
                className="pl-9"
                value={iconSearch}
                onChange={(e) => setEmojiSearch(e.target.value)}
              />
            </div>
            <ScrollArea className="h-[250px]">
              <div className="grid grid-cols-8 gap-1">
                {filteredEmojis.map((emoji) => (
                  <Button
                    key={emoji.id}
                    className="flex items-center justify-center p-1"
                    size="sm"
                    variant="ghost"
                    onClick={() => onSelectEmoji && onSelectEmoji(emoji.emoji)}
                  >
                    {emoji.emoji}
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </TabsContent>
      </Tabs>

      <div className="border-border flex justify-end border-t pt-1">
        <Button variant="secondary" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}

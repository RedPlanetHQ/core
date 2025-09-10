import {
  RiDiscordFill,
  RiGithubFill,
  RiMailFill,
  RiSlackFill,
} from "@remixicon/react";
import { LayoutGrid } from "lucide-react";
import { LinearIcon, SlackIcon } from "./icons";
import { Cursor } from "./icons/cursor";
import { Claude } from "./icons/claude";
import { Cline } from "./icons/cline";
import { VSCode } from "./icons/vscode";
import { Obsidian } from "./icons/obsidian";
import { Figma } from "./icons/figma";
import StaticLogo from "./logo/logo";

export const ICON_MAPPING = {
  slack: SlackIcon,
  email: RiMailFill,
  discord: RiDiscordFill,
  github: RiGithubFill,

  gmail: RiMailFill,
  linear: LinearIcon,
  cursor: Cursor,
  claude: Claude,
  cline: Cline,
  vscode: VSCode,
  obsidian: Obsidian,
  figma: Figma,
  core: StaticLogo,

  // Default icon
  integration: LayoutGrid,
};

export type IconType = keyof typeof ICON_MAPPING;

export function getIcon(icon: IconType) {
  if (icon in ICON_MAPPING) {
    return ICON_MAPPING[icon];
  }

  return ICON_MAPPING["integration"];
}

export const getIconForAuthorise = (
  name: string,
  size = 40,
  image?: string,
) => {
  if (image) {
    return (
      <img
        src={image}
        alt={name}
        className="rounded"
        style={{ height: size, width: size }}
      />
    );
  }

  const lowerName = name.toLowerCase();

  if (lowerName in ICON_MAPPING) {
    const IconComponent = ICON_MAPPING[lowerName as IconType];

    return <IconComponent size={size} />;
  }

  return <LayoutGrid size={size} />;
};

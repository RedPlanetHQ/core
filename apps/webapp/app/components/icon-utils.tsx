import { RiGithubFill, RiMailFill } from "@remixicon/react";
import { LayoutGrid } from "lucide-react";
import { LinearIcon, SlackIcon } from "./icons";
import { Cursor } from "./icons/cursor";
import { Claude } from "./icons/claude";
import { Cline } from "./icons/cline";
import { Codex } from "./icons/codex";
import { ChatGPT } from "./icons/chatgpt";
import { Gemini } from "./icons/gemini";
import { Windsurf } from "./icons/windsurf";
import { VSCode } from "./icons/vscode";
import { Obsidian } from "./icons/obsidian";
import { Figma } from "./icons/figma";
import StaticLogo from "./logo/logo";
import { Zed } from "./icons/zed";
import { Kilo } from "./icons/kilo";
import { Gmail } from "./icons/gmail";
import { GoogleCalendar } from "./icons/google-calendar";
import { GoogleSheets } from "./icons/google-sheets";
import { GoogleDocs } from "./icons/google-docs";
import { CalCom } from "./icons/cal_com";
import { Notion } from "./icons/notion";
import { Zoho } from "./icons/zoho";
import { Hubspot } from "./icons/hubspot";
import { Discord } from "./icons/discord";
import { Todoist } from "./icons/todoist";
import { Ghost } from "./icons/ghost";

export const ICON_MAPPING = {
  slack: SlackIcon,
  email: RiMailFill,
  github: RiGithubFill,

  gmail: Gmail,
  "google-calendar": GoogleCalendar,
  "google-sheets": GoogleSheets,
  "google-docs": GoogleDocs,
  linear: LinearIcon,
  cursor: Cursor,
  claude: Claude,
  "claude-code": Claude,
  cline: Cline,
  codex: Codex,
  chatgpt: ChatGPT,
  gemini: Gemini,
  windsurf: Windsurf,
  vscode: VSCode,
  obsidian: Obsidian,
  figma: Figma,
  core: StaticLogo,
  persona: StaticLogo,
  "topic-analysis": StaticLogo,
  zed: Zed,
  kilo: Kilo,
  cal_com: CalCom,
  notion: Notion,
  zoho: Zoho,
  hubspot: Hubspot,
  discord: Discord,
  todoist: Todoist,
  ghost: Ghost,

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

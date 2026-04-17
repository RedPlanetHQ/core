import { RiGithubFill, RiMailFill, RiLinkedinFill } from "@remixicon/react";
import { Chromium, Code, Globe, LayoutGrid, RefreshCw } from "lucide-react";
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
import { GoogleSearchConsole } from "./icons/google-search-console";
import { CalCom } from "./icons/cal_com";
import { Notion } from "./icons/notion";
import { Zoho } from "./icons/zoho";
import { Hubspot } from "./icons/hubspot";
import { Discord } from "./icons/discord";
import { Todoist } from "./icons/todoist";
import { Ghost } from "./icons/ghost";
import { Fireflies } from "./icons/fireflies";
import { Whatsapp } from "./icons/whatsapp";
import { Metabase } from "./icons/metabase";
import { Resend } from "./icons/resend";
import { Ynab } from "./icons/ynab";
import { Jira } from "./icons/jira";
import { Confluence } from "./icons/confluence";
import { Mixpanel } from "./icons/mixpanel_icon";
import { BacklogLine } from "./icons/backlog";
import { TodoLine } from "./icons/todo";
import { InProgressLine } from "./icons/in-progress";
import { BlockedLine } from "./icons/blocked";
import { DoneFill } from "./icons/done";
import { TaskStatus } from "@core/database";
import { Task } from "./icons/task";
import { Spotify } from "./icons/spotify";
import { Stripe } from "./icons/stripe";
import { InReviewLine } from "./icons/in-review-line";

export const ICON_MAPPING = {
  slack: SlackIcon,
  email: RiMailFill,
  github: RiGithubFill,
  linkedin: RiLinkedinFill,

  gmail: Gmail,
  "google-calendar": GoogleCalendar,
  "google-sheets": GoogleSheets,
  "google-docs": GoogleDocs,
  "google-search-console": GoogleSearchConsole,
  linear: LinearIcon,
  cursor: Cursor,
  claude: Claude,
  "claude-code": Claude,
  "claude-code-plugin": Claude,
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
  zoho_email: Zoho,
  hubspot: Hubspot,
  discord: Discord,
  todoist: Todoist,
  ghost: Ghost,
  fireflies: Fireflies,
  whatsapp: Whatsapp,
  metabase: Metabase,
  resend: Resend,
  ynab: Ynab,
  jira: Jira,
  confluence: Confluence,
  mixpanel: Mixpanel,
  stripe: Stripe,
  cli: Code,
  "core-extension": Chromium,
  task: Task,
  spotify: Spotify,

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

export const TaskStatusIcons: Record<TaskStatus, React.ElementType> = {
  Todo: TodoLine,
  Waiting: BlockedLine,
  Ready: TodoLine,
  Working: InProgressLine,
  Review: InReviewLine,
  Done: DoneFill,
  Recurring: RefreshCw,
};

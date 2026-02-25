import React, { useState, useCallback, useMemo } from "react";
import { useFetcher } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

interface IngestionRuleSectionProps {
  ingestionRule: {
    id: string;
    text: string;
  } | null;
  activeAccount: any;
  slug?: string;
}

export function IngestionRuleSection({
  ingestionRule,
  activeAccount,
  slug,
}: IngestionRuleSectionProps) {
  const [ingestionRuleText, setIngestionRuleText] = useState(
    ingestionRule?.text || "",
  );
  const ingestionRuleFetcher = useFetcher();

  const handleIngestionRuleUpdate = useCallback(() => {
    ingestionRuleFetcher.submit(
      {
        ingestionRule: ingestionRuleText,
      },
      {
        method: "post",
      },
    );
  }, [ingestionRuleText, ingestionRuleFetcher]);

  const placeholder = useMemo(() => {
    if (slug === "linkedin") {
      return `Example for LinkedIn: "Ingest my posts and professional updates. Capture comments on my posts that mention 'collaboration' or 'partnership'. Ignore generic engagement like 'Congrats!' or 'Good job!'."`;
    }
    return `Example for Gmail: "Only ingest emails from the last 24 hours that contain the word 'urgent' or 'important' in the subject line or body. Skip promotional emails and newsletters. Focus on emails from known contacts or business domains."`;
  }, [slug]);

  const placeholder = useMemo(() => {
    switch (slug) {
      // Productivity & Tasks
      case "linear":
        return `Example for Linear: "Ingest issues assigned to me or with 'Urgent' priority. Track comments on tickets I am subscribed to."`;
      case "todoist":
        return `Example for Todoist: "Ingest active tasks with 'High' priority (P1). Ignore sub-tasks or routine daily chores."`;
      case "google-tasks":
        return `Example for Google Tasks: "Ingest incomplete tasks due this week. Ignore tasks in the 'Groceries' list."`;
      case "notion":
        return `Example for Notion: "Ingest pages in the 'Engineering' workspace that I have edited or commented on."`;

      // Communication
      case "slack":
        return `Example for Slack: "Ingest messages from DMs and the #team-core channel. Capture threads where I am mentioned."`;
      case "discord":
        return `Example for Discord: "Ingest messages from #announcements and #dev-chat. Ignore bot messages."`;
      case "gmail":
        return `Example for Gmail: "Ingest emails from 'important' contacts or with the label 'Work'. Ignore newsletters and promotions."`;
      case "zoho-mail":
        return `Example for Zoho Mail: "Ingest unread emails from my 'Inbox' received in the last 48 hours."`;

      // Code & Development
      case "codeberg":
        return `Example for Codeberg: "Ingest issues assigned to me and pull requests where I am a reviewer. Monitor activity in the 'RedPlanetHQ' organization. Ignore commits from dependabot."`;
      case "github":
        return `Example for GitHub: "Ingest PRs where I am a reviewer and issues assigned to me. Track commits to the 'main' branch."`;
      case "github-analytics":
        return `Example for GitHub Analytics: "Ingest daily view and clone traffic for my top 5 public repositories."`;

      // Calendar & Docs
      case "google-calendar":
        return `Example for Google Calendar: "Ingest upcoming events where I am an attendee. Ignore 'Out of Office' blocks."`;
      case "cal-com":
        return `Example for Cal.com: "Ingest confirmed bookings where I am the host. Ignore cancelled events."`;
      case "google-docs":
        return `Example for Google Docs: "Ingest documents I have modified in the last 7 days."`;
      case "google-sheets":
        return `Example for Google Sheets: "Ingest spreadsheets located in the 'Financials' folder."`;

      // Social & CRM
      case "linkedin":
        return `Example for LinkedIn: "Ingest my posts and professional updates. Capture comments on my posts that mention 'collaboration' or 'partnership'. Ignore generic engagement like 'Congrats!' or 'Good job!'."`;
      case "hubspot":
        return `Example for HubSpot: "Ingest new contacts assigned to me and deals currently in the 'Negotiation' stage."`;

      // Default
      default:
        return `Example: "Only ingest items from the last 24 hours that match specific keywords. Skip automated notifications."`;
    }
  }, [slug]);

  if (!activeAccount) {
    return null;
  }

  return (
    <div className="mt-6 space-y-4">
      <h3 className="text-lg font-medium">Ingestion Rule</h3>
      <div className="bg-background-3 space-y-4 rounded-lg p-4">
        <div className="space-y-2">
          <label htmlFor="ingestionRule" className="text-sm font-medium">
            Rule Description
          </label>
          <Textarea
            id="ingestionRule"
            placeholder={placeholder}
            value={ingestionRuleText}
            onChange={(e) => setIngestionRuleText(e.target.value)}
            className="min-h-[100px]"
          />
          <p className="text-muted-foreground text-sm">
            Describe what data should be ingested from this integration
          </p>
        </div>
        <div className="flex justify-end">
          <Button
            variant="secondary"
            disabled={
              !ingestionRuleText.trim() ||
              ingestionRuleFetcher.state === "submitting"
            }
            onClick={handleIngestionRuleUpdate}
          >
            {ingestionRuleFetcher.state === "submitting"
              ? "Updating..."
              : "Update Rule"}
          </Button>
        </div>
      </div>
    </div>
  );
}
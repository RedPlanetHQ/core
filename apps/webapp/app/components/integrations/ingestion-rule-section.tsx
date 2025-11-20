import React, { useState, useCallback } from "react";
import { useFetcher } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

interface IngestionRuleSectionProps {
  ingestionRule: {
    id: string;
    text: string;
  } | null;
  activeAccount: any;
}

export function IngestionRuleSection({
  ingestionRule,
  activeAccount,
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

  React.useEffect(() => {
    if (ingestionRuleFetcher.state === "idle") {
      // Optionally show success message or refresh
    }
  }, [ingestionRuleFetcher.state, ingestionRuleFetcher.data]);

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
            placeholder={`Example for Gmail: "Only ingest emails from the last 24 hours that contain the word 'urgent' or 'important' in the subject line or body. Skip promotional emails and newsletters. Focus on emails from known contacts or business domains."`}
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

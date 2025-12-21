import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Button } from "~/components/ui/button";

interface EpisodeSidebarProps {
  sessionId: string | null;
  onClose: () => void;
}

export function EpisodeSidebar({ sessionId, onClose }: EpisodeSidebarProps) {
  const [logContent, setLogContent] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setLogContent(null);
      return;
    }

    const fetchLog = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/v1/documents/${sessionId}`);
        if (response.ok) {
          const data = await response.json();
          setLogContent(data.log);
        } else {
          setError("Failed to load episode details");
        }
      } catch (err) {
        console.error("Error fetching log:", err);
        setError("Error loading episode details");
      } finally {
        setLoading(false);
      }
    };

    fetchLog();
  }, [sessionId]);

  if (!sessionId) return null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-border flex items-center justify-between border-b p-2">
        <h2 className="text-md font-semibold">Episode Details</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
          </div>
        )}

        {error && <div className="text-destructive text-sm">{error}</div>}

        {!loading && !error && logContent && (
          <div className="space-y-4">
            {/* Title */}
            {logContent.title && (
              <div>
                <h3 className="text-muted-foreground mb-1 text-sm font-medium">
                  Title
                </h3>
                <p className="text-base">{logContent.title}</p>
              </div>
            )}

            {/* Content */}
            {logContent.data.episodeBody && (
              <div>
                <h3 className="text-muted-foreground mb-1 text-sm font-medium">
                  Content
                </h3>
                <div className="rounded-md p-3 text-base whitespace-pre-wrap">
                  {logContent.data.episodeBody}
                </div>
              </div>
            )}

            {/* Created At */}
            {logContent.createdAt && (
              <div>
                <h3 className="text-muted-foreground mb-1 text-sm font-medium">
                  Created
                </h3>
                <p className="text-sm">
                  {new Date(logContent.createdAt).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

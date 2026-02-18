import { useEffect, useState } from "react";
import { X, Loader2, LoaderCircle } from "lucide-react";
import { Button } from "~/components/ui/button";
import { ClientOnly } from "remix-utils/client-only";
import { DocumentEditorView } from "../logs/views/document-editor-view.client";

interface SessionDocument {
  title: string | null;
  content: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  pendingContent: string | null;
}

interface SessionSidebarProps {
  sessionId: string | null;
  onClose: () => void;
}

export function EpisodeSidebar({ sessionId, onClose }: SessionSidebarProps) {
  const [document, setDocument] = useState<SessionDocument | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setDocument(null);
      return;
    }

    const fetchDocument = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/v1/documents/session/${sessionId}`);
        if (response.ok) {
          const data = await response.json();
          setDocument(data);
        } else {
          setError("Failed to load session details");
        }
      } catch (err) {
        console.error("Error fetching document:", err);
        setError("Error loading session details");
      } finally {
        setLoading(false);
      }
    };

    fetchDocument();
  }, [sessionId]);

  if (!sessionId) return null;

  return (
    <div className="flex h-full flex-col z-50">
      {/* Header */}
      <div className="border-border flex items-center justify-between border-b p-2">
        <h2 className="text-md font-semibold">Session Details</h2>
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

        {error && <div className="text-destructive ">{error}</div>}

        {!loading && !error && document && (
          <div className="space-y-4">
            {/* Title */}
            {document.title && (
              <div>
                <h3 className="text-muted-foreground mb-1 font-medium">
                  Title
                </h3>
                <p className="text-base">{document.title}</p>
              </div>
            )}

            {/* Content */}
            {document.content && (
              <div>
                <h3 className="text-muted-foreground mb-1 font-medium">
                  Content
                </h3>
                <div className="rounded-md whitespace-pre-wrap">
                  <ClientOnly
                    fallback={
                      <div className="flex w-full justify-center">
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                      </div>
                    }
                  >
                    {() => <DocumentEditorView document={document as any} editable={false} />}
                  </ClientOnly>
                </div>
              </div>
            )}

            {/* Pending Content */}
            {document.pendingContent && (
              <div>
                <h3 className="text-muted-foreground mb-1 font-medium">
                  Pending
                </h3>
                <div className="rounded-md p-3 whitespace-pre-wrap bg-muted/50">
                  {document.pendingContent}
                </div>
              </div>
            )}

            {/* Created At */}
            {document.createdAt && (
              <div>
                <h3 className="text-muted-foreground mb-1 font-medium">
                  Created
                </h3>
                <p className="">
                  {new Date(document.createdAt).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

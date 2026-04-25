import { useNavigate, useOutletContext, useParams } from "@remix-run/react";
import { useEffect } from "react";
import { Globe } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { CdpViewer, buildCdpWsUrl } from "~/components/browser/cdp-viewer";
import type { BrowserOutletContext } from "./home.tasks.$taskId.browser";

export default function BrowserSessionRoute() {
  const { sessions, taskId } = useOutletContext<BrowserOutletContext>();
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const session = sessions.find((s) => s.id === sessionId) ?? null;

  // Stale URL — bounce back to the index so it can pick a valid session.
  useEffect(() => {
    if (sessionId && !session && sessions.length > 0) {
      navigate(`/home/tasks/${taskId}/browser`, { replace: true });
    }
  }, [sessionId, session, sessions.length, navigate, taskId]);

  if (!session) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Session not found
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="border-border flex shrink-0 items-center gap-2 border-b px-4 py-2 text-sm">
        <Globe size={14} className="text-muted-foreground" />
        <span className="font-medium">{session.sessionName}</span>
        {session.gateway?.name ? (
          <Badge variant="secondary" className="font-normal">
            <span className="text-[10px]">{session.gateway.name}</span>
          </Badge>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        <CdpViewer
          key={session.id}
          wsUrl={buildCdpWsUrl(session.gatewayId, session.sessionName)}
        />
      </div>
    </div>
  );
}

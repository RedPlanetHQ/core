import { useNavigate, useOutletContext } from "@remix-run/react";
import { useEffect } from "react";
import type { BrowserOutletContext } from "./home.tasks.$taskId.browser";

export default function BrowserIndex() {
  const { sessions, taskId } = useOutletContext<BrowserOutletContext>();
  const navigate = useNavigate();

  // The parent layout already handles the "no sessions" empty state, so
  // when we land here with sessions present, just route to the most-recent
  // one. Remix will revalidate this loader when the user navigates back.
  useEffect(() => {
    if (sessions.length === 0) return;
    navigate(`/home/tasks/${taskId}/browser/${sessions[0]!.id}`, {
      replace: true,
    });
  }, [sessions, taskId, navigate]);

  return null;
}

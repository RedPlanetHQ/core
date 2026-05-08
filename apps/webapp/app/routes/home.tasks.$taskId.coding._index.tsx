import { useNavigate, useOutletContext } from "@remix-run/react";
import { useEffect, useRef } from "react";
import type { CodingOutletContext } from "./home.tasks.$taskId.coding";

export function lastSessionStorageKey(taskId: string): string {
  return `coding:lastSession:${taskId}`;
}

export default function CodingIndex() {
  const { sessions, taskId } = useOutletContext<CodingOutletContext>();
  const navigate = useNavigate();
  // Guard so we only navigate once per mount, even if sessions reference
  // changes due to a loader revalidation while this index is still rendered.
  const didNavigate = useRef(false);

  useEffect(() => {
    if (didNavigate.current || sessions.length === 0) return;
    didNavigate.current = true;

    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem(lastSessionStorageKey(taskId))
        : null;

    const target =
      (stored && sessions.find((s) => s.id === stored)?.id) ?? sessions[0]!.id;

    navigate(`/home/tasks/${taskId}/coding/${target}`, { replace: true });
  }, [sessions, taskId, navigate]);

  return null;
}

import React from "react";
import { PageEditor } from "~/components/editor/page-editor.client";

interface TaskPageEditorProps {
  pageId: string;
  collabToken: string;
  butlerName: string;
  taskId: string;
}

export function TaskPageEditor({
  pageId,
  collabToken,
  butlerName,
  taskId,
}: TaskPageEditorProps) {
  return (
    <PageEditor
      pageId={pageId}
      collabToken={collabToken}
      butlerName={butlerName}
      isToday={false}
      parentTaskId={taskId}
      minHeight="200px"
    />
  );
}

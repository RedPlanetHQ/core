/*
  Warnings:

  - A unique constraint covering the columns `[sessionId,workspaceId]` on the table `Document` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Document_sessionId_workspaceId_key" ON "Document"("sessionId", "workspaceId");

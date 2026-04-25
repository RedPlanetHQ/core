-- DropIndex
DROP INDEX "BrowserSession_gatewayId_sessionName_key";

-- CreateIndex
CREATE INDEX "BrowserSession_gatewayId_sessionName_idx" ON "BrowserSession"("gatewayId", "sessionName");

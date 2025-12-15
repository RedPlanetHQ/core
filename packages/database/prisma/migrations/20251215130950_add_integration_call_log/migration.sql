-- CreateTable
CREATE TABLE "IntegrationCallLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "integrationAccountId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "IntegrationCallLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "IntegrationCallLog" ADD CONSTRAINT "IntegrationCallLog_integrationAccountId_fkey" FOREIGN KEY ("integrationAccountId") REFERENCES "IntegrationAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

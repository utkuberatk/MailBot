-- CreateTable
CREATE TABLE "TrackEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "messageId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "target" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ip" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    CONSTRAINT "TrackEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "companyId" INTEGER NOT NULL,
    "campaignId" INTEGER,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "trackingId" TEXT NOT NULL,
    "gmailMessageId" TEXT,
    "gmailThreadId" TEXT,
    "sentAt" DATETIME,
    "openedAt" DATETIME,
    "lastOpenedAt" DATETIME,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "firstClickAt" DATETIME,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "openNotifiedAt" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("bodyHtml", "campaignId", "companyId", "createdAt", "error", "gmailMessageId", "gmailThreadId", "id", "openCount", "openedAt", "sentAt", "status", "subject", "toEmail", "trackingId") SELECT "bodyHtml", "campaignId", "companyId", "createdAt", "error", "gmailMessageId", "gmailThreadId", "id", "openCount", "openedAt", "sentAt", "status", "subject", "toEmail", "trackingId" FROM "Message";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE UNIQUE INDEX "Message_trackingId_key" ON "Message"("trackingId");
CREATE INDEX "Message_status_idx" ON "Message"("status");
CREATE INDEX "Message_gmailThreadId_idx" ON "Message"("gmailThreadId");
CREATE INDEX "Message_openedAt_idx" ON "Message"("openedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TrackEvent_messageId_type_idx" ON "TrackEvent"("messageId", "type");

-- CreateIndex
CREATE INDEX "TrackEvent_at_idx" ON "TrackEvent"("at");

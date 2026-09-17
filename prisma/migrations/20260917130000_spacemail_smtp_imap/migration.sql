-- Mevcut Gmail kimlikleri korunur. Yeni SMTP/IMAP akisi RFC Message-ID
-- alanlarini kullanir; tum yeni kolonlar nullable oldugu icin eski satirlar
-- degistirilmeden kalir.
ALTER TABLE "Message" ADD COLUMN "rfcMessageId" TEXT;
ALTER TABLE "Reply" ADD COLUMN "rfcMessageId" TEXT;
ALTER TABLE "Reply" ADD COLUMN "imapKey" TEXT;
ALTER TABLE "Reply" ADD COLUMN "inReplyTo" TEXT;
ALTER TABLE "Reply" ADD COLUMN "references" TEXT;

CREATE TABLE "EmailThreadReference" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "messageId" INTEGER NOT NULL,
    "rfcMessageId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailThreadReference_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Message_rfcMessageId_key" ON "Message"("rfcMessageId");
CREATE UNIQUE INDEX "Reply_rfcMessageId_key" ON "Reply"("rfcMessageId");
CREATE UNIQUE INDEX "Reply_imapKey_key" ON "Reply"("imapKey");
CREATE UNIQUE INDEX "EmailThreadReference_rfcMessageId_key" ON "EmailThreadReference"("rfcMessageId");
CREATE INDEX "EmailThreadReference_messageId_idx" ON "EmailThreadReference"("messageId");

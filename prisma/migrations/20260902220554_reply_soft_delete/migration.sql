-- AlterTable
ALTER TABLE "Reply" ADD COLUMN "deletedAt" DATETIME;

-- CreateIndex
CREATE INDEX "Reply_deletedAt_idx" ON "Reply"("deletedAt");

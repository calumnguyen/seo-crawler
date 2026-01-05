-- AlterTable
ALTER TABLE "Backlink" ADD COLUMN     "discoveredVia" TEXT;

-- CreateIndex
CREATE INDEX "Backlink_discoveredVia_idx" ON "Backlink"("discoveredVia");

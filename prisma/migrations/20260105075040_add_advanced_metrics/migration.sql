-- Add content hash for similarity detection
ALTER TABLE "CrawlResult" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;

-- Add performance metrics (as JSONB)
ALTER TABLE "CrawlResult" ADD COLUMN IF NOT EXISTS "performanceMetrics" JSONB;

-- Add mobile-specific metrics (as JSONB)
ALTER TABLE "CrawlResult" ADD COLUMN IF NOT EXISTS "mobileMetrics" JSONB;

-- Create index on contentHash for faster similarity searches
CREATE INDEX IF NOT EXISTS "CrawlResult_contentHash_idx" ON "CrawlResult"("contentHash");


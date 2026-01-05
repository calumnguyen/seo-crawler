-- Add meta robots tag field
ALTER TABLE "CrawlResult" ADD COLUMN IF NOT EXISTS "metaRobots" TEXT;

-- Add content quality metrics
ALTER TABLE "CrawlResult" ADD COLUMN IF NOT EXISTS "wordCount" INTEGER;
ALTER TABLE "CrawlResult" ADD COLUMN IF NOT EXISTS "contentQualityScore" DOUBLE PRECISION;
ALTER TABLE "CrawlResult" ADD COLUMN IF NOT EXISTS "contentDepthScore" DOUBLE PRECISION;

-- Add HTTP headers storage (as JSONB for flexibility)
ALTER TABLE "CrawlResult" ADD COLUMN IF NOT EXISTS "httpHeaders" JSONB;


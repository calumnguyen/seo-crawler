-- Composite indexes for optimized duplicate checks and queries
-- These indexes significantly speed up common query patterns

-- Index for duplicate check in audit (most common query)
CREATE INDEX IF NOT EXISTS "CrawlResult_auditId_url_idx" ON "CrawlResult"("auditId", "url");

-- Index for project-level duplicate checks (14-day deduplication)
-- Note: This requires a join, but helps with the crawledAt filter
CREATE INDEX IF NOT EXISTS "CrawlResult_url_crawledAt_idx" ON "CrawlResult"("url", "crawledAt");

-- Index for content similarity queries (grouping by contentHash)
CREATE INDEX IF NOT EXISTS "CrawlResult_contentHash_statusCode_idx" ON "CrawlResult"("contentHash", "statusCode") WHERE "contentHash" IS NOT NULL AND "statusCode" < 400;


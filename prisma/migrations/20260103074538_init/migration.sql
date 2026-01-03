-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "robotsTxtUrl" TEXT,
    "sitemapUrl" TEXT,
    "crawlDelay" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "pagesCrawled" INTEGER NOT NULL DEFAULT 0,
    "pagesTotal" INTEGER NOT NULL DEFAULT 0,
    "overallScore" DOUBLE PRECISION,
    "technicalScore" DOUBLE PRECISION,
    "contentScore" DOUBLE PRECISION,
    "performanceScore" DOUBLE PRECISION,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlResult" (
    "id" TEXT NOT NULL,
    "auditId" TEXT,
    "domainId" TEXT,
    "url" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "title" TEXT,
    "metaDescription" TEXT,
    "metaKeywords" TEXT,
    "canonicalUrl" TEXT,
    "language" TEXT,
    "responseTimeMs" INTEGER NOT NULL,
    "contentLength" INTEGER,
    "crawledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastModified" TIMESTAMP(3),
    "etag" TEXT,
    "redirectChain" JSONB,
    "redirectCount" INTEGER NOT NULL DEFAULT 0,
    "finalUrl" TEXT,
    "structuredData" JSONB,
    "completenessScore" DOUBLE PRECISION,
    "accuracyScore" DOUBLE PRECISION,
    "freshnessScore" DOUBLE PRECISION,
    "h1Count" INTEGER NOT NULL DEFAULT 0,
    "h2Count" INTEGER NOT NULL DEFAULT 0,
    "h3Count" INTEGER NOT NULL DEFAULT 0,
    "internalLinksCount" INTEGER NOT NULL DEFAULT 0,
    "externalLinksCount" INTEGER NOT NULL DEFAULT 0,
    "imagesCount" INTEGER NOT NULL DEFAULT 0,
    "imagesWithAltCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CrawlResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "auditId" TEXT,
    "crawlResultId" TEXT,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "recommendation" TEXT,
    "details" JSONB,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Heading" (
    "id" TEXT NOT NULL,
    "crawlResultId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Heading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Image" (
    "id" TEXT NOT NULL,
    "crawlResultId" TEXT NOT NULL,
    "src" TEXT NOT NULL,
    "alt" TEXT,
    "title" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Link" (
    "id" TEXT NOT NULL,
    "crawlResultId" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "text" TEXT,
    "isExternal" BOOLEAN NOT NULL,
    "rel" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OgTag" (
    "id" TEXT NOT NULL,
    "crawlResultId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "image" TEXT,
    "type" TEXT,
    "url" TEXT,

    CONSTRAINT "OgTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backlink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourcePageId" TEXT NOT NULL,
    "linkId" TEXT,
    "anchorText" TEXT,
    "isDofollow" BOOLEAN NOT NULL DEFAULT true,
    "isSponsored" BOOLEAN NOT NULL DEFAULT false,
    "isUgc" BOOLEAN NOT NULL DEFAULT false,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "linkPosition" TEXT,

    CONSTRAINT "Backlink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlSchedule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "domainId" TEXT,
    "url" TEXT,
    "crawlFrequency" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "lastCrawledAt" TIMESTAMP(3),
    "nextCrawlAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "crawlType" TEXT NOT NULL,

    CONSTRAINT "CrawlSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditComparison" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "previousAuditId" TEXT NOT NULL,
    "currentAuditId" TEXT NOT NULL,
    "newIssues" INTEGER NOT NULL DEFAULT 0,
    "fixedIssues" INTEGER NOT NULL DEFAULT 0,
    "improvedScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditComparison_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_domain_key" ON "Project"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_domain_key" ON "Domain"("domain");

-- CreateIndex
CREATE INDEX "Audit_projectId_idx" ON "Audit"("projectId");

-- CreateIndex
CREATE INDEX "Audit_startedAt_idx" ON "Audit"("startedAt");

-- CreateIndex
CREATE INDEX "CrawlResult_auditId_idx" ON "CrawlResult"("auditId");

-- CreateIndex
CREATE INDEX "CrawlResult_domainId_idx" ON "CrawlResult"("domainId");

-- CreateIndex
CREATE INDEX "CrawlResult_url_idx" ON "CrawlResult"("url");

-- CreateIndex
CREATE INDEX "CrawlResult_crawledAt_idx" ON "CrawlResult"("crawledAt");

-- CreateIndex
CREATE INDEX "CrawlResult_statusCode_idx" ON "CrawlResult"("statusCode");

-- CreateIndex
CREATE INDEX "CrawlResult_finalUrl_idx" ON "CrawlResult"("finalUrl");

-- CreateIndex
CREATE INDEX "Issue_auditId_idx" ON "Issue"("auditId");

-- CreateIndex
CREATE INDEX "Issue_severity_idx" ON "Issue"("severity");

-- CreateIndex
CREATE INDEX "Issue_category_idx" ON "Issue"("category");

-- CreateIndex
CREATE INDEX "Issue_crawlResultId_idx" ON "Issue"("crawlResultId");

-- CreateIndex
CREATE INDEX "Heading_crawlResultId_idx" ON "Heading"("crawlResultId");

-- CreateIndex
CREATE INDEX "Heading_level_idx" ON "Heading"("level");

-- CreateIndex
CREATE INDEX "Image_crawlResultId_idx" ON "Image"("crawlResultId");

-- CreateIndex
CREATE INDEX "Link_crawlResultId_idx" ON "Link"("crawlResultId");

-- CreateIndex
CREATE INDEX "Link_isExternal_idx" ON "Link"("isExternal");

-- CreateIndex
CREATE INDEX "Link_href_idx" ON "Link"("href");

-- CreateIndex
CREATE UNIQUE INDEX "OgTag_crawlResultId_key" ON "OgTag"("crawlResultId");

-- CreateIndex
CREATE INDEX "Backlink_projectId_idx" ON "Backlink"("projectId");

-- CreateIndex
CREATE INDEX "Backlink_sourcePageId_idx" ON "Backlink"("sourcePageId");

-- CreateIndex
CREATE INDEX "Backlink_discoveredAt_idx" ON "Backlink"("discoveredAt");

-- CreateIndex
CREATE INDEX "Backlink_isActive_idx" ON "Backlink"("isActive");

-- CreateIndex
CREATE INDEX "Backlink_isDofollow_idx" ON "Backlink"("isDofollow");

-- CreateIndex
CREATE UNIQUE INDEX "Backlink_projectId_sourcePageId_linkId_key" ON "Backlink"("projectId", "sourcePageId", "linkId");

-- CreateIndex
CREATE INDEX "CrawlSchedule_projectId_idx" ON "CrawlSchedule"("projectId");

-- CreateIndex
CREATE INDEX "CrawlSchedule_domainId_idx" ON "CrawlSchedule"("domainId");

-- CreateIndex
CREATE INDEX "CrawlSchedule_nextCrawlAt_idx" ON "CrawlSchedule"("nextCrawlAt");

-- CreateIndex
CREATE INDEX "CrawlSchedule_isActive_idx" ON "CrawlSchedule"("isActive");

-- CreateIndex
CREATE INDEX "CrawlSchedule_crawlType_idx" ON "CrawlSchedule"("crawlType");

-- CreateIndex
CREATE INDEX "AuditComparison_projectId_idx" ON "AuditComparison"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditComparison_previousAuditId_currentAuditId_key" ON "AuditComparison"("previousAuditId", "currentAuditId");

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlResult" ADD CONSTRAINT "CrawlResult_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlResult" ADD CONSTRAINT "CrawlResult_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_crawlResultId_fkey" FOREIGN KEY ("crawlResultId") REFERENCES "CrawlResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Heading" ADD CONSTRAINT "Heading_crawlResultId_fkey" FOREIGN KEY ("crawlResultId") REFERENCES "CrawlResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Image" ADD CONSTRAINT "Image_crawlResultId_fkey" FOREIGN KEY ("crawlResultId") REFERENCES "CrawlResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_crawlResultId_fkey" FOREIGN KEY ("crawlResultId") REFERENCES "CrawlResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OgTag" ADD CONSTRAINT "OgTag_crawlResultId_fkey" FOREIGN KEY ("crawlResultId") REFERENCES "CrawlResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backlink" ADD CONSTRAINT "Backlink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backlink" ADD CONSTRAINT "Backlink_sourcePageId_fkey" FOREIGN KEY ("sourcePageId") REFERENCES "CrawlResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backlink" ADD CONSTRAINT "Backlink_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlSchedule" ADD CONSTRAINT "CrawlSchedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlSchedule" ADD CONSTRAINT "CrawlSchedule_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

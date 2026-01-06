# SEO Web Crawler

A comprehensive, enterprise-grade SEO web crawler and audit tool built with Next.js. Automatically crawls websites, analyzes SEO metrics, discovers backlinks via search engines, detects issues, and provides actionable insights.

## 🌟 Key Features

### 🔍 **Comprehensive Website Crawling**
- **Robots.txt Compliance**: Respects robots.txt rules and crawl delays
- **Sitemap Discovery**: Automatically discovers and parses XML sitemaps (supports multiple sitemaps)
- **Sitemap & Robots.txt Storage**: Stores and displays robots.txt and all discovered sitemaps with syntax highlighting
- **Smart Link Following**: Follows internal links with depth control
- **URL Normalization**: Consistent URL handling with session ID and tracking parameter removal
- **Project-Level Deduplication**: Prevents re-crawling within 14-day windows
- **Automatic Deduplication**: Built-in deduplication during crawling (normalized URLs)
- **Honeypot Detection**: Advanced static analysis to detect and avoid honeypot links/traps
- **Proxy Support**: Rotating proxy support with automatic failover
- **Browser Headers**: Realistic browser headers to avoid bot detection
- **Cookie Management**: Session cookie handling for stateful crawling

### 📊 **Advanced SEO Data Collection**

#### On-Page SEO Elements
- **Meta Tags**: Title, description, keywords, robots directives
- **Headings**: H1, H2, H3 extraction and analysis
- **Images**: Alt text, dimensions, missing alt detection
- **Links**: Internal/external classification, rel attributes (nofollow, sponsored, UGC)
- **Canonical URLs**: Canonical tag detection
- **Open Graph Tags**: OG title, description, image, type, URL
- **Language Detection**: HTML lang attribute
- **Structured Data**: JSON-LD schema extraction (Article, FAQ, HowTo, Organization, Review, etc.)

#### Technical SEO Metrics
- **HTTP Status Codes**: Response status tracking
- **Response Time**: Page load performance
- **Redirect Tracking**: Full redirect chains with count and final URL
- **HTTP Headers**: Essential headers for caching/CORS analysis (cache-control, etag, last-modified, etc.)
- **Content Length**: Page size tracking
- **Last Modified & ETag**: Caching metadata

#### Content Quality Metrics
- **Word Count**: Total content words
- **Content Quality Score**: 0-1 score based on title, meta description, H1, word count, images
- **Content Depth Score**: 0-1 score based on content length, structure, and comprehensiveness
- **Content Hash**: SHA-256 hash for duplicate content detection

#### Performance Metrics
- **First Contentful Paint (FCP)**
- **Largest Contentful Paint (LCP)**
- **First Input Delay (FID)**
- **Cumulative Layout Shift (CLS)**
- **Time to Interactive (TTI)**
- **Total Blocking Time (TBT)**
- **Speed Index**

#### Mobile Metrics
- **Viewport Meta Tag**: Presence and content
- **Mobile-Friendliness**: Responsive design detection
- **Touch Target Size**: Accessibility compliance
- **Text Readability**: Font size and contrast
- **Content Width**: Mobile optimization

#### AI SEO Metrics
- **AI SEO Score**: 0-1 score evaluating AI answer effectiveness
- **FAQ Schema Detection**: Highly valued for AI answers
- **HowTo Schema Detection**: Step-by-step content recognition
- **Answer-Focused Content**: Question patterns in headings
- **Structured Data Analysis**: Schema type identification

### 🔗 **Advanced Backlink Discovery System**

#### Three-Tier Backlink Tracking
1. **Forward Backlinks** (Immediate)
   - When Page A is crawled and links to Page B (that exists), backlink is created immediately
   - Works across all projects (cross-domain tracking)

2. **Retroactive Backlinks** (Future Matching)
   - When Page A links to Page B (not yet crawled), link is saved
   - When Page B is later crawled, backlink is created retroactively
   - Ensures no backlinks are missed regardless of crawl order

3. **Reverse Discovery via Search Engines** (External)
   - Uses **Google Programmable Search API** (Custom Search) to query: `link:example.com`
   - Uses **Bing Search API** for additional coverage
   - Discovers pages linking to your site from external sources
   - Queues discovered pages for crawling (low priority)
   - Creates backlinks with `discoveredVia: 'google'` or `'bing'`
   - Integrated with **AntiCaptcha** service for CAPTCHA solving when needed

#### Backlink Metadata
- **Anchor Text**: Link text analysis
- **DoFollow/NoFollow**: Link attribute detection
- **Sponsored/UGC**: Sponsored and user-generated content flags
- **Discovery Method**: Tracks if found via Google, Bing, or normal crawl
- **Cross-Project Tracking**: Finds backlinks from any project/domain

### 🚨 **Automated Issue Detection**

Detects and reports SEO issues automatically:
- **Missing Title Tag**
- **Missing Meta Description**
- **Missing H1 Tag**
- **Multiple H1 Tags**
- **Headings Too Long** (>100 characters)
- **Missing Alt Text**: Images without alt attributes
- **Broken Links**: External links that return 4xx/5xx errors
- **Duplicate Titles**: Across pages in the same project
- **Duplicate Content**: Content similarity detection (60%+ threshold)

### 📈 **Content Similarity Detection**

- **Cross-Project Analysis**: Finds duplicate content across all crawled projects
- **Content Hashing**: SHA-256 hashing for efficient comparison
- **Similarity Threshold**: Configurable (default: 60%)
- **Similar Pages Display**: Shows pages with similar content on detail pages

### 📊 **Interactive Graph Visualization**

- **Page Relationship Graph**: Interactive, zoomable graph showing crawled pages and their relationships
- **Directory-Based Coloring**: Pages grouped by subdirectory with unique colors (150+ color palette)
- **Root Node Identification**: Automatically identifies and highlights the homepage/root page
- **Node Sizing**: Node size based on internal link count
- **Click Navigation**: Click nodes to navigate to page details
- **Force-Directed Layout**: Smooth, intuitive layout algorithm

### 🗑️ **Duplicate URL Cleanup**

- **Automatic Deduplication**: Built into crawling process (prevents duplicates at source)
- **URL Normalization**: Strips session IDs (jsessionid), tracking parameters (utm_*, fbclid, gclid, etc.)
- **Content-Hash Deduplication**: Removes pages with identical content but different URLs
- **Cleanup Script**: `scripts/clean-duplicate-urls.ts` for batch cleanup
- **Web UI Cleanup**: Button on `/crawls` page to remove content-hash duplicates with live logs
- **Dry Run Mode**: Preview what will be deleted before cleanup

### 📊 **Real-Time Monitoring & Logging**

#### Audit Logs (6 Categories)
1. **Setup**: Sitemap discovery, robots.txt parsing
2. **Filtering**: URL filtering and robots.txt compliance
3. **Queued**: URLs queued for crawling
4. **Crawled**: Successfully crawled pages
5. **Skipped**: URLs skipped (duplicates, disallowed, etc.)
6. **Backlink Discovery**: External backlink search logs (Google/Bing queries, results, errors)

#### Real-Time Features
- **Live Log Streaming**: Auto-updating log boxes with search functionality
- **Queue Status**: Real-time job counts (waiting, active, delayed)
- **Progress Tracking**: Pages crawled vs. total pages
- **Diagnostics**: Queue health, connection status, error detection

### ⏸️ **Crawl Control**
- **Pause**: Temporarily pause crawls (can be resumed)
- **Resume**: Continue paused crawls
- **Stop**: Permanently stop crawls (cannot be resumed)
- **Auto-Stop**: Automatically stops paused crawls after 14 days
- **Audit Log Cleanup**: Automatically deletes logs when crawl stops/completes (saves space)
- **Approval System**: Optional robots.txt approval for failed checks

### 📅 **Scheduled Crawls**
- **Recurring Crawls**: Daily, weekly, monthly frequencies
- **Automatic Execution**: Background job processing
- **Priority System**: Configurable crawl priorities

### 💾 **Storage Optimization**

#### Three Storage Levels
1. **Minimal** (Default - 90% space savings)
   - Only essential data: URL, status, title, meta description, counts
   - No headings, images, or links stored
   - Best for cost optimization

2. **Standard** (30% space savings)
   - Essential data + limited detail:
   - First 10 headings per level
   - First 20 images
   - First 50 links
   - Good balance of detail and cost

3. **Full** (No space savings)
   - All data stored: complete headings, images, links
   - Best for detailed analysis

#### Space Optimizations
- **Text Truncation**: Titles (200 chars), descriptions (300 chars)
- **HTTP Header Filtering**: Only essential headers stored (10 max)
- **Structured Data Limiting**: First 3 JSON-LD blocks, 5KB truncation
- **Redirect Chain Limiting**: Max 5 redirects
- **Conditional Storage**: Performance/mobile metrics only if non-null

#### Time Optimizations
- **Parallel Duplicate Checks**: 50% faster (100-150ms → 50-75ms)
- **Composite Indexes**: 10-50x faster queries
- **Content Hash Optimization**: 50% faster on large pages
- **Total Time Savings**: 60% reduction in crawl time

### 🎯 **Dashboard & Analytics**

- **Project Overview**: All projects with audit history
- **Most Recent Project**: Quick view of latest project with crawl status (completed/stopped)
- **Active Crawls**: Real-time crawl progress
- **Recent Activity**: Latest crawls and audits
- **Scheduled Crawls**: Upcoming automatic crawls
- **Crawl History**: Complete crawl result browsing (`/crawls`)
- **Issue Summary**: Aggregated SEO issues across projects
- **Graph View**: Interactive page relationship visualization

## 🛠️ Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Database**: PostgreSQL (Neon serverless)
- **ORM**: Prisma 7
- **Queue**: Bull (Redis)
- **Authentication**: Magic Link (passwordless)
- **Styling**: Tailwind CSS 4
- **HTML Parsing**: Cheerio
- **Robots.txt**: robots-parser
- **Sitemap**: xml2js
- **Graph Visualization**: D3.js, react-force-graph-2d

## 📋 Prerequisites

- **Node.js**: 18+
- **PostgreSQL**: Database (Neon recommended for serverless)
- **Redis**: Queue management (Upstash, Railway, or self-hosted)
- **Magic Link**: Account for authentication
- **Google Programmable Search API**: For backlink discovery (requires API key and Custom Search Engine ID)
- **Bing Search API**: For additional backlink discovery coverage (optional)
- **AntiCaptcha**: Account for CAPTCHA solving (optional, but recommended for search engine queries)

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone <repository-url>
cd seo-web-crawler
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Variables

Create a `.env` file in the root directory:

```env
# Database (Neon recommended)
DATABASE_URL="postgresql://user:password@host/database"
DATABASE_URL_POOL="postgresql://user:password@host-pooler/database?sslmode=require"

# Redis
REDIS_URL="redis://default:password@host:port"

# Magic Link Authentication
NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY="pk_live_..."
MAGIC_SECRET_KEY="sk_live_..."

# Optional: Storage Optimization
CRAWL_STORAGE_LEVEL=minimal  # minimal | standard | full
MAX_TITLE_LENGTH=200
MAX_META_DESCRIPTION_LENGTH=300
MAX_HTTP_HEADERS=10
MAX_STRUCTURED_DATA_BLOCKS=3
MAX_REDIRECT_CHAIN_LENGTH=5

# Optional: Performance
QUEUE_CONCURRENCY=10  # Number of parallel crawl jobs
CRAWL_DELAY_SECONDS=0.5  # Default crawl delay
MAX_CRAWL_DELAY_SECONDS=5  # Maximum crawl delay cap

# Optional: Proxy Support (format: host:port, one per line or comma-separated)
PROXY_LIST="proxy1.com:8080,proxy2.com:8080"

# Optional: Search Engine APIs (for backlink discovery)
GOOGLE_API_KEY="your-google-programmable-search-api-key"
GOOGLE_CUSTOM_SEARCH_ENGINE_ID="your-google-custom-search-engine-id"
BING_SEARCH_API_KEY="your-bing-search-api-key"

# Optional: CAPTCHA Solving (for search engine queries)
CAPTCHA_SOLVER="anticaptcha"  # 'anticaptcha' | '2captcha' | 'none'
CAPTCHA_API_KEY="your-anticaptcha-api-key"
CAPTCHA_TIMEOUT=120000  # Timeout in milliseconds (default: 120000 = 2 minutes)
```

### 4. Database Setup

```bash
# Generate Prisma Client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Initialize first user
npx tsx scripts/init-user.ts
```

### 5. Start Development

```bash
# Terminal 1: Next.js dev server
npm run dev

# Terminal 2: Queue worker (required for crawling)
npm run worker
```

Open [http://localhost:3000](http://localhost:3000) to access the application.

## 📖 Usage Guide

### Creating a Project

1. Navigate to the dashboard
2. Click "Create New Project"
3. Enter:
   - **Project Name**: Display name (must be unique)
   - **Base URL**: Website URL (e.g., `https://example.com`, must be unique)
4. Click "Start Crawl" to begin the initial audit

**Note**: Duplicate project names or domains are prevented. The system will show an error if you try to create a duplicate.

### Managing Crawls

#### Starting a Crawl
- **Automatic**: Click "Start Crawl" from project page
- **Manual**: Use API endpoint `POST /api/audits/[auditId]/start-auto`

#### Controlling Crawls
- **Pause**: Temporarily pause (can resume later)
- **Resume**: Continue a paused crawl
- **Stop**: Permanently stop (cannot resume, logs are cleared)
- **Approve**: Skip robots.txt check if it fails (for manual approval)

#### Monitoring Progress
- **Real-Time Logs**: View live crawl progress with 6 log categories
- **Queue Status**: See waiting, active, and delayed jobs
- **Diagnostics**: Check queue health and connection status

### Viewing Results

#### Page-Level Details
- Navigate to `/crawls/[id]` for detailed page analysis
- View all SEO metrics, structured data, issues, and backlinks
- See similar pages (duplicate content detection)
- Check performance and mobile metrics

#### Project-Level Overview
- Navigate to `/projects/[id]` for project summary
- View all audits and crawl history (completed and stopped)
- View robots.txt and sitemaps with syntax highlighting
- Interactive graph visualization of page relationships
- Analyze trends over time

#### Graph Visualization
- Click "Graph View" tab on project detail page
- Interactive, zoomable graph of crawled pages
- Pages colored by subdirectory
- Click nodes to navigate to page details
- Auto-centered and zoomed on initial load

#### Backlink Analysis
- View backlinks on any crawled page
- See discovery method (Google, Bing, or crawl)
- Filter by DoFollow/NoFollow, Sponsored, UGC
- Track cross-project backlinks

#### Configuration Files (Robots.txt & Sitemaps)
- View robots.txt content with syntax highlighting
- View all discovered sitemaps
- Click any sitemap to view its content with XML syntax highlighting
- All content displayed in modal (no downloads needed)

### Duplicate Cleanup

#### Automatic Deduplication
- Built into the crawling process
- Prevents duplicates based on normalized URLs
- Strips session IDs and tracking parameters automatically

#### Manual Cleanup

**Option 1: Command Line Script**
```bash
# Dry run to see what will be deleted
npx tsx scripts/clean-duplicate-urls.ts --dry-run

# Clean URL-based duplicates (session IDs, tracking params)
npx tsx scripts/clean-duplicate-urls.ts

# Clean content-hash duplicates (same content, different URLs)
npx tsx scripts/clean-duplicate-urls.ts --content-hash-only --dry-run
npx tsx scripts/clean-duplicate-urls.ts --content-hash-only

# For a specific audit
npx tsx scripts/clean-duplicate-urls.ts --audit-id=<audit-id> --dry-run
```

**Option 2: Web UI**
1. Navigate to `/crawls` page
2. Click "Remove Duplicates (Content Hash)" button
3. View live logs in the modal
4. Page refreshes automatically after cleanup

### Issue Detection

Issues are automatically detected and displayed:
- **Inline Display**: Issues shown in relevant sections (Title, Headings, Images, etc.)
- **Severity Levels**: Error, Warning, Info
- **Recommendations**: Actionable suggestions for each issue
- **Details**: Additional context and metadata

## 🗄️ Database Schema

### Key Models

- **User**: System users with email authentication
- **Project**: Websites being crawled
- **Audit**: Crawl sessions and their results
- **CrawlResult**: Individual page crawl data with all SEO metrics
- **Backlink**: Discovered backlinks (cross-project tracking)
- **Issue**: SEO issues and recommendations
- **AuditLog**: Real-time crawl logs (6 categories)
- **CrawlSchedule**: Recurring crawl configurations
- **Domain**: Domain-level metadata (robots.txt content, sitemap URLs and content)

### Relationships

- Project → Audits (1:many)
- Audit → CrawlResults (1:many)
- CrawlResult → Backlinks (1:many, as target)
- CrawlResult → Links (1:many, as source)
- Project → Backlinks (1:many)

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/check-email` - Check if email exists
- `POST /api/auth/login` - Login with Magic Link
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Projects
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create new project (prevents duplicates)
- `GET /api/projects/[id]` - Get project details
- `DELETE /api/projects/[id]` - Delete project
- `GET /api/projects/[id]/audits` - Get project audits
- `GET /api/projects/[id]/crawl-results` - Get project crawl results (domain-filtered)
- `GET /api/projects/[id]/graph` - Get graph data for visualization
- `GET /api/projects/[id]/robots` - Get robots.txt content
- `GET /api/projects/[id]/sitemaps` - Get all sitemaps
- `GET /api/projects/[id]/sitemaps/[index]` - Get specific sitemap content
- `GET /api/projects/[id]/backlinks` - Get project backlinks
- `GET /api/projects/with-audits` - Get projects with audit summaries

### Audits
- `GET /api/audits/[auditId]` - Get audit details
- `POST /api/audits/[auditId]/start-auto` - Start automatic crawl
- `POST /api/audits/[auditId]/pause` - Pause crawl
- `POST /api/audits/[auditId]/resume` - Resume crawl
- `POST /api/audits/[auditId]/stop` - Stop crawl
- `POST /api/audits/[auditId]/approve` - Approve crawl (skip robots.txt)
- `GET /api/audits/[auditId]/crawl-results` - Get audit crawl results
- `GET /api/audits/[auditId]/logs` - Get audit logs (by category)
- `GET /api/audits/[auditId]/diagnostics` - Get queue diagnostics
- `POST /api/audits/check-completion` - Check and mark completed audits
- `POST /api/audits/auto-stop-paused` - Auto-stop paused audits (>14 days)

### Crawl Results
- `GET /api/crawl-results` - List crawl results (with filters, pagination)
- `GET /api/crawl-results/[id]` - Get crawl result details
- `GET /api/crawl-results/[id]/backlinks` - Get backlinks for a page
- `GET /api/crawl-results/[id]/similar` - Get similar pages (duplicate content)
- `POST /api/crawl-results/deduplicate-content-hash` - Remove content-hash duplicates with logs

### Dashboard
- `GET /api/dashboard/activity` - Get active audits and recent crawls
- `GET /api/dashboard/data` - Get crawled data for dashboard
- `GET /api/dashboard/scheduled` - Get scheduled crawls

### Queue
- `GET /api/queue/status` - Get queue status
- `POST /api/queue/clear` - Clear the queue
- `POST /api/queue/cleanup` - Cleanup old jobs
- `POST /api/queue/force-stop` - Force stop all jobs

### Users
- `GET /api/users` - List all users
- `POST /api/users` - Create new user

## 🏗️ Project Structure

```
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API routes
│   │   │   ├── audits/        # Audit management
│   │   │   ├── crawl-results/ # Crawl result endpoints (including deduplication)
│   │   │   ├── dashboard/     # Dashboard data
│   │   │   ├── projects/      # Project management (including graph, robots, sitemaps)
│   │   │   └── queue/         # Queue management
│   │   ├── audits/            # Audit detail pages
│   │   ├── crawls/            # Crawl result pages (including deduplication UI)
│   │   ├── projects/          # Project pages (including graph view)
│   │   └── login/             # Authentication
│   ├── lib/                   # Core libraries
│   │   ├── crawler.ts         # Main crawling logic
│   │   ├── crawler-db-optimized.ts  # Optimized DB storage (with deduplication)
│   │   ├── queue.ts           # Bull queue management
│   │   ├── backlinks.ts       # Backlink tracking
│   │   ├── retroactive-backlinks.ts  # Retroactive backlink creation
│   │   ├── reverse-link-discovery.ts # Search engine backlink discovery
│   │   ├── search-engine-queries.ts  # Google/Bing queries
│   │   ├── issue-detection.ts # SEO issue detection
│   │   ├── advanced-link-checker.ts  # Broken link detection
│   │   ├── content-similarity.ts     # Duplicate content detection
│   │   ├── robots.ts          # Robots.txt handling (with storage)
│   │   ├── sitemap.ts         # Sitemap parsing (with storage)
│   │   ├── deduplication.ts   # URL deduplication
│   │   ├── honeypot-detector.ts # Honeypot link detection
│   │   ├── proxy-fetch.ts     # Proxy support
│   │   ├── proxy-manager.ts   # Proxy rotation
│   │   ├── browser-headers.ts # Browser header simulation
│   │   ├── cookie-manager.ts  # Cookie handling
│   │   ├── captcha-detector.ts # CAPTCHA detection
│   │   ├── captcha-solver.ts  # CAPTCHA solving (placeholder)
│   │   └── audit-logs.ts      # Audit log management
│   ├── components/
│   │   ├── CrawlGraph.tsx     # Interactive graph visualization
│   │   └── ui/                # UI components
│   ├── types/                 # TypeScript definitions
│   │   └── seo.ts            # SEO data types
│   └── generated/            # Generated Prisma client
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── migrations/           # Database migrations
├── scripts/
│   ├── queue-worker.js       # Background queue worker
│   ├── init-user.ts          # User initialization
│   ├── clean-duplicate-urls.ts # Duplicate cleanup script
│   └── check-remaining-duplicates.ts # Diagnostic script
└── public/                   # Static assets
```

## 🔧 Development

### Running Tests

```bash
npm run lint
npm run lint:fix
```

### Database Migrations

```bash
# Create a new migration
npx prisma migrate dev --name migration-name

# Apply migrations in production
npx prisma migrate deploy

# Generate Prisma Client
npx prisma generate
```

### Queue Management

```bash
# Start queue worker
npm run worker

# Check queue status
GET /api/queue/status

# Clear the queue
POST /api/queue/clear
```

### Duplicate Cleanup Scripts

```bash
# Clean URL-based duplicates (session IDs, tracking params)
npx tsx scripts/clean-duplicate-urls.ts --dry-run
npx tsx scripts/clean-duplicate-urls.ts

# Clean content-hash duplicates
npx tsx scripts/clean-duplicate-urls.ts --content-hash-only --dry-run
npx tsx scripts/clean-duplicate-urls.ts --content-hash-only

# Check for remaining duplicates (diagnostic)
npx tsx scripts/check-remaining-duplicates.ts
```

### Environment Variables

See `.env.example` for all available configuration options.

## 📊 Performance & Optimization

### Storage Optimization

The system includes comprehensive space and time optimizations:

- **30-90% space reduction** depending on storage level
- **60% time reduction** in crawl processing
- **Composite indexes** for 10-50x faster queries
- **Parallel processing** for duplicate checks

See `SPACE_TIME_OPTIMIZATION.md` and `OPTIMIZATION_SUMMARY.md` for details.

### Production Database Indexes

Run these in your production database SQL editor:

```sql
-- Composite indexes for performance
CREATE INDEX IF NOT EXISTS "CrawlResult_auditId_url_idx" ON "CrawlResult"("auditId", "url");
CREATE INDEX IF NOT EXISTS "CrawlResult_url_crawledAt_idx" ON "CrawlResult"("url", "crawledAt");
CREATE INDEX IF NOT EXISTS "CrawlResult_contentHash_statusCode_idx" ON "CrawlResult"("contentHash", "statusCode") WHERE "contentHash" IS NOT NULL AND "statusCode" < 400;
```

## 🚢 Deployment

### Vercel Deployment

1. Connect your GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy automatically on push

### Railway Deployment

See `railway.json` for Railway-specific configuration.

### Required Services

- **PostgreSQL**: Neon, Supabase, or self-hosted
- **Redis**: Upstash, Railway, or self-hosted
- **Magic Link**: For authentication

### Queue Worker

The queue worker must run continuously for crawls to process:

```bash
# Production: Use PM2 or similar
pm2 start scripts/queue-worker.js --name seo-crawler-worker

# Or use Railway/Heroku worker dyno
```

## 🔐 Authentication

The application uses Magic Link for passwordless authentication. Only users with emails registered in the database can log in.

### Adding Users

1. Use the `/users` page (requires admin access)
2. Or use the API: `POST /api/users` with email
3. Or use the script: `npx tsx scripts/init-user.ts`

## 📝 Key Features Explained

### Backlink Discovery System

The system uses a three-tier approach:

1. **Forward Backlinks**: When Page A links to Page B (that exists), backlink created immediately
2. **Retroactive Backlinks**: When Page A links to Page B (not yet crawled), link saved and backlink created when Page B is crawled
3. **Search Engine Discovery**: Uses **Google Programmable Search API** (Custom Search) and **Bing Search API** to find external pages linking to your site
   - Integrated with **AntiCaptcha** service for CAPTCHA solving when needed
   - Requires API keys for Google (API key + Custom Search Engine ID) and Bing
   - Google API has a 10,000 queries/day free tier, then falls back to Bing

This ensures comprehensive backlink tracking with reliable API-based discovery.

### Issue Detection

Automatically detects:
- Missing SEO elements (title, description, H1, alt text)
- Structural issues (multiple H1s, long headings)
- Broken links (4xx/5xx errors)
- Duplicate content (60%+ similarity)

Issues are displayed inline on crawl detail pages with severity levels and recommendations.

### Content Similarity

Uses SHA-256 content hashing to detect duplicate content:
- Cross-project analysis
- Configurable similarity threshold
- Similar pages displayed on detail pages

### AI SEO Scoring

Evaluates how effective a page is for AI-powered search results:
- FAQ schema detection (highly valued)
- HowTo schema detection
- Answer-focused content patterns
- Question patterns in headings
- Structured data presence

### Honeypot Detection

Advanced static analysis to detect honeypot links:
- CSS hiding patterns (display:none, visibility:hidden, opacity:0)
- Off-screen positioning (left:-9999px, etc.)
- Zero-size elements
- Hidden class names
- Aria-hidden attributes
- Suspicious URL patterns

Prevents crawlers from following trap links that waste resources.

### URL Normalization & Deduplication

Comprehensive URL normalization to prevent duplicates:
- Strips session IDs from paths (jsessionid, phpsessid, etc.)
- Removes tracking parameters (utm_*, fbclid, gclid, ref, etc.)
- Normalizes trailing slashes
- Removes fragments (#)
- Sorts query parameters
- Removes default ports

Automatic deduplication during crawling prevents duplicate storage.

### Graph Visualization

Interactive graph showing page relationships:
- Force-directed layout for intuitive navigation
- Directory-based coloring (150+ unique colors)
- Root node identification and highlighting
- Node sizing based on link count
- Click-to-navigate functionality
- Auto-centering and zooming

## 🐛 Troubleshooting

### Database Timeouts

If you experience database timeouts:
- Use `DATABASE_URL_POOL` with `-pooler` suffix (Neon)
- Check connection limits
- Review query performance with indexes

### Redis Connection Issues

- Ensure Redis is accessible
- Check `REDIS_URL` format
- Verify Redis maxclients limit

### Queue Not Processing

- Ensure queue worker is running: `npm run worker`
- Check Redis connection
- Review queue diagnostics: `/api/audits/[auditId]/diagnostics`

### Crawl Stuck

- Check audit logs for errors
- Review queue status
- Check robots.txt compliance
- Verify sitemap accessibility

### Duplicate Pages

- Automatic deduplication should prevent most duplicates
- Use cleanup script for existing duplicates: `scripts/clean-duplicate-urls.ts`
- Check normalization rules if duplicates persist
- Use content-hash deduplication for same-content duplicates

## 📚 Additional Documentation

- `OPTIMIZATION.md` - Detailed optimization strategies
- `SPACE_TIME_OPTIMIZATION.md` - Space and time optimization details
- `OPTIMIZATION_SUMMARY.md` - Quick reference for optimizations
- `ARCHITECTURE.md` - System architecture overview
- `KEEP_CRAWLING_RUNNING.md` - Production deployment guide
- `HONEYPOT_DETECTION_ASSESSMENT.md` - Honeypot detection analysis
- `SEARCH_ENGINE_BACKLINK_SOLUTIONS.md` - Backlink discovery strategies
- `RESEARCH.md` - Comprehensive research documentation

## 📄 License

Private project - All rights reserved

## 🤝 Contributing

This is a private project. For questions or issues, contact the project maintainer.

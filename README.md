# SEO Web Crawler

A comprehensive SEO web crawler and audit tool built with Next.js, designed to analyze websites, discover backlinks, and provide detailed SEO insights.

## Features

- 🔍 **Website Crawling**: Automated crawling of websites with robots.txt and sitemap support
- 📊 **SEO Audits**: Comprehensive SEO analysis with technical, content, and performance scores
- 🔗 **Backlink Discovery**: Automatic discovery and tracking of backlinks
- 📈 **Dashboard**: Real-time monitoring of crawl progress and results
- 🔐 **Authentication**: Magic Link authentication with email-based access control
- ⏸️ **Crawl Control**: Pause, resume, and stop crawling operations
- 📅 **Scheduled Crawls**: Automated recurring crawls with configurable frequencies

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Database**: PostgreSQL (Neon)
- **ORM**: Prisma
- **Queue**: Bull (Redis)
- **Authentication**: Magic Link
- **Styling**: Tailwind CSS

## Getting Started

### Prerequisites

- Node.js 18+ 
- PostgreSQL database (or Neon account)
- Redis instance
- Magic Link account (for authentication)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd seo-web-crawler
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env` file in the root directory:
```env
# Database
DATABASE_URL="your-postgresql-connection-string"

# Redis
REDIS_URL="your-redis-connection-string"

# Magic Link Authentication
NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY="your-magic-publishable-key"
MAGIC_SECRET_KEY="your-magic-secret-key"
```

4. Set up the database:
```bash
# Generate Prisma Client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Initialize first user
npx tsx scripts/init-user.ts
```

5. Start the development server:
```bash
npm run dev
```

6. Start the queue worker (in a separate terminal):
```bash
npm run worker
```

Open [http://localhost:3000](http://localhost:3000) to access the application.

## Project Structure

```
├── src/
│   ├── app/              # Next.js App Router pages
│   │   ├── api/          # API routes
│   │   ├── audits/       # Audit detail pages
│   │   ├── crawls/       # Crawl result pages
│   │   ├── projects/     # Project management pages
│   │   ├── users/        # User management page
│   │   └── login/        # Authentication page
│   ├── lib/              # Utility functions and libraries
│   │   ├── crawler.ts    # Main crawling logic
│   │   ├── queue.ts      # Queue management
│   │   ├── prisma.ts     # Database client
│   │   └── auth-context.tsx # Authentication context
│   └── types/            # TypeScript type definitions
├── prisma/
│   └── schema.prisma    # Database schema
└── scripts/
    └── queue-worker.js   # Background queue worker
```

## Usage

### Creating a Project

1. Navigate to the dashboard
2. Enter a project name and base URL
3. Click "Start Crawl" to begin the initial crawl

### Managing Crawls

- **Pause**: Temporarily pause a running crawl (can be resumed)
- **Resume**: Continue a paused crawl
- **Stop**: Permanently stop a crawl (cannot be resumed)

### Viewing Results

- Access detailed audit results from the dashboard
- View individual crawl results and SEO scores
- Analyze backlinks and discover linking opportunities

## Authentication

The application uses Magic Link for passwordless authentication. Only users with emails registered in the database can log in.

To add a new user:
1. Use the `/users` page (requires admin access)
2. Or use the API endpoint: `POST /api/users`

## Database Schema

Key models:
- **User**: System users with email authentication
- **Project**: Websites being crawled
- **Audit**: Crawl sessions and their results
- **CrawlResult**: Individual page crawl data
- **Backlink**: Discovered backlinks
- **Issue**: SEO issues and recommendations

## API Endpoints

### Authentication
- `POST /api/auth/check-email` - Check if email exists
- `POST /api/auth/login` - Login with Magic Link
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Projects
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create new project
- `GET /api/projects/[id]` - Get project details

### Audits
- `GET /api/audits/[auditId]` - Get audit details
- `POST /api/audits/[auditId]/start-auto` - Start automatic crawl
- `POST /api/audits/[auditId]/pause` - Pause crawl
- `POST /api/audits/[auditId]/resume` - Resume crawl
- `POST /api/audits/[auditId]/stop` - Stop crawl

### Users
- `GET /api/users` - List all users
- `POST /api/users` - Create new user

## Development

### Running Tests
```bash
npm run lint
```

### Database Migrations
```bash
# Create a new migration
npx prisma migrate dev --name migration-name

# Apply migrations in production
npx prisma migrate deploy
```

### Queue Management
```bash
# Clear the queue
POST /api/queue/clear

# Check queue status
GET /api/queue/status
```

## Deployment

See [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) for deployment instructions.

## License

Private project - All rights reserved

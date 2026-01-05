import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET - List all projects
export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      include: {
        _count: {
          select: {
            Audit: true,
            Backlink: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

// POST - Create a new project and start first crawl
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, baseUrl } = body;

    if (!name || !baseUrl) {
      return NextResponse.json(
        { error: 'Name and baseUrl are required' },
        { status: 400 }
      );
    }

    // Extract domain from baseUrl
    let domain: string;
    try {
      const url = new URL(baseUrl);
      domain = url.hostname.replace(/^www\./, '');
    } catch {
      return NextResponse.json(
        { error: 'Invalid baseUrl format' },
        { status: 400 }
      );
    }

    // Check if project with this domain already exists
    let project = await prisma.project.findUnique({
      where: { domain },
    });

    if (project) {
      // Project exists, update name if different and create new audit
      if (project.name !== name) {
        project = await prisma.project.update({
          where: { id: project.id },
          data: { name },
        });
      }
    } else {
      // Create new project
      project = await prisma.project.create({
        data: {
          id: crypto.randomUUID(),
          name,
          baseUrl,
          domain,
          updatedAt: new Date(),
        },
      });
    }

    // Create initial audit for this project
    const audit = await prisma.audit.create({
      data: {
        id: crypto.randomUUID(),
        projectId: project.id,
        status: 'pending',
        pagesTotal: 0,
        pagesCrawled: 0,
      },
    });

    return NextResponse.json({
      project,
      audit,
    });
  } catch (error) {
    console.error('Error creating project:', error);
    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500 }
    );
  }
}


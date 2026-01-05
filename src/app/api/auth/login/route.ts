import { NextRequest, NextResponse } from 'next/server';
import { Magic } from '@magic-sdk/admin';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const magic = new Magic(process.env.MAGIC_SECRET_KEY!);

// POST - Verify Magic Link token and create session
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { didToken } = body;

    if (!didToken) {
      return NextResponse.json(
        { error: 'Magic token is required' },
        { status: 400 }
      );
    }

    // Verify the Magic token
    let metadata;
    try {
      metadata = await magic.users.getMetadataByToken(didToken);
    } catch (error) {
      console.error('Magic token verification failed:', error);
      return NextResponse.json(
        { error: 'Invalid or expired Magic token' },
        { status: 401 }
      );
    }

    const email = metadata.email;
    if (!email) {
      return NextResponse.json(
        { error: 'Email not found in Magic token' },
        { status: 400 }
      );
    }

    // Check if user exists in database
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found in database' },
        { status: 404 }
      );
    }

    // Create session (store user info in cookie)
    const cookieStore = await cookies();
    cookieStore.set('user', JSON.stringify({
      id: user.id,
      email: user.email,
      name: user.name,
    }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('Error during login:', error);
    return NextResponse.json(
      { error: 'Failed to complete login' },
      { status: 500 }
    );
  }
}



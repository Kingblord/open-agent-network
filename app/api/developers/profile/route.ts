import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest, withAuth } from '@/lib/api-middleware';
import { getDeveloper, updateDeveloper } from '@/lib/db';
import { JWTPayload, verifyToken } from '@/lib/auth';

async function GET(
  request: NextRequest,
  context: any,
  user: JWTPayload
) {
  try {
    const developer = await getDeveloper(user.developerId);

    if (!developer) {
      return NextResponse.json(
        { error: 'Developer not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: developer.id,
      name: developer.name,
      email: developer.email,
      credits: developer.credits,
      tier: developer.tier,
      createdAt: developer.createdAt,
      updatedAt: developer.updatedAt,
    });
  } catch (error) {
    console.error('[v0] Get profile error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function PUT(
  request: NextRequest,
  context: any,
  user: JWTPayload
) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string' || name.length < 2) {
      return NextResponse.json(
        { error: 'Invalid name provided' },
        { status: 400 }
      );
    }

    await updateDeveloper(user.developerId, { name });

    const developer = await getDeveloper(user.developerId);

    return NextResponse.json({
      message: 'Profile updated successfully',
      developer: {
        id: developer?.id,
        name: developer?.name,
        email: developer?.email,
        credits: developer?.credits,
        tier: developer?.tier,
      },
    });
  } catch (error) {
    console.error('[v0] Update profile error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Create wrapped handlers
async function handleGET(request: NextRequest, context: any) {
  const token = getTokenFromRequest(request);
  if (!token) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const user = verifyToken(token);
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return GET(request, context, user);
}

async function handlePUT(request: NextRequest, context: any) {
  const token = getTokenFromRequest(request);
  if (!token) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const user = verifyToken(token);
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return PUT(request, context, user);
}

export { handleGET as GET, handlePUT as PUT };

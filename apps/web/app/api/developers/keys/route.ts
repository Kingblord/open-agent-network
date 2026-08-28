import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken, generateApiKey, hashApiKey } from '@/lib/auth';
import { getDeveloperApiKeys, createApiKey, revokeApiKey } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
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

    const keys = await getDeveloperApiKeys(user.developerId);

    return NextResponse.json({
      keys: keys.map(key => ({
        id: key.id,
        name: key.name,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
        isRevoked: key.revokedAt !== null,
      })),
    });
  } catch (error) {
    console.error('[v0] Get API keys error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
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

    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string' || name.length < 1) {
      return NextResponse.json(
        { error: 'Invalid API key name' },
        { status: 400 }
      );
    }

    // Generate API key
    const apiKey = generateApiKey();
    const keyHash = await hashApiKey(apiKey);

    // Store in database — createApiKey requires the full ApiKey object (Omit<ApiKey, 'id'>)
    const keyId = await createApiKey({
      developerId: user.developerId,
      keyHash,
      name,
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: null,
    });

    return NextResponse.json(
      {
        message: 'API key created successfully',
        keyId,
        apiKey, // Only show once!
        name,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[v0] Create API key error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, JWTPayload } from './auth';

// Extract token from request headers or cookies
export function getTokenFromRequest(request: NextRequest): string | null {
  // Try to get from Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Try to get from cookies
  const cookieToken = request.cookies.get('oan-token')?.value;
  if (cookieToken) {
    return cookieToken;
  }

  return null;
}

// Middleware to verify authentication
export function withAuth(
  handler: (
    request: NextRequest,
    context: any,
    user: JWTPayload
  ) => Promise<NextResponse>
) {
  return async (request: NextRequest, context: any) => {
    try {
      const token = getTokenFromRequest(request);

      if (!token) {
        return NextResponse.json(
          { error: 'Unauthorized: No token provided' },
          { status: 401 }
        );
      }

      const payload = verifyToken(token);
      if (!payload) {
        return NextResponse.json(
          { error: 'Unauthorized: Invalid token' },
          { status: 401 }
        );
      }

      return handler(request, context, payload);
    } catch (error) {
      console.error('[v0] Auth middleware error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  };
}

// Middleware to verify API key
export async function withApiKey(
  handler: (request: NextRequest, context: any, developerId: string) => Promise<NextResponse>
) {
  return async (request: NextRequest, context: any) => {
    try {
      const apiKey = request.headers.get('x-api-key');

      if (!apiKey) {
        return NextResponse.json(
          { error: 'Unauthorized: No API key provided' },
          { status: 401 }
        );
      }

      // In a real implementation, you would verify the API key against the database
      // For MVP, we'll just check if it matches the pattern
      if (!apiKey.startsWith('oan_')) {
        return NextResponse.json(
          { error: 'Unauthorized: Invalid API key' },
          { status: 401 }
        );
      }

      // TODO: Implement proper API key verification against Firestore
      // For now, we'll extract the developer ID from a claim in the key
      const developerId = request.headers.get('x-developer-id') || '';

      if (!developerId) {
        return NextResponse.json(
          { error: 'Unauthorized: Missing developer ID' },
          { status: 401 }
        );
      }

      return handler(request, context, developerId);
    } catch (error) {
      console.error('[v0] API key middleware error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  };
}

import { NextRequest, NextResponse } from 'next/server';
import { LoginRequestSchema } from '@/lib/schemas';
import { getDeveloperByEmail } from '@/lib/db';
import { comparePassword, generateToken, setAuthCookie } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
    const validatedData = LoginRequestSchema.parse(body);

    // Find developer by email
    const developer = await getDeveloperByEmail(validatedData.email);
    if (!developer) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Compare password
    const passwordMatch = await comparePassword(validatedData.password, developer.password);
    if (!passwordMatch) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Generate JWT token
    const token = generateToken({
      developerId: developer.id,
      email: developer.email,
    });

    // Set auth cookie
    await setAuthCookie(token);

    return NextResponse.json(
      {
        message: 'Login successful',
        developerId: developer.id,
        token,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[v0] Login error:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

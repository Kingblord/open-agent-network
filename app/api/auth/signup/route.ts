import { NextRequest, NextResponse } from 'next/server';
import { SignupRequestSchema } from '@/lib/schemas';
import { getDeveloperByEmail, createDeveloper } from '@/lib/db';
import { hashPassword, generateToken, setAuthCookie } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
    const validatedData = SignupRequestSchema.parse(body);

    // Check if email already exists
    const existingDeveloper = await getDeveloperByEmail(validatedData.email);
    if (existingDeveloper) {
      return NextResponse.json(
        { error: 'Email already registered' },
        { status: 409 }
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(validatedData.password);

    // Generate developer ID
    const developerId = `dev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create developer
    await createDeveloper(developerId, {
      name: validatedData.name,
      email: validatedData.email,
      password: hashedPassword,
      credits: 50, // Initial credits for MVP
      tier: 'free',
    });

    // Generate JWT token
    const token = generateToken({
      developerId,
      email: validatedData.email,
    });

    // Set auth cookie
    await setAuthCookie(token);

    return NextResponse.json(
      {
        message: 'Signup successful',
        developerId,
        token,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[v0] Signup error:', error);

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

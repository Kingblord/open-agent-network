import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
import { cookies } from 'next/headers';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-do-not-use-in-production';
const JWT_EXPIRY = '7d';
const TOKEN_NAME = 'oan-token';

export interface JWTPayload {
  developerId: string;
  email: string;
  iat?: number;
  exp?: number;
}

// Generate JWT token
export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

// Verify JWT token
export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch (error) {
    console.error('[v0] Token verification failed:', error);
    return null;
  }
}

// Hash password
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcryptjs.genSalt(10);
  return bcryptjs.hash(password, salt);
}

// Compare password
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcryptjs.compare(password, hash);
}

// Generate API Key (random string)
export function generateApiKey(): string {
  return 'oan_' + require('crypto').randomBytes(32).toString('hex');
}

// Hash API Key
export async function hashApiKey(apiKey: string): Promise<string> {
  return hashPassword(apiKey);
}

// Set auth token in cookies
export async function setAuthCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(TOKEN_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });
}

// Get auth token from cookies
export async function getAuthCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(TOKEN_NAME)?.value;
}

// Remove auth token from cookies
export async function removeAuthCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(TOKEN_NAME);
}

// Verify API Key against hash
export async function verifyApiKey(apiKey: string, hash: string): Promise<boolean> {
  return comparePassword(apiKey, hash);
}

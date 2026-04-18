import { Context } from 'hono';
import { sign, verify } from 'hono/jwt';
import bcrypt from 'bcryptjs';

// Extend Hono Context type to include user
declare module 'hono' {
  interface ContextVariableMap {
    user: {
      userId: string;
      email: string;
      role: string;
    };
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(password, hashed);
}

export async function generateAccessToken(
  payload: { userId: string; email: string; role: string },
  secret: string
): Promise<string> {
  // CRITICAL CHECK: Throw a clear error if the secret is missing
  if (!secret) {
    throw new Error('INTERNAL_ERROR: JWT_SECRET is undefined. Check your .dev.vars or Wrangler secrets.');
  }

  // Use a 7-day expiration
  const expirationTime = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  
  // Explicitly set the algorithm to HS256 to avoid Hono type issues
  return sign({ ...payload, exp: expirationTime }, secret, 'HS256');
}

export async function verifyToken(
  token: string,
  secret: string
): Promise<{ userId: string; email: string; role: string }> {
  try {
    const payload = await verify(token, secret, 'HS256');
    return payload as { userId: string; email: string; role: string };
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

export function setAuthCookie(c: Context, token: string): void {
  const maxAge = 7 * 24 * 60 * 60; // 7 days in seconds
  c.header('Set-Cookie', `token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
}

export function clearAuthCookie(c: Context): void {
  c.header('Set-Cookie', 'token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
}

export function getAuthTokenFromCookie(c: Context): string | null {
  const cookie = c.req.header('Cookie');
  if (!cookie) return null;

  const match = cookie.match(/token=([^;]+)/);
  return match ? match[1] : null;
}

export async function authMiddleware(c: Context, next: () => Promise<void>): Promise<void> {
  const token = getAuthTokenFromCookie(c);
  if (!token) {
    c.status(401);
    await c.json({ error: 'Unauthorized' });
    return;
  }

  try {
    const secret = (c.env as any)?.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET not configured');
    }

    const payload = await verifyToken(token, secret);
    c.set('user', payload);
    await next();
  } catch (error) {
    c.status(401);
    await c.json({ error: 'Unauthorized' });
  }
}

export async function adminMiddleware(c: Context, next: () => Promise<void>): Promise<void> {
  const user = c.get('user');
  if (!user || user.role !== 'admin') {
    c.status(403);
    await c.json({ error: 'Forbidden: Admin access required' });
    return;
  }
  await next();
}
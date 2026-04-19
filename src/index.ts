import { serveStatic } from 'hono/cloudflare-workers'; // Make sure you have this import at the top
import { Hono } from 'hono';
import { getDb } from './db';
import { customAlphabet } from 'nanoid';
import { z } from 'zod';
import { authMiddleware, hashPassword, verifyPassword, generateAccessToken, setAuthCookie, clearAuthCookie, getAuthTokenFromCookie, verifyToken, adminMiddleware } from './auth';

// Non-ambiguous alphabet for URL slugs (excludes 0/O, 1/I/l, etc.)
const nanoid = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz', 6);

type Bindings = {
  DATABASE_URL: string;
  JWT_SECRET: string;
  ASSETS: { fetch: (req: Request) => Promise<Response> }; // Tell TypeScript about the Cloudflare Assets fetcher
};

const app = new Hono<{ Bindings: Bindings }>();

// Validation schemas
const urlSchema = z.object({
  url: z.string().url('Invalid URL format'),
});

const signupSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

// Initialize database
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Auth routes
const authRouter = new Hono<{ Bindings: Bindings }>();

authRouter.post('/signup', async (c) => {
  try {
    const body = await c.req.json();
    const { email, password } = signupSchema.parse(body);

    const db = getDb(c.env.DATABASE_URL);

    // Check if user already exists
    const existingUser = await db`
      SELECT id FROM users WHERE email = ${email}
    `;

    if (Array.isArray(existingUser) && existingUser.length > 0) {
      return c.json({ error: 'User already exists' }, 400);
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const result = await db`
      INSERT INTO users (email, password_hash)
      VALUES (${email}, ${passwordHash})
      RETURNING id, email, role, created_at
    `;

    if (!Array.isArray(result) || result.length === 0) {
      throw new Error('Failed to create user');
    }

    const user = result[0] as { id: string; email: string; role: string; created_at: Date };

    // Generate JWT token
    const token = await generateAccessToken(
      {
        userId: user.id,
        email: user.email,
        role: user.role
      },
      c.env.JWT_SECRET
    );

    // Set secure cookie
    setAuthCookie(c, token);

    // Return user info (without password)
    return c.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid input' }, 400);
    }
    console.error('Error in signup:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

authRouter.post('/login', async (c) => {
  try {
    const body = await c.req.json();
    const { email, password } = loginSchema.parse(body);

    const db = getDb(c.env.DATABASE_URL);

    // Find user
    const result = await db`
      SELECT id, email, password_hash, role, created_at
      FROM users
      WHERE email = ${email}
    `;

    if (!Array.isArray(result) || result.length === 0) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const user = result[0] as { id: string; email: string; password_hash: string; role: string; created_at: Date };

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Generate JWT token
  // Add this check!
  if (!c.env.JWT_SECRET) {
    console.error("FATAL: JWT_SECRET is missing from environment.");
    return c.json({ error: 'Server configuration error' }, 500);
  }

  // Then generate the token
  const token = await generateAccessToken(
    {
      userId: user.id,
      email: user.email,
      role: user.role
    },
    c.env.JWT_SECRET  
  );

    // Set secure cookie
    setAuthCookie(c, token);

    // Return user info (without password)
    return c.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid input' }, 400);
    }
    console.error('Error in login:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

authRouter.post('/logout', (c) => {
  clearAuthCookie(c);
  return c.json({ message: 'Logged out successfully' });
});

// 👇 ADD THIS NEW ROUTE 👇
authRouter.get('/me', async (c) => {
  const token = getAuthTokenFromCookie(c);
  if (!token) {
    return c.json({ authenticated: false }, 401);
  }

  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    return c.json({
      authenticated: true,
      user: {
        id: payload.userId,
        email: payload.email,
        role: payload.role
      }
    });
  } catch (e) {
    return c.json({ authenticated: false }, 401);
  }
});
// 👆 END OF NEW ROUTE 👆
// Apply auth routes
app.route('/auth', authRouter);

// Main routes
app.post('/shorten', async (c) => {
  try {
    const body = await c.req.json();
    const { url } = urlSchema.parse(body);

    const db = getDb(c.env.DATABASE_URL);

    // Get user from JWT token if available
    let userId: string | null = null;
    const token = getAuthTokenFromCookie(c);
    if (token) {
      try {
        const payload = await verifyToken(token, c.env.JWT_SECRET);
        userId = payload.userId;
      } catch (e) {
        // Invalid token, user remains anonymous
        console.debug('Invalid token during shorten:', e);
      }
    }

    // Generate a unique 6-character slug
    let slug = '';
    let exists = true;

    while (exists) {
      slug = nanoid();
      const result = await db`SELECT slug FROM links WHERE slug = ${slug}`;
      exists = Array.isArray(result) && result.length > 0;
    }

    // Insert the new link
    const result = await db`
      INSERT INTO links (slug, original_url, user_id)
      VALUES (${slug}, ${url}, ${userId})
      RETURNING id, slug, original_url, clicks, created_at, user_id
    ` as unknown as Promise<{
      id: number;
      slug: string;
      original_url: string;
      clicks: number;
      created_at: Date;
      user_id: string | null;
    }[]>;

    if (!Array.isArray(result) || result.length === 0) {
      throw new Error('Failed to create short URL');
    }

    const link = result[0];

    // Construct the short URL (in production, this would be your domain)
    const host = c.req.header('Host') || 'localhost:8787';
    const shortUrl = `https://${host}/${slug}`;

    return c.json({
      shortUrl,
      slug,
      originalUrl: link.original_url,
      userId: link.user_id
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid URL' }, 400);
    }
    console.error('Error in shorten endpoint:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Redirect route for 6-character slugs with analytics - placed at the end to avoid intercepting routes
// 🛡️ The Bulletproof Admin Route
app.get('/admin', async (c) => {
  const token = getAuthTokenFromCookie(c);
  
  if (!token) return c.redirect('/login.html');

  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    
    if (payload.role !== 'admin') {
      return c.redirect('/login.html');
    }

    // 🚀 USE c.env.ASSETS TO BYPASS HONO AND FETCH THE STATIC FILE DIRECTLY
    // Note: The file in your public folder must be named 'admin-protected.html'
    const url = new URL(c.req.url);
    url.pathname = '/admin-protected.html';
    
    return await c.env.ASSETS.fetch(new Request(url));
    
  } catch (e) {
    console.error("Admin Route Error:", e);
    return c.redirect('/login.html');
  }
});

// Block direct access to the hidden file
app.get('/admin-protected.html', (c) => c.text('Forbidden', 403));

app.get('/:slug', async (c) => {
  const { slug } = c.req.param();

  // Only process if slug is exactly 6 characters to avoid interfering with other routes
  if (slug.length !== 6) {
    return c.notFound();
  }

  // Avoid interfering with specific routes
  if (slug === 'shorten' || slug === 'api') {
    return c.notFound();
  }

  const db = getDb(c.env.DATABASE_URL);

  // Find the link by slug
  const result = await db`
    SELECT id, original_url, clicks
    FROM links
    WHERE slug = ${slug}
  ` as unknown as Promise<{
    id: number;
    slug: string;
    original_url: string;
    clicks: number;
    created_at: Date;
  }[]>;

  if (!Array.isArray(result) || result.length === 0) {
    return c.notFound();
  }

  const link = result[0];

  // Increment click count
  await db`
    UPDATE links
    SET clicks = clicks + 1
    WHERE id = ${link.id}
  `;

  // Log analytics (non-blocking)
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const ipHash = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown')
        );
        const ipHashHex = Array.from(new Uint8Array(ipHash))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');

        await db`
          INSERT INTO analytics (link_id, ip_hash, user_agent, referer)
          VALUES (${link.id}, ${ipHashHex}, ${c.req.header('User-Agent') || 'unknown'}, ${c.req.header('Referer') || null})
        `;
      } catch (error) {
        console.error('Analytics logging error:', error);
        // Don't fail the request if analytics fails
      }
    })()
  );

  // Redirect to original URL
  return c.redirect(link.original_url, 301);
});

// Admin routes (protected)
const adminRouter = new Hono<{ Bindings: Bindings }>();

// Middleware to verify JWT token and admin role
adminRouter.use('*', async (c, next) => {
  try {
    const token = getAuthTokenFromCookie(c);
    if (!token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Verify JWT token
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    
    // Check if user is admin
    if (payload.role !== 'admin') {
      return c.json({ error: 'Forbidden: Admin access required' }, 403);
    }

    // Store user in context for use in route handlers
    c.set('user', payload);
    await next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    return c.json({ error: 'Unauthorized' }, 401);
  }
});

// Admin stats
adminRouter.get('/stats', async (c) => {
  try {
    const db = getDb(c.env.DATABASE_URL);

    // Get total users
    const usersResult = (await db`SELECT COUNT(*) as count FROM users`) as unknown as Array<{ count: number }>;
    const totalUsers = usersResult && usersResult.length > 0 ? Number(usersResult[0].count) : 0;

    // Get total links
    const linksResult = (await db`SELECT COUNT(*) as count FROM links`) as unknown as Array<{ count: number }>;
    const totalLinks = linksResult && linksResult.length > 0 ? Number(linksResult[0].count) : 0;

    // Get clicks in last 24h
    const clicks24hResult = (await db`
      SELECT COUNT(*) as count
      FROM analytics
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    `) as unknown as Array<{ count: number }>;
    const clicks24h = clicks24hResult && clicks24hResult.length > 0 ? Number(clicks24hResult[0].count) : 0;

    // Get clicks this month
    const clicksMonthResult = (await db`
      SELECT COUNT(*) as count
      FROM analytics
      WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
    `) as unknown as Array<{ count: number }>;
    const clicksMonth = clicksMonthResult && clicksMonthResult.length > 0 ? Number(clicksMonthResult[0].count) : 0;

    return c.json({
      totalUsers,
      totalLinks,
      clicks24h,
      clicksMonth
    });
  } catch (error) {
    console.error('Error in admin stats:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Admin users list
adminRouter.get('/users', async (c) => {
  try {
    const db = getDb(c.env.DATABASE_URL);

    const result = await db`
      SELECT id, email, role, created_at
      FROM users
      ORDER BY created_at DESC
    `;

    const users = Array.isArray(result) ? result.map((user: any) => ({
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.created_at
    })) : [];

    return c.json({ users });
  } catch (error) {
    console.error('Error in admin users:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Apply admin routes with prefix
app.route('/api/admin', adminRouter);

// User history route (protected)
app.get('/api/user/history', async (c) => {
  try {
    // Extract user from JWT token
    const token = getAuthTokenFromCookie(c);
    if (!token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
      const payload = await verifyToken(token, c.env.JWT_SECRET);
      const userId = payload.userId;

      const db = getDb(c.env.DATABASE_URL);

      // Fetch links for the authenticated user
      const result = await db`
        SELECT l.id, l.slug, l.original_url, l.clicks, l.created_at,
               COUNT(a.id) as analytics_count
        FROM links l
        LEFT JOIN analytics a ON l.id = a.link_id
        WHERE l.user_id = ${userId}
        GROUP BY l.id, l.slug, l.original_url, l.clicks, l.created_at
        ORDER BY l.created_at DESC
      `;

      const links = Array.isArray(result) ? result.map((link: any) => ({
        id: link.id,
        slug: link.slug,
        originalUrl: link.original_url,
        clicks: link.clicks,
        createdAt: link.created_at,
        analyticsCount: link.analytics_count || 0
      })) : [];

      return c.json({ links });
    } catch (error) {
      console.error('Error verifying token:', error);
      return c.json({ error: 'Unauthorized' }, 401);
    }
  } catch (error) {
    console.error('Error in user history:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

export default app;
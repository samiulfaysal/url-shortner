import { Hono } from 'hono';
import { getDb } from './db';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { serveStatic } from 'hono/cloudflare-workers';

const app = new Hono();

// Validation schema for URL
const urlSchema = z.object({
  url: z.string().url('Invalid URL format'),
});

// Serve static files from public directory
app.use('/*', serveStatic({ root: './public/', manifest: {} }));

// Initialize database
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// POST /shorten - Create a new short URL
app.post('/shorten', async (c) => {
  try {
    const body = await c.req.json();
    const { url } = urlSchema.parse(body);

    const db = getDb();

    // Generate a unique 6-character slug
    let slug = '';
    let exists = true;

    while (exists) {
      slug = nanoid(6);
      const result = await db`SELECT slug FROM links WHERE slug = ${slug}`;
      exists = Array.isArray(result) && result.length > 0;
    }

    // Insert the new link
    const result = await db`
      INSERT INTO links (slug, original_url)
      VALUES (${slug}, ${url})
      RETURNING id, slug, original_url, clicks, created_at
    ` as unknown as Promise<{
      id: number;
      slug: string;
      original_url: string;
      clicks: number;
      created_at: Date;
    }[]>;

    const link = Array.isArray(result) && result.length > 0 ? result[0] : result;

    // Construct the short URL (in production, this would be your domain)
    const host = c.req.header('Host') || 'localhost:8787';
    const shortUrl = `https://${host}/api/${slug}`;

    return c.json({
      shortUrl,
      slug,
      originalUrl: link.original_url,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid URL' }, 400);
    }
    throw error;
  }
});

// GET /api/:slug - Redirect to original URL
app.get('/api/:slug', async (c) => {
  const { slug } = c.req.param();

  const db = getDb();

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
    return c.json({ error: 'URL not found' }, 404);
  }

  const link = result[0];

  // Increment click count
  await db`
    UPDATE links
    SET clicks = clicks + 1
    WHERE id = ${link.id}
  `;

  // Redirect to original URL
  return c.redirect(link.original_url, 301);
});

// Catch-all route for handling direct slug access (without /api prefix)
app.get('/:slug', async (c) => {
  const { slug } = c.req.param();

  // Avoid interfering with API routes
  if (slug === 'shorten' || slug === 'api') {
    return c.notFound();
  }

  const db = getDb();

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

  // Redirect to original URL
  return c.redirect(link.original_url, 301);
});

export default app;
import { Hono } from 'hono';
import { getDb } from './db';
import { nanoid } from 'nanoid';
import { z } from 'zod';

type Bindings = {
  DATABASE_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Validation schema for URL
const urlSchema = z.object({
  url: z.string().url('Invalid URL format'),
});

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

    const db = getDb(c.env.DATABASE_URL);

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
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid URL' }, 400);
    }
    console.error('Error in shorten endpoint:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Redirect route for 6-character slugs - placed at the end to avoid intercepting routes
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

  // Redirect to original URL
  return c.redirect(link.original_url, 301);
});

export default app;
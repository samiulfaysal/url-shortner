import { Hono } from 'hono';
import { getDb } from './db';
import { nanoid } from 'nanoid';
import { z } from 'zod';

const app = new Hono();

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
    ` as Promise<{
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
  ` as Promise<{
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

// GET / - Serve frontend
app.get('/', async (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>URL Shortener</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-900 text-gray-100 min-h-screen flex flex-col items-center justify-center p-4">
      <div class="w-full max-w-xl">
        <h1 class="text-3xl font-bold mb-6 text-center">URL Shortener</h1>

        <form id="shorten-form" class="bg-gray-800 rounded-lg p-6 w-full">
          <div class="mb-4">
            <label for="url-input" class="block mb-2 font-medium">Enter URL to shorten:</label>
            <input
              type="url"
              id="url-input"
              required
              class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://example.com/very/long/url"
            />
          </div>

          <button
            type="submit"
            id="shorten-btn"
            class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
          >
            Shorten URL
          </button>
        </form>

        <div id="result" class="mt-6 hidden">
          <div class="bg-gray-800 rounded-lg p-4">
            <p class="mb-2 font-medium">Your short URL:</p>
            <div class="flex items-center space-x-3">
              <input
                type="text"
                id="short-url-output"
                readonly
                class="flex-1 bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-sm"
              />
              <button
                id="copy-btn"
                class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
              >
                Copy
              </button>
            </div>
          </div>
        </div>

        <div id="error" class="mt-4 hidden text-red-400 text-center"></div>
      </div>

      <script>
        document.getElementById('shorten-form')?.addEventListener('submit', async (e) => {
          e.preventDefault();

          const urlInput = document.getElementById('url-input') as HTMLInputElement;
          const shortenBtn = document.getElementById('shorten-btn') as HTMLButtonElement;
          const resultDiv = document.getElementById('result');
          const shortUrlOutput = document.getElementById('short-url-output') as HTMLInputElement;
          const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
          const errorDiv = document.getElementById('error');

          const url = urlInput.value.trim();

          if (!url) {
            errorDiv.textContent = 'Please enter a URL';
            errorDiv.classList.remove('hidden');
            return;
          }

          shortenBtn.disabled = true;
          shortenBtn.textContent = 'Shortening...';
          errorDiv.classList.add('hidden');

          try {
            const response = await fetch('/shorten', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ url }),
            });

            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || 'Failed to shorten URL');
            }

            const data = await response.json();
            shortUrlOutput.value = data.shortUrl;
            resultDiv.classList.remove('hidden');

          } catch (error) {
            errorDiv.textContent = error.message || 'An error occurred';
            errorDiv.classList.remove('hidden');
          } finally {
            shortenBtn.disabled = false;
            shortenBtn.textContent = 'Shorten URL';
          }
        });

        document.getElementById('copy-btn')?.addEventListener('click', () => {
          const shortUrlOutput = document.getElementById('short-url-output') as HTMLInputElement;
          shortUrlOutput.select();
          document.execCommand('copy');

          const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
          const originalText = copyBtn.textContent;
          copyBtn.textContent = 'Copied!';

          setTimeout(() => {
            copyBtn.textContent = originalText;
          }, 2000);
        });
      </script>
    </body>
    </html>
  `);
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
  ` as Promise<{
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
import { neon } from '@neondatabase/serverless';

let db: ReturnType<typeof neon> | null = null;

export function getDb(): ReturnType<typeof neon> {
  if (!db) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    db = neon(databaseUrl);
  }
  return db;
}
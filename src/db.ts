import { neon } from '@neondatabase/serverless';

let db: ReturnType<typeof neon> | null = null;

export function getDb(databaseUrl: string): ReturnType<typeof neon> {
  if (!db) {
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    db = neon(databaseUrl);
  }
  return db;
}
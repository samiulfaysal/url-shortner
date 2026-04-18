import { neon } from '@neondatabase/serverless';

export function getDb(databaseUrl: string): ReturnType<typeof neon> {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(databaseUrl);
}
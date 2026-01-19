import type { Config } from 'drizzle-kit';
import { app } from 'electron';
import path from 'path';

// For development, use a local path
const isDev = process.env.NODE_ENV === 'development';
const dbPath = isDev
  ? './data/shadower-dev.db'
  : path.join(app?.getPath('userData') || '.', 'data', 'shadower.db');

export default {
  schema: './src/lib/db/sqlite/schema.sqlite.ts',
  out: './src/lib/db/migrations/sqlite',
  dialect: 'sqlite',
  dbCredentials: {
    url: dbPath,
  },
  verbose: true,
  strict: true,
} satisfies Config;
